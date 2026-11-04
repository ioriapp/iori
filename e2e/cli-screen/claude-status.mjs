import { fakeMarker } from "../fake-model/marker.mjs";
import {
  typeTerminal,
  clearObserved,
  observedCurrentScreen,
} from "../terminal/scenario.mjs";
import { TerminalScreenObservation } from "../../verification/terminal/screen-observation.ts";
import assert from "node:assert/strict";
import { stripVTControlCharacters } from "node:util";
import { submitToCli, pressCliKey } from "./input.mjs";
import { focusTerminal, finishCli, waitForCliState } from "./scenario.mjs";
import { waitFor } from "../../verification/ui.mjs";

// A startup question of Claude Code drops the keys of about its first 250 ms
// (2.1.308: a key 220 ms after the question appeared was dropped, one at
// 250 ms was taken). Twice that also lets a taken key's redraw arrive.
const STARTUP_RETRY_MS = 500;

/**
 * Answers Claude Code's startup questions in the Terminal `id` as the user
 * does, until `ready()` returns a value: trust this folder ("Yes"), and a
 * project's MCP servers or external imports (the chosen "continue without"
 * and "disable"). A key the question dropped is pressed again while the
 * question is still the latest thing on the screen.
 */
export async function answerClaudeStartup(client, id, ready, milliseconds) {
  const screen = client.screen;
  const tail = `window.__terminalObservation.tails[document.querySelector('[data-iori-terminal-id="${id}"]').getAttribute('data-iori-stream-id')]??''`;
  let pressedAt = 0;
  let length = 0;
  let changedAt = Date.now();
  return waitFor(
    async () => {
      const output = stripVTControlCharacters(await screen.evaluate(tail));
      if (output.length !== length) {
        length = output.length;
        changedAt = Date.now();
      }
      const words = output.replaceAll(/\s+/gu, "");
      const at = (text) => words.lastIndexOf(text);
      const [question, shown] = [
        [
          "trust",
          Math.max(at("Yes,Itrustthisfolder"), at("trustthisdirectory")),
        ],
        ["mcp", at("ContinuewithoutusingthisMCPserver")],
        ["imports", at("No,disableexternalimports")],
      ].sort((a, b) => b[1] - a[1])[0];
      // A question stays on screen until Claude Code draws what follows it.
      if (shown < 0 || shown < Math.max(at("forshortcuts"), at('Try"')))
        return ready();
      const now = Date.now();
      if (now - pressedAt < STARTUP_RETRY_MS) return undefined;
      let key = "Enter";
      if (question === "trust") {
        if (at("❯No,exit") > at("❯Yes,Itrustthisfolder")) key = "ArrowDown";
        // Confirm "Yes" once the screen has settled after the last key.
        else if (now - changedAt < STARTUP_RETRY_MS) return undefined;
      }
      await focusTerminal(client, id);
      await pressCliKey(client, key);
      pressedAt = Date.now();
      return undefined;
    },
    Boolean,
    milliseconds,
    "Claude Codeの起動の確認への答え",
  );
}

/** A real permission prompt declined by Esc: no simulated lifecycle events. */
export async function openClaude(client) {
  const screen = client.screen;
  await screen.click('[data-iori-action="workspace-add-tab"]');
  await screen.click('[data-iori-cli-id="claude"]');
  await screen.wait('[data-iori-tab-cli="claude"]');
  const id = (
    await screen.attribute('[data-iori-tab-cli="claude"]', "data-iori-tab-id")
  ).replace(/^terminal:/u, "");
  await screen.wait(
    `[data-iori-terminal-id="${id}"][data-iori-stream-state="ready"]`,
  );
  await focusTerminal(client, id);
  await typeTerminal(client, "", undefined, "claude-focus", { focus: false });
  const tail = `window.__terminalObservation.tails[document.querySelector('[data-iori-terminal-id="${id}"]').getAttribute('data-iori-stream-id')]??''`;
  await answerClaudeStartup(client, id, async () => {
    const output = stripVTControlCharacters(await screen.evaluate(tail));
    return (
      output.includes("Haiku") &&
      (output.includes("shortcuts") || output.includes("Try "))
    );
  });
  return id;
}
export async function claudeStatusScenario({
  client,
  record,
  preventHookInstall,
  windows = false,
}) {
  if (windows)
    await client.screen
      .evaluate(`window.__TAURI__.event.listen('native://stream',({payload})=>{
      const event=JSON.parse(payload.json);
      if(event.type==='terminal.updated'){
        window.__claudeStatuses??={};
        window.__claudeStatuses[event.terminal.id]=event.terminal.cliStatus;
        if(window.__claudeTurnStates&&event.terminal.id===window.__claudeTurnId)
          window.__claudeTurnStates.push(event.terminal.cliStatus);
      }
    }).then(unsubscribe=>{window.__claudeNativeUnsubscribe=unsubscribe})`);
  const state = (id, states) =>
    windows
      ? waitFor(
          () =>
            client.screen.evaluate(
              `window.__claudeStatuses?.[${JSON.stringify(id)}]?.state`,
            ),
          (value) => states.includes(value),
          120000,
          "CLIのhook状態の観測",
        )
      : waitForCliState(client, id, states);
  const restore = await preventHookInstall();
  try {
    const first = await openClaude(client);
    assert.equal(
      await client.screen.visible(
        `[data-iori-terminal-row="${first}"] [data-status]`,
      ),
      false,
    );
    await finishCli(client, first, "claude");
    await record(
      "取り付けが失敗しても初回のClaude Codeを使え、次の起動で再試行する",
    );
  } finally {
    await restore();
  }
  const retry = await openClaude(client);
  await client.screen.wait(
    `[data-iori-terminal-row="${retry}"] [aria-label="待機中"], [data-iori-terminal-row="${retry}"] [aria-label="Idle"]`,
  );
  await record(
    "取り付けの失敗後も、再試行した最初のClaude Codeの会話から状態の印が出る",
  );
  await finishCli(client, retry, "claude");
  const id = await openClaude(client);
  const screen = client.screen;
  const row = `[data-iori-terminal-row="${id}"]`;
  await submitToCli(
    client,
    'Use Bash to run exactly node -e "console.log(42)". Do not use any other tool.' +
      fakeMarker("claude-approval-esc"),
  );
  await screen.wait(`${row} [data-status="waiting"]`);
  assert.equal(
    await screen.attribute(
      '[data-iori-action="attention-open"]',
      "data-iori-attention-count",
    ),
    "1",
  );
  await focusTerminal(client, id);
  // PermissionRequest can reach Host before the CLI has drawn its dialog.
  // Wait for the real approval screen before declining it.
  await waitFor(async () => {
    const output = await screen.evaluate(
      `window.__terminalObservation.tails[document.querySelector('[data-iori-terminal-id="${id}"]').getAttribute('data-iori-stream-id')]??''`,
    );
    return stripVTControlCharacters(output)
      .replaceAll(/\s+/gu, "")
      .includes("Doyouwanttoproceed?");
  });
  await pressCliKey(client, "Escape");
  await waitFor(async () => {
    const output = await screen.evaluate(
      `window.__terminalObservation.tails[document.querySelector('[data-iori-terminal-id="${id}"]').getAttribute('data-iori-stream-id')]??''`,
    );
    return stripVTControlCharacters(output).includes("Interrupted");
  });
  await waitFor(
    () =>
      screen.attribute(
        '[data-iori-action="attention-open"]',
        "data-iori-attention-count",
      ),
    (count) => count === "0",
  );
  assert.equal(await screen.visible(`${row} [data-status="waiting"]`), false);
  await record("本物のClaude Codeで承認をEscで断ると判断待ちから消える");
  await finishCli(client, id, "claude");
  const interrupted = await openClaude(client);
  const interruptedRow = `[data-iori-terminal-row="${interrupted}"]`;
  const failures = [];
  await state(interrupted, ["idle"]);
  await clearObserved(client);
  // Observe the tool's start and finish through Host's normal Client events.
  // UserPromptSubmit alone precedes Claude's interruptible response screen.
  await screen.evaluate(
    windows
      ? `(()=>{window.__claudeTurnStates=[];window.__claudeTurnId=${JSON.stringify(interrupted)};return true})()`
      : `(async()=>{
    const {connection}=await import('/src/connection.ts');
    window.__claudeTurnStates=[];
    window.__claudeTurnUnsubscribe=connection.subscribeHostEvents((_host,event)=>{
      if(event.type==='terminal.updated'&&event.terminal.id===${JSON.stringify(interrupted)})
        window.__claudeTurnStates.push(event.terminal.cliStatus);
    });
  })()`,
  );
  try {
    await submitToCli(
      client,
      "Read only sample.txt using Read, then output integers from 1 to 20000, one per line. This is an interruption test. Do not skip Read." +
        fakeMarker("claude-interrupt"),
    );
    await waitFor(
      () =>
        screen.evaluate(`(()=>{
        const states=window.__claudeTurnStates;
        const read=states.findIndex(s=>s?.activity?.tool==='Read');
        return read>=0&&states.slice(read+1).some(s=>s?.state==='active'&&s.activity?.kind==='thinking');
      })()`),
      Boolean,
      undefined,
      "Readが終わり応答が続いていること",
    );
    await record("Read完了後の応答中にEscを送る");
    await focusTerminal(client, interrupted);
    await pressCliKey(client, "Escape");
    await observedCurrentScreen(client, interrupted, /Interrupted/u);
  } finally {
    await screen.evaluate(
      windows
        ? "window.__claudeTurnId=undefined"
        : "window.__claudeTurnUnsubscribe()",
    );
  }
  try {
    await state(interrupted, ["stopped"]);
    assert.equal(
      await screen.visible(`${interruptedRow} [data-status="active"]`),
      false,
    );
    await record("応答中のEscで中断すると停止し、Runningが消える");
  } catch (error) {
    failures.push(`応答中の中断: ${error}`);
    await record(`応答中の中断で停止へ変わらない: ${error}`);
  }
  await submitToCli(
    client,
    "Reply exactly AFTER_INTERRUPT without tools." +
      fakeMarker("claude-after-interrupt"),
  );
  await state(interrupted, ["active"]);
  await state(interrupted, ["done", "idle"]);
  await record("中断の後の依頼は応答中から完了へ進む");
  await finishCli(client, interrupted, "claude");
  const denied = await openClaude(client);
  const deniedRow = `[data-iori-terminal-row="${denied}"]`;
  await submitToCli(
    client,
    'Use Bash to run exactly node -e "console.log(42)". Do not use any other tool.' +
      fakeMarker("claude-approval-no"),
  );
  await screen.wait(`${deniedRow} [data-status="waiting"]`);
  const permission = await observedCurrentScreen(
    client,
    denied,
    /Do you want to proceed\?/u,
  );
  const observer = new TerminalScreenObservation();
  let no;
  try {
    await observer.apply(denied, {
      kind: "terminal.snapshot",
      snapshot: permission,
    });
    no = observer.currentText(denied).match(/(\d+)\.\s*No\b/u);
  } finally {
    observer.dispose();
  }
  assert.ok(no, "承認画面のNoの選択番号を取得できる");
  await focusTerminal(client, denied);
  for (let position = 1; position < Number(no[1]); position++)
    await pressCliKey(client, "ArrowDown");
  await pressCliKey(client, "Enter");
  await observedCurrentScreen(client, denied, /Interrupted/u);
  try {
    await waitFor(
      () =>
        screen.attribute(
          '[data-iori-action="attention-open"]',
          "data-iori-attention-count",
        ),
      (count) => count === "0",
    );
    assert.equal(
      await screen.visible(`${deniedRow} [data-status="waiting"]`),
      false,
    );
    await record("承認画面でNoを選ぶと判断待ちから消える");
  } catch (error) {
    failures.push(`承認の拒否: ${error}`);
    await record(`承認の拒否で判断待ちが残る: ${error}`);
  }
  await finishCli(client, denied, "claude");
  if (windows) await screen.evaluate("window.__claudeNativeUnsubscribe()");
  if (failures.length) throw new Error(failures.join("\n"));
}

/** Real Claude Code permission hook, plus an oversized Host preview to exercise the
 * Client's tolerant reader. The command only writes a local documentation fixture. */
export async function longApproval({ client, record, oversizedAttention }) {
  const warmup = await openClaude(client);
  await finishCli(client, warmup, "claude");
  const id = await openClaude(client);
  const screen = client.screen;
  const row = `[data-iori-terminal-row="${id}"]`;
  oversizedAttention(true);
  await submitToCli(
    client,
    "Read approval-command.txt and pass its full contents to Bash to write release-notes.md. It is a harmless local heredoc with a dummy token=x documentation example." +
      fakeMarker("claude-long-approval"),
  );
  await screen.wait(`${row} [data-status="waiting"]`);
  await screen.click('[data-iori-action="attention-open"]');
  await screen.wait(
    `[data-iori-terminal-id="${id}"][data-iori-stream-state="ready"]`,
  );
  await waitFor(async () =>
    stripVTControlCharacters(
      await screen.evaluate(
        `window.__terminalObservation.tails[document.querySelector('[data-iori-terminal-id="${id}"]').getAttribute('data-iori-stream-id')]??''`,
      ),
    )
      .replaceAll(/\s+/gu, "")
      .includes("Doyouwanttoproceed?"),
  );
  oversizedAttention(false);
  await pressCliKey(client, "Escape");
  await waitFor(
    () =>
      screen.attribute(
        '[data-iori-action="attention-open"]',
        "data-iori-attention-count",
      ),
    (count) => count === "0",
  );
  await finishCli(client, id, "claude");
  await record(
    "4096字超でtokenを含む実承認でも、判断待ち一覧とCLI画面を開いて回答できる",
  );
}
