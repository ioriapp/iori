import assert from "node:assert/strict";
import { test } from "node:test";
import { summarizeRecords, median, taskWorkTime } from "./record-summary.ts";
import type { TaskRecord, RecordAgent } from "./board.ts";
const candidate = { cli: "codex", model: "test-model", effort: "low" };
const agent = (
  id: string,
  overrides: Partial<RecordAgent> = {},
): RecordAgent => ({
  id,
  role: "Worker",
  candidate,
  createdAt: 1,
  revisions: 0,
  ...overrides,
});
const task = (
  id: string,
  agents: RecordAgent[],
  overrides: Partial<TaskRecord> = {},
): TaskRecord => ({
  id,
  conversation: "conversation",
  title: id,
  teamId: "team",
  team: "Development",
  version: 1,
  role: "Worker",
  difficulty: "medium",
  createdAt: 1,
  revisions: 0,
  agents,
  ...overrides,
});
test("Recordsの判定は最初の候補へ、時間・トークン量・差し戻しは実担当へ帰属し判定前を率から除く", () => {
  const tasks = [
    task(
      "accepted",
      [
        agent("a", {
          elapsedMs: 10,
          tokens: { input: 100, output: 20, cacheRead: 80 },
        }),
      ],
      { decision: "accept" },
    ),
    task(
      "handoff",
      [
        agent("b", { elapsedMs: 30, revisions: 1 }),
        agent("c", {
          candidate: { cli: "pi", model: "test-model" },
          elapsedMs: 80,
          tokens: { input: 500, output: 100 },
          revisions: 2,
        }),
      ],
      { decision: "accept", revisions: 3 },
    ),
    task(
      "rejected",
      [
        agent("d", {
          elapsedMs: 90,
          tokens: { input: 300, output: 60, cacheRead: 120 },
        }),
      ],
      { decision: "reject" },
    ),
    task("pending", [agent("e", { elapsedMs: 50 })]),
    task(
      "same-candidate",
      [agent("f", { elapsedMs: 70 }), agent("g", { elapsedMs: 100 })],
      { decision: "accept" },
    ),
    task("another-role", [agent("h", { role: "Reviewer" })]),
  ];
  const rows = summarizeRecords(tasks),
    worker = rows.find(
      (row) => row.role === "Worker" && row.candidate.cli === "codex",
    )!,
    handoff = rows.find((row) => row.candidate.cli === "pi")!,
    reviewer = rows.find((row) => row.role === "Reviewer")!;
  assert.deepEqual(
    {
      tasks: worker.tasks,
      agents: worker.agents,
      decided: worker.decided,
      firstAccepted: worker.firstAccepted,
      rejected: worker.rejected,
      revisions: worker.revisions,
      time: worker.time,
      tokens: worker.tokens,
      measuredTokens: worker.measuredTokens,
      input: worker.input,
      output: worker.output,
      cacheHit: worker.cacheHit,
      measuredCache: worker.measuredCache,
    },
    {
      tasks: 5,
      agents: 6,
      decided: 4,
      firstAccepted: 2,
      rejected: 1,
      revisions: 1,
      time: 60,
      tokens: 240,
      measuredTokens: 2,
      input: 200,
      output: 40,
      cacheHit: 0.5,
      measuredCache: 2,
    },
  );
  assert.deepEqual(handoff.taskIds, ["handoff"]);
  assert.equal(handoff.tasks, 0);
  assert.equal(handoff.agents, 1);
  assert.equal(handoff.revisions, 2);
  assert.equal(handoff.time, 80);
  assert.equal(handoff.tokens, 600);
  assert.equal(handoff.decided, 0);
  assert.equal(handoff.input, 500);
  assert.equal(handoff.output, 100);
  assert.equal(handoff.cacheHit, undefined);
  assert.equal(handoff.measuredCache, 0);
  assert.equal(reviewer.time, undefined);
  assert.equal(reviewer.tokens, undefined);
  assert.equal(reviewer.measuredTokens, 0);
  assert.equal(reviewer.input, undefined);
  assert.equal(reviewer.output, undefined);
});
test("中央値は偶数・奇数・空の観測値を区別し、入力の順を変えない", () => {
  const values = [50, 10, 30];
  assert.equal(median(values), 30);
  assert.deepEqual(values, [50, 10, 30]);
  assert.equal(median([10, 30]), 20);
  assert.equal(median([]), undefined);
  assert.equal(median([0]), 0);
});

test("Cache hitは観測された入力だけを分母にし、未取得・ゼロ入力を率にしない", () => {
  const summarize = (agents: RecordAgent[]) =>
    summarizeRecords([task("cache", agents)])[0]!;
  const row = summarize([
    agent("read", { tokens: { input: 200, output: 10, cacheRead: 100 } }),
    agent("miss", { tokens: { input: 100, output: 30, cacheRead: 0 } }),
    agent("unmeasured", { tokens: { input: 900, output: 50 } }),
    agent("missing"),
  ]);
  assert.equal(row.cacheHit, 1 / 3);
  assert.equal(row.measuredCache, 2);
  assert.equal(row.measuredTokens, 3);
  assert.equal(row.input, 200);
  assert.equal(row.output, 30);
  assert.equal(
    summarize([
      agent("zero", { tokens: { input: 0, output: 0, cacheRead: 0 } }),
    ]).cacheHit,
    undefined,
  );
  assert.equal(
    summarize([
      agent("miss", { tokens: { input: 100, output: 0, cacheRead: 0 } }),
    ]).cacheHit,
    0,
  );
});

test("Recordsの時間は作業時間を使い、記録前の子だけ経過時間へ戻る", () => {
  const record = task("mixed", [
    agent("working", { elapsedMs: 900, workMs: 20 }),
    agent("legacy", { elapsedMs: 40 }),
    agent("waiting", { elapsedMs: 800, workMs: 0 }),
    agent("unknown"),
  ]);
  assert.equal(summarizeRecords([record])[0]!.time, 20);
  assert.equal(taskWorkTime(record), 60);
  assert.equal(taskWorkTime(task("legacy", [], { elapsedMs: 100 })), 100);
  assert.equal(taskWorkTime(task("unknown", [])), undefined);
});
