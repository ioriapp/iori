import assert from "node:assert/strict";
import test from "node:test";
import { runHostTest } from "../../verification/host/process.mjs";
import {
  actorCommand,
  registerScriptedCli,
} from "../../verification/host/scripted-definition.mjs";

test("hookもpasteの印もない子のPTYに最初の依頼が一度だけ届く", (t) =>
  runHostTest(t, async ({ client, dataRoot, stage }) => {
    stage("親と子のCLIの定義を登録する");
    const parentCli = await registerScriptedCli(client, dataRoot);
    const childCli = await registerScriptedCli(client, dataRoot, {
      noReady: true,
    });
    const candidate = {
      id: "worker-candidate",
      cli: childCli,
      model: "",
      tools: [],
      minimum: "",
    };
    stage("子の候補を持つチームを作って有効にする");
    const team = await client.request("teams.create", {
      definition: {
        name: "Initial input",
        description: "",
        instruction: "",
        parent: { ...candidate, id: "parent", cli: parentCli },
        roles: [
          {
            id: "worker",
            name: "Worker",
            when: "",
            limit: "",
            reuse: true,
            split: false,
            instruction: "",
            request: "",
            report: "",
            candidates: { high: [], medium: [candidate], low: [] },
          },
        ],
      },
    });
    await client.request("teams.settings", {
      enabled: true,
      defaultTeam: team.saved.id,
      limits: {},
    });
    stage("チームの親のPTYが入力を受け付ける");
    const events = await client.events();
    await events.waitFor((event) => event.type === "snapshot");
    const { terminal: parent } = await client.request("team.launch", {
      teamId: team.saved.id,
      cwd: dataRoot,
    });
    const parentPty = await client.terminal(parent.id);
    await parentPty.output("ACTOR_READY");
    // The parent definition takes its instructions as typed input.
    await parentPty.output("ACTOR_PROMPT:");
    stage("親のPTYから子へ委譲する");
    const delegated = await actorCommand(parentPty, "delegate", [
      "delegate",
      "--role",
      "Worker",
      "--difficulty",
      "low",
      "--title",
      "First request",
      "--worktree",
      "parent",
      "--body",
      "Receive the first request.",
    ]);
    const childId = delegated.data.child;
    stage("委譲した子のPTYを開いて最初の画面を受け取る");
    const changed = await events.waitFor(
      (event) =>
        event.type === "teams.child.updated" &&
        event.child.id === childId &&
        event.child.terminalId,
    );
    const child = await client.terminal(changed.child.terminalId);
    await child.output("NO_READY_SCREEN");
    stage("子のPTYに最初の依頼が届く");
    await child.output("INITIAL_REQUEST_RECEIVED:Open the file");
    stage("親のPTYから子へ後続の依頼を送る");
    await actorCommand(parentPty, "barrier", [
      "send",
      childId,
      "--kind",
      "request",
      "--body",
      "INITIAL_INPUT_BARRIER",
    ]);
    stage("子が後続の依頼を受け、初回依頼が一度だけ届いたと返す");
    const { output } = await child.waitFor(({ output }) =>
      /INITIAL_INPUT_COUNT=\d+\r?\n/u.test(output),
    );
    assert.equal(Number(output.match(/INITIAL_INPUT_COUNT=(\d+)\r?\n/u)[1]), 1);
  }));
