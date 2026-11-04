import { openWorkspaceView } from "../../verification/workspace/interaction.mjs";
import assert from "node:assert/strict";
import { waitFor } from "../../verification/ui.mjs";
import { splitTab } from "../../verification/workspace/interaction.mjs";
import { openSettingsSection, openSidebar } from "../connection/scenario.mjs";
import {
  clearObserved,
  closedRow,
  create,
  observe,
  observed,
  requestClose,
  say,
  typeTerminal,
} from "../terminal/scenario.mjs";

const attr = (name, value) => `[${name}=${JSON.stringify(value)}]`;
const action = (value) => attr("data-iori-action", value);
const worktreeButton = (path) =>
  "button" + attr("data-iori-worktree-path", path);
const tabButton = (kind) => "button" + attr("data-iori-tab-kind", kind);
// Mobile shows one View full screen instead of a tab strip.
const mobileView = (kind) => attr("data-iori-mobile-view-kind", kind);

export async function groupAction(screen, kind, name) {
  const groupId = await screen.attribute(
    tabButton(kind),
    "data-iori-group-id",
    "[data-iori-group-id]",
  );
  assert.equal(Boolean(groupId), true);
  const group = attr("data-iori-group-id", groupId);
  const selector = group + " " + action(name);
  if (await screen.visible(selector)) await screen.click(selector);
  else {
    await screen.click(group + " " + action("workspace-tab-list"));
    await screen.click(action(name + "-list"));
  }
}

async function visibleGroups(screen) {
  return screen.evaluate(
    `JSON.stringify([...document.querySelectorAll('button[data-iori-tab-id][data-iori-tab-kind]')].map(tab=>[tab.getAttribute('data-iori-tab-id'),tab.closest('[data-iori-group-id]')?.getAttribute('data-iori-group-id')]).sort((a,b)=>a[0].localeCompare(b[0])))`,
  );
}

export async function openFolder(screen, path, mobile, hostName) {
  await openSidebar(screen);
  await screen.click(
    action("sidebar-add-folder") +
      (hostName ? attr("data-iori-host-name", hostName) : ""),
  );
  const field = '[data-iori-field="folder-path"]';
  await waitFor(
    () => screen.value(field),
    (value) => Boolean(value),
  );
  await screen.input(field, path);
  const candidate =
    '[data-iori-view="folder-picker"] ' + attr("data-iori-folder-path", path);
  await screen.wait(candidate);
  if (mobile) await screen.tap(candidate);
  else await screen.key("Enter");
  await waitFor(
    () => screen.value(field),
    (value) => value.slice(0, -1) === path,
  );
  if (mobile)
    await screen.tap(action("folder-open"), { dismissKeyboard: true });
  else await screen.key("Control+Enter");
  // A folder seen before restores its tabs; a new one shows the start screen.
  await waitFor(() =>
    screen.evaluate(
      `document.querySelector('[data-iori-current-worktree-path]')?.getAttribute('data-iori-current-worktree-path')===${JSON.stringify(path)}`,
    ),
  );
}

async function layout(screen) {
  const scope = await screen.evaluate(
    "document.querySelector('[data-iori-layout-scope]')?.getAttribute('data-iori-layout-scope')",
  );
  if (!scope) return undefined;
  return screen.evaluateAsync(
    `window.__TAURI__.core.invoke('native_load_workspace_layout',{scopeKey:${JSON.stringify(scope)}})`,
  );
}
function signature(saved) {
  return JSON.stringify({
    grid: saved?.layout?.grid,
    panels: saved?.layout?.panels,
    tabs: saved?.tabs?.map((tab) => ({ id: tab.id, kind: tab.kind })),
  });
}
async function startShell(screen) {
  await screen.wait(
    '[data-iori-view="workspace-start"] button[data-iori-shell-id]',
  );
  await screen.click(
    '[data-iori-view="workspace-start"] button[data-iori-shell-id]',
  );
  await screen.wait(tabButton("terminal"));
}
export async function selectWorktree(screen, path, mobile) {
  await openSidebar(screen);
  await screen.click(worktreeButton(path));
  await waitFor(() =>
    screen.evaluate(
      `document.querySelector('[data-iori-current-worktree-path]')?.getAttribute('data-iori-current-worktree-path')===${JSON.stringify(path)}`,
    ),
  );
}

export async function workspaceScenario({
  screen,
  invitation,
  registered,
  deviceName,
  fixture,
  mobile,
  restart,
  record,
  shot,
  back,
  viewport,
  client,
  hostOs,
}) {
  let narrow = mobile;
  const shownTerminal = () =>
    screen.evaluate(
      "[...document.querySelectorAll('[data-iori-view=\"terminal\"]')].find(e=>{const r=e.getBoundingClientRect();return r.width>0&&r.height>0&&getComputedStyle(e).visibility!=='hidden';})?.getAttribute('data-iori-terminal-id')??''",
    );
  await waitFor(
    async () =>
      (await screen.visible('[data-iori-view="workspace"]')) ||
      (await screen.visible('[data-iori-field="invitation"]')),
  );
  if (!(await screen.visible('[data-iori-field="invitation"]'))) {
    await openSettingsSection(screen, "open-connection");
    await screen.click(action("register-new-host"));
  }
  if (await screen.visible(action("connect-invitation")))
    await screen.click(action("connect-invitation"));
  await screen.wait('[data-iori-field="invitation"]');
  await screen.input('[data-iori-field="invitation"]', invitation);
  await screen.click(action("continue"));
  await screen.wait('[data-iori-view="confirm-registration"]');
  await screen.input('[data-iori-field="device-name"]', deviceName);
  await screen.click(action("register"));
  await registered();
  await waitFor(async () => !(await screen.visible(action("register"))));
  await screen.wait('[data-iori-view="workspace"]');
  if (await screen.visible('[data-iori-view="settings"]'))
    await screen.key("Escape");
  await openFolder(screen, fixture.repository, mobile);
  await screen.wait('[data-iori-view="workspace-start"]');
  await record("Hostのフォルダーを辿りGitリポジトリを開く");
  await openSidebar(screen);
  await screen.wait(worktreeButton(fixture.worktree));
  fixture.add();
  await screen.wait(worktreeButton(fixture.addedWorktree));
  fixture.remove();
  await waitFor(
    async () => !(await screen.visible(worktreeButton(fixture.addedWorktree))),
  );
  await record("外部Gitのworktree追加・削除が操作なしで反映");
  if (mobile) await back();
  if (mobile) {
    await viewport(true);
    narrow = false;
    await waitFor(() => screen.evaluate("innerWidth>=768"));
    await record("Androidの実画面を横向きにして配置操作を確認");
  }
  // Start with the Host's default shell from the launcher.
  await create(client());
  await screen.wait(tabButton("terminal"));
  await observe(client());
  const terminalId = await waitFor(shownTerminal);
  await typeTerminal(client(), say(hostOs, "サイドバーから日本語入力"));
  await observed(client(), "サイドバーから日本語入力");
  // The Terminal this view sized fits its view without scrollbars.
  const overflow = await screen.evaluate(
    `(()=>{const v=document.querySelector('[data-iori-view="terminal"][data-iori-terminal-id="${terminalId}"] [data-iori-part="terminal-viewport"]');return [v.scrollWidth-v.clientWidth,v.scrollHeight-v.clientHeight].join('x');})()`,
  );
  assert.equal(overflow, "0x0", `Terminal overflows its view by ${overflow}px`);
  await record("サイドバーからTerminalを開き日本語を含むコマンドを実行");
  await screen.click(
    '[data-tab-kind="terminal"] ' + action("workspace-close-tab"),
  );
  await waitFor(async () => !(await screen.visible(tabButton("terminal"))));
  await openSidebar(screen);
  await screen.wait(attr("data-iori-terminal-row", terminalId));
  await clearObserved(client());
  await screen.click(attr("data-iori-terminal-row", terminalId));
  await screen.wait(tabButton("terminal"));
  await observed(client(), "サイドバーから日本語入力");
  await typeTerminal(client(), say(hostOs, "タブを開き直して続き"));
  await observed(client(), "タブを開き直して続き");
  await record("タブを閉じてもTerminalの行が残り、開き直すと続きを表示");
  await openSidebar(screen);
  await openWorkspaceView(screen, "files");
  await screen.wait(tabButton("files"));
  await openSidebar(screen);
  await openWorkspaceView(screen, "git");
  await screen.wait(tabButton("git"));
  const initialGroups = await visibleGroups(screen);
  await splitTab(screen, tabButton("git"), "right");
  await waitFor(async () => (await visibleGroups(screen)) !== initialGroups);
  await screen.click(tabButton("files"));
  const rightGroups = await visibleGroups(screen);
  await splitTab(screen, tabButton("files"), "below");
  await waitFor(async () => (await visibleGroups(screen)) !== rightGroups);
  const filesId = await screen.attribute(
    tabButton("files"),
    "data-iori-tab-id",
  );
  const gitId = await screen.attribute(tabButton("git"), "data-iori-tab-id");
  const beforeMove = await visibleGroups(screen);
  await screen.drag(
    tabButton("files"),
    attr("data-iori-workspace-panel", gitId),
  );
  await waitFor(async () => (await visibleGroups(screen)) !== beforeMove);
  await screen.click(tabButton("git"));
  await groupAction(screen, "git", "workspace-maximize");
  await screen.wait(action("workspace-restore"));
  await screen.wait('[data-iori-view="git"]');
  await shot("maximized");
  await screen.click(action("workspace-restore"));
  const saved = await waitFor(
    () => layout(screen),
    (value) => Boolean(value?.layout && value.tabs?.length === 3),
  );
  const expected = signature(saved);
  const expectedGroups = await visibleGroups(screen);
  assert.equal(Boolean(filesId), true);
  await record("タブの左右上下分割・ドラッグ移動・中央最大化と復帰");
  await shot("workspace");
  screen = await restart();
  if (mobile) await viewport(true);
  await screen.wait('[data-iori-view="workspace"]');
  if (mobile) await selectWorktree(screen, fixture.repository, narrow);
  await screen.wait(tabButton("git"));
  assert.equal(
    (await visibleGroups(screen)) === expectedGroups,
    true,
    "再起動後の画面も同じタブとペイン配置を表示する",
  );
  assert.equal(
    signature(await layout(screen)) === expected,
    true,
    "再起動後も同じ配置が戻る",
  );
  await selectWorktree(screen, fixture.worktree, narrow);
  await screen.wait('[data-iori-view="workspace-start"]');
  await shot("start");
  await startShell(screen);
  await selectWorktree(screen, fixture.repository, narrow);
  await screen.wait(tabButton("git"));
  assert.equal(
    (await visibleGroups(screen)) === expectedGroups,
    true,
    "worktree往復後の画面も同じタブとペイン配置を表示する",
  );
  assert.equal(
    signature(await layout(screen)) === expected,
    true,
    "別worktreeから戻ると元の配置が戻る",
  );
  await record("Client再起動とworktree往復で配置を保持");
  await screen.click(action("settings-open"));
  await screen.click(action("display-language"));
  await screen.click('[data-iori-option="language-en"]');
  await waitFor(() => screen.evaluate("document.documentElement.lang==='en'"));
  await waitFor(
    async () => (await screen.text(tabButton("files"))) === "Files",
  );
  await screen.click(action("display-theme"));
  await screen.click('[data-iori-option="theme-dark"]');
  await waitFor(() =>
    screen.evaluate("document.documentElement.classList.contains('dark')"),
  );
  await screen.click(action("display-language"));
  await screen.click('[data-iori-option="language-ja"]');
  await waitFor(() => screen.evaluate("document.documentElement.lang==='ja'"));
  await waitFor(
    async () => (await screen.text(tabButton("files"))) === "ファイル",
  );
  await shot("settings-ja-dark");
  await screen.key("Escape");
  await waitFor(
    async () => !(await screen.visible('[data-iori-view="settings"]')),
  );
  await shot("overall-ja-dark");
  await screen.click(tabButton("terminal"));
  // A tab opens its stream when shown; capture once its screen is restored.
  await screen.wait(
    '[data-iori-view="terminal"][data-iori-stream-state="ready"]',
  );
  await shot("terminal-ja-dark");
  await screen.click(action("settings-open"));
  await screen.click(action("display-theme"));
  await screen.click('[data-iori-option="theme-light"]');
  await waitFor(() =>
    screen.evaluate("!document.documentElement.classList.contains('dark')"),
  );
  await shot("settings-ja-light");
  await screen.click(action("settings-keyboard"));
  await screen.wait('[data-iori-view="keyboard-settings"]');
  await shot("settings-keyboard-ja-light");
  await screen.key("Escape");
  await waitFor(
    async () => !(await screen.visible('[data-iori-view="settings"]')),
  );
  await shot("overall-ja-light");
  await screen.click(tabButton("terminal"));
  // A tab opens its stream when shown; capture once its screen is restored.
  await screen.wait(
    '[data-iori-view="terminal"][data-iori-stream-state="ready"]',
  );
  await shot("terminal-ja-light");
  await record("設定で言語・テーマが画面全体へ即時反映");
  const extra = await create(client());
  await requestClose(client(), extra);
  assert.equal(
    await screen.visible(action("terminal-confirm-close")),
    false,
    "入力待ちのTerminalは確認せずに閉じる",
  );
  await closedRow(client(), extra);
  await record("行の「閉じる」でTerminalのプロセスを終え、行が消える");
  if (mobile) {
    await viewport(false);
    await waitFor(() => screen.evaluate("innerWidth<768"));
    await openSidebar(screen);
    await openWorkspaceView(screen, "files");
    await screen.wait(mobileView("files"));
    await openSidebar(screen);
    await openWorkspaceView(screen, "git");
    await screen.wait(mobileView("git"));
    await screen.swipe(
      '[data-iori-view="workspace"]',
      { x: 0.01, y: 0.5 },
      { x: 0.6, y: 0.5 },
    );
    await screen.wait(action("sidebar-open-terminal"));
    await openWorkspaceView(screen, "terminal");
    await waitFor(
      async () =>
        !(await screen.evaluate(
          "Boolean(document.querySelector('[data-sidebar=sidebar][data-mobile=true]'))",
        )) && (await screen.visible(mobileView("terminal"))),
    );
    await observe(client());
    await typeTerminal(client(), say(hostOs, "帯の矢印キー"));
    await observed(client(), "帯の矢印キー");
    await clearObserved(client());
    await screen.click(`${mobileView("terminal")} [data-iori-key="arrowUp"]`);
    await screen.click(`${mobileView("terminal")} [data-iori-key="enter"]`);
    await observed(client(), "帯の矢印キー");
    await shot("mobile-terminal");
    await record("スマホの全画面のTerminalでキーの帯から矢印とEnterを送る");
    await openSidebar(screen);
    await screen.click(action("settings-open"));
    await screen.click(action("settings-keyboard"));
    await screen.input(
      '[data-iori-field="keyboard-text"]',
      say(hostOs, "決まった文字列キー").slice(0, -1),
    );
    await screen.click('[data-iori-field="keyboard-send-enter"]');
    await screen.click(action("keyboard-key-add"));
    // The added key joins the end of the list, which scrolls inside the dialog.
    await waitFor(() =>
      screen.evaluate(
        "(()=>{const row=document.querySelector('[data-iori-key-row^=\"custom-\"]');row?.scrollIntoView({block:'nearest'});return Boolean(row);})()",
      ),
    );
    await shot("mobile-keyboard-settings");
    await screen.click(action("settings-close"));
    await waitFor(
      async () => !(await screen.visible('[data-iori-view="settings"]')),
    );
    await clearObserved(client());
    await screen.click(`${mobileView("terminal")} [data-iori-key^="custom-"]`);
    await observed(client(), "決まった文字列キー");
    await record("キーボードの設定で決まった文字列のキーを足し、帯から送る");
    await back();
    await screen.wait(mobileView("git"));
    await back();
    await screen.wait(mobileView("files"));
    await shot("mobile-workspace");
    await openSidebar(screen);
    await screen.wait(worktreeButton(fixture.repository));
    await shot("mobile-drawer");
    await back();
    await waitFor(
      async () => !(await screen.visible(action("sidebar-open-files"))),
    );
    // Back walks every View visited in this worktree, then the first screen.
    const shown = () =>
      screen.evaluate(
        "document.querySelector('[data-iori-view=\"mobile-home\"]')?'home':[...document.querySelectorAll('[data-iori-mobile-view-kind]')].find(e=>!e.hidden)?.getAttribute('data-iori-workspace-panel')??''",
      );
    for (let step = 0; (await shown()) !== "home"; step++) {
      assert.equal(step < 20, true, "戻る操作で最初の画面へ着く");
      const before = await shown();
      await back();
      await waitFor(async () => (await shown()) !== before);
    }
    await shot("mobile-home");
    await record(
      "スマホの左端スワイプ・ドロワー選択とAndroid戻る操作（最初の画面まで）",
    );
  }
}
