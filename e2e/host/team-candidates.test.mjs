import assert from "node:assert/strict";
import test from "node:test";
import { runHostTest } from "../../verification/host/process.mjs";
import {
  actorCommand,
  registerScriptedCli,
} from "../../verification/host/scripted-definition.mjs";
import { registerResponseCli } from "../../verification/host/response-definition.mjs";

async function setup(client, dataRoot) {
  const parentCli = await registerScriptedCli(client, dataRoot, {
    noReady: true,
  });
  const workerCli = await registerResponseCli(client, dataRoot);
  const candidate = (id, cli) => ({
    id,
    cli,
    model: "",
    tools: [],
    minimum: "",
  });
  const definition = {
    name: "Candidates",
    description: "",
    instruction: "",
    parent: candidate("parent", parentCli),
    roles: [
      {
        id: "worker",
        name: "Worker",
        when: "",
        limit: "1",
        reuse: false,
        split: false,
        instruction: "",
        request: "",
        report: "",
        candidates: {
          high: [],
          low: [],
          medium: [candidate("missing", "absent-notification-cli")],
        },
      },
    ],
  };
  const team = await client.request("teams.create", { definition });
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
  await parent.output("NO_READY_SCREEN");
  await parent.output("INITIAL_REQUEST_RECEIVED:");
  return {
    parent,
    events,
    teamId: team.saved.id,
    definition: team.saved,
    worker: candidate("worker", workerCli),
  };
}

const notice =
  "No available candidate for this delegation. Edit the team, then run iori tasks.";

const delegate = (parent, id, title) =>
  actorCommand(parent, id, [
    "delegate",
    "--role",
    "Worker",
    "--difficulty",
    "low",
    "--title",
    title,
    "--worktree",
    "parent",
    "--body",
    "AUTO_INTERRUPT",
  ]);

async function startFirst(client, context) {
  const first = await delegate(context.parent, "first", "First");
  assert.equal(first.data.waiting, "candidates");
  await actorCommand(context.parent, "initial-barrier", ["tasks"]);
  const output = await context.parent.output("ACTOR_RESULT:initial-barrier:");
  assert.doesNotMatch(output, /No available candidate for this delegation/u);
  const active = structuredClone(context.definition);
  active.roles[0].candidates.medium = [context.worker];
  await client.request("teams.save", {
    teamId: context.teamId,
    definition: active,
  });
  const started = await context.events.waitFor(
    (event) =>
      event.type === "teams.child.updated" &&
      event.child.id === first.data.child &&
      event.child.terminalId,
  );
  const child = await client.terminal(started.child.terminalId);
  await child.output("RESPONSE_ACTIVE");
  return first;
}

test("上限待ちが候補なしに変わると親へ知らせる", (t) =>
  runHostTest(t, async ({ client, dataRoot, stage }) => {
    stage("最初の候補なしを返答し、候補を追加して子を起動する");
    const context = await setup(client, dataRoot);
    await startFirst(client, context);
    stage("上限待ちを作り、使える候補をなくす");
    const second = await delegate(context.parent, "second", "Second");
    assert.equal(second.data.waiting, "capacity");
    await client.request("teams.save", {
      teamId: context.teamId,
      definition: context.definition,
    });
    await context.events.waitFor(
      (event) =>
        event.type === "teams.child.updated" &&
        event.child.id === second.data.child &&
        event.child.waiting === "candidates",
    );
    await context.parent.output(notice);
    await actorCommand(context.parent, "later-barrier", ["tasks"]);
    const output = await context.parent.output("ACTOR_RESULT:later-barrier:");
    assert.equal(output.split(notice).length - 1, 1);
  }));

test("再利用しない子を作り直して候補なしになれば親へ知らせる", (t) =>
  runHostTest(t, async ({ client, dataRoot, stage }) => {
    stage("候補を追加して最初の子を起動する");
    const context = await setup(client, dataRoot);
    const first = await startFirst(client, context);
    await client.request("teams.save", {
      teamId: context.teamId,
      definition: context.definition,
    });
    stage("再利用しない子へ依頼を送り、作り直した子の候補なしを受け取る");
    await actorCommand(context.parent, "replace", [
      "send",
      first.data.child,
      "--kind",
      "request",
      "--body",
      "Check again.",
    ]);
    await context.events.waitFor(
      (event) =>
        event.type === "teams.child.updated" &&
        event.child.id !== first.data.child &&
        event.child.waiting === "candidates",
    );
    await context.parent.output(notice);
    await actorCommand(context.parent, "barrier", ["tasks"]);
    const output = await context.parent.output("ACTOR_RESULT:barrier:");
    assert.equal(output.split(notice).length - 1, 1);
  }));

test("HostとTerminalの係の再起動で未起動の委譲は再起動による停止になる", (t) =>
  runHostTest(t, async ({ client, dataRoot, restart, stage }) => {
    stage("使える候補がない子を委譲する");
    const context = await setup(client, dataRoot);
    const waiting = await delegate(context.parent, "waiting", "Waiting");
    assert.equal(waiting.data.waiting, "candidates");
    stage("検証専用のTerminalの係とHostを再起動する");
    const { stopTerminalDaemon } =
      await import("../../verification/terminal/daemon-process.mjs");
    const { join } = await import("node:path");
    const reconnected = await restart({
      whileStopped: () => stopTerminalDaemon(join(dataRoot, "iori-host")),
    });
    stage("保存された子の停止理由を取得する");
    const result = await reconnected.request("teams.children", {});
    const child = result.children.find(
      (entry) => entry.id === waiting.data.child,
    );
    assert.equal(child.state, "stopped");
    assert.equal(child.stoppedBy, "host_restart");
  }));
