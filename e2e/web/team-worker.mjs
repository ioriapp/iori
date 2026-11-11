import { prepareTeamScenario } from "./team-fixture.mjs";
import { fakeMarker } from "../fake-model/marker.mjs";
import {
  waitForOperation,
  childFailure,
} from "../../verification/web/operation.mjs";
import { waitForCliState } from "../cli-screen/scenario.mjs";
export async function prepareTeamWorker(
  options,
  { report = false, plan = false } = {},
) {
  const context = await prepareTeamScenario({
    ...options,
    reportImmediately: report,
  });
  const { parentCommand, teamRecords, teamDelivery, client } = context;
  let planTask;
  if (plan) {
    await parentCommand([
      "plan",
      "goal",
      "--body",
      "Verify team question, report and revision flow",
    ]);
    await parentCommand(["plan", "add", "--title", "Verification worker"]);
    planTask = (await parentCommand(["plan", "show"])).data.tasks.at(-1).number;
    await parentCommand([
      "plan",
      "update",
      String(planTask),
      "--state",
      "in_progress",
      "--checkpoint",
      "Delegating to Worker",
    ]);
  }
  await parentCommand([
    "delegate",
    "--role",
    "Worker",
    "--difficulty",
    "low",
    "--title",
    "Verification worker",
    "--worktree",
    "new",
    ...(plan ? ["--plan", String(planTask)] : []),
    "--body",
    report
      ? 'Read the request, run iori report --body "Successful verification; no files changed." once, then end your turn. Do not modify files or ask questions.' +
        fakeMarker("team-answer")
      : 'Read every file named in the parent message before replying. Before START, return only "Ready" as your final answer and finish this response. Do not use tools to wait or agent-collaboration tools. Do not run any other commands before START. After START use iori ask to ask whether to report completion. Read the answer file then report successful verification with no changes through iori report. On a revise message read its file and report again without another question. Do not change files.' +
        fakeMarker("team-ready"),
  ]);
  const state = await waitForOperation(
    "子の実CLIを起動",
    teamRecords,
    (value) => value.children[0]?.terminalId,
    childFailure(teamRecords, (children) => children[0]),
  );
  const child = state.children[0];
  if (report)
    await waitForOperation(
      "子の実CLIが報告",
      teamRecords,
      (value) => value.children[0].state === "reported",
      childFailure(teamRecords, (children) => children[0]),
    );
  else
    await waitForOperation(
      "子Codexの初回応答",
      teamDelivery,
      (value) => value.codex.initialReply,
      childFailure(teamRecords, (children) => children[0]),
    );
  await waitForCliState(client, child.terminalId, ["idle", "done"]);
  return {
    ...context,
    child,
    childRow: `[data-iori-child-id="${child.id}"]`,
    planTask,
  };
}
