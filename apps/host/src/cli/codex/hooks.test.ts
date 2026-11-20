import assert from "node:assert/strict";
import test from "node:test";
import { hooks } from "./hooks.ts";

test("a Codex SessionStart during compaction does not change the CLI state", () => {
  assert.equal(
    hooks.normalize({ hook_event_name: "SessionStart", source: "compact" }),
    undefined,
  );
});

test("a regular Codex SessionStart sets the CLI state to idle", () => {
  assert.deepEqual(hooks.normalize({ hook_event_name: "SessionStart" }), {
    state: "idle",
  });
  assert.deepEqual(
    hooks.normalize({ hook_event_name: "SessionStart", source: "startup" }),
    { state: "idle" },
  );
});
