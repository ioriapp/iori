import { openSidebar } from "../connection/scenario.mjs";
import assert from "node:assert/strict";
import {
  clearObserved,
  observed,
  typeTerminal,
} from "../terminal/scenario.mjs";
import { clickWithin, waitFor } from "../../verification/ui.mjs";

// Run explicitly with --only=terminal-width-handoff. A PC click on a Terminal
// that already has focus must take the width back from a phone (Issue #101),
// and a phone's batch-input screen must take it back with a finger tap (#103).
export async function terminalWidthHandoff({
  desktop,
  phone,
  worktree,
  terminalId,
  record,
}) {
  const pane = `[data-iori-view="terminal"][data-iori-terminal-id=${JSON.stringify(terminalId)}]`;
  const cols = (client) =>
    client.screen.evaluate(
      `Number(document.querySelector(${JSON.stringify(pane)}).dataset.ioriCols)`,
    );
  const screen = desktop.screen;
  const pc = await screen.evaluate(`(()=>{
    const e=document.querySelector(${JSON.stringify(pane)});
    return {cols:Number(e.dataset.ioriCols),rows:Number(e.dataset.ioriRows)};
  })()`);
  // A real foreground PTY program on the alternate screen, like a TUI CLI,
  // prints the kernel's size on SIGWINCH. It reads no input, so a click
  // cannot reach the PTY as typed text that would take the width instead.
  const program = [
    "import os,signal,sys,time",
    "def report(*_):",
    "  size=os.get_terminal_size(0)",
    "  print('\\r\\nPTY_%dx%d'%(size.columns,size.lines),end='',flush=True)",
    "signal.signal(signal.SIGWINCH,report)",
    "print('\\x1b[?1049h\\x1b[2J\\x1b[H'+'WIDTH_'+'READY',end='',flush=True)",
    "try:",
    "  while True: time.sleep(60)",
    "finally:",
    "  print('\\x1b[?1049l',end='',flush=True)",
  ].join("\n");
  await typeTerminal(
    desktop,
    `python3 -c '${`exec(${JSON.stringify(program)})`.replaceAll("'", "'\\''")}'\r`,
  );
  await observed(desktop, "WIDTH_READY");
  const mobile = await phone();
  await mobile.browser.call("Emulation.setTouchEmulationEnabled", {
    enabled: true,
  });
  await mobile.screen.wait('[data-iori-view="workspace"]');
  await openSidebar(mobile.screen);
  await mobile.screen.click(
    `button[data-iori-worktree-path=${JSON.stringify(worktree)}]`,
  );
  await openSidebar(mobile.screen);
  await mobile.screen.click(
    `[data-iori-terminal-row=${JSON.stringify(terminalId)}]`,
  );
  await mobile.screen.wait(`${pane}[data-iori-stream-state="ready"]`);
  // Shells start in live input. Their batch mode uses the same tap handler as
  // CLI screens, which start in batch input by default.
  await mobile.screen.click(`${pane} [data-iori-action="terminal-input-live"]`);
  await mobile.screen.wait(`${pane} [data-iori-field="terminal-batch-input"]`);
  await waitFor(async () => (await cols(desktop)) < pc.cols);
  await clearObserved(desktop);
  await desktop.browser.call("Page.bringToFront");
  // The PC Terminal kept its focus, so this click raises no focus event.
  await clickWithin(desktop, `${pane} .xterm-screen`);
  await observed(desktop, `PTY_${pc.cols}x${pc.rows}`);
  await record(
    "スマホが幅を取った後、焦点を保ったPCのTerminalのクリックでPTYがPCの幅に戻る",
  );
  await clearObserved(desktop);
  await mobile.browser.call("Page.bringToFront");
  await waitFor(
    async () => (await cols(mobile)) === pc.cols,
    Boolean,
    undefined,
    "スマホのpaneへPCの幅が届く",
  );
  // The shared touch helper with no finger movement is a tap, not a mouse
  // click or focus change. The program reports the real PTY width on resize.
  await mobile.screen.swipe(
    `${pane} .xterm-screen`,
    { x: 0.5, y: 0.5 },
    { x: 0.5, y: 0.5 },
  );
  // A pane shows the PTY's current size, so read the phone's width once the
  // tap has taken it: the phone's layout may have settled after the first take.
  const mobileCols = await waitFor(
    async () => {
      const value = await cols(mobile);
      return value < pc.cols ? value : undefined;
    },
    Boolean,
    undefined,
    "スマホのtapの後のpaneの列数",
  );
  await observed(desktop, `PTY_${mobileCols}x`);
  assert.equal(
    await mobile.screen.evaluate("document.activeElement.matches('textarea')"),
    false,
  );
  await record(
    "PCが幅を持つまとめて入力の画面をスマホの指でtapすると、入力欄へ焦点を移さずPTYがスマホの幅に戻る",
  );
  await mobile.browser.call("Page.close");
  await typeTerminal(desktop, "\x03", undefined, "finish-program", {
    focus: false,
  });
}
