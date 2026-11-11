import assert from "node:assert/strict";
import { test } from "node:test";
import { displayUsage } from "./display-usage.ts";

test("Muse の値とリセット済みの値を表示し、週の値を保存する", () => {
  const result = displayUsage(
    {
      observedAtMs: 900,
      window: { usedPercent: 25, resetsAtMs: 1000, windowDurationMins: 240 },
      weekly: { usedPercent: 17, resetsAtMs: 2000 },
    },
    undefined,
    true,
    1000,
  );
  assert.deepEqual(result, {
    usage: {
      observedAt: 900,
      windows: [
        { remaining: 100, minutes: 240 },
        { remaining: 83, minutes: 10080, resetsAt: 2000 },
      ],
    },
    saved: {
      schema: 1,
      windowMinutes: 240,
      weekly: { usedPercent: 17, resetsAt: 2000 },
      observedAt: 900,
    },
  });
  assert.deepEqual(
    displayUsage(
      {
        window: { usedPercent: 10, resetsAtMs: 2000 },
        weekly: { usedPercent: 30, resetsAtMs: 1000 },
      },
      undefined,
      true,
      1000,
    ).usage,
    {
      observedAt: 1000,
      windows: [
        { remaining: 90, minutes: 300, resetsAt: 2000 },
        { remaining: 100, minutes: 10080 },
      ],
    },
  );
});

test("Muse が値を返さないサブスクは保存した週の値と取得時刻を使う", () => {
  const saved = {
    schema: 1 as const,
    windowMinutes: 240,
    weekly: { usedPercent: 17, resetsAt: 2000 },
    observedAt: 900,
  };
  assert.deepEqual(displayUsage(undefined, saved, undefined, 1000), {
    usage: {
      observedAt: 900,
      windows: [
        { remaining: 100, minutes: 240 },
        { remaining: 83, minutes: 10080, resetsAt: 2000 },
      ],
    },
    saved,
  });
  assert.deepEqual(displayUsage(undefined, saved, true, 2000).usage, {
    observedAt: 900,
    windows: [
      { remaining: 100, minutes: 240 },
      { remaining: 100, minutes: 10080 },
    ],
  });
  assert.deepEqual(displayUsage(undefined, undefined, true, 1000), {
    usage: { observedAt: 1000, windows: [{ remaining: 100, minutes: 300 }] },
    saved: undefined,
  });
  assert.deepEqual(displayUsage(undefined, saved, false, 1000), {
    usage: undefined,
    saved: undefined,
  });
});
