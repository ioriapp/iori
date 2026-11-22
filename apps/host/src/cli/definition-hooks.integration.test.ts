import { test, type TestContext } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import {
  cliDefinitions,
  loadCliDefinitions,
  saveUserDefinition,
} from "./definitions.ts";
import { hookInstallContext } from "./hook-install.ts";

// E2E runs one Host for each home. Two Hosts of one OS user, each with its
// own storage, write the same CLI settings files: a Host reading its own
// definitions must not take the other Host's hooks for stale ones.
test(
  "同じHOMEの2つのHostで、片方のHostの定義の読み込みが他方のHostの定義のhooksを消さない",
  { skip: process.platform === "win32" },
  async () => {
    const home = await mkdtemp(join(tmpdir(), "iori-definition-hooks-"));
    const names = ["HOME", "XDG_CONFIG_HOME", "PI_CODING_AGENT_DIR"];
    const original = names.map((name) => process.env[name]);
    process.env.HOME = home;
    process.env.XDG_CONFIG_HOME = join(home, ".config");
    process.env.PI_CODING_AGENT_DIR = join(home, ".pi", "agent");
    try {
      const settings = join(home, "settings.json");
      await writeFile(settings, JSON.stringify({ theme: "dark" }));
      const first = join(home, "first-host");
      await saveUserDefinition(
        first,
        "first-cli",
        JSON.stringify({
          schema: 1,
          id: "first-cli",
          name: "First CLI",
          command: "first-cli",
          hooks: {
            format: "claude-settings",
            file: settings,
            rules: [{ event: "Stop", state: "done" }],
          },
        }),
      );
      const shell = {
        id: "bash",
        label: "Bash",
        executable: "/bin/bash",
        args: [],
      };
      const definition = cliDefinitions.find((cli) => cli.id === "first-cli");
      await definition?.hooks?.install(
        await hookInstallContext(
          shell,
          "first-cli",
          "",
          true,
          undefined,
          first,
        ),
      );
      const installed = await readFile(settings, "utf8");
      assert.match(installed, /iori-cli-hook/u);
      // The other Host's storage does not have the first Host's definition.
      await loadCliDefinitions(join(home, "second-host"));
      assert.equal(await readFile(settings, "utf8"), installed);
    } finally {
      names.forEach((name, index) => {
        if (original[index] === undefined) delete process.env[name];
        else process.env[name] = original[index];
      });
      await rm(home, { recursive: true, force: true });
    }
  },
);

// The web runner isolates HOME for each Host, so it cannot cover Hosts that
// share a user's CLI settings and shared hook script.
test(
  "同じHOMEのHostで、定義の取り付け・削除・撤去が他方の出来事と共有scriptを消さず、保存先の無い記録を外し、並行の準備でも各CLIの記録と拡張を保つ",
  { skip: process.platform === "win32" },
  async () => {
    const home = await mkdtemp(join(tmpdir(), "iori-shared-hooks-"));
    const names = ["HOME", "XDG_CONFIG_HOME", "PI_CODING_AGENT_DIR"];
    const original = names.map((name) => process.env[name]);
    process.env.HOME = home;
    process.env.XDG_CONFIG_HOME = join(home, ".config");
    process.env.PI_CODING_AGENT_DIR = join(home, ".pi", "agent");
    try {
      const { removeCliHooks } = await import("./hook-install.ts");
      const { removeUserDefinition } = await import("./definitions.ts");
      const { readdir } = await import("node:fs/promises");
      const first = join(home, "first-host");
      const second = join(home, "second-host");
      const shell = {
        id: "bash",
        label: "Bash",
        executable: "/bin/bash",
        args: [],
      };
      const settings = join(home, "shared.json");
      const script = join(home, ".iori", "hooks", "iori-cli-hook.mjs");
      const install = async (root: string, events: string[]) => {
        await saveUserDefinition(
          root,
          "shared-cli",
          JSON.stringify({
            schema: 1,
            id: "shared-cli",
            name: "Shared CLI",
            command: "shared-cli",
            hooks: {
              format: "claude-settings",
              file: settings,
              rules: events.map((event) => ({ event, state: "done" })),
            },
          }),
        );
        await cliDefinitions
          .find((cli) => cli.id === "shared-cli")!
          .hooks!.install(
            await hookInstallContext(
              shell,
              "shared-cli",
              "",
              true,
              undefined,
              root,
            ),
          );
      };
      const events = async () =>
        Object.keys(
          JSON.parse(await readFile(settings, "utf8")).hooks ?? {},
        ).sort();
      await install(first, ["Stop"]);
      await install(second, ["Stop"]);
      // Same id and same event share one invocation, not duplicate reports.
      assert.equal(
        JSON.parse(await readFile(settings, "utf8")).hooks.Stop.length,
        1,
      );
      await removeUserDefinition(second, "shared-cli");
      assert.deepEqual(await events(), ["Stop"]);
      await install(second, ["PreToolUse"]);
      assert.deepEqual(await events(), ["PreToolUse", "Stop"]);
      await removeCliHooks(shell, second);
      assert.deepEqual(await events(), ["Stop"]);
      assert.match(await readFile(script, "utf8"), /IORI_CLI_HOOK_URL/u);
      // Built-in removal must keep the other Host's same built-in as well.
      // A Host prepares its previously opened CLIs concurrently on startup.
      // No held promises or fake delay: these are the real install paths.
      const ids = ["claude", "cursor", "antigravity", "pi", "opencode"];
      const prepare = (root: string) =>
        Promise.all(
          ids.map(async (id) => {
            await cliDefinitions
              .find((cli) => cli.id === id)!
              .hooks!.install(
                await hookInstallContext(shell, id, "", true, undefined, root),
              );
          }),
        );
      await prepare(first);
      await prepare(second);
      const registry = join(home, ".iori", "hooks", "hosts");
      for (const file of await readdir(registry)) {
        const record = JSON.parse(await readFile(join(registry, file), "utf8"));
        for (const id of ids)
          assert.ok(record.clis.includes(id), `missing CLI: ${id}`);
        for (const id of ["claude", "cursor", "antigravity"])
          assert.ok(record.hooks[id], `missing hooks: ${id}`);
      }
      const sharedFiles = [
        join(home, ".claude", "settings.json"),
        join(home, ".cursor", "hooks.json"),
        join(home, ".gemini", "config", "hooks.json"),
        join(home, ".pi", "agent", "extensions", "iori-agent-status.ts"),
        join(home, ".config", "opencode", "plugins", "iori-status.js"),
      ];
      const beforeRemoval = await Promise.all(
        sharedFiles.map((file) => readFile(file, "utf8")),
      );
      await loadCliDefinitions(first);
      assert.deepEqual(
        await Promise.all(sharedFiles.map((file) => readFile(file, "utf8"))),
        beforeRemoval,
      );
      const cursorFile = join(home, ".cursor", "hooks.json");
      const cursorBefore = await readFile(cursorFile, "utf8");
      await removeCliHooks(shell, second);
      assert.equal(await readFile(cursorFile, "utf8"), cursorBefore);
      await readFile(script);
      assert.deepEqual(
        await Promise.all(sharedFiles.map((file) => readFile(file, "utf8"))),
        beforeRemoval,
      );
      await mkdir(second, { recursive: true });
      await install(second, ["PreToolUse"]);
      assert.equal((await readdir(registry)).length, 2);
      await rm(second, { recursive: true, force: true });
      await install(first, ["Stop"]);
      assert.equal((await readdir(registry)).length, 1);
      assert.deepEqual(await events(), ["Stop"]);
      await removeCliHooks(shell, first);
      await assert.rejects(readFile(script), { code: "ENOENT" });
      for (const file of sharedFiles.slice(-2))
        await assert.rejects(readFile(file), { code: "ENOENT" });
    } finally {
      names.forEach((name, index) => {
        if (original[index] === undefined) delete process.env[name];
        else process.env[name] = original[index];
      });
      await rm(home, { recursive: true, force: true });
    }
  },
);

const bridges = [
  ["pi", ".pi/agent/extensions/iori-agent-status.ts"],
  ["opencode", ".config/opencode/plugins/iori-status.js"],
] as const;

async function bridgeContext(t: TestContext, id: string) {
  const home = await mkdtemp(join(tmpdir(), "iori-bridge-"));
  const env = {
    HOME: home,
    XDG_CONFIG_HOME: join(home, ".config"),
    PI_CODING_AGENT_DIR: join(home, ".pi", "agent"),
  };
  const original = Object.keys(env).map(
    (name) => [name, process.env[name]] as const,
  );
  Object.assign(process.env, env);
  t.after(async () => {
    for (const [name, value] of original) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
    await rm(home, { recursive: true, force: true });
  });
  const root = join(home, "host");
  await mkdir(root);
  const shell = {
    id: "bash",
    label: "Bash",
    executable: "/bin/bash",
    args: [],
  };
  const hooks = cliDefinitions.find((cli) => cli.id === id)!.hooks!;
  const ctx = await hookInstallContext(shell, id, "", true, undefined, root);
  return { home, hooks, ctx };
}

for (const [id, relativePath] of bridges) {
  test(
    `${id}: ユーザーの同名プラグインを取り付けと撤去で保持する`,
    { skip: process.platform === "win32" },
    async (t) => {
      const { home, hooks, ctx } = await bridgeContext(t, id);
      const path = join(home, relativePath);
      await mkdir(dirname(path), { recursive: true });
      const content = "export default function userPlugin() {}\n";
      await writeFile(path, content);
      await t.test("取り付け", async () => {
        await hooks.install(ctx);
        assert.equal(await readFile(path, "utf8"), content);
      });
      await writeFile(path, content);
      await t.test("撤去", async () => {
        await hooks.remove(ctx);
        assert.equal(await readFile(path, "utf8"), content);
      });
    },
  );

  test(
    `${id}: 同梱プラグインを引き継ぎ、記録した内容なら更新と撤去ができる`,
    { skip: process.platform === "win32" },
    async (t) => {
      const { home, hooks, ctx } = await bridgeContext(t, id);
      const path = join(home, relativePath);
      await hooks.install(ctx);
      const bundled = await readFile(path, "utf8");
      // Older releases wrote the same header without recording ownership.
      const legacy =
        "// Copyright (c) 2026 Lovecast Inc.; MIT license accompanies iori Host (cli/ORCA-LICENSE.txt).\n" +
        "const url = process.env.IORI_CLI_HOOK_URL;\n";
      await rm(ctx.writtenPath!, { force: true });
      await writeFile(path, legacy);
      await hooks.install(ctx);
      assert.equal(await readFile(path, "utf8"), bundled);
      await rm(ctx.writtenPath!, { force: true });
      await writeFile(path, legacy);
      await hooks.remove(ctx);
      await assert.rejects(readFile(path), { code: "ENOENT" });

      await hooks.install(ctx);
      await rm(ctx.writtenPath!, { force: true }); // Stable releases did not record these bridges.
      await hooks.install(ctx);
      const record = JSON.parse(await readFile(ctx.writtenPath!, "utf8"));
      const earlier = bundled + "// earlier bridge version\n";
      record[id].copy.sha256 = createHash("sha256")
        .update(earlier)
        .digest("hex");
      await writeFile(ctx.writtenPath!, JSON.stringify(record));
      await writeFile(path, earlier);
      await hooks.install(ctx);
      assert.equal(await readFile(path, "utf8"), bundled);

      const changed = bundled + "// user edit\n";
      await writeFile(path, changed);
      await hooks.install(ctx);
      assert.equal(await readFile(path, "utf8"), changed);
      await hooks.remove(ctx);
      assert.equal(await readFile(path, "utf8"), changed);

      await rm(path);
      await hooks.install(ctx);
      await hooks.remove(ctx);
      await assert.rejects(readFile(path), { code: "ENOENT" });
    },
  );
}
