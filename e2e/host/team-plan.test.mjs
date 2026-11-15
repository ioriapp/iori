import assert from "node:assert/strict";
import test from "node:test";
import { runHostTest } from "../../verification/host/process.mjs";
import {
  automationCommand,
  delivered,
  registerAutomationCli,
} from "../../verification/host/automation-definition.mjs";

async function launchParent(client, dataRoot) {
  const cli = await registerAutomationCli(client, dataRoot);
  const team = await client.request("teams.create", {
    definition: {
      name: "Plan",
      description: "",
      instruction: "",
      parent: { id: "parent", cli, model: "", tools: [], minimum: "" },
      roles: [],
    },
  });
  await client.request("teams.settings", {
    enabled: true,
    defaultTeam: team.saved.id,
    limits: {},
  });
  const { terminal } = await client.request("team.launch", {
    teamId: team.saved.id,
    cwd: dataRoot,
  });
  const parent = await client.terminal(terminal.id);
  await parent.output("AUTOMATION_READY");
  return parent;
}

test("plan add --first と plan move で計画の順を変え、番号を保ったまま Board へ渡す", (t) =>
  runHostTest(t, async ({ client, dataRoot, stage }) => {
    const parent = await launchParent(client, dataRoot);
    assert.match(
      await delivered(parent),
      /Keep tasks in the order you will work on them \(iori plan move\); task numbers are stable IDs and do not change when tasks move\./u,
    );

    stage("目標と3つのタスクを登録した後に先頭と指定位置へ追加する");
    assert.equal(
      (
        await automationCommand(parent, "goal", [
          "plan",
          "goal",
          "--body",
          "Ship plan ordering",
        ])
      ).code,
      0,
    );
    const add1 = await automationCommand(parent, "add-1", [
      "plan",
      "add",
      "--title",
      "First",
    ]);
    assert.equal(add1.code, 0);
    assert.equal(add1.stdout.trim(), "Plan task 1: added. Order: 1.");

    const add2 = await automationCommand(parent, "add-2", [
      "plan",
      "add",
      "--title",
      "Second",
    ]);
    assert.equal(add2.code, 0);
    assert.equal(add2.stdout.trim(), "Plan task 2: added. Order: 1, 2.");

    const add3 = await automationCommand(parent, "add-3", [
      "plan",
      "add",
      "--title",
      "Third",
    ]);
    assert.equal(add3.code, 0);
    assert.equal(add3.stdout.trim(), "Plan task 3: added. Order: 1, 2, 3.");

    const addFirst = await automationCommand(parent, "add-first", [
      "plan",
      "add",
      "--title",
      "Urgent",
      "--first",
    ]);
    assert.equal(addFirst.code, 0);
    assert.equal(
      addFirst.stdout.trim(),
      "Plan task 4: added. Order: 4, 1, 2, 3.",
    );

    const addAfter = await automationCommand(parent, "add-after", [
      "plan",
      "add",
      "--title",
      "Follow-up",
      "--after",
      "2",
    ]);
    assert.equal(addAfter.code, 0);
    assert.equal(
      addAfter.stdout.trim(),
      "Plan task 5: added. Order: 4, 1, 2, 5, 3.",
    );

    const beforeMove = JSON.parse(
      (
        await automationCommand(parent, "show-before", [
          "plan",
          "show",
          "--json",
        ])
      ).stdout,
    );
    assert.equal(beforeMove.ok, true);

    stage("plan move で前後の並び順を変え、Activity には積まない");
    const moveBack = await automationCommand(parent, "move-back", [
      "plan",
      "move",
      "3",
      "--after",
      "1",
    ]);
    assert.equal(moveBack.code, 0);
    assert.equal(
      moveBack.stdout.trim(),
      "Plan task 3: moved. Order: 4, 1, 3, 2, 5.",
    );

    const moveFirst = await automationCommand(parent, "move-first", [
      "plan",
      "move",
      "2",
      "--first",
    ]);
    assert.equal(moveFirst.code, 0);
    assert.equal(
      moveFirst.stdout.trim(),
      "Plan task 2: moved. Order: 2, 4, 1, 3, 5.",
    );

    const moveForward = await automationCommand(parent, "move-forward", [
      "plan",
      "move",
      "4",
      "--after",
      "5",
    ]);
    assert.equal(moveForward.code, 0);
    assert.equal(
      moveForward.stdout.trim(),
      "Plan task 4: moved. Order: 2, 1, 3, 5, 4.",
    );

    const expectedOrder = [
      [2, "Second"],
      [1, "First"],
      [3, "Third"],
      [5, "Follow-up"],
      [4, "Urgent"],
    ];

    const afterMove = JSON.parse(
      (
        await automationCommand(parent, "show-after", [
          "plan",
          "show",
          "--json",
        ])
      ).stdout,
    );
    assert.equal(afterMove.ok, true);
    assert.deepEqual(
      afterMove.data.tasks.map((task) => [task.number, task.title]),
      expectedOrder,
    );
    assert.equal(
      afterMove.data.activity.length,
      beforeMove.data.activity.length,
    );
    assert.ok(afterMove.data.updatedAt >= beforeMove.data.updatedAt);

    const board = await client.request("teams.board", { cwd: dataRoot });
    assert.equal(board.conversations.length, 1);
    const boardPlan = board.conversations[0].plan;
    assert.deepEqual(
      boardPlan.tasks.map((task) => [task.number, task.title]),
      expectedOrder,
    );
    assert.equal(boardPlan.activity.length, beforeMove.data.activity.length);

    stage("キャンセル済みのタスクも Order の並びに残る");
    assert.equal(
      (
        await automationCommand(parent, "cancel-5", [
          "plan",
          "cancel",
          "5",
          "--reason",
          "No longer needed",
        ])
      ).code,
      0,
    );
    const moveWithCancelled = await automationCommand(
      parent,
      "move-cancelled",
      ["plan", "move", "1", "--after", "3"],
    );
    assert.equal(moveWithCancelled.code, 0);
    assert.equal(
      moveWithCancelled.stdout.trim(),
      "Plan task 1: moved. Order: 2, 3, 1, 5, 4.",
    );
  }));

test("不正な plan add と plan move の引数を拒否する", (t) =>
  runHostTest(t, async ({ client, dataRoot }) => {
    const parent = await launchParent(client, dataRoot);
    assert.equal(
      (
        await automationCommand(parent, "add-1", [
          "plan",
          "add",
          "--title",
          "First",
        ])
      ).code,
      0,
    );
    assert.equal(
      (
        await automationCommand(parent, "add-2", [
          "plan",
          "add",
          "--title",
          "Second",
        ])
      ).code,
      0,
    );

    const bothOnAdd = await automationCommand(parent, "add-both", [
      "plan",
      "add",
      "--title",
      "Both",
      "--first",
      "--after",
      "1",
    ]);
    assert.notEqual(bothOnAdd.code, 0);

    const missingTarget = await automationCommand(parent, "move-none", [
      "plan",
      "move",
      "1",
    ]);
    assert.notEqual(missingTarget.code, 0);

    const bothOnMove = await automationCommand(parent, "move-both", [
      "plan",
      "move",
      "1",
      "--first",
      "--after",
      "2",
    ]);
    assert.notEqual(bothOnMove.code, 0);

    const sameTask = await automationCommand(parent, "move-same", [
      "plan",
      "move",
      "1",
      "--after",
      "1",
    ]);
    assert.notEqual(sameTask.code, 0);

    const missingSource = await automationCommand(parent, "move-missing-src", [
      "plan",
      "move",
      "99",
      "--first",
    ]);
    assert.notEqual(missingSource.code, 0);
    assert.equal(
      missingSource.stdout.trim(),
      "Plan task does not exist. Read iori plan show.",
    );

    const missingAfterOnMove = await automationCommand(
      parent,
      "move-missing-after",
      ["plan", "move", "1", "--after", "99"],
    );
    assert.notEqual(missingAfterOnMove.code, 0);
    assert.equal(
      missingAfterOnMove.stdout.trim(),
      "Plan task does not exist. Read iori plan show.",
    );

    const missingAfterOnAdd = await automationCommand(
      parent,
      "add-missing-after",
      ["plan", "add", "--title", "Missing", "--after", "99"],
    );
    assert.notEqual(missingAfterOnAdd.code, 0);
    assert.equal(
      missingAfterOnAdd.stdout.trim(),
      "Plan task does not exist. Read iori plan show.",
    );

    const shown = JSON.parse(
      (await automationCommand(parent, "show", ["plan", "show", "--json"]))
        .stdout,
    );
    assert.deepEqual(
      shown.data.tasks.map((task) => task.number),
      [1, 2],
    );
  }));
