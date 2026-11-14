import assert from "node:assert/strict";
import test from "node:test";
import type { SerializedDockview } from "dockview-react";
import type { SavedLayout, WorkspaceState } from "./workspace-state.ts";
import type { WorkspaceTab } from "./workspace-panel.tsx";
import {
  addWorkspaceTab,
  closeWorkspaceTab,
  closeMobileWorkspaceTab,
  missingWorkspaceTerminals,
  readWorkspaceState,
  replaceWorkspaceStartTab,
  selectWorkspaceTab,
  terminalWorkspaceTab,
  writeSavedLayout,
} from "./workspace-state.ts";

// 0.1.101 stored this envelope without mobileClosedTabs.
const saved101 = {
  layout: {
    grid: {
      root: {
        type: "leaf",
        size: 1200,
        data: { id: "main", views: ["terminal:1"], activeView: "terminal:1" },
      },
      width: 1200,
      height: 800,
      orientation: "HORIZONTAL" as SerializedDockview["grid"]["orientation"],
    },
    panels: {
      "terminal:1": {
        id: "terminal:1",
        contentComponent: "workspace",
        params: { tabId: "terminal:1" },
      },
    },
    activeGroup: "main",
  },
  tabs: [
    {
      id: "terminal:1",
      kind: "terminal",
      title: "bash",
      terminalId: "1",
      target: {
        host: { publicKey: "host", hostName: "Host", addresses: [] },
        folder: {
          kind: "folder",
          openedAt: 0,
          inSidebar: true,
          path: "/workspace",
          workspacePath: "/workspace",
        },
        folderPath: "/workspace",
        worktree: { path: "/workspace", primary: true, detached: false },
        cwd: "/workspace",
      },
    },
  ],
  activeTabId: "terminal:1",
  lastTerminalId: "1",
  views: { "terminal:1": { scroll: 24 } },
} satisfies SavedLayout;

test("0.1.101の配置・タブ・選択・Viewの保存データを読み込み、同じ形式で保存できる", () => {
  // JSON also checks that optional fields remain absent on disk.
  const stored: unknown = JSON.parse(JSON.stringify(saved101));
  const state = readWorkspaceState(stored);
  assert.ok(state);
  assert.deepEqual(state.tabs, saved101.tabs);
  assert.equal(state.activeTabId, saved101.activeTabId);
  const written: SavedLayout = writeSavedLayout(state);
  assert.deepEqual(JSON.parse(JSON.stringify(written)), stored);
});

const terminal: WorkspaceTab = saved101.tabs[0];
const start: WorkspaceTab = {
  id: "start:1",
  kind: "start",
  title: "Start",
  target: terminal.target,
};
const empty: WorkspaceState = { tabs: [], activeTabId: "" };

test("Terminal一覧の古い更新が、その後に追加した新しいTerminalタブを閉じない", () => {
  const observed = addWorkspaceTab(empty, terminal);
  const created: WorkspaceTab = {
    ...terminal,
    id: "terminal:2",
    terminalId: "2",
  };
  let current = selectWorkspaceTab(
    addWorkspaceTab(observed, created),
    created.id,
  );
  // This list arrived in the render before terminal.created added the new tab.
  for (const tab of missingWorkspaceTerminals(observed, new Set()))
    current = closeWorkspaceTab(current, tab.id);
  assert.deepEqual(current.tabs, [created]);
  assert.equal(current.activeTabId, created.id);
  assert.deepEqual(observed.tabs, [terminal]);
});

test("別の入口と開始タブから同じTerminalを開いてもタブが重複しない", () => {
  const current = addWorkspaceTab(addWorkspaceTab(empty, terminal), start);
  const reopened = {
    ...terminal,
    id: "terminal:another-entry",
    title: "new title",
  };
  const added = addWorkspaceTab(current, reopened);
  assert.equal(added, current);
  const replaced = replaceWorkspaceStartTab(added, start.id, reopened);
  assert.deepEqual(replaced.tabs, [terminal]);
  assert.equal(
    terminalWorkspaceTab(replaced, terminal.target.host.publicKey, "1"),
    terminal,
  );
});

test("開始タブをTerminalへ置き換えても保存済みのペイン配置を削除しない", () => {
  const layout = {
    ...structuredClone(saved101.layout),
    panels: {
      [start.id]: {
        id: start.id,
        contentComponent: "workspace",
        params: { tabId: start.id },
      },
    },
  };
  layout.grid.root.data.views = [start.id];
  layout.grid.root.data.activeView = start.id;
  const current: WorkspaceState = {
    tabs: [start],
    activeTabId: start.id,
    layout,
  };
  const before = structuredClone(current);
  const next = replaceWorkspaceStartTab(current, start.id, terminal);
  assert.deepEqual(next.tabs, [terminal]);
  assert.deepEqual(writeSavedLayout(next).layout, before.layout);
  assert.deepEqual(current, before);
});

test("Terminal終了が前のタブ一覧を使って後から開いたタブや選択を巻き戻さない", () => {
  const beforeExit = selectWorkspaceTab(
    addWorkspaceTab(empty, terminal),
    terminal.id,
  );
  const current = selectWorkspaceTab(
    addWorkspaceTab(beforeExit, start),
    start.id,
  );
  const ended = terminalWorkspaceTab(
    current,
    terminal.target.host.publicKey,
    "1",
  );
  assert.ok(ended);
  const next = closeWorkspaceTab(current, ended.id);
  assert.deepEqual(next.tabs, [start]);
  assert.equal(next.activeTabId, start.id);
  assert.equal(
    terminalWorkspaceTab(next, terminal.target.host.publicKey, "1"),
    undefined,
  );
  assert.deepEqual(current.tabs, [terminal, start]);
});

test("スマホでタブを閉じてもPCの配置と空ペインを残す区別を保存・復元できる", () => {
  const desktop = readWorkspaceState(saved101);
  assert.ok(desktop);
  for (const preservePane of [false, true]) {
    const mobile = closeMobileWorkspaceTab(desktop, terminal.id, preservePane);
    const restored = readWorkspaceState(
      JSON.parse(JSON.stringify(writeSavedLayout(mobile))),
    );
    assert.ok(restored);
    assert.deepEqual(restored.tabs, []);
    assert.deepEqual(restored.layout, saved101.layout);
    assert.deepEqual(restored.mobileClosedTabs, [
      { id: terminal.id, preservePane },
    ]);
    assert.deepEqual(desktop.tabs, [terminal]);
  }
});
