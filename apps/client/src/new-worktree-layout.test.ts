import assert from "node:assert/strict";
import { test } from "node:test";
import type { SerializedDockview } from "dockview-react";
import {
  pruneLayout,
  readWorktreeLayoutTemplate,
} from "./new-worktree-layout.ts";

type Node = SerializedDockview["grid"]["root"];
const leaf = (
  id: string,
  views: string[],
  size: number,
  activeView = views[0],
): Node => ({ type: "leaf", size, data: { id, views, activeView } });
const layout = (root: Node): SerializedDockview => ({
  grid: {
    root,
    width: 1200,
    height: 800,
    orientation: "HORIZONTAL" as SerializedDockview["grid"]["orientation"],
  },
  panels: Object.fromEntries(
    ["board", "parent", "child", "shell", "file"].map((id) => [
      id,
      {
        id,
        contentComponent: "workspace",
        params: { tabId: id, target: { cwd: "/old/worktree" } },
      },
    ]),
  ),
  activeGroup: "right",
});

// 保存から子やファイルを除き、親とBoardの左右・大きさ・各群の選択を保つ。
test("pruneLayout preserves selected tabs and split proportions without worktree data", () => {
  const source = layout({
    type: "branch",
    data: [
      leaf("left", ["board", "file"], 400),
      leaf("right", ["child", "parent"], 800, "parent"),
    ],
  });
  const before = structuredClone(source);
  const result = pruneLayout(
    source,
    new Map([
      ["board", "slot-1"],
      ["parent", "slot-2"],
    ]),
  );
  assert.deepEqual(result?.grid.root.data, [
    leaf("group-1", ["slot-1"], 400),
    leaf("group-2", ["slot-2"], 800),
  ]);
  assert.equal(result?.activeGroup, "group-2");
  assert.deepEqual(result?.panels["slot-2"].params, { tabId: "slot-2" });
  assert.ok(!JSON.stringify(result).includes("/old/worktree"));
  assert.deepEqual(source, before);
  const excludedSelection = structuredClone(source);
  if (!Array.isArray(excludedSelection.grid.root.data))
    throw new Error("Expected branches");
  const right = excludedSelection.grid.root.data[1];
  if (Array.isArray(right.data)) throw new Error("Expected group");
  right.data.activeView = "child";
  assert.equal(
    pruneLayout(
      excludedSelection,
      new Map([
        ["board", "slot-1"],
        ["parent", "slot-2"],
      ]),
    )?.activeGroup,
    "group-2",
  );
});

// CLIだけで作成した時はBoardの群を除き、親の枠だけで幅を使う。
test("pruneLayout removes an unavailable Board and its empty split", () => {
  const source = layout({
    type: "branch",
    data: [leaf("left", ["board"], 400), leaf("right", ["parent"], 800)],
  });
  const result = pruneLayout(source, new Map([["parent", "agent"]]));
  assert.deepEqual(result?.grid.root.data, [leaf("group-1", ["agent"], 800)]);
  assert.deepEqual(Object.keys(result!.panels), ["agent"]);
});

// 空になった枝を畳んでも残った上下分割を左右へ入れ替えない。
test("pruneLayout retains the axis of a surviving nested split", () => {
  const source = layout({
    type: "branch",
    data: [
      leaf("left", ["child"], 400),
      {
        type: "branch",
        size: 800,
        data: [leaf("top", ["parent"], 300), leaf("bottom", ["shell"], 500)],
      },
    ],
  });
  const result = pruneLayout(
    source,
    new Map([
      ["parent", "agent"],
      ["shell", "terminal"],
    ]),
  );
  assert.equal(result?.grid.orientation, "VERTICAL");
  assert.deepEqual(result?.grid.root.data, [
    leaf("group-1", ["agent"], 300),
    leaf("group-2", ["terminal"], 500),
  ]);
});

// 全タブが適用対象外なら既定の配置へ戻せる。
test("pruneLayout yields no layout when all groups are empty", () => {
  assert.equal(
    pruneLayout(
      layout({ type: "branch", data: [leaf("left", ["board"], 400)] }),
      new Map(),
    ),
    undefined,
  );
});

// 未保存・壊れた形は新しいworktreeを妨げず、読める項目だけを使う。
test("readWorktreeLayoutTemplate reads leniently and treats reset as unsaved", () => {
  for (const value of [
    null,
    {},
    { slots: [] },
    { version: 1, slots: [{ id: "x", kind: "agent" }], layout: {} },
  ])
    assert.equal(readWorktreeLayoutTemplate(value), undefined);
  const result = readWorktreeLayoutTemplate({
    version: 1,
    layout: layout({ type: "branch", data: [leaf("right", ["parent"], 800)] }),
    slots: [
      { id: "parent", kind: "agent" },
      { id: "bad", kind: "unknown" },
      null,
    ],
    activeSlot: "parent",
  });
  assert.deepEqual(result?.slots, [{ id: "parent", kind: "agent" }]);
  assert.equal(result?.activeSlot, "parent");
});
