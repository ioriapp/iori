import assert from "node:assert/strict";
import { test } from "node:test";
import { boardActivityChange, resumesBoardTool } from "./board-activity.ts";

const thinking = { kind: "thinking" } as const;
const tool = { kind: "tool", tool: "Bash", summary: "sleep 1" } as const;

test("Board delays a new tool by 500ms and returns Thinking immediately before it is shown", () => {
  const pending = boardActivityChange(
    true,
    tool,
    false,
    thinking,
    undefined,
    undefined,
    1000,
  );
  assert.deepEqual(pending, { shown: tool, delay: 500 });
  const ended = boardActivityChange(
    true,
    thinking,
    false,
    thinking,
    undefined,
    undefined,
    1200,
  );
  assert.equal(ended.shown, thinking);
  assert.equal(ended.delay, 0);
});

test("Board holds a displayed tool for 200ms from its actual commit", () => {
  for (const [elapsed, remaining] of [
    [0, 200],
    [100, 100],
    [199, 1],
    [200, 0],
    [1200, 0],
  ]) {
    const next = boardActivityChange(
      true,
      thinking,
      false,
      tool,
      undefined,
      2400,
      2400 + elapsed,
    );
    assert.equal(next.shown, thinking);
    assert.equal(next.delay, remaining);
  }
  assert.deepEqual(
    boardActivityChange(true, tool, false, tool, undefined, 2400, 2401),
    { shown: tool },
  );
});

test("Board shows approval immediately and resumes the same tool without a delay", () => {
  const approval = boardActivityChange(
    false,
    undefined,
    true,
    tool,
    undefined,
    2400,
    2401,
  );
  assert.equal(approval.shown, undefined);
  assert.equal(approval.delay, undefined);
  assert.equal(approval.beforeAnswer, tool);
  assert.equal(resumesBoardTool(tool, approval.beforeAnswer), true);
  assert.deepEqual(
    boardActivityChange(
      true,
      tool,
      false,
      undefined,
      approval.beforeAnswer,
      undefined,
      2402,
    ),
    { shown: tool },
  );
  const other = { ...tool, summary: "other command" };
  assert.equal(resumesBoardTool(other, approval.beforeAnswer), false);
  assert.equal(
    boardActivityChange(
      true,
      other,
      false,
      undefined,
      approval.beforeAnswer,
      undefined,
      2402,
    ).delay,
    500,
  );
  assert.equal(
    boardActivityChange(false, undefined, false, tool, undefined, 2400, 2401)
      .beforeAnswer,
    undefined,
  );
});
