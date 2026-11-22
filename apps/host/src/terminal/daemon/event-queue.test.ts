import assert from "node:assert/strict";
import test from "node:test";
import { EventQueue } from "./event-queue.ts";

test("切断中の件数上限は全Terminalで共有し、終了通知より先に古いhookを破棄する", () => {
  const queue = new EventQueue();
  const exit = { id: "ended", kind: "exit", exitCode: 0, pid: 1 } as const;
  queue.push(exit);
  for (let i = 0; i < 1024; ++i)
    queue.push({ id: String(i), kind: "hook", payload: {} });
  queue.trim();
  assert.equal(queue.first("ended"), exit);
  assert.equal(queue.first("0"), undefined);
  assert.equal([...queue.ids].length, 1024);
  for (let i = 0; i < 1024; ++i) queue.push({ ...exit, id: String(i) });
  queue.trim();
  assert.equal(queue.first("ended"), undefined);
  assert.equal([...queue.ids].length, 1024);
});

test("切断中のバイト上限はUTF-8で数え、配送済みのhookを差し引く", () => {
  const queue = new EventQueue();
  const payload = { text: "端".repeat(1024 * 1024) };
  const first = { id: "a", kind: "hook", payload } as const;
  const next = { id: "a", kind: "hook", payload } as const;
  queue.push(first);
  queue.push(next);
  queue.remove(first);
  queue.push({ id: "b", kind: "hook", payload });
  queue.trim();
  assert.equal(queue.first("a"), next);
  queue.push({ id: "c", kind: "hook", payload });
  queue.trim();
  assert.equal(queue.first("a")?.id, undefined);
  assert.deepEqual([...queue.ids], ["b", "c"]);
});
