import assert from "node:assert/strict";
import { prepareTeamWorker } from "./team-worker.mjs";
import { mobileBoardsScenario } from "./mobile-boards.mjs";
import { openWorkspaceView } from "../../verification/workspace/interaction.mjs";
import { returnToWorktree } from "./agents-navigation.mjs";
export async function teamBoardScenario(options) {
  const {
    screen,
    worktree,
    savedTeam,
    parentId,
    planTask,
    record,
    shot,
    mobile,
    desktop,
  } = await prepareTeamWorker(options, { report: true, plan: true });
  await mobileBoardsScenario({
    screen,
    worktree,
    mobile,
    desktop,
    shot,
    record,
    expectedState: "Reported",
    expectedDot: "done",
    finished: 0,
  });

  await openWorkspaceView(screen, "board");
  await screen.wait('[data-iori-view="board"] .board-agent-row');
  assert.equal(await screen.visible(".board-turns"), false);
  assert.equal(
    await screen.text(".board-agent-row .parent-verdict"),
    "Parent: Pending",
  );
  assert.equal(
    await screen.text(".board-agent-row .agent-heading strong"),
    "Worker · Low",
  );
  await screen.click('[data-iori-action="board-open-conversation"]');
  await screen.wait(
    `[data-iori-terminal-id="${parentId}"][data-iori-displayed="true"]`,
  );
  await openWorkspaceView(screen, "board");
  assert.ok(
    (await screen.text('[data-iori-view="board"]')).includes(
      "Verify team question, report and revision flow",
    ),
  );
  await screen.wait(`[data-iori-plan-task="${planTask}"]`);
  await screen.wait('[data-iori-agent-tokens="known"]');
  assert.match(
    await screen.text('[data-iori-agent-tokens="known"]'),
    /\d(?:[\d.,]*)(?:k|M)? tokens/u,
  );
  assert.match(
    await screen.text(".agent-quota"),
    /Codex \d+(?:\.\d+)?[mhd] \d+% used · resets \d+[mhd]/iu,
  );
  assert.ok(
    (await screen.text(".board-agent-row .agent-main")).includes(
      `Task ${planTask}`,
    ),
  );
  assert.ok(
    (
      await screen.text(`[data-iori-plan-task="${planTask}"] .todo-assignee`)
    ).includes("Worker · Low · Codex"),
  );
  assert.ok(
    (
      await screen.text(`[data-iori-plan-task="${planTask}"] .todo-assignee`)
    ).includes(`Task ${planTask}`),
  );
  const editTeam = '[data-iori-action="board-edit-team"]';
  const verifyTeamLink = async () => {
    await screen.wait(editTeam);
    assert.equal(await screen.text(editTeam), savedTeam.name);
    await screen.click(editTeam);
    await screen.wait(".team-surface:not([hidden]) .team-overview");
    assert.equal(
      await screen.value('.team-overview [data-iori-field="team-name"]'),
      savedTeam.name,
    );
  };
  await verifyTeamLink();
  await returnToWorktree(screen, worktree);
  await openWorkspaceView(screen, "board");
  await record("BoardのPlan・Agentsと親の会話・チーム編集・Mobileの入口を確認");
}
