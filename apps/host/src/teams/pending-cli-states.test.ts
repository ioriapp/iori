import assert from "node:assert/strict";
import test from "node:test";
import { PendingCliStates } from "./pending-cli-states.ts";

test("登録前の状態をTerminalごとに届いた順で一度だけ渡し、clearで空にする", () => {
  const pending = new PendingCliStates<{ state: string }>();
  pending.add("worker", { state: "active" });
  pending.add("idle-worker", { state: "idle" });
  pending.add("worker", { state: "done" });
  assert.deepEqual(pending.take("worker"), [
    { state: "active" },
    { state: "done" },
  ]);
  assert.deepEqual(pending.take("worker"), []);
  // Idle stays idle; it is not turned into an active response.
  assert.deepEqual(pending.take("idle-worker"), [{ state: "idle" }]);
  pending.add("failed-worker", { state: "active" });
  pending.clear();
  assert.deepEqual(pending.take("failed-worker"), []);
});
