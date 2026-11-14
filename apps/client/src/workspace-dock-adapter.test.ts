import assert from "node:assert/strict";
import test from "node:test";
import type { SerializedDockview } from "dockview-react";
import type { WorkspaceTab } from "./workspace-panel.tsx";
import { removedDockTabs, replaceDockTab } from "./workspace-dock-adapter.ts";

// A remove notification can be the middle of a move, or close one split only.
test("パネルの移動や分割の片方を閉じた時に、残っている論理タブを削除しない", () => {
  const removed = new Set(["terminal:moved", "files:split", "terminal:closed"]);
  const settled = new Set(["terminal:moved", "files:split"]);
  assert.deepEqual(removedDockTabs(removed, settled), ["terminal:closed"]);
});

test("Dockview準備前の開始タブ置換で、ペインの分割・位置・選択と旧形式のパネルIDを保持する", () => {
  const layout: SerializedDockview = {
    grid: {
      root: {
        type: "branch",
        data: [
          {
            type: "leaf",
            size: 400,
            data: { id: "left", views: ["start:1"], activeView: "start:1" },
          },
          {
            type: "leaf",
            size: 800,
            data: { id: "right", views: ["files:1"], activeView: "files:1" },
          },
        ],
      },
      width: 1200,
      height: 800,
      orientation: "HORIZONTAL" as SerializedDockview["grid"]["orientation"],
    },
    panels: {
      "start:1": {
        id: "start:1",
        contentComponent: "workspace",
        params: { tabId: "start:1" },
      },
      "files:1": {
        id: "files:1",
        contentComponent: "workspace",
        params: { tabId: "files:1" },
      },
    },
    activeGroup: "left",
  };
  const terminal: WorkspaceTab = {
    id: "terminal:1",
    kind: "terminal",
    title: "bash",
    terminalId: "1",
    target: {
      host: { publicKey: "host", hostName: "Host", addresses: [] },
      folder: {
        path: "/workspace",
        workspacePath: "/workspace",
        kind: "folder",
        openedAt: 0,
        inSidebar: true,
      },
      folderPath: "/workspace",
      worktree: { path: "/workspace", primary: true, detached: false },
      cwd: "/workspace",
    },
  };
  const before = structuredClone(layout);
  const result = replaceDockTab(layout, "start:1", terminal);
  assert.ok(result);
  assert.deepEqual(result.grid, before.grid);
  assert.equal(result.activeGroup, before.activeGroup);
  assert.equal(result.panels["start:1"].id, "start:1");
  assert.deepEqual(result.panels["start:1"].params, { tabId: terminal.id });
  assert.equal(result.panels["start:1"].title, terminal.title);
  assert.deepEqual(result.panels["files:1"], before.panels["files:1"]);
  assert.deepEqual(layout, before);
});
