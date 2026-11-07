/// <reference types="node" />
import assert from "node:assert/strict";
import test from "node:test";
import { replaceStartTab } from "./workspace-launch-tabs.ts";

test("始めるタブを置き換える時に同じTerminalのタブが既にあれば、始めるタブを外して重複させない", () => {
  const existing = { id: "terminal:1", title: "existing" };
  const tabs = [
    { id: "start:1", title: "Start" },
    { id: "files:1", title: "Files" },
    existing,
  ];
  assert.deepEqual(
    replaceStartTab(tabs, "start:1", { id: "terminal:1", title: "new" }),
    [tabs[1], existing],
  );
});
