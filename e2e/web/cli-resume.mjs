import { fakeMarker } from "../fake-model/marker.mjs";
import {
  waitForOperation,
  cliFailure,
} from "../../verification/web/operation.mjs";
import {
  returnToWorktree,
  saveStartupArguments,
} from "./agents-navigation.mjs";
import assert from "node:assert/strict";
import { splitTab } from "../../verification/workspace/interaction.mjs";
import { TerminalScreenObservation } from "../../verification/terminal/screen-observation.ts";
import { waitFor } from "../../verification/ui.mjs";
import { submitToCli } from "../cli-screen/input.mjs";
import { finishCli, focusTerminal } from "../cli-screen/scenario.mjs";
import {
  observed,
  observedCurrentScreen,
  clearObserved,
  beginRenderObservation,
  observedRenderFrames,
} from "../terminal/scenario.mjs";

const action = (name) => `[data-iori-action="${name}"]`;
async function closeResume(screen, id) {
  await screen.click(
    `[data-iori-terminal-id="${id}"] ${action("cli-resume-close")}`,
  );
  // Closing is asynchronous. Finish this user operation before the next CLI
  // opens into the layout whose previous tab is still being removed.
  await waitFor(() =>
    screen.evaluate(
      `!document.querySelector('[data-iori-tab-id="terminal:${id}"]') && !document.querySelector('[data-iori-terminal-row="${id}"]')`,
    ),
  );
}

export async function cliResumeScenario({
  fakeModelRequests,
  client,
  restartHostLosingTerminals,
  resumeScreenEvidence,
  session,
  assistantReply,
  warmup,
  record,
  shot,
}) {
  const screen = client.screen;
  if (warmup) {
    await screen.click(action("workspace-add-tab"));
    await screen.click('[data-iori-cli-id="codex"]');
    await screen.wait('[data-iori-tab-cli="codex"]');
    const first = (
      await screen.attribute('[data-iori-tab-cli="codex"]', "data-iori-tab-id")
    ).replace(/^terminal:/, "");
    await screen.wait(
      `[data-iori-terminal-id="${first}"][data-iori-stream-state="ready"]`,
    );
    await finishCli(client, first);
    await warmup();
  }
  const startupArguments = '--model "gpt-6-luna"';
  await saveStartupArguments(screen, "codex", startupArguments);
  await returnToWorktree(screen);
  await screen.click(action("workspace-add-tab"));
  await screen.click('[data-iori-cli-id="codex"]');
  await screen.wait('[data-iori-tab-cli="codex"]');
  const id = (
    await screen.attribute('[data-iori-tab-cli="codex"]', "data-iori-tab-id")
  ).replace(/^terminal:/, "");
  await screen.wait(
    `[data-iori-terminal-id="${id}"][data-iori-stream-state="ready"]`,
  );
  const tab = `[data-iori-tab-id="terminal:${id}"]`;
  const pane = `[data-iori-terminal-id="${id}"]`;
  if (await screen.visible(action("workspace-restore")))
    await screen.click(action("workspace-restore"));
  await splitTab(screen, tab, "below");
  const group = await screen.attribute(
    tab,
    "data-iori-group-id",
    "[data-iori-group-id]",
  );
  await screen.click(
    `[data-iori-group-id="${group}"] ${action("workspace-maximize")}`,
  );
  await screen.wait(action("workspace-restore"));
  await focusTerminal(client, id);
  await waitForOperation(
    "cli-resume: Codexが入力を受け付ける",
    async () => {
      const text = await screen.evaluate(
        `window.__terminalObservation.tails[document.querySelector('[data-iori-terminal-id="${id}"]').dataset.ioriStreamId]??''`,
      );
      if (text.includes("Ask Codex")) return true;
      if (text.includes("trust this folder")) await screen.key("Enter");
      return false;
    },
    Boolean,
    cliFailure(screen, id),
  );
  await submitToCli(
    client,
    "Remember the word IORI_RESUME_MEMORY. Reply exactly RESUME_SAVED without using tools." +
      fakeMarker("recovery-save"),
    undefined,
    "resume-before",
    { focus: false },
  );
  await observed(
    client,
    "RESUME_SAVED",
    undefined,
    "observe",
    cliFailure(screen, id),
  );
  const before = await waitForOperation(
    "cli-resume: SessionStartで会話のIDを保存",
    () => session(id),
    (value) => Boolean(value?.session?.id),
    cliFailure(screen, id),
  );
  await waitForOperation(
    "cli-resume: 会話の記録に再開前の応答",
    () => assistantReply(before.session.id, "RESUME_SAVED"),
    Boolean,
    cliFailure(screen, id),
  );
  assert.ok(
    before.command.includes(startupArguments),
    "新規の命令に保存した引用符付き引数が付く",
  );
  assert.ok(before?.session?.id, "SessionStartから会話IDを保存した");
  // The prompt itself also contains RESUME_SAVED. A saved model record is not
  // proof that Codex has painted its answer in the PTY before shutdown.
  const replyLine = /^\s*•\s*RESUME_SAVED\s*$/mu;
  const beforeStop = await observedCurrentScreen(
    client,
    id,
    replyLine,
    cliFailure(screen, id),
  );
  await beginRenderObservation(client);
  const savedSnapshot = await restartHostLosingTerminals({
    terminalId: id,
    whileStopped: async () => {
      // Resize through the user's layout controls while the Host is down, so
      // the very first cold-open request must use the smaller split pane.
      await screen.click(action("workspace-restore"));
      await screen.click(tab);
      await waitFor(
        async () => Number(await screen.attribute(pane, "data-iori-rows")),
        (rows) => rows > 0 && rows < beforeStop.rows,
      );
    },
  });
  await screen.wait(
    `[data-iori-terminal-id="${id}"] [data-iori-state="cli-resume-pending"]`,
  );
  await screen.wait(
    `[data-iori-terminal-id="${id}"][data-iori-stream-state="ready"]`,
  );
  await focusTerminal(client, id);
  const frames = await observedRenderFrames(client, id);
  const restored = frames.find((frame) => frame.kind === "terminal.snapshot");
  const restoredScreen = new TerminalScreenObservation();
  try {
    assert.ok(restored, "再接続の最初の画面を受信した");
    assert.ok(
      restored.snapshot.rows < savedSnapshot.rows,
      "保存時より行数の少ないペインで最初の画面を復元した",
    );
    await restoredScreen.apply(id, restored);
    assert.ok(
      replyLine.test(restoredScreen.currentText(id)),
      "CLIの最後の画面を履歴へ残した",
    );
    await record(
      `保存時${savedSnapshot.rows}行から最初の復元${restored.snapshot.rows}行へ縮めてもCLIの最後の返答が残る`,
    );
  } catch (error) {
    const comparison = {};
    for (const [stage, snapshot] of [
      ["beforeStop", beforeStop],
      ["savedAfterStop", savedSnapshot],
      ["restored", restored?.snapshot],
    ]) {
      const observation = new TerminalScreenObservation();
      try {
        if (snapshot)
          await observation.apply(id, { kind: "terminal.snapshot", snapshot });
        const text = observation.currentText(id);
        comparison[stage] = {
          snapshotPresent: Boolean(snapshot),
          rows: snapshot?.rows,
          cols: snapshot?.cols,
          markerPresent: text.includes("RESUME_SAVED"),
          replyLinePresent: replyLine.test(text),
        };
      } finally {
        observation.dispose();
      }
    }
    resumeScreenEvidence(comparison);
    throw error;
  } finally {
    restoredScreen.dispose();
  }
  await screen.evaluate("window.__terminalObservation.renderFrames=undefined");
  await observed(client, "iori-test#");
  await shot("cli-resume-row");
  await clearObserved(client);
  await screen.click(`[data-iori-terminal-id="${id}"] ${action("cli-resume")}`);
  await waitFor(
    async () =>
      !(await screen.visible(
        `[data-iori-terminal-id="${id}"] [data-iori-state="cli-resume-pending"]`,
      )),
  );
  await record(
    "AIエージェントで保存した引数が単独の新規起動に付き、引用符が保持される",
  );
  // Codex 0.162.1 can omit history above its composer in a short split
  // pane, even though resume is ready for input.
  // Observe the newly painted input after clearObserved, not SessionStart.
  await focusTerminal(client, id);
  await observed(
    client,
    "Ask Codex to do anything",
    undefined,
    "observe",
    cliFailure(screen, id),
  );
  assert.doesNotMatch(
    await screen.evaluate(
      `window.__terminalObservation.tails[document.querySelector('[data-iori-terminal-id="${id}"]').dataset.ioriStreamId]??''`,
    ),
    /IORI_COMMAND_BIN|export PATH/u,
    "再開の入力行に内部のPATH設定を出さない",
  );
  await submitToCli(
    client,
    "What word did I ask you to remember? Reply with that word only, without using tools." +
      fakeMarker("recovery-resume"),
    undefined,
    "resume-after",
    { focus: false },
  );
  await observed(
    client,
    "IORI_RESUME_MEMORY",
    undefined,
    "observe",
    cliFailure(screen, id),
  );
  await waitForOperation(
    "cli-resume: 再開した会話が前に覚えた語を答える",
    () => assistantReply(before.session.id, "IORI_RESUME_MEMORY"),
    Boolean,
    cliFailure(screen, id),
  );
  if (fakeModelRequests)
    assert.equal(
      fakeModelRequests.find(
        (request) => request.marker === "recovery-resume" && request.step === 0,
      )?.tokensPresent["IORI_RESUME_MEMORY"],
      true,
      "再開した要求に前の会話の記憶語が含まれる",
    );
  assert.equal(
    (await session(id))?.session?.id,
    before.session.id,
    "同じCLI会話を再開した",
  );
  await record(
    "Hostの再起動で保存画面と再開行を残し、再開で同じCodex会話と記憶を戻す",
  );
  await restartHostLosingTerminals();
  await screen.wait(
    `[data-iori-terminal-id="${id}"] [data-iori-state="cli-resume-pending"]`,
  );
  await screen.wait(
    `[data-iori-terminal-id="${id}"][data-iori-stream-state="ready"]`,
  );
  await closeResume(screen, id);
  await record("再開行の閉じるで終了済みCLIの画面と一覧を閉じる");
  await screen.click(action("settings-open"));
  for (const section of ["notifications", "general"]) {
    await screen.click(action(`settings-${section}`));
    for (const theme of ["light", "dark"]) {
      await screen.evaluate(
        `document.documentElement.classList.toggle('dark', ${theme === "dark"})`,
      );
      await shot(`settings-${section}-${theme}`);
    }
  }
  await screen.click(action("settings-close"));
}
