import assert from "node:assert/strict";
import { test } from "node:test";
import { eventSchema, parseResponse } from "./index.ts";
import { parseCliUsage } from "./cli.ts";
const child = {
  id: "child",
  createdAt: 1,
  conversation: "conversation",
  parentTerminalId: "parent",
  parentCwd: "/repo",
  teamId: "team",
  role: "Worker",
  title: "Inspect",
  state: "stopped",
  cli: { id: "codex", name: "Codex" },
};
test("child snapshots and deltas discard malformed children without losing readable siblings", () => {
  const bad = [
    { ...child, state: "invented" },
    { ...child, parentCwd: 12 },
    { ...child, stoppedBy: "invented" },
    { ...child, elapsedMs: NaN },
    { ...child, notified: "yes" },
  ];
  const value = { children: [child, ...bad] };
  assert.deepEqual(
    parseResponse("teams.children", { ok: true, result: value }),
    { ok: true, result: { children: [child] } },
  );
  assert.deepEqual(eventSchema.parse({ type: "teams.children", ...value }), {
    type: "teams.children",
    children: [child],
  });
  assert.deepEqual(eventSchema.parse({ type: "teams.child.updated", child }), {
    type: "teams.child.updated",
    child,
  });
  for (const malformed of bad)
    assert.throws(() =>
      eventSchema.parse({ type: "teams.child.updated", child: malformed }),
    );
  assert.throws(() =>
    parseResponse("teams.children", { ok: true, result: { children: {} } }),
  );
});
test("Client checks the shape and numeric ranges of usage windows received from the Host", () => {
  const valid = { remaining: 25, minutes: 300, resetsAt: 1800000000000 };
  const bad = [
    null,
    { remaining: -1, minutes: 300 },
    { remaining: 101, minutes: 300 },
    { remaining: NaN, minutes: 300 },
    { remaining: 30, minutes: 0 },
    { remaining: 30, minutes: Infinity },
    { ...valid, resetsAt: "later" },
    { ...valid, resetsAt: Infinity },
  ];
  assert.deepEqual(parseCliUsage({ windows: [valid, ...bad] }), {
    windows: [valid],
  });
  assert.deepEqual(parseCliUsage({ windows: [valid], observedAt: 123 }), {
    windows: [valid],
    observedAt: 123,
  });
  for (const value of [
    {},
    null,
    { windows: [] },
    { windows: bad },
    { windows: "all" },
  ]) {
    assert.equal(parseCliUsage(value), undefined);
    assert.deepEqual(
      eventSchema.parse({ type: "cli.usage", cliId: "codex", usage: value }),
      { type: "cli.usage", cliId: "codex" },
    );
    const parsed = parseResponse("cli.list", {
      ok: true,
      result: { clis: [{ id: "codex", name: "Codex", usage: value }] },
    });
    assert.deepEqual(parsed, {
      ok: true,
      result: { clis: [{ id: "codex", name: "Codex", hidden: false }] },
    });
  }
  assert.deepEqual(
    eventSchema.parse({
      type: "cli.usage",
      cliId: "codex",
      usage: { windows: [valid] },
    }),
    { type: "cli.usage", cliId: "codex", usage: { windows: [valid] } },
  );
  assert.deepEqual(eventSchema.parse({ type: "cli.usage", cliId: "codex" }), {
    type: "cli.usage",
    cliId: "codex",
  });
  assert.throws(() => eventSchema.parse({ type: "cli.usage", cliId: 12 }));
});
