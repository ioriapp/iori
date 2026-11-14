import assert from "node:assert/strict";
import { access, mkdir, readFile, watch, writeFile } from "node:fs/promises";
import { join, relative, dirname } from "node:path";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import { runHostTest } from "../../verification/host/process.mjs";
import {
  automationDefinition,
  delivered,
  launchedRun,
  registerAutomationCli,
} from "../../verification/host/automation-definition.mjs";

async function save(client, dataRoot, changes = {}) {
  const cli = await registerAutomationCli(client, dataRoot);
  const definition = automationDefinition(cli, dataRoot, changes);
  return {
    ...(await client.request("automation.save", { definition })),
    definition,
  };
}

// Only stopped verification data is moved back in time; the real Host creates the runs.
function pastSchedule(dataRoot, id, nextAt) {
  const db = new DatabaseSync(join(dataRoot, "iori-host", "host.sqlite"));
  try {
    const value = JSON.parse(
      db.prepare("SELECT value_json FROM automations WHERE id = ?").get(id)
        .value_json,
    );
    value.nextAt = nextAt;
    db.prepare("UPDATE automations SET value_json = ? WHERE id = ?").run(
      JSON.stringify(value),
      id,
    );
  } finally {
    db.close();
  }
}

test("無効な自動化も今すぐ実行でき、複数行の指示のコピーをCLIへ渡す", (t) =>
  runHostTest(t, async ({ client, dataRoot, stage }) => {
    const { automation, definition } = await save(client, dataRoot, {
      enabled: false,
    });
    stage("手動で実行してCLIが読んだ指示を確かめる");
    const { run } = await client.request("automation.run", {
      id: automation.id,
    });
    assert.equal(
      (await client.request("automation.history", { id: automation.id })).runs
        .length,
      1,
    );
    const terminal = await client.terminal(run.terminalId);
    assert.equal(await delivered(terminal), definition.instruction);
    const file = await delivered(terminal, "FILE");
    const hostData = join(dataRoot, "iori-host");
    assert.ok(
      !relative(join(hostData, "team-deliveries"), file).startsWith(".."),
    );
    assert.equal(await readFile(file, "utf8"), definition.instruction);
    stage("Terminalを閉じた後で配送したコピーが回収される");
    const changes = watch(dirname(file));
    const notifications = changes[Symbol.asyncIterator]();
    const pending = notifications.next();
    await client.request("terminal.close", {
      terminalId: run.terminalId,
      confirm: true,
    });
    try {
      for (
        let next = pending;
        await access(file).then(
          () => true,
          () => false,
        );
        next = notifications.next()
      )
        await next;
    } finally {
      await notifications.return();
    }
    await assert.rejects(access(file), { code: "ENOENT" });
  }));

test("自動化の設定と実行履歴をHostの再起動後も保持する", (t) =>
  runHostTest(t, async ({ client, dataRoot, restart, stage }) => {
    const { automation, definition } = await save(client, dataRoot);
    const { run } = await client.request("automation.run", {
      id: automation.id,
    });
    stage("Hostを再起動して設定と会話の履歴を読む");
    client = await restart();
    const saved = (await client.request("automation.list")).automations.find(
      (item) => item.id === automation.id,
    );
    assert.equal(saved.instruction, definition.instruction);
    assert.deepEqual(saved.target, definition.target);
    assert.equal(
      (await client.request("automation.history", { id: automation.id }))
        .runs[0].terminalId,
      run.terminalId,
    );
  }));

test("存在しないフォルダーの起動失敗を履歴へ残し、編集した場所で再実行できる", (t) =>
  runHostTest(t, async ({ client, dataRoot, stage }) => {
    const { automation, definition } = await save(client, dataRoot, {
      cwd: join(dataRoot, "missing"),
    });
    const { run: failed } = await client.request("automation.run", {
      id: automation.id,
    });
    assert.match(failed.launchError, /folder/u);
    assert.equal(failed.terminalId, undefined);
    stage("作業場所を直し、履歴を残したままCLIを起動する");
    await client.request("automation.save", {
      id: automation.id,
      definition: { ...definition, cwd: dataRoot },
    });
    const { run } = await client.request("automation.run", {
      id: automation.id,
    });
    assert.ok(run.terminalId);
    assert.equal(
      await delivered(await client.terminal(run.terminalId)),
      definition.instruction,
    );
    assert.deepEqual(
      new Set(
        (
          await client.request("automation.history", { id: automation.id })
        ).runs.map((run) => run.id),
      ),
      new Set([failed.id, run.id]),
    );
  }));

test("指示ファイルの準備に失敗した理由を履歴へ残す", (t) =>
  runHostTest(t, async ({ client, dataRoot }) => {
    const { automation } = await save(client, dataRoot);
    const root = join(dataRoot, "iori-host", "automation-files");
    await mkdir(root, { recursive: true });
    await writeFile(join(root, automation.id), "blocks directory creation");
    const { run } = await client.request("automation.run", {
      id: automation.id,
    });
    assert.ok(run.launchError);
    assert.equal(run.terminalId, undefined);
    const { runs } = await client.request("automation.history", {
      id: automation.id,
    });
    assert.equal(runs[0].launchError, run.launchError);
  }));

test("親CLIが未設定のチームを実行すると設定の案内を履歴に残す", (t) =>
  runHostTest(t, async ({ client, dataRoot }) => {
    const team = await client.request("teams.create", {
      template: "development",
      language: "ja",
    });
    await client.request("teams.settings", {
      enabled: true,
      defaultTeam: team.saved.id,
      limits: {},
    });
    const { automation } = await save(client, dataRoot, {
      target: { kind: "team", teamId: team.saved.id },
    });
    const { run } = await client.request("automation.run", {
      id: automation.id,
    });
    assert.equal(
      run.launchError,
      "This team has no parent CLI. Edit the team and choose one.",
    );
    assert.equal(run.terminalId, undefined);
    const history = await client.request("automation.history", {
      id: automation.id,
    });
    assert.equal(history.runs[0].launchError, run.launchError);
  }));

test("稼働中に一回の予定の時刻が来ると起動して無効になる", (t) =>
  runHostTest(t, async ({ client, dataRoot }) => {
    const at = Date.now() + 1500;
    const { automation } = await save(client, dataRoot, {
      schedule: { kind: "once", at },
    });
    const run = await launchedRun(client, automation.id);
    assert.equal(run.scheduledAt, at);
    assert.equal(run.trigger, "schedule");
    assert.equal(
      (await client.request("automation.list")).automations.find(
        (item) => item.id === automation.id,
      ).enabled,
      false,
    );
  }));

test("一回の予定は起動後に無効になり、同じ予定を再起動で重ねない", (t) =>
  runHostTest(t, async ({ client, dataRoot, restart, stage }) => {
    const { automation } = await save(client, dataRoot, {
      schedule: { kind: "once", at: Date.now() + 86400000 },
    });
    stage("停止中に過ぎた一回の予定をHostの起動で拾う");
    const scheduledAt = Date.now() - 1000;
    client = await restart({
      whileStopped: () => pastSchedule(dataRoot, automation.id, scheduledAt),
    });
    const run = await launchedRun(client, automation.id);
    assert.equal(run.scheduledAt, scheduledAt);
    assert.equal(
      (await client.request("automation.list")).automations.find(
        (item) => item.id === automation.id,
      ).enabled,
      false,
    );
    client = await restart();
    assert.equal(
      (await client.request("automation.history", { id: automation.id })).runs
        .length,
      1,
    );
  }));

for (const missed of ["latest", "skip"])
  test(`停止中の毎日の予定は${missed === "latest" ? "最新だけ実行する" : "全て記録だけ残す"}`, (t) =>
    runHostTest(t, async ({ client, dataRoot, restart, stage }) => {
      const { automation } = await save(client, dataRoot, {
        schedule: { kind: "daily", time: "00:00" },
        missed,
      });
      // Start from the Host's own next date, just as the original screen scenario does.
      const nextAt = automation.nextAt - 3 * 86400000;
      stage("過ぎた予定を再起動後の履歴で読む");
      client = await restart({
        whileStopped: () => pastSchedule(dataRoot, automation.id, nextAt),
      });
      if (missed === "latest") await launchedRun(client, automation.id);
      const { runs } = await client.request("automation.history", {
        id: automation.id,
      });
      assert.equal(runs.length, 3);
      assert.equal(
        runs.filter((run) => run.terminalId).length,
        missed === "latest" ? 1 : 0,
      );
      assert.equal(
        runs.filter((run) => run.reason === "offline").length,
        missed === "latest" ? 2 : 3,
      );
    }));

test("自動化を削除しても開始済みの会話は残る", (t) =>
  runHostTest(t, async ({ client, dataRoot }) => {
    const { automation } = await save(client, dataRoot);
    const { run } = await client.request("automation.run", {
      id: automation.id,
    });
    await client.request("automation.delete", { id: automation.id });
    assert.equal(
      (await client.request("automation.list")).automations.some(
        (item) => item.id === automation.id,
      ),
      false,
    );
    assert.deepEqual(
      (await client.request("automation.history", { id: automation.id })).runs,
      [],
    );
    assert.ok(
      (await client.request("terminal.list")).terminals.some(
        (item) => item.id === run.terminalId,
      ),
    );
  }));
