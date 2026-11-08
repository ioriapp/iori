import assert from "node:assert/strict";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";
import { runHostTest } from "../../verification/host/process.mjs";
import { actorCommand } from "../../verification/host/scripted-definition.mjs";
import { registerLifecycleCli } from "../../verification/host/lifecycle-definition.mjs";
import { registerResponseCli } from "../../verification/host/response-definition.mjs";

async function setup(client, dataRoot, actions, limit = "") {
  const parentCli = await registerLifecycleCli(client, dataRoot, "parent");
  const candidates = [];
  for (const action of actions) {
    const cli =
      action === "response"
        ? await registerResponseCli(client, dataRoot)
        : await registerLifecycleCli(client, dataRoot, action);
    candidates.push({ id: action, cli, model: "", tools: [], minimum: "" });
  }
  const team = await client.request("teams.create", {
    definition: {
      name: "Lifecycle",
      description: "",
      instruction: "",
      parent: {
        id: "parent",
        cli: parentCli,
        model: "",
        tools: [],
        minimum: "",
      },
      roles: [
        {
          id: "worker",
          name: "Worker",
          when: "",
          limit,
          reuse: true,
          split: false,
          instruction: "",
          request: "",
          report: "",
          candidates: { high: [], low: [], medium: candidates },
        },
      ],
    },
  });
  await client.request("teams.settings", {
    enabled: true,
    defaultTeam: team.saved.id,
    limits: {},
  });
  const events = await client.events();
  await events.waitFor((event) => event.type === "snapshot");
  const { terminal } = await client.request("team.launch", {
    teamId: team.saved.id,
    cwd: dataRoot,
  });
  const parent = await client.terminal(terminal.id);
  await parent.output("LIFECYCLE_READY:startup");
  await parent.output("LIFECYCLE_PARENT_INPUT:");
  return { parent, parentId: terminal.id, events };
}
async function delegate(context, id, body = "Do the work.") {
  const result = await actorCommand(context.parent, id, [
    "delegate",
    "--role",
    "Worker",
    "--difficulty",
    "low",
    "--title",
    id,
    "--worktree",
    "parent",
    "--body",
    body,
  ]);
  return result.data;
}
async function childTerminal(client, context, id) {
  const event = await context.events.waitFor(
    (e) =>
      e.type === "teams.child.updated" &&
      e.child.id === id &&
      e.child.terminalId,
  );
  return client.terminal(event.child.terminalId);
}

test("親が終了すると上限待ちを取り消し、動いている子は続く", (t) =>
  runHostTest(t, async ({ client, dataRoot, stage }) => {
    const context = await setup(client, dataRoot, ["report-later"], "1");
    stage("動作中の子と上限待ちの子を作る");
    const first = await delegate(context, "first", "AUTO_REPORT_COMPLETED");
    const child = await childTerminal(client, context, first.child);
    await child.output("LIFECYCLE_WORKING");
    const second = await delegate(context, "second");
    assert.equal(second.waiting, "capacity");
    stage("親CLIを終了し未起動の子が停止する");
    await context.parent.input("EXIT_NOW\r");
    await context.events.waitFor(
      (e) =>
        e.type === "teams.child.updated" &&
        e.child.id === second.child &&
        e.child.state === "stopped" &&
        e.child.stoppedBy === "parent_exit",
    );
    stage("動作中の子は報告できる");
    await writeFile(join(dataRoot, "release"), "done");
    await context.events.waitFor(
      (e) =>
        e.type === "teams.child.updated" &&
        e.child.id === first.child &&
        e.child.state === "reported",
    );
  }));

test("親が終了した後の子の報告を保留し再開後に読める", (t) =>
  runHostTest(t, async ({ client, dataRoot, stage }) => {
    const context = await setup(client, dataRoot, ["report-later"], "1");
    const first = await delegate(context, "first", "AUTO_REPORT_COMPLETED");
    const child = await childTerminal(client, context, first.child);
    await child.output("LIFECYCLE_WORKING");
    const queued = await delegate(context, "queued");
    assert.equal(queued.waiting, "capacity");
    stage("親CLIを終了後に子が報告する");
    await context.parent.input("EXIT_NOW\r");
    await context.events.waitFor(
      (e) =>
        e.type === "teams.child.updated" &&
        e.child.id === queued.child &&
        e.child.stoppedBy === "parent_exit",
    );
    await writeFile(join(dataRoot, "release"), "done");
    await context.events.waitFor(
      (e) =>
        e.type === "teams.child.updated" &&
        e.child.id === first.child &&
        e.child.state === "reported",
    );
    stage("親を再開して保留通知と報告本文を読む");
    await client.request("cli.resume", { terminalId: context.parentId });
    const parent = await client.terminal(context.parentId);
    await parent.output("LIFECYCLE_READY:resume");
    const tasks = await actorCommand(parent, "tasks", ["tasks"]);
    assert.equal(
      tasks.data.children.find((entry) => entry.child === first.child)
        .parentNoticePending,
      true,
    );
    const report = await actorCommand(parent, "read", ["read", first.child]);
    assert.match(JSON.stringify(report), /Completed the work\./u);
    await delegate({ ...context, parent }, "after-resume");
    const acknowledged = await actorCommand(parent, "acknowledged", ["tasks"]);
    assert.equal(
      acknowledged.data.children.find((entry) => entry.child === first.child)
        .parentNoticePending,
      undefined,
    );
  }));

test("承認待ちの回答は停止後も残り、再開時に届く", (t) =>
  runHostTest(t, async ({ client, dataRoot, stage }) => {
    const context = await setup(client, dataRoot, ["approval"]);
    const first = await delegate(context, "first");
    const child = await childTerminal(client, context, first.child);
    await child.output("LIFECYCLE_APPROVAL");
    const terminalId = (
      await client.request("teams.children", {})
    ).children.find((entry) => entry.id === first.child).terminalId;
    await context.events.waitFor(
      (e) =>
        e.type === "terminal.updated" &&
        e.terminal.id === terminalId &&
        e.terminal.cliStatus?.state === "waiting",
    );
    stage("承認待ちの子へ回答を送り、停止する");
    await actorCommand(context.parent, "answer", [
      "send",
      first.child,
      "--kind",
      "answer",
      "--body",
      "First answer.",
    ]);
    await actorCommand(context.parent, "stop", ["stop", first.child]);
    const pending = await actorCommand(context.parent, "pending", ["tasks"]);
    assert.equal(
      pending.data.children.find((entry) => entry.child === first.child)
        .pendingMessages,
      1,
    );
    stage("再開時に保留中の回答と次の回答が届く");
    const resumedEvents = await client.events();
    await resumedEvents.waitFor((e) => e.type === "snapshot");
    await actorCommand(context.parent, "resume", [
      "send",
      first.child,
      "--kind",
      "answer",
      "--body",
      "Second answer.",
    ]);
    await resumedEvents.waitFor(
      (e) =>
        e.type === "teams.child.updated" &&
        e.child.id === first.child &&
        e.child.state === "running",
    );
    const { output } = await client.terminalUntil(terminalId, ({ output }) =>
      output.includes("LIFECYCLE_DONE:2"),
    );
    assert.match(output, /First answer\./u);
    assert.match(output, /Second answer\./u);
    assert.ok(
      output.indexOf("First answer.") < output.indexOf("Second answer."),
    );
  }));

test("CLIの失敗後に直接入力すると作業中に戻り次の失敗も知らせる", (t) =>
  runHostTest(t, async ({ client, dataRoot, stage }) => {
    const context = await setup(client, dataRoot, ["failure"]);
    const first = await delegate(context, "first");
    const child = await childTerminal(client, context, first.child);
    await context.events.waitFor(
      (e) =>
        e.type === "teams.child.updated" &&
        e.child.id === first.child &&
        e.child.state === "failed",
    );
    await context.parent.output("failed:");
    stage("利用者が子に直接入力する");
    const retryEvents = await client.events();
    await retryEvents.waitFor((e) => e.type === "snapshot");
    await child.input("Try again.\r");
    await retryEvents.waitFor(
      (e) =>
        e.type === "teams.child.updated" &&
        e.child.id === first.child &&
        e.child.state === "running",
    );
    await retryEvents.waitFor(
      (e) =>
        e.type === "teams.child.updated" &&
        e.child.id === first.child &&
        e.child.state === "failed",
    );
    await child.output("LIFECYCLE_FAILED:2");
    await context.parent.waitFor(
      ({ output }) => (output.match(/failed:/gu) ?? []).length >= 2,
    );
  }));

test("候補のCLIの失敗を次の候補への続行案内とともに親へ知らせる", (t) =>
  runHostTest(t, async ({ client, dataRoot, stage }) => {
    const context = await setup(client, dataRoot, ["failure", "response"]);
    stage("子のCLIが失敗し親が続行の案内を受け取る");
    const first = await delegate(context, "first");
    const notice = await context.parent.output(
      `delegate again with --continue ${first.task}`,
    );
    assert.match(notice, /Model unavailable/u);
  }));

test("失敗した候補の次の候補へ依頼と失敗理由を引き継ぐ", (t) =>
  runHostTest(t, async ({ client, dataRoot, stage }) => {
    const context = await setup(client, dataRoot, ["failure", "response"], "1");
    stage("最初の候補が失敗する");
    const first = await delegate(
      context,
      "first",
      "Original work. AUTO_REPORT_COMPLETED",
    );
    await context.events.waitFor(
      (e) =>
        e.type === "teams.child.updated" &&
        e.child.id === first.child &&
        e.child.state === "failed",
    );
    await context.parent.output("Model unavailable");
    stage("同じ仕事を続行し次の候補が元の依頼を読む");
    const next = await actorCommand(context.parent, "continue", [
      "delegate",
      "--role",
      "Worker",
      "--difficulty",
      "low",
      "--title",
      "Continue",
      "--worktree",
      "parent",
      "--continue",
      first.task,
      "--body",
      "Continue the work.",
    ]);
    assert.equal(next.data.task, first.task);
    await context.events.waitFor(
      (e) =>
        e.type === "teams.child.updated" &&
        e.child.id === first.child &&
        e.child.state === "stopped" &&
        e.child.stoppedBy === "parent",
    );
    const child = await childTerminal(client, context, next.data.child);
    const output = await child.output("RESPONSE_TURN_DONE:1");
    const request = JSON.parse(output.match(/RESPONSE_BODY:(.+)\r?\n/u)[1]);
    assert.match(request, /Original work\./u);
    assert.match(request, /Model unavailable/u);
    await context.events.waitFor(
      (e) =>
        e.type === "teams.child.updated" &&
        e.child.id === next.data.child &&
        e.child.state === "reported",
    );
    const report = await actorCommand(context.parent, "read", [
      "read",
      next.data.child,
    ]);
    assert.match(JSON.stringify(report), /Completed the work\./u);
  }));
