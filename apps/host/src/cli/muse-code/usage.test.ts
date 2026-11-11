import assert from "node:assert/strict";
import { test } from "node:test";
import { readUsage } from "./usage.ts";

// window and weekly from muse serve's usage/read response.
test("Muse subscription usage becomes five-hour and weekly windows", () => {
  assert.deepEqual(
    readUsage({
      weekly: { resetsAtMs: 1794787200000, usedPercent: 11 },
      window: {
        resetsAtMs: 1794329374000,
        usedPercent: 25,
        windowDurationMins: 300,
      },
    }),
    {
      windows: [
        { remaining: 75, minutes: 300, resetsAt: 1794329374000 },
        { remaining: 89, minutes: 10080, resetsAt: 1794787200000 },
      ],
    },
  );
});
