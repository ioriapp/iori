import { test } from "node:test";
import assert from "node:assert/strict";
import { releaseScenarios } from "./scenarios.mjs";

test("scoped acceptance recognizes a web workflow", () => {
  assert.deepEqual(releaseScenarios(["--scenarios=terminal-fit"]), [
    "terminal-fit",
  ]);
});

test("scoped acceptance also runs workflows containing the selected child", () => {
  assert.deepEqual(releaseScenarios(["--scenarios=terminal-retention"]), [
    "terminal-retention",
  ]);
  assert.deepEqual(releaseScenarios(["--scenarios=clipboard-image:codex"]), [
    "clipboard-image:codex",
    "clipboard",
  ]);
  assert.deepEqual(releaseScenarios(["--scenarios=claude-status"]), [
    "claude-status",
  ]);
});
