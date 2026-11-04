import { local as verificationLocal } from "../native/local.mjs";
import assert from "node:assert/strict";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { lockEntry } from "../native/locks.mjs";
import {
  gate,
  prepareWindowsRuntime,
  cleanupWindowsRuntime,
  linux,
  sh,
} from "../native/remote.mjs";
import {
  windowsDesktop,
  windowsResizePoint,
} from "../native/windows-desktop.mjs";
import { evidence } from "../connection/build.mjs";
import {
  prepareWindowsClientStorage,
  cleanupWindowsClientStorage,
} from "../connection/client-storage.mjs";
import {
  startWindowsClient,
  stopWindowsClientTask,
} from "../connection/client.mjs";
import { startHost } from "../connection/host.mjs";
import { inviteCli } from "../connection/cli.mjs";
import {
  register,
  openSettingsSection,
  openSidebar,
  closeSidebar,
} from "../../e2e/connection/scenario.mjs";
import { openFolder } from "../../e2e/workspace/scenario.mjs";
import { create, observe } from "../../e2e/terminal/scenario.mjs";
import { waitFor } from "../ui.mjs";
await lockEntry(import.meta.url);
gate({
  devices: [verificationLocal.linux.host, verificationLocal.windows.host],
});
const state = JSON.parse(
  await readFile(evidence + "/build-state.json", "utf8"),
);
const root = evidence + "/run-" + Date.now();
await mkdir(root, { recursive: true });
const result = { steps: [], cleanup: {} };
let client, host, cli, runtime;
const record = (step, value) => {
  result.steps.push({ step, value });
  console.log(step, JSON.stringify(value));
};
const capture = (name) =>
  windowsDesktop(state, "window-capture", {
    screenshot: `${root}/${name}.png`,
  });
const pointer = (action, x, y, rest = {}) =>
  windowsDesktop(state, "window-pointer", {
    pointer: { action, x, y, ...rest },
  });
const windowState = () => windowsDesktop(state, "window-state");
const assertMoved = (before, after) =>
  assert.ok(
    before.bounds.x !== after.bounds.x || before.bounds.y !== after.bounds.y,
    "空きをドラッグすると窓が移動する",
  );
// Edge resizes start with room on every side. Earlier moves can leave an edge
// on the work area's border, where Windows snaps instead of resizing.
const placeForResize = async () => {
  const before = await windowState();
  const scale = before.dpi / 96;
  const blank = await blankPoint();
  await pointer("drag", blank.x, blank.y, {
    toX: blank.x + (200 - before.bounds.x) / scale,
    toY: blank.y + (80 - before.bounds.y) / scale,
  });
  record("place-for-resize", await windowState());
};
const blankPoint = () =>
  client.screen.evaluate(
    "(()=>{const e=[...document.querySelectorAll('.dv-void-container[data-tauri-drag-region],.window-mobile-drag-region')].find(e=>e.getBoundingClientRect().width>0);const r=e?.getBoundingClientRect();return r?{x:r.x+r.width/2,y:r.y+r.height/2}:null})()",
  );
const panePositions = () =>
  client.screen.evaluate(
    "[...document.querySelectorAll('.dv-groupview')].map(e=>({tabs:[...e.querySelectorAll('[data-iori-tab-id]')].map(t=>t.getAttribute('data-iori-tab-id')),rect:e.getBoundingClientRect().toJSON()}))",
  );
const setTheme = async (theme) => {
  await openSettingsSection(client.screen, "settings-display");
  await client.screen.click('[data-iori-action="display-theme"]');
  await client.screen.click(`[data-iori-option="theme-${theme}"]`);
  await waitFor(() =>
    client.screen.evaluate(
      `document.documentElement.classList.contains('dark')===${theme === "dark"}`,
    ),
  );
  await client.screen.click('[data-iori-action="settings-close"]');
  await waitFor(
    async () => !(await client.screen.visible('[data-iori-view="settings"]')),
  );
};
// Modal backdrops raise the caption strip above everything; each part must be
// below it and inside the window.
const insideWindow = async (name, selectors) => {
  const layout = await client.screen.evaluate(
    `(()=>({caption:parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--window-caption-height')),height:innerHeight,parts:${JSON.stringify(selectors)}.map(s=>{const r=document.querySelector(s)?.getBoundingClientRect();return {s,top:r?.top,bottom:r?.bottom}}),scrolls:[...document.querySelectorAll('[role=dialog] *')].some(e=>e.scrollHeight>e.clientHeight+1&&/auto|scroll/.test(getComputedStyle(e).overflowY))}))()`,
  );
  record(name + "-layout", layout);
  for (const part of layout.parts)
    if (!(part.top >= layout.caption && part.bottom <= layout.height))
      outside.push(`${name}: ${part.s}`);
  return layout;
};
const outside = [];
try {
  prepareWindowsClientStorage(state);
  runtime = prepareWindowsRuntime();
  host = await startHost("linux", state.linuxRoot);
  client = await startWindowsClient(state);
  cli = await inviteCli("linux", host.root, host.dataHome);
  await register(client.screen, cli.invitation, "Window controls verification");
  // Registration ends on the Devices settings.
  await client.screen.click('[data-iori-action="settings-close"]');
  const folder = state.linuxRoot + "/caption-fixture";
  // Merged worktrees make the cleanup confirmation taller than the window.
  const commit = "git -c user.name=iori -c user.email=iori@localhost";
  linux(
    `sudo -u iori-dev -H bash -c ${sh(`set -e; mkdir -p ${sh(folder)}; cd ${sh(folder)}; test -d .git && exit 0; git init -q -b main; ${commit} commit -q --allow-empty -m base; for i in $(seq -w 1 16); do git worktree add -q -b merged-$i ../caption-worktree-$i; ${commit} -C ../caption-worktree-$i commit -q --allow-empty -m task-$i; ${commit} merge -q --no-ff merged-$i -m merge-$i; done`)}`,
  );
  await openFolder(client.screen, folder, false);
  await observe(client);
  await create(client);
  await setTheme("light");
  const size = () =>
    client.screen.evaluate("({width:innerWidth,height:innerHeight})");
  const initial = await capture("normal");
  record("normal", initial);
  assert.equal(initial.title, "iori");
  let view = await size();
  record(
    "layout",
    await client.screen.evaluate(
      "({chrome:Boolean(document.querySelector('[data-iori-part=window-controls]')),bars:[...document.querySelectorAll('.dv-tabs-and-actions-container')].map(e=>({top:e.getBoundingClientRect().top,padding:getComputedStyle(e).paddingRight})),controls:document.querySelector('[data-iori-part=window-controls]')?.getBoundingClientRect().toJSON()})",
    ),
  );
  // PC width: tall dialogs, the settings dialog and menus stay below the caption.
  const original = view;
  let edgePoint = windowsResizePoint(original, "right");
  await pointer("drag", edgePoint.x, edgePoint.y, {
    toX: windowsResizePoint({ ...original, width: 1440 }, "right").x,
    toY: edgePoint.y,
  });
  await waitFor(async () => (await size()).width !== original.width);
  record("pc-size", await size());
  for (const theme of ["light", "dark"]) {
    await setTheme(theme);
    await openSettingsSection(client.screen, "settings-display");
    await insideWindow(`settings-${theme}`, [
      '[data-iori-view="settings"]',
      '[data-iori-action="settings-close"]',
    ]);
    record(`settings-${theme}`, await capture(`settings-${theme}`));
    await client.screen.click('[data-iori-action="settings-close"]');
    await waitFor(
      async () => !(await client.screen.visible('[data-iori-view="settings"]')),
    );
    await openSidebar(client.screen);
    await client.screen.contextMenu(
      `.nav-repository-button[title=${JSON.stringify(folder)}]`,
    );
    await client.screen.click('[data-iori-action="worktree-cleanup"]');
    // Before the fix the candidates can sit above the window, so wait in the DOM.
    await waitFor(() =>
      client.screen.evaluate(
        "document.querySelectorAll('[data-iori-removal-select]').length===16",
      ),
    );
    const cleanup = await insideWindow(`worktree-cleanup-${theme}`, [
      '[data-iori-view="worktree-removal"]',
      '[data-iori-view="worktree-removal"] [data-slot="dialog-title"]',
      '[data-iori-view="worktree-removal"] [data-slot="dialog-footer"]',
    ]);
    if (!cleanup.scrolls)
      outside.push(`worktree-cleanup-${theme}: 本文のスクロール`);
    record(
      `worktree-cleanup-${theme}`,
      await capture(`worktree-cleanup-${theme}`),
    );
    await client.screen.key("Escape");
    await waitFor(
      async () =>
        !(await client.screen.visible('[data-iori-view="worktree-removal"]')),
    );
    await client.screen.contextMenu("[data-iori-tab-id]");
    await client.screen.wait('[data-slot="context-menu-content"]');
    await insideWindow(`tab-menu-${theme}`, [
      '[data-slot="context-menu-content"]',
    ]);
    record(`tab-menu-${theme}`, await capture(`tab-menu-${theme}`));
    await client.screen.key("Escape");
    await waitFor(
      async () =>
        !(await client.screen.visible('[data-slot="context-menu-content"]')),
    );
  }
  await setTheme("light");
  view = await size();
  edgePoint = windowsResizePoint(view, "right");
  await pointer("drag", edgePoint.x, edgePoint.y, {
    toX: windowsResizePoint(original, "right").x,
    toY: edgePoint.y,
  });
  await waitFor(
    async () => Math.abs((await size()).width - original.width) <= 2,
  );
  view = await size();
  await pointer("hover", view.width - 69, 17);
  record("snap-hover", await capture("snap-layout"));
  record(
    "hover-state",
    await client.screen.evaluate(
      "document.querySelector('[data-iori-action=window-maximize]')?.getAttribute('data-hover')",
    ),
  );
  await pointer("click", view.width - 69, 17);
  await waitFor(async () => (await size()).width !== view.width);
  const maximized = await capture("maximized");
  record("maximized", maximized);
  assert.equal(maximized.maximized, true);
  await setTheme("dark");
  record("dark", await capture("dark"));
  await pointer("hover", (await size()).width - 69, 17);
  record("dark-hover", await capture("dark-hover"));
  await pointer("hover", 100, 100);
  assert.equal(
    await client.screen.attribute(
      '[data-iori-action="window-maximize"]',
      "data-hover",
    ),
    "false",
  );
  await setTheme("light");
  await client.screen.click('[data-iori-action="workspace-maximize"]');
  record("pane-maximized", await capture("pane-maximized"));
  await pointer("click", 100, 17);
  await waitFor(
    async () => !(await client.screen.visible(".workspace-maximize-backdrop")),
  );
  view = await size();
  await pointer("click", view.width - 69, 17);
  await waitFor(async () => (await size()).width !== view.width);
  const restored = await capture("restored");
  record("restored", restored);
  assert.equal(restored.maximized, false);
  let blank = await blankPoint();
  assert.ok(blank, "上端に窓を動かせる空きがある");
  await pointer("double", blank.x, blank.y);
  const doubleMaximized = await capture("double-click");
  record("double-click", doubleMaximized);
  assert.equal(doubleMaximized.maximized, true);
  blank = await blankPoint();
  await pointer("double", blank.x, blank.y);
  const doubleRestored = await windowState();
  record("double-click-restore", doubleRestored);
  assert.equal(doubleRestored.maximized, false);
  // The OS consumes pointerup during the move. Moving over the pane afterward
  // must not start a Dockview ghost, nor may the following click move the pane.
  for (const steps of [20, 2]) {
    blank = await blankPoint();
    const before = await windowState();
    const panes = await panePositions();
    await pointer("drag", blank.x, blank.y, {
      toX: blank.x + 40,
      toY: blank.y + 40,
      steps,
    });
    const moved = await capture(`drag-${steps}`);
    record(`drag-${steps}`, moved);
    assertMoved(before, moved);
    view = await size();
    await pointer("hover", view.width - 40, view.height / 2);
    record(
      `post-drag-hover-${steps}`,
      await capture(`post-drag-hover-${steps}`),
    );
    assert.equal(
      await client.screen.visible(
        '.dv-drop-target-selection,.dv-drop-target-anchor,body > div[style*="z-index: 99999"]',
      ),
      false,
    );
    await pointer("click", view.width - 40, view.height / 2);
    assert.deepEqual(
      await panePositions(),
      panes,
      "窓を動かした後もペインの配置は変わらない",
    );
  }
  await placeForResize();
  view = await size();
  const beforeResize = await windowState();
  edgePoint = windowsResizePoint(view, "right");
  await pointer("drag", edgePoint.x, edgePoint.y, {
    toX: view.width + 70,
    toY: view.height / 2,
  });
  const resized = await capture("resize");
  record("resize", resized);
  assert.ok(
    resized.bounds.width > beforeResize.bounds.width,
    "右の枠で窓を広げられる",
  );
  for (const edge of ["left", "bottom", "top", "top-right", "above-maximize"]) {
    view = await size();
    const before = await windowState();
    const point = windowsResizePoint(
      view,
      edge === "above-maximize" ? "top" : edge,
    );
    const { x, y } =
      edge === "above-maximize" ? { ...point, x: view.width - 69 } : point;
    await pointer("drag", x, y, {
      toX: x + (edge === "left" ? -20 : edge === "top-right" ? 20 : 0),
      toY: y + (edge === "left" ? 0 : edge === "bottom" ? 20 : -20),
    });
    const after = await windowState();
    record(`resize-${edge}`, after);
    assert.ok(
      edge === "left"
        ? after.bounds.width > before.bounds.width
        : after.bounds.height > before.bounds.height,
      `${edge}の枠で窓を広げられる`,
    );
  }
  blank = await blankPoint();
  const offset = await client.screen.evaluate("screenX");
  await pointer("drag", blank.x, blank.y, {
    toX: -offset - 20,
    toY: blank.y + 80,
  });
  record("aero-snap", await capture("aero-snap"));
  await windowsDesktop(state, "window-restore");
  await windowsDesktop(state, "window-key", {
    pointer: { keys: [0x5b, 0x25] },
  });
  record("win-left", await capture("win-left"));
  await windowsDesktop(state, "window-restore");
  view = await size();
  edgePoint = windowsResizePoint(view, "right");
  await pointer("drag", edgePoint.x, edgePoint.y, {
    toX: 703,
    toY: view.height / 2,
  });
  await waitFor(async () => (await size()).width < 768);
  await client.screen.wait(".window-mobile-drag-region");
  const narrowBefore = await windowState();
  blank = await blankPoint();
  assert.ok(blank, "狭い窓でも上端にドラッグ領域がある");
  await pointer("drag", blank.x, blank.y, {
    toX: blank.x + 40,
    toY: blank.y + 40,
  });
  const narrowMoved = await capture("narrow-drag");
  record("narrow-drag", narrowMoved);
  assertMoved(narrowBefore, narrowMoved);
  blank = await blankPoint();
  await pointer("double", blank.x, blank.y);
  assert.equal((await windowState()).maximized, true);
  await windowsDesktop(state, "window-restore");
  for (const theme of ["dark", "light"]) {
    await setTheme(theme);
    await openSidebar(client.screen);
    await insideWindow(`sidebar-sheet-${theme}`, [
      '[data-sidebar="sidebar"][data-mobile="true"]',
    ]);
    record(`sidebar-sheet-${theme}`, await capture(`sidebar-sheet-${theme}`));
    await closeSidebar(client.screen);
  }
  assert.deepEqual(
    outside,
    [],
    "ダイアログ・メニュー・シートは帯の下・窓の中に見える",
  );
  // Modal pointer blocking must not disable the caption's OS operations.
  await openSettingsSection(client.screen, "settings-display");
  const modalBefore = await windowState();
  await pointer("drag", 100, 17, { toX: 140, toY: 57 });
  const modalMoved = await capture("modal-drag");
  record("modal-drag", modalMoved);
  assertMoved(modalBefore, modalMoved);
  assert.equal(
    await client.screen.visible('[data-iori-view="settings"]'),
    true,
  );
  view = await size();
  await pointer("click", view.width - 115, 17);
  const minimized = await windowsDesktop(state, "window-state");
  record("minimized", minimized);
  assert.equal(minimized.minimized, true);
  await windowsDesktop(state, "window-restore");
  assert.equal(
    await client.screen.visible('[data-iori-view="settings"]'),
    true,
  );
  view = await size();
  await pointer("click", view.width - 23, 17);
  const closed = await windowsDesktop(state, "window-state");
  record("close", closed);
  assert.equal(closed.visible, false);
  await windowsDesktop(state, "window-restore");
  await windowsDesktop(state, "window-key", {
    pointer: { keys: [0x12, 0x73] },
  });
  const altF4 = await windowsDesktop(state, "window-state");
  record("alt-f4", altF4);
  assert.equal(altF4.visible, false);
} catch (error) {
  result.error = error.stack;
  process.exitCode = 1;
  console.error(error);
} finally {
  if (cli && !cli.closed) cli.stop();
  for (const [name, action] of [
    ["client", () => client?.stop()],
    ["host", () => host?.stop()],
    ["task", () => stopWindowsClientTask(state)],
    ["runtime", () => cleanupWindowsRuntime(runtime)],
    ["storage", () => cleanupWindowsClientStorage(state)],
  ]) {
    try {
      await action();
      result.cleanup[name] = true;
    } catch (error) {
      result.cleanup[name] = String(error);
      process.exitCode = 1;
    }
  }
  await writeFile(root + "/result.json", JSON.stringify(result, null, 2));
  console.log("evidence: " + root);
}
