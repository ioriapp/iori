import assert from "node:assert/strict";
import { watch } from "node:fs";
import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";
import { runHostTest } from "../../verification/host/process.mjs";

const definition = (id) => ({
  schema: 1,
  id,
  name: "Example CLI",
  command: "node",
});

test("アイコンの変更と復元で以前の画像を片付け、他のファイルを残す", (t) =>
  runHostTest(t, async ({ client, dataRoot, stage }) => {
    const value = definition("icon-cleanup");
    await client.request("cli.definition.save", {
      definition: JSON.stringify(value),
    });
    const folder = join(dataRoot, "iori-host", "cli-definitions", value.id);
    await writeFile(join(folder, "helper.txt"), "keep");
    const set = async (color) => {
      const uploadId = crypto.randomUUID();
      const image = `<svg xmlns="http://www.w3.org/2000/svg"><path fill="${color}" d="M0 0h1v1z"/></svg>`;
      await client.request("cli.definition.file.write", {
        uploadId,
        first: true,
        data: Buffer.from(image).toString("base64"),
      });
      await client.request("cli.icon.set", {
        cliId: value.id,
        image: { name: "icon.svg", uploadId },
      });
      return JSON.parse(await readFile(join(folder, "definition.json"), "utf8"))
        .icon.light;
    };
    stage("画像を入れ替え、以前の画像を消す");
    const first = await set("red");
    const second = await set("blue");
    assert.notEqual(first, second);
    assert.deepEqual(
      (await readdir(folder)).sort(),
      ["definition.json", "helper.txt", second].sort(),
    );
    stage("共通の画像へ戻し、最後の画像を消す");
    await client.request("cli.icon.set", { cliId: value.id });
    assert.deepEqual((await readdir(folder)).sort(), [
      "definition.json",
      "helper.txt",
    ]);
  }));

test("CLI定義を保存して再起動後も一覧から読める", (t) =>
  runHostTest(t, async ({ client, restart, stage }) => {
    const value = definition("example-cli");
    stage("定義を確認して保存する");
    const check = await client.request("cli.definition.check", {
      definition: JSON.stringify(value),
    });
    assert.equal(check.summary.id, value.id);
    assert.equal(check.summary.replaces, false);
    assert.equal(
      (
        await client.request("cli.definition.save", {
          definition: JSON.stringify(value),
        })
      ).cliId,
      value.id,
    );
    stage("再起動したHostで保存済みの定義が上書き対象になる");
    const restarted = await restart();
    const again = await restarted.request("cli.definition.check", {
      definition: JSON.stringify(value),
    });
    assert.equal(again.summary.replaces, true);
    assert.equal(again.summary.requiresConfirmation, true);
    const { clis } = await restarted.request("cli.list", {});
    assert.ok(clis.some((cli) => cli.id === value.id));
  }));

test("不正なCLI定義は理由を返し保存しない", (t) =>
  runHostTest(t, async ({ client, dataRoot, stage }) => {
    const value = {
      ...definition("invalid-cli"),
      launch: { model: "--model {model}" },
    };
    stage("引数の形が不正な定義を確認し保存する");
    const checked = await client.request("cli.definition.check", {
      definition: JSON.stringify(value),
    });
    const saved = await client.request("cli.definition.save", {
      definition: JSON.stringify(value),
    });
    assert.equal(checked.reason.field, "launch.model");
    assert.deepEqual(saved.reason, checked.reason);
    await assert.rejects(
      readFile(
        join(
          dataRoot,
          "iori-host",
          "cli-definitions",
          value.id,
          "definition.json",
        ),
      ),
    );
  }));

test("定義の外を指すアイコンを拒否する", (t) =>
  runHostTest(t, async ({ client, stage }) => {
    stage("定義フォルダーの外を参照するアイコンを確認する");
    const value = {
      ...definition("outside-icon"),
      icon: { light: "../icon.svg" },
    };
    const checked = await client.request("cli.definition.check", {
      definition: JSON.stringify(value),
    });
    const saved = await client.request("cli.definition.save", {
      definition: JSON.stringify(value),
    });
    assert.equal(checked.reason.field, "icon.light");
    assert.deepEqual(saved.reason, checked.reason);
  }));

test("編集しても利用者が置いた補助ファイルを残す", (t) =>
  runHostTest(t, async ({ client, dataRoot, stage }) => {
    const value = definition("with-helper");
    stage("定義のフォルダーに利用者の補助ファイルを置く");
    await client.request("cli.definition.save", {
      definition: JSON.stringify(value),
    });
    const folder = join(dataRoot, "iori-host", "cli-definitions", value.id);
    await mkdir(folder, { recursive: true });
    await writeFile(join(folder, "helper.txt"), "user content\n");
    stage("定義を編集し補助ファイルが残る");
    await client.request("cli.definition.save", {
      cliId: value.id,
      definition: JSON.stringify({ ...value, name: "Edited" }),
    });
    assert.equal(
      await readFile(join(folder, "helper.txt"), "utf8"),
      "user content\n",
    );
  }));

test("定義の添付画像は再登録で引き継ぎ、不要になると削除する", (t) =>
  runHostTest(t, async ({ client, dataRoot, stage }) => {
    const value = {
      ...definition("attached-cli"),
      icon: { light: "icon.svg" },
    };
    const text = JSON.stringify(value);
    stage("不足する画像を添付して定義を保存する");
    const missing = await client.request("cli.definition.save", {
      definition: text,
    });
    assert.deepEqual(missing.missing, ["icon.svg"]);
    const image =
      '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1 1"><path d="M0 0h1v1H0z"/></svg>';
    const uploadId = crypto.randomUUID();
    await client.request("cli.definition.file.write", {
      uploadId,
      first: true,
      data: Buffer.from(image).toString("base64"),
    });
    await client.request("cli.definition.save", {
      definition: text,
      files: [{ name: "icon.svg", uploadId }],
    });
    const path = join(
      dataRoot,
      "iori-host",
      "cli-definitions",
      value.id,
      "icon.svg",
    );
    assert.equal(await readFile(path, "utf8"), image);
    stage("同じ定義の再登録では画像を引き継ぐ");
    await client.request("cli.definition.save", { definition: text });
    assert.equal(await readFile(path, "utf8"), image);
    stage("画像を使わなくなった定義に入れ直すと画像を消す");
    await client.request("cli.definition.save", {
      definition: JSON.stringify(definition(value.id)),
    });
    await assert.rejects(readFile(path));
  }));

test("保存先の読めない定義を理由付きで一覧に返す", (t) =>
  runHostTest(t, async ({ client, dataRoot, stage }) => {
    stage("形の不正な定義ファイルを保存先に置く");
    const folder = join(dataRoot, "iori-host", "cli-definitions", "broken-cli");
    await mkdir(folder, { recursive: true });
    await writeFile(
      join(folder, "definition.json"),
      JSON.stringify({
        ...definition("broken-cli"),
        launch: { model: "--model {model}" },
      }),
    );
    stage("CLI一覧に不正な定義と理由が出る");
    const list = await client.request("cli.list");
    const failed = list.failed.find((entry) => entry.folder === "broken-cli");
    assert.equal(failed.reason.field, "launch.model");
  }));

test("定義の確認に書き換えるhooks設定ファイルが出る", (t) =>
  runHostTest(t, async ({ client, dataRoot, stage }) => {
    const settings = join(dataRoot, "hooks.toml");
    const value = {
      ...definition("toml-cli"),
      hooks: {
        file: settings,
        format: "list",
        at: "hooks",
        entry: { event: "{event}", command: "{command}" },
        sessionId: "session_id",
        rules: [{ event: "Stop", state: "done" }],
      },
    };
    stage("hooksを持つ定義の影響を確認する");
    const result = await client.request("cli.definition.check", {
      definition: JSON.stringify(value),
    });
    assert.deepEqual(result.summary.settings, [settings]);
    assert.equal(result.summary.requiresConfirmation, true);
  }));

async function waitForFile(path, predicate) {
  let changed = false;
  let wake;
  const watcher = watch(join(path, ".."), () => {
    changed = true;
    wake?.();
  });
  try {
    for (;;) {
      changed = false;
      const text = await readFile(path, "utf8").catch((error) => {
        if (error.code === "ENOENT") return "";
        throw error;
      });
      if (predicate(text)) return text;
      if (!changed)
        await new Promise((resolve) => {
          wake = resolve;
        });
      wake = undefined;
    }
  } finally {
    watcher.close();
  }
}

test("TOMLのhooksは利用者の内容を残して追加し、定義の削除で元に戻す", (t) =>
  runHostTest(t, async ({ client, dataRoot, stage }) => {
    const settings = join(dataRoot, "hooks.toml");
    const original =
      '# user settings\n[[hooks]]\nevent = "Notification"\ncommand = "user-command"\n';
    await writeFile(settings, original);
    const value = {
      ...definition("toml-hooks"),
      hooks: {
        file: settings,
        format: "list",
        at: "hooks",
        entry: { event: "{event}", command: "{command}" },
        sessionId: "session_id",
        rules: [
          { event: "SessionStart", state: "idle" },
          { event: "Stop", state: "done" },
        ],
      },
    };
    stage("定義を保存してCLIを起動する");
    await client.request("cli.definition.save", {
      definition: JSON.stringify(value),
    });
    await client.request("cli.launch", { cliId: value.id, cwd: dataRoot });
    const installed = await waitForFile(settings, (text) =>
      text.includes("'Stop' '-' 'toml-hooks'"),
    );
    assert.ok(installed.startsWith(original));
    for (const event of ["SessionStart", "Stop"])
      assert.match(
        installed,
        new RegExp(
          `\\[\\[hooks\\]\\]\\nevent = "${event}"\\ncommand = "[^"\\n]*iori-cli-hook[^"\\n]*'${event}' '-' 'toml-hooks'"`,
          "u",
        ),
      );
    stage("定義を削除して利用者の設定を残す");
    await client.request("cli.definition.remove", { cliId: value.id });
    assert.equal(await readFile(settings, "utf8"), original);
  }));

test("プラグインの定義削除ではioriが置いたファイルだけ消す", (t) =>
  runHostTest(t, async ({ client, dataRoot, stage }) => {
    const target = join(dataRoot, "plugins");
    await mkdir(target);
    const actor = join(dataRoot, "plugin-cli.mjs");
    await writeFile(
      actor,
      'console.log("PLUGIN_READY"); process.stdin.resume();\n',
    );
    const foreign = join(target, "foreign.js");
    await writeFile(foreign, "user plugin\n");
    const register = async (id, name, contents) => {
      const uploadId = crypto.randomUUID();
      await client.request("cli.definition.file.write", {
        uploadId,
        first: true,
        data: Buffer.from(contents).toString("base64"),
      });
      await client.request("cli.definition.save", {
        definition: JSON.stringify({
          ...definition(id),
          command: { shell: `'${process.execPath}' '${actor}'` },
          hooks: { format: "plugin-file", install: { copy: name, to: target } },
        }),
        files: [{ name, uploadId }],
      });
    };
    stage("定義に付属するプラグインを起動で置く");
    await register("plugin-cli", "plugin.js", "iori plugin\n");
    await client.request("cli.launch", { cliId: "plugin-cli", cwd: dataRoot });
    await waitForFile(
      join(target, "plugin.js"),
      (text) => text === "iori plugin\n",
    );
    stage("定義削除で置いたプラグインを消し、利用者のファイルを残す");
    await client.request("cli.definition.remove", { cliId: "plugin-cli" });
    await assert.rejects(readFile(join(target, "plugin.js")));
    assert.equal(await readFile(foreign, "utf8"), "user plugin\n");
    stage("同名の利用者のファイルを上書きせず、削除でも残す");
    await register("foreign-cli", "foreign.js", "iori plugin\n");
    const { terminal } = await client.request("cli.launch", {
      cliId: "foreign-cli",
      cwd: dataRoot,
    });
    await (await client.terminal(terminal.id)).output("PLUGIN_READY");
    await client.request("cli.definition.remove", { cliId: "foreign-cli" });
    assert.equal(await readFile(foreign, "utf8"), "user plugin\n");
  }));
