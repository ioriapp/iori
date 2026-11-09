import { openWorkspaceView } from "../../verification/workspace/interaction.mjs";
import assert from "node:assert/strict";
import { waitFor } from "../../verification/ui.mjs";
import { splitTab } from "../../verification/workspace/interaction.mjs";
import {
  focusTerminal,
  controlKey,
  waitForPiInput,
  finishCli,
} from "../cli-screen/scenario.mjs";
import {
  typeTerminal,
  observed,
  clearObserved,
} from "../terminal/scenario.mjs";
import { openAgents, returnToWorktree } from "./agents-navigation.mjs";
import { openSidebar } from "../connection/scenario.mjs";

const action = (name) => `[data-iori-action="workspace-${name}"]`;
const tab = (id) => `[data-iori-tab-id="terminal:${id}"]`;
const start = '[data-iori-view="workspace-start"]';
const startTab = 'button[data-iori-tab-kind="start"]';
const startGroup = (screen) =>
  screen.attribute(startTab, "data-iori-group-id", "[data-iori-group-id]");
const closeStart = (screen) =>
  screen.click(
    '.dock-tab-header:has([data-iori-tab-kind="start"]) [data-iori-action="workspace-close-tab"]',
  );
const empty = '[data-iori-view="empty-pane"]';
const groupOf = (screen, id) =>
  screen.attribute(tab(id), "data-iori-group-id", "[data-iori-group-id]");

export async function paneMaximize({ client, terminalId, record, shot }) {
  const screen = client.screen;
  const originalViews = await screen.evaluate(
    `Array.from(document.querySelectorAll('button[data-iori-tab-kind="files"], button[data-iori-tab-kind="git"]'), tab => tab.dataset.ioriTabKind)`,
  );
  for (const kind of originalViews) {
    await openWorkspaceView(screen, kind);
    await screen.click(
      `.dock-tab-header:has([data-iori-tab-kind="${kind}"]) [data-iori-action="workspace-close-tab"]`,
    );
  }
  await screen.click(tab(terminalId));
  let group = await groupOf(screen, terminalId);
  const addedPanes = [];
  if (
    (await screen.evaluate(
      "document.querySelectorAll('.dv-groupview').length",
    )) === 1
  ) {
    await screen.click(`[data-iori-group-id="${group}"] ${action("add-tab")}`);
    await screen.click('[data-iori-shell-id="bash"]');
    await screen.wait(
      `[data-iori-group-id="${group}"] [data-iori-tab-kind="terminal"][data-iori-tab-id]:not([data-iori-tab-id="terminal:${terminalId}"])`,
    );
    const upperTerminal = (
      await screen.attribute(
        `[data-iori-group-id="${group}"] [data-iori-tab-kind="terminal"][data-iori-tab-id]:not([data-iori-tab-id="terminal:${terminalId}"])`,
        "data-iori-tab-id",
      )
    ).replace(/^terminal:/, "");
    await screen.click(tab(terminalId));
    await splitTab(screen, tab(terminalId), "below");
    addedPanes.push({ group, terminal: upperTerminal });
    await screen.click(
      `[data-iori-group-id="${group}"] ${action("split-right")}`,
    );
    await screen.wait(`${start} .cli-launcher-search input`);
    const id = await startGroup(screen);
    await screen.click(`${start} [data-iori-shell-id="bash"]`);
    await screen.wait(
      `[data-iori-group-id="${id}"] [data-iori-tab-id^="terminal:"]`,
    );
    const terminal = (
      await screen.attribute(
        `[data-iori-group-id="${id}"] [data-iori-tab-id^="terminal:"]`,
        "data-iori-tab-id",
      )
    ).replace(/^terminal:/, "");
    addedPanes.push({ group: id, terminal });
    group = await groupOf(screen, terminalId);
    await screen.click(tab(terminalId));
  }
  await screen.click(`[data-iori-group-id="${group}"] ${action("maximize")}`);
  await screen.wait(action("restore"));
  await focusTerminal(client, terminalId);
  await clearObserved(client);
  // The real PTY reads and reports the received byte without interpreting ESC.
  const receiver = String.raw`import os,sys,tty,termios
fd=sys.stdin.fileno()
old=termios.tcgetattr(fd)
tty.setraw(fd)
try:
 os.write(1,b'ESC_READY\r\n')
 byte=os.read(fd,1)
 os.write(1,b'\r\nESC_BYTES_'+byte.hex().encode()+b'_END\r\n')
finally:
 termios.tcsetattr(fd,termios.TCSANOW,old)
`;
  await typeTerminal(
    client,
    `python3 -c 'import base64;exec(base64.b64decode("${Buffer.from(receiver).toString("base64")}"))'\r`,
  );
  await observed(client, "ESC_READY");
  await screen.key("Escape");
  const received = await waitFor(() =>
    screen.evaluate(
      "window.__terminalObservation.tail.match(/ESC_BYTES_([0-9a-f]+)_END/)?.[1]",
    ),
  );
  assert.equal(received, "1b", "TerminalのEscapeが実PTYへ届く");
  assert.equal(await screen.visible(action("restore")), true);
  assert.equal(await screen.visible(".workspace-maximize-backdrop"), true);
  await record("TerminalのEscapeは最大化を保ち、実PTYが0x1bを受信する");
  await screen.click(action("restore"));
  await screen.click(`[data-iori-group-id="${group}"] ${action("add-tab")}`);
  await screen.click('[data-iori-cli-id="pi"]');
  await screen.wait('[data-iori-tab-cli="pi"]');
  const piId = (
    await screen.attribute('[data-iori-tab-cli="pi"]', "data-iori-tab-id")
  ).replace(/^terminal:/, "");
  await focusTerminal(client, piId);
  await waitForPiInput(client, piId);
  await screen.click(
    `[data-iori-group-id="${group}"] ${action("split-right")}`,
  );
  await screen.wait(`${start} .cli-launcher-search input`);
  const otherGroup = await startGroup(screen);
  await screen.click(`${start} [data-iori-shell-id="bash"]`);
  await screen.wait(
    `[data-iori-group-id="${otherGroup}"] [data-iori-tab-id^="terminal:"]`,
  );
  const otherId = (
    await screen.attribute(
      `[data-iori-group-id="${otherGroup}"] [data-iori-tab-id^="terminal:"]`,
      "data-iori-tab-id",
    )
  ).replace(/^terminal:/, "");
  await openWorkspaceView(screen, "files", otherGroup);
  const rectangles = (includeHidden = false) =>
    screen.evaluate(`
    [...document.querySelectorAll('[data-iori-workspace-panel]')].map(e=>{
      const id=e.getAttribute('data-iori-workspace-panel');
      const tab=[...document.querySelectorAll('[data-iori-tab-id]')].find(t=>t.getAttribute('data-iori-tab-id')===id);
      const pane=tab?.closest('.dv-groupview')?.querySelector('.dv-content-container');
      return {
      id:e.getAttribute('data-iori-workspace-panel'),
      rect:e.getBoundingClientRect().toJSON(),
      pane:pane?.getBoundingClientRect().toJSON(),
      visible:getComputedStyle(e).visibility!=='hidden'
    }}).filter(e=>(e.visible||${includeHidden})&&e.rect.width>0&&e.rect.height>0)`);
  await screen.wait('[data-iori-tab-kind="files"]');
  const filesId = await screen.attribute(
    '[data-iori-tab-kind="files"]',
    "data-iori-tab-id",
  );
  const filesGroup = await screen.attribute(
    '[data-iori-tab-kind="files"]',
    "data-iori-group-id",
    "[data-iori-group-id]",
  );
  for (const [target, selectedId, restore] of [
    [group, `terminal:${terminalId}`, "escape"],
    [group, `terminal:${piId}`, "button"],
    [otherGroup, `terminal:${otherId}`, "outside"],
    [filesGroup, filesId, "double-click"],
  ]) {
    const button = `[data-iori-group-id="${target}"] ${action("maximize")}`;
    const groupTabs = await screen.evaluate(
      `[...document.querySelectorAll('[data-iori-group-id="${target}"] [data-iori-tab-id]')].map(e=>e.getAttribute('data-iori-tab-id'))`,
    );
    const selectedTab = `[data-iori-tab-id="${selectedId}"]`;
    await screen.click(selectedTab);
    await screen.wait(`[data-iori-workspace-panel="${selectedId}"]`);
    // A retained overlay may already be visible at its previous coordinates.
    // Capture the baseline only once the selected content fills its own pane.
    const before = await waitFor(
      rectangles,
      (items) =>
        items.some((item) => item.id === selectedId) &&
        items.every(
          (item) =>
            item.pane &&
            ["x", "y", "width", "height"].every(
              (key) => Math.abs(item.rect[key] - item.pane[key]) < 1,
            ),
        ),
      undefined,
      `${target}/${restore}: 選んだタブの内容がペインに収まる`,
    );
    if (restore === "double-click") await screen.doubleClick(selectedTab);
    else await screen.click(button);
    await screen.wait(action("restore"));
    // Switching visible content makes Dockview measure the maximized group.
    // Restoring must discard those coordinates for every kind of tab.
    for (const id of groupTabs)
      await screen.click(`[data-iori-tab-id="${id}"]`);
    await screen.click(selectedTab);
    if (restore === "escape") await shot("pane-maximized");
    if (restore === "button") await screen.click(action("restore"));
    else if (restore === "escape") {
      // The tab header is outside the shell/CLI input and owns this key.
      await screen.evaluate(`document.querySelector('${selectedTab}').focus()`);
      await screen.key("Escape");
    } else if (restore === "double-click")
      await screen.doubleClick(selectedTab);
    else {
      // The maximized group covers the backdrop center; click the exposed edge.
      await screen.click(".workspace-maximize-backdrop", { x: 0.005 });
    }
    await waitFor(
      async () => !(await screen.visible(".workspace-maximize-backdrop")),
    );
    await waitFor(
      () => rectangles(true),
      (after) =>
        after.every(
          (item) =>
            item.pane &&
            ["x", "y", "width", "height"].every(
              (key) => Math.abs(item.rect[key] - item.pane[key]) < 1,
            ),
        ) &&
        before.every((original) => {
          const restored = after.find((item) => item.id === original.id);
          return (
            restored &&
            ["x", "y", "width", "height"].every(
              (key) => Math.abs(restored.rect[key] - original.rect[key]) < 1,
            )
          );
        }),
      undefined,
      `${target}/${restore}: 内容が元のペインへ戻る`,
    );
    assert.equal(await screen.visible(action("restore")), false);
    if (restore === "escape") {
      await shot("pane-restored");
      // Moving focus after restoring must not scroll the whole workspace.
      await screen.key("Tab");
    }
    const surface = await screen.evaluate(`(()=>{
      const root=document.querySelector('.iori-dock');
      return {top:root.scrollTop,left:root.scrollLeft,width:root.clientWidth,height:root.clientHeight,scrollWidth:root.scrollWidth,scrollHeight:root.scrollHeight};
    })()`);
    assert.equal(surface.top, 0);
    assert.equal(surface.left, 0);
    assert.equal(surface.scrollHeight, surface.height);
    assert.equal(surface.scrollWidth, surface.width);
    await record(
      `最大化から復元 ${target}/${selectedId}/${restore}: ${JSON.stringify({ panels: await rectangles(true), surface })}`,
    );
  }
  // Leave the existing scenario's original Terminal and layout available.
  await screen.click('[data-iori-tab-kind="files"]');
  await screen.click(
    '.dock-tab-header:has([data-iori-tab-kind="files"]) [data-iori-action="workspace-close-tab"]',
  );
  for (const id of [piId, otherId]) {
    await screen.click(tab(id));
    if (id === piId) await finishCli(client, piId, "pi");
    await focusTerminal(client, id);
    await typeTerminal(client, "exit\r");
    await waitFor(async () => !(await screen.visible(tab(id))));
  }
  await screen.click(
    `[data-iori-empty-group="${otherGroup}"] ${action("close-pane")}`,
  );
  await screen.click(tab(terminalId));
  for (const pane of addedPanes.reverse()) {
    await screen.click(tab(pane.terminal));
    await focusTerminal(client, pane.terminal);
    await typeTerminal(client, "exit\r");
    await waitFor(async () => !(await screen.visible(tab(pane.terminal))));
    await screen.click(
      `[data-iori-empty-group="${pane.group}"] ${action("close-pane")}`,
    );
  }
  for (const kind of originalViews) await openWorkspaceView(screen, kind);
  await screen.click(tab(terminalId));
}

export async function paneResize({ client, terminalId, record }) {
  const screen = client.screen;
  const group = await groupOf(screen, terminalId);
  await screen.click(
    `[data-iori-group-id="${group}"] ${action("split-right")}`,
  );
  await screen.wait(start);
  await focusTerminal(client, terminalId);
  // Real PTY output and OSC titles exercise the same Host metadata updates
  // as a running CLI. No synthetic React render or delayed Promise is used.
  await typeTerminal(
    client,
    'i=0; while :; do i=$((i+1)); printf \'\\033]0;output-%s\\007stream-%s\\n\' "$i" "$i"; sleep 0.05; done\r',
  );
  await observed(client, "stream-3");
  await screen.evaluate(`(()=>{
    const pane=document.querySelector('[data-iori-terminal-id="${terminalId}"]');
    const sash=[...document.querySelectorAll('.dv-sash')].find(e=>{const r=e.getBoundingClientRect();return r.height>r.width&&r.height>0;});
    sash.setAttribute('data-iori-output-sash','');
    const read=()=>({width:pane.getBoundingClientRect().width,cols:Number(pane.getAttribute('data-iori-cols')),screenWidth:pane.querySelector('.xterm-screen').getBoundingClientRect().width,frames:window.__terminalObservation.frames});
    const o=window.__paneResize={before:read(),moves:[],read};
    window.__terminalObservation.renderFrames=[];
    let dragging=false;
    const sample=()=>{if(dragging){o.moves.push(read());requestAnimationFrame(sample);}};
    const down=()=>{dragging=true;sample();};
    const up=()=>{dragging=false;document.removeEventListener('pointerdown',down);document.removeEventListener('pointerup',up);};
    document.addEventListener('pointerdown',down);
    document.addEventListener('pointerup',up);
  })()`);
  await screen.drag(
    "[data-iori-output-sash]",
    `[data-iori-terminal-id="${terminalId}"]`,
    { x: 0.65 },
  );
  const metrics = await screen.evaluate(`(()=>{
    const o=window.__paneResize;
    const stream=document.querySelector('[data-iori-terminal-id="${terminalId}"]').getAttribute('data-iori-stream-id');
    return {before:o.before,moves:o.moves,after:o.read(),sizes:window.__terminalObservation.renderFrames.filter(f=>f.kind==='terminal.size'&&f.streamId===stream).length};
  })()`);
  await record(`出力中の境界ドラッグ: ${JSON.stringify(metrics)}`);
  assert.ok(
    metrics.moves.at(-1).frames > metrics.moves[0].frames,
    "ドラッグ中も実際の出力を受け取る",
  );
  assert.ok(
    Math.abs(metrics.after.width - metrics.before.width * 0.65) < 5,
    "離した位置に境界を保つ",
  );
  assert.ok(
    metrics.moves.every(
      (m, i) => i === 0 || m.width <= metrics.moves[i - 1].width + 1,
    ),
    "ドラッグ中に境界が戻らない",
  );
  assert.ok(
    metrics.moves.every(
      (m) =>
        m.cols === metrics.before.cols &&
        m.screenWidth === metrics.before.screenWidth,
    ),
    "ドラッグ中は端末寸法を保つ",
  );
  const sizeFrames = `window.__terminalObservation.renderFrames.filter(f=>f.kind==='terminal.size'&&f.streamId===document.querySelector('[data-iori-terminal-id="${terminalId}"]').getAttribute('data-iori-stream-id')).length`;
  // The Host confirms the new size asynchronously; count only after it
  // arrives and after a later input round trip, so a slow machine cannot
  // pass with zero or hide a second update.
  await waitFor(
    () => screen.evaluate(sizeFrames),
    (sizes) => sizes > 0,
    10000,
    "離した後に端末寸法の更新が届く",
  );
  await focusTerminal(client, terminalId);
  await clearObserved(client);
  await controlKey(client, "c");
  await observed(client, /^iori-test#\s*$/mu);
  await typeTerminal(client, "printf '%s%s\\n' 'drag-' 'complete'\r");
  await observed(client, "drag-complete");
  assert.equal(
    await screen.evaluate(sizeFrames),
    1,
    "離した後に端末寸法を一度だけ更新する",
  );
  await record("連続出力中も境界を保持し、離した後も入力を続けられる");
  await closeStart(screen);
  await waitFor(async () => !(await screen.visible(start)));
}

export async function paneActions({
  client,
  terminalId,
  record,
  shot,
  finishBackgroundTerminal,
}) {
  const screen = client.screen;
  const group = await groupOf(screen, terminalId);
  for (const direction of ["right", "below"]) {
    await screen.click(
      `[data-iori-group-id="${group}"] ${action(`split-${direction}`)}`,
    );
    await screen.wait(`${start} .cli-launcher-search input`);
    assert.equal(await groupOf(screen, terminalId), group);
    assert.equal(await screen.visible(startTab), true);
    for (const name of ["add-tab", "split-right", "split-below", "maximize"])
      assert.equal(
        await screen.visible(
          `[data-iori-group-id="${await startGroup(screen)}"] ${action(name)}`,
        ),
        true,
      );
    if (direction === "right") {
      await shot("start-pane");
      if (process.env.IORI_TEAMS_CAPTURE === "1") {
        for (const theme of ["light", "dark"]) {
          await client.browser.viewport({ width: 1440, height: 900 });
          await screen.evaluate(
            `document.documentElement.classList.toggle('dark', ${theme === "dark"})`,
          );
          await shot(`pc-split-panes-${theme}`);
        }
        await client.browser.viewport({ width: 390, height: 844 });
        await screen.wait(start);
        await shot("mobile-split-panes-dark");
        await client.browser.viewport({ width: 1440, height: 1000 });
        await screen.wait(startTab);
      }
      const emptyGroup = await startGroup(screen);
      await screen.click(
        `[data-iori-group-id="${emptyGroup}"] ${action("maximize")}`,
      );
      await screen.wait(action("restore"));
    }
    await closeStart(screen);
    await waitFor(async () => !(await screen.visible(start)));
    assert.equal(
      await screen.visible(action("restore")),
      false,
      "最大化した始めるのペインを閉じたら元の配置へ戻る",
    );
    assert.equal(
      await screen.visible(".workspace-maximize-backdrop"),
      false,
      "最大化の背景を残さない",
    );
  }
  await record(
    "単一Terminalの左右上下分割は元のタブを保ち、始めるタブのあるペインを開き、閉じられる",
  );
  await openWorkspaceView(screen, "files");
  await screen.click(tab(terminalId));
  await screen.click(
    `[data-iori-group-id="${group}"] ${action("split-right")}`,
  );
  assert.equal(
    await groupOf(screen, terminalId),
    group,
    "複数タブでも元のTerminalを動かさない",
  );
  await screen.wait(`${start} .cli-launcher-search input`);
  const newGroup = await startGroup(screen);
  await screen.click(`${start} [data-iori-shell-id="bash"]`);
  // The start tab is replaced in place; read the id once it is the Terminal.
  const newTab = await waitFor(() =>
    screen.attribute(
      `[data-iori-group-id="${newGroup}"] [data-iori-tab-id^="terminal:"]`,
      "data-iori-tab-id",
    ),
  );
  const newId = newTab.replace(/^terminal:/, "");
  await focusTerminal(client, newId);
  // Wait for the shell to receive the command before hiding its stream.
  // A FIFO lets the runner end it only once the other screen is visible.
  await typeTerminal(
    client,
    "mkfifo .pane-exit; printf '%s%s\\n' 'pane-' 'waiting'; read -r < .pane-exit; rm -f .pane-exit; exit\r",
  );
  await observed(client, "pane-waiting");
  await openAgents(screen);
  await screen.wait(".team-surface:not([hidden]) .team-agents-page");
  await finishBackgroundTerminal();
  await waitFor(() =>
    screen.evaluate(
      `!document.querySelector('[data-iori-tab-id="terminal:${newId}"]')`,
    ),
  );
  await returnToWorktree(screen);
  await screen.wait(
    `[data-iori-empty-group="${newGroup}"] .cli-launcher-search input`,
  );
  await screen.click(
    `[data-iori-empty-group="${newGroup}"] ${action("close-pane")}`,
  );
  await waitFor(
    async () =>
      !(await screen.visible(`[data-iori-empty-group="${newGroup}"]`)),
  );
  await record(
    "Teams画面の裏でプロセスが終了しても、戻ると空ペインの一覧から閉じられる",
  );
  await screen.click(
    `[data-iori-group-id="${group}"] ${action("split-right")}`,
  );
  await screen.wait(`${start} .cli-launcher-search input`);
  const mobileExitGroup = await startGroup(screen);
  await screen.click(`${start} [data-iori-shell-id="bash"]`);
  const mobileExitTab = await waitFor(() =>
    screen.attribute(
      `[data-iori-group-id="${mobileExitGroup}"] [data-iori-tab-id^="terminal:"]`,
      "data-iori-tab-id",
    ),
  );
  const mobileExitId = mobileExitTab.replace(/^terminal:/, "");
  await client.browser.viewport({ width: 390, height: 844 });
  await screen.wait(
    `[data-iori-workspace-panel="${mobileExitTab}"]:not([hidden])`,
  );
  await focusTerminal(client, mobileExitId);
  await typeTerminal(client, "exit\r");
  await waitFor(() =>
    screen.evaluate(
      `!document.querySelector('[data-iori-workspace-panel="${mobileExitTab}"]')`,
    ),
  );
  await client.browser.viewport({ width: 1440, height: 1000 });
  await screen.wait(
    `[data-iori-empty-group="${mobileExitGroup}"] .cli-launcher-search input`,
  );
  await screen.click(
    `[data-iori-empty-group="${mobileExitGroup}"] ${action("close-pane")}`,
  );
  await record("MobileでTerminalが終了しても、PCへ戻ると空ペインが残る");
  // With only one pane left, ending its last Terminal keeps the launcher but
  // cannot offer closing the user's final place to open a View.
  await screen.click(
    '.dock-tab-header:has([data-iori-tab-kind="files"]) [data-iori-action="workspace-close-tab"]',
  );
  await screen.click('button[data-iori-tab-kind="git"]');
  await screen.click(
    '.dock-tab-header:has([data-iori-tab-kind="git"]) [data-iori-action="workspace-close-tab"]',
  );
  await focusTerminal(client, terminalId);
  await typeTerminal(client, "exit\r");
  await screen.wait(`${empty} .cli-launcher-search input`);
  assert.equal(await screen.visible(action("close-pane")), false);
  await record("最後の1ペインには閉じる操作を出さない");
  await screen.click(`${empty} [data-iori-shell-id="bash"]`);
  const resumedTab = await waitFor(() =>
    screen.attribute(
      `[data-iori-group-id="${group}"] [data-iori-tab-id^="terminal:"]`,
      "data-iori-tab-id",
    ),
  );
  const resumedId = resumedTab.replace(/^terminal:/, "");
  await focusTerminal(client, resumedId);
  await typeTerminal(client, "printf '%s%s\\n' '空のペイン' 'で続ける'\r");
  await observed(client, "空のペインで続ける");
  await record("最後の空ペインからTerminalを開いて続けられる");
  await client.browser.viewport({ width: 390, height: 844 });
  await screen.wait(
    `[data-iori-workspace-panel="${resumedTab}"]:not([hidden])`,
  );
  await screen.click(action("add-tab"));
  await screen.click('[data-iori-shell-id="bash"]');
  const mobileNewTab = await waitFor(
    () =>
      screen.attribute(
        '[data-iori-workspace-panel^="terminal:"]:not([hidden])',
        "data-iori-workspace-panel",
      ),
    (id) => Boolean(id && id !== resumedTab),
  );
  await openSidebar(screen);
  await screen.click(`[data-iori-terminal-row="${resumedId}"]`);
  await screen.click(action("close-tab"));
  await screen.wait(
    `[data-iori-workspace-panel="${mobileNewTab}"]:not([hidden])`,
  );
  await focusTerminal(client, mobileNewTab.replace(/^terminal:/, ""));
  await typeTerminal(client, "exit\r");
  await waitFor(() =>
    screen.evaluate(
      `!document.querySelector(${JSON.stringify(`[data-iori-workspace-panel="${mobileNewTab}"]`)})`,
    ),
  );
  await client.browser.viewport({ width: 1440, height: 1000 });
  await screen.wait(`${empty} .cli-launcher-search input`);
  await screen.click(`[data-iori-terminal-row="${resumedId}"]`);
  await screen.wait(tab(resumedId));
  await record(
    "MobileでPCのタブを閉じ新しいTerminalが終了してもPCで作業を続けられる",
  );
  return resumedId;
}
