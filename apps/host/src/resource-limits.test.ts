import assert from "node:assert/strict";
import { test } from "node:test";
import {
  ByteLimitError,
  createConcurrencyLimiter,
  mapWithConcurrency,
  readBoundedResponseBytes,
} from "./resource-limits.ts";

test("runs only as many operations as there are available slots", async () => {
  const run = createConcurrencyLimiter(2);
  const first = Promise.withResolvers<void>();
  const second = Promise.withResolvers<void>();
  const started = Promise.withResolvers<void>();
  const current = [run(() => first.promise), run(() => second.promise)];
  const next = run(() => started.resolve());
  let didStart = false;
  void started.promise.then(() => {
    didStart = true;
  });
  await Promise.resolve();
  await Promise.resolve();
  assert.equal(didStart, false);
  first.resolve();
  await started.promise;
  second.resolve();
  await Promise.all([...current, next]);
});

test("removes cancelled work from the queue without calling it", async () => {
  const run = createConcurrencyLimiter(1);
  const gate = Promise.withResolvers<void>();
  const running = run(() => gate.promise);
  const controller = new AbortController();
  const cancelled = run(
    () => assert.fail("cancelled job started"),
    controller.signal,
  );
  const next = run(() => "next");
  let reason: unknown;
  void cancelled.catch((error: unknown) => {
    reason = error;
  });
  controller.abort();
  await Promise.resolve();
  assert.equal(reason, controller.signal.reason);
  await assert.rejects(cancelled, { name: "AbortError" });
  gate.resolve();
  await running;
  assert.equal(await next, "next");
});

test("maps in input order and takes new items only when a worker is free", async () => {
  const gate = Promise.withResolvers<string>();
  const started = Promise.withResolvers<void>();
  const later = Promise.withResolvers<void>();
  const calls: number[] = [];
  const result = mapWithConcurrency([0, 1, 2], 2, (item) => {
    calls.push(item);
    if (item === 0) return gate.promise;
    if (item === 1) {
      started.resolve();
      return later.promise.then(() => "one");
    }
    return "two";
  });
  await started.promise;
  assert.deepEqual(calls, [0, 1]);
  later.resolve();
  gate.resolve("zero");
  assert.deepEqual(await result, ["zero", "one", "two"]);
});

test("rejects an oversized Content-Length without pulling from the body", async () => {
  let cancelled = false;
  const body = new ReadableStream<Uint8Array>(
    {
      pull: () => assert.fail("oversized declared body was read"),
      cancel: () => {
        cancelled = true;
      },
    },
    { highWaterMark: 0 },
  );
  await assert.rejects(
    readBoundedResponseBytes(
      new Response(body, { headers: { "Content-Length": "8" } }),
      5,
    ),
    ByteLimitError,
  );
  assert.equal(cancelled, true);
});

test("cancels a response as soon as the received chunks exceed the limit", async () => {
  let pulled = 0;
  let cancelled = false;
  const body = new ReadableStream<Uint8Array>(
    {
      pull(controller) {
        pulled++;
        assert.ok(pulled <= 2, "the rest of the oversized body was read");
        controller.enqueue(new Uint8Array(3));
      },
      cancel() {
        cancelled = true;
      },
    },
    { highWaterMark: 0 },
  );
  await assert.rejects(
    readBoundedResponseBytes(new Response(body), 5),
    ByteLimitError,
  );
  assert.equal(pulled, 2);
  assert.equal(cancelled, true);
  assert.equal(body.locked, false);
  assert.deepEqual(
    await readBoundedResponseBytes(new Response("12345"), 5),
    Buffer.from("12345"),
  );
});
