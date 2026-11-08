import { writeFile } from "node:fs/promises";
import { fakeMarker } from "../fake-model/marker.mjs";
import { prepareTeamWorker } from "./team-worker.mjs";
import { pasteToCli } from "./cli-input.mjs";
import {
  waitForOperation,
  childFailure,
  cliFailure,
  anyFailure,
} from "../../verification/web/operation.mjs";
import { waitFor } from "../../verification/ui.mjs";
import { waitForCliState } from "../cli-screen/scenario.mjs";
export async function teamMessagesScenario(options) {
  const {
    client,
    screen,
    child,
    childRow,
    worktree,
    parentId,
    parentCommand,
    teamRecords,
    teamDelivery,
    record,
  } = await prepareTeamWorker(options);
  await screen.click(`${childRow} .nav-child-button`);
  await screen.wait(
    `[data-iori-terminal-id="${child.terminalId}"][data-iori-stream-state="ready"]`,
  );
  await pasteToCli(
    client,
    "START. Return to the original delegation: use iori ask to ask whether to report completion, then finish this turn and wait for the answer file." +
      fakeMarker("team-ask"),
  );
  await waitForOperation(
    "チーム: 子Codexのask",
    teamRecords,
    (value) => value.children[0].questionFiles.length >= 1,
    childFailure(teamRecords, (children) => children[0]),
  );
  await waitForOperation(
    "チーム: 親Claude Codeが質問の知らせを受信",
    teamDelivery,
    (value) => value.claude.questionNotice,
    anyFailure(
      childFailure(teamRecords, (children) => children[0]),
      cliFailure(screen, parentId),
    ),
  );
  await waitForCliState(client, child.terminalId, ["idle", "done"]);
  await screen.click(`[data-iori-terminal-row="${parentId}"]`);
  await waitForCliState(client, parentId, ["idle", "done"]);
  await parentCommand(["read", child.id]);
  const answerBody =
    "- Yes, report completion now.\n- Keep this dash-prefixed line unchanged." +
    fakeMarker("team-answer");
  await writeFile(`${worktree}/team-send-answer.md`, answerBody);
  await parentCommand([
    "send",
    child.id,
    "--kind",
    "answer",
    "--file",
    "team-send-answer.md",
  ]);
  await waitForOperation(
    "チーム: 子Codexが回答の一行を受信",
    teamDelivery,
    (value) => value.codex.childAnswer,
    childFailure(teamRecords, (children) => children[0]),
  );
  await record("親の経路からのsend answerがCodexのuser入力の記録へ入る");
  await screen.click(
    `button[data-iori-worktree-path=${JSON.stringify(worktree)}]`,
  );
  await screen.click(`[data-iori-terminal-row="${parentId}"]`);
  await waitForOperation(
    "チーム: 親Claude Codeが報告の知らせを受信",
    teamDelivery,
    (value) => value.claude.reportNotice,
    anyFailure(
      childFailure(teamRecords, (children) => children[0]),
      cliFailure(screen, parentId),
    ),
  );
  await record("子Codexのreportの知らせがClaude Codeのuser入力の記録へ入る");
  await waitForOperation(
    "チーム: 操作後に子が報告",
    teamRecords,
    (value) => value.children[0].state === "reported",
    childFailure(teamRecords, (children) => children[0]),
  );
  await screen.wait(`${childRow}[data-iori-child-state="reported"]`);
  await waitFor(
    () => screen.text(`${childRow} .nav-child-state`),
    (value) => value.startsWith("Reported"),
  );
  await waitForCliState(client, child.terminalId, ["idle", "done"]);
}
