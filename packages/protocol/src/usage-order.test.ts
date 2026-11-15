import assert from "node:assert/strict";
import { test } from "node:test";
import { orderUsageWindows, statusBarUsageWindows } from "./cli.ts";

const w = (
  minutes: number,
  remaining: number,
  name?: string,
  resetsAt?: number,
) => ({
  ...(name ? { name } : {}),
  remaining,
  minutes,
  ...(resetsAt !== undefined ? { resetsAt } : {}),
});

test("orderUsageWindows puts unnamed windows first, preserves named group order, and sorts each group by duration", () => {
  assert.deepEqual(
    orderUsageWindows([w(300, 80), w(10080, 40), w(10080, 60, "Fable")]),
    [w(300, 80), w(10080, 40), w(10080, 60, "Fable")],
  );

  assert.deepEqual(
    orderUsageWindows([
      w(10080, 10, "Gemini Models"),
      w(300, 90, "Gemini Models"),
      w(10080, 90, "Claude and GPT models"),
      w(300, 20, "Claude and GPT models"),
      w(10080, 30, "Gemini 4 Argon"),
    ]),
    [
      w(300, 90, "Gemini Models"),
      w(10080, 10, "Gemini Models"),
      w(300, 20, "Claude and GPT models"),
      w(10080, 90, "Claude and GPT models"),
      w(10080, 30, "Gemini 4 Argon"),
    ],
  );

  assert.deepEqual(orderUsageWindows([w(10080, 50)]), [w(10080, 50)]);

  assert.deepEqual(
    orderUsageWindows([w(10080, 60, "Fable"), w(10080, 40), w(300, 80)]),
    [w(300, 80), w(10080, 40), w(10080, 60, "Fable")],
  );

  assert.deepEqual(
    orderUsageWindows([w(10080, 50, "Group", 1), w(10080, 50, "Group", 2)]),
    [w(10080, 50, "Group", 1), w(10080, 50, "Group", 2)],
  );
});

test("statusBarUsageWindows picks up to 3 used windows with lowest remaining in received order", () => {
  assert.deepEqual(
    statusBarUsageWindows([w(300, 80), w(10080, 40), w(10080, 60, "Fable")]),
    [w(300, 80), w(10080, 40), w(10080, 60, "Fable")],
  );

  assert.deepEqual(
    statusBarUsageWindows([
      w(300, 90, "Gemini Models"),
      w(10080, 10, "Gemini Models"),
      w(300, 20, "Claude and GPT models"),
      w(10080, 90, "Claude and GPT models"),
      w(10080, 30, "Gemini 4 Argon"),
    ]),
    [
      w(10080, 10, "Gemini Models"),
      w(300, 20, "Claude and GPT models"),
      w(10080, 30, "Gemini 4 Argon"),
    ],
  );

  assert.deepEqual(
    statusBarUsageWindows([w(300, 100), w(10080, 100), w(10080, 100, "Fable")]),
    [w(300, 100)],
  );
});
