import { splitTab } from "../../verification/workspace/interaction.mjs";
import {
  cliRowNamed,
  cliMenuAction,
  returnToWorktree,
  openAgents,
} from "../web/agents-navigation.mjs";
import assert from "node:assert/strict";
import { waitFor } from "../../verification/ui.mjs";
import { cliPaneResize } from "./resize.mjs";
import {
  observed,
  observedCurrentScreen,
  clearObserved,
  typeTerminal,
} from "../terminal/scenario.mjs";
const action = (name) => `[data-iori-action="${name}"]`;

export async function controlKey(client, letter) {
  // Like pressCliKey, allow the real CLI to handle one gesture before the
  // next: clearing a draft and exiting must remain separate user operations.
  await new Promise((resolve) => setTimeout(resolve, 200));
  if (client.browser.webdriver) {
    await client.browser.call("actions", {
      actions: [
        {
          type: "key",
          id: "cli-keyboard",
          actions: [
            { type: "keyDown", value: "\uE009" },
            { type: "keyDown", value: letter },
            { type: "keyUp", value: letter },
            { type: "keyUp", value: "\uE009" },
          ],
        },
      ],
    });
  } else {
    await client.browser.call("Input.dispatchKeyEvent", {
      type: "rawKeyDown",
      key: letter,
      code: `Key${letter.toUpperCase()}`,
      windowsVirtualKeyCode: letter.toUpperCase().charCodeAt(0),
      modifiers: 2,
    });
    await client.browser.call("Input.dispatchKeyEvent", {
      type: "keyUp",
      key: letter,
      code: `Key${letter.toUpperCase()}`,
      modifiers: 2,
    });
  }
}
export async function focusTerminal(client, id) {
  // Mounted input can precede stream opening; a key sent then never reaches PTY.
  // Match typeTerminal's existing readiness condition, without waiting for CLI startup.
  await waitFor(() =>
    client.screen.evaluate(
      `Boolean(document.querySelector('[data-iori-terminal-id="${id}"][data-iori-stream-state="ready"] [data-iori-field="terminal-input"]'))`,
    ),
  );
  await client.screen.evaluate(
    `document.querySelector('[data-iori-terminal-id="${id}"] [data-iori-field="terminal-input"]').focus()`,
  );
}

/** Observe the actual Host hook state, without depending on TUI wording. */
export async function waitForCliState(client, id, states) {
  return waitFor(
    () =>
      client.screen.evaluate(`(async()=>{
      const {connection}=await import('/src/connection.ts');
      const result=await connection.requestHost(connection.getSnapshot().host.publicKey,'terminal.list',{});
      if(!result.ok)throw new Error('CLI状態を取得できませんでした');
      return result.result.terminals.find(t=>t.id===${JSON.stringify(id)})?.cliStatus?.state;
    })()`),
    (state) => states.includes(state),
    120000,
    "CLIのhook状態の観測",
  );
}
async function tail(client, id) {
  return client.screen.evaluate(
    `window.__terminalObservation.tails[document.querySelector('[data-iori-terminal-id="${id}"]')?.getAttribute('data-iori-stream-id')]??''`,
  );
}

/** The provisional Codex composer has the same placeholder but no model footer. */
export async function waitForCodexInput(client, id) {
  await waitFor(async () => {
    const output = await tail(client, id);
    if (output.includes("Ask Codex")) return true;
    if (output.includes("trust this folder")) await client.screen.key("Enter");
    return false;
  });
  // Inspect the current screen: old startup frames may contain the same prompt.
  await observedCurrentScreen(
    client,
    id,
    /Ask Codex[\s\S]*GPT-\S+\s+(?:low|medium|high|xhigh|minimal)\b/iu,
  );
}

/** The startup help can leave a split pane before its stream opens. The new
 * session's footer is part of the current input screen, including a snapshot. */
export async function waitForPiInput(client, id) {
  await waitFor(
    async () => {
      const output = await tail(client, id);
      if (output.includes("0.0%")) return true;
      if (output.includes("Trust project folder?"))
        await client.screen.key("Enter");
      return false;
    },
    Boolean,
    undefined,
    "Piの入力画面の観測",
  );
}
export async function finishCli(client, id, cliId = "codex") {
  await focusTerminal(client, id);
  await clearObserved(client);
  const state = await client.screen.evaluate(`(async()=>{
    const {connection}=await import('/src/connection.ts');
    const result=await connection.requestHost(connection.getSnapshot().host.publicKey,'terminal.list',{});
    if(!result.ok)throw new Error('CLI状態を取得できませんでした');
    return result.result.terminals.find(t=>t.id===${JSON.stringify(id)})?.cliStatus?.state;
  })()`);
  if (["active", "waiting"].includes(state)) {
    await controlKey(client, "c");
    await waitForCliState(client, id, ["stopped", "idle", "done"]);
    if (cliId === "codex") await waitForCodexInput(client, id);
    else if (cliId === "pi")
      await observedCurrentScreen(client, id, /\d+(?:\.\d+)?%/u);
    else await observedCurrentScreen(client, id, /Interrupted|❯/u);
  }
  if (cliId === "pi") await controlKey(client, "d");
  else {
    await controlKey(client, "c");
    await controlKey(client, "c");
  }
  let batchAnswered = false;
  await waitFor(async () => {
    if (
      !(await client.screen.attribute(
        `[data-iori-tab-id="terminal:${id}"]`,
        "data-iori-tab-cli",
      ))
    )
      return true;
    if (
      client.browser.webdriver &&
      !batchAnswered &&
      /バッチ ジョブを終了しますか|バッチジョブを終了しますか|Terminate batch job/iu.test(
        await tail(client, id),
      )
    ) {
      await typeTerminal(client, "Y\r", undefined, "batch-exit", {
        focus: false,
      });
      batchAnswered = true;
    }
    return false;
  });
}
async function themedShots(client, shot, name) {
  for (const theme of ["light", "dark"]) {
    await client.screen.evaluate(
      `document.documentElement.classList.toggle('dark',${theme === "dark"})`,
    );
    await shot(`${name}-${theme}`);
  }
}

/** Real installed CLIs, keyboard exits, and no model prompts. */
export async function cliScenario({
  client,
  record,
  shot,
  cliId = "pi",
  shell = "posix",
  registrationCommand = "pi",
  settings = true,
  beforeFirstOpen,
  resize = false,
  resizeOnly = false,
}) {
  const screen = client.screen;
  const originalId = await screen.attribute(
    '[data-iori-view="terminal"]',
    "data-iori-terminal-id",
  );
  const open = async (id) => {
    await screen.click(action("workspace-add-tab"));
    await screen.wait(`[data-iori-cli-id="${id}"]`);
    if (beforeFirstOpen) {
      await beforeFirstOpen();
      beforeFirstOpen = undefined;
    }
    await screen.click(`[data-iori-cli-id="${id}"]`);
    await screen.wait(`[data-iori-tab-cli="${id}"]`);
    return (
      await screen.attribute(`[data-iori-tab-cli="${id}"]`, "data-iori-tab-id")
    ).replace(/^terminal:/, "");
  };
  const exited = async (id) => {
    await waitFor(
      () =>
        screen.attribute(
          `[data-iori-tab-id="terminal:${id}"]`,
          "data-iori-tab-cli",
        ),
      (value) => !value,
    );
    assert.equal(
      await screen.attribute(
        `[data-iori-terminal-row="${id}"]`,
        "data-iori-row-cli",
      ),
      "",
    );
  };
  const quit = async (id) => {
    await finishCli(client, id, cliId);
    await exited(id);
  };
  const id = await open(cliId);
  await focusTerminal(client, id);
  await screen.wait(`[data-iori-row-cli="${cliId}"]`);
  if (cliId === "pi") await waitForPiInput(client, id);
  else await waitForCodexInput(client, id);
  if (!settings) {
    const label = await screen.text(`[data-iori-tab-id="terminal:${id}"]`);
    assert.doesNotMatch(label, /\b(?:cmd|pwsh|powershell)\.exe/iu);
    await themedShots(client, shot, "pc-overall-ja");
  }
  await record("＋から本物のCLIの画面を開き、タブとサイドバーで見分ける");
  if (resize && !settings)
    await cliPaneResize({ client, terminalId: id, record });
  await quit(id);
  if (resizeOnly) return id;
  assert.doesNotMatch(await tail(client, id), /printf|777/u);
  if (shell === "posix") {
    await observed(client, /^iori-test#\s*$/mu);
    await clearObserved(client);
    await screen.key("ArrowUp");
    await observed(client, registrationCommand);
    const recalled = await tail(client, id);
    assert.doesNotMatch(recalled, /printf|777/u);
    // ANSI framing is ignored; the command itself must be the bare command.
    assert.equal(
      recalled
        .replace(/\u001b\[[0-?]*[ -/]*[@-~]/gu, "")
        .replace(/[\r\b]/g, "")
        .trim(),
      registrationCommand,
    );
    await controlKey(client, "u");
    await record("内部の起動行が画面に無く、↑で素の起動コマンドを呼び戻す");
  }
  await clearObserved(client);
  if (shell === "cmd") await typeTerminal(client, "set IORI_CLI_PART=CLI\r");
  await typeTerminal(
    client,
    shell === "powershell"
      ? "Write-Output ('CLI' + 'から戻ったshell')\r"
      : shell === "cmd"
        ? "echo %IORI_CLI_PART%から戻ったshell\r"
        : "echo 'CLI'\"から戻ったshell\"\r",
  );
  await observed(client, "CLIから戻ったshell");
  await record("CLIを抜け、同じTerminalのshellで続けてコマンドを実行");
  if (!settings) return id;

  // Send Ctrl+C as soon as the new terminal can receive a keyboard gesture,
  // without waiting for the TUI's initialized screen. Pi's second Ctrl+C also
  // exits when the first gesture happens after it has entered raw mode.
  const interrupted = await open(cliId);
  await screen.wait(
    `[data-iori-terminal-id="${interrupted}"] [data-iori-field="terminal-input"]`,
  );
  await focusTerminal(client, interrupted);
  await controlKey(client, "c");
  await controlKey(client, "c");
  await exited(interrupted);
  await record("CLIの起動直後のCtrl+Cでタブとサイドバーがshell表示へ戻る");

  await screen.click(action("workspace-add-tab"));
  await screen.click(action("add-cli"));
  await screen.wait(`[data-iori-cli-version="${cliId}"]`);
  assert.match(
    await screen.text(`[data-iori-cli-version="${cliId}"]`),
    /\d+\.\d+/u,
  );
  await screen.click(action("cli-add-open"));
  await screen.input('[data-iori-field="cli-name"]', "My CLI");
  await screen.input('[data-iori-field="cli-command"]', registrationCommand);
  await screen.key("Tab");
  const modelArgument = '[data-iori-field="cli-model-argument"]';
  await waitFor(
    () => screen.value(modelArgument),
    (value) => value === "--model {model}",
  );
  // A draft the user removed does not come back for the same command.
  await screen.input(modelArgument, "");
  await screen.input('[data-iori-field="cli-command"]', registrationCommand);
  await screen.key("Tab");
  assert.equal(await screen.value(modelArgument), "");
  await screen.click(action("cli-add-submit"));
  const customId = await cliRowNamed(screen, "My CLI");
  const customRow = `[data-iori-cli-row="${customId}"]`;
  if ((await screen.attribute(customRow, "data-state")) !== "open")
    await screen.click(`${customRow} .team-agent-toggle`);
  await screen.click(`${customRow} ${action("cli-definition-edit")}`);
  assert.equal(
    await screen.value(`${customRow} [data-iori-field="cli-command"]`),
    registrationCommand,
  );
  await screen.input(`${customRow} [data-iori-field="cli-name"]`, "My Pi");
  await screen.input(
    `${customRow} [data-iori-field="cli-command"]`,
    registrationCommand + " --no-session",
  );
  await screen.click(`${customRow} ${action("cli-definition-save")}`);
  await waitFor(async () =>
    (await screen.text(`${customRow} .team-agent-name > span`)).includes(
      "My Pi",
    ),
  );
  await returnToWorktree(screen);
  await screen.click(action("workspace-add-tab"));
  // The launcher follows the CLI list, not the last used CLI.
  const launcherOrder = await screen.evaluate(`(async () => {
    const { connection } = await import('/src/connection.ts');
    const host = connection.getSnapshot().host.publicKey;
    const response = await connection.requestHost(host, 'cli.list', {});
    if (!response?.ok) throw new Error('CLI list unavailable');
    const ids = [...document.querySelectorAll('.new-items-popover [data-iori-cli-id]')].map(el => el.getAttribute('data-iori-cli-id'));
    return { ids, expected: response.result.clis.map(cli => cli.id).filter(id => ids.includes(id)) };
  })()`);
  assert.ok(launcherOrder.ids.includes(cliId));
  assert.deepEqual(launcherOrder.ids, launcherOrder.expected);
  await screen.input(".new-items-popover input", "My Pi");
  await screen.wait(`[data-iori-cli-id="${customId}"]`);
  assert.equal(
    await screen.visible('.new-items-popover button[data-iori-cli-id="pi"]'),
    false,
  );
  await screen.click(`[data-iori-cli-id="${customId}"]`);
  await screen.wait(`[data-iori-tab-cli="${customId}"]`);
  const customTerminal = (
    await screen.attribute(
      `[data-iori-tab-cli="${customId}"]`,
      "data-iori-tab-id",
    )
  ).replace(/^terminal:/, "");
  await focusTerminal(client, customTerminal);
  await waitForPiInput(client, customTerminal);
  await openAgents(screen);
  await screen.reveal(customRow);
  if ((await screen.attribute(customRow, "data-state")) !== "open")
    await screen.click(`${customRow} .team-agent-toggle`);
  await screen.click(`${customRow} ${action("cli-definition-edit")}`);
  assert.equal(
    await screen.value(`${customRow} [data-iori-field="cli-command"]`),
    registrationCommand + " --no-session",
  );
  await screen.click(`${customRow} ${action("cli-definition-cancel")}`);
  await cliMenuAction(screen, customId, "cli-definition-delete");
  await screen.wait('[data-iori-view="cli-definition-removal"]');
  await screen.click(action("cli-definition-remove"));
  await waitFor(() =>
    screen.evaluate(`!document.querySelector(${JSON.stringify(customRow)})`),
  );
  await returnToWorktree(screen);
  await screen.click(action("workspace-add-tab"));
  assert.equal(await screen.visible(`[data-iori-cli-id="${customId}"]`), false);
  assert.equal(
    await screen.attribute(
      `[data-iori-tab-id="terminal:${customTerminal}"]`,
      "data-iori-tab-cli",
    ),
    customId,
  );
  await screen.key("Escape");
  await record(
    "名前とコマンドで足したCLIの名前とコマンドを編集し、削除後も開いたTerminalは続く",
  );

  // Finish the two shells used by the exit checks before composing the v9
  // screenshot: only the two live CLIs and the original shell remain.
  for (const ended of [id, interrupted]) {
    await screen.click(`[data-iori-tab-id="terminal:${ended}"]`);
    await focusTerminal(client, ended);
    await typeTerminal(client, "exit\r", undefined, "finish-cli-check-shell", {
      focus: false,
    });
    const row = `[data-iori-terminal-row="${ended}"]`;
    await waitFor(
      async () =>
        !(await screen.visible(row)) ||
        (await screen.visible(`${row} .nav-session-exited`)),
    );
    if (await screen.visible(row)) {
      await screen.contextMenu(row);
      await screen.click(action("terminal-close"));
    }
    await waitFor(
      () => screen.visible(`[data-iori-tab-id="terminal:${ended}"]`),
      (value) => !value,
    );
  }

  const second = await open(cliId);
  await focusTerminal(client, second);
  await waitForPiInput(client, second);
  // v9 composition: two CLI panes above a full-width shell.
  await screen.click(`[data-iori-tab-id="terminal:${originalId}"]`);
  await splitTab(
    screen,
    `[data-iori-tab-id="terminal:${originalId}"]`,
    "below",
  );
  await screen.click(`[data-iori-tab-id="terminal:${second}"]`);
  await splitTab(screen, `[data-iori-tab-id="terminal:${second}"]`, "right");
  await focusTerminal(client, second);
  if (resize)
    await cliPaneResize({ client, terminalId: second, record, split: false });
  await themedShots(client, shot, "pc-overall-ja");
  const photoGroup = await screen.attribute(
    `[data-iori-tab-id="terminal:${second}"]`,
    "data-iori-group-id",
    "[data-iori-group-id]",
  );
  await screen.click(
    `[data-iori-group-id="${photoGroup}"] [data-iori-action="workspace-add-tab"]`,
  );
  await screen.wait(`[data-iori-cli-id="${cliId}"]`);
  await themedShots(client, shot, "pc-new");
  await screen.key("Escape");
  await openAgents(screen);
  await screen.wait(`[data-iori-cli-version="${cliId}"]`);
  await themedShots(client, shot, "pc-settings-ai-agents");
  await returnToWorktree(screen);
  await quit(second);
  await quit(customTerminal);
  return id;
}

/** An unauthenticated real Cursor CLI explains model discovery failure. */
export async function modelFailureScenario({ client, record }) {
  const screen = client.screen;
  await openAgents(screen);
  const row = '[data-iori-cli-row="cursor"]';
  await screen.wait(row);
  await waitFor(
    () => screen.text(`${row} [role="alert"]`),
    (text) => text.includes("Authentication required"),
    undefined,
    "Cursor CLIの認証エラーをAIエージェントに表示",
  );
  const summary = await screen.text(`${row} [data-iori-model-error-summary]`);
  assert.match(summary, /^Error: Authentication required/u);
  assert.doesNotMatch(
    summary,
    /\x1b|cannot set terminal process group|no job control/u,
  );
  const details = `${row} .team-preview-trigger`;
  assert.equal(await screen.attribute(details, "aria-expanded"), "false");
  assert.equal(
    await screen.visible(`${row} [data-iori-model-error-output]`),
    false,
  );
  await screen.click(details);
  await screen.wait(`${row} [data-iori-model-error-output]`);
  const output = await screen.text(`${row} [data-iori-model-error-output]`);
  assert.match(output, /^Error: Authentication required/u);
  assert.match(output, /CURSOR_API_KEY\/CURSOR_AUTH_TOKEN/u);
  assert.doesNotMatch(
    output,
    /\x1b|cannot set terminal process group|no job control/u,
  );
  await screen.click(`${row} [data-iori-action="retry-models"]`);
  await waitFor(
    () => screen.attribute(details, "aria-expanded"),
    (value) => value === "false",
  );
  assert.equal(
    await screen.visible(`${row} [data-iori-model-error-output]`),
    false,
  );
  await record(
    "Cursor CLIの認証エラーだけを表示し、詳細で全文を開き、再試行で閉じる",
  );
}
