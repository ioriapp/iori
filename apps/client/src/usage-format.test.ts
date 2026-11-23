import assert from "node:assert/strict";
import { test } from "node:test";
import {
  formatUpdatedAt,
  formatUsage,
  formatUsageDuration,
  formatUsageLength,
  formatUsagePace,
  usageDepletionMinutes,
} from "./usage-format.ts";

test("usage shows used or remaining percentage and the reset duration", () => {
  assert.equal(formatUsage(300, 74.6), "5h 25% used");
  assert.equal(
    formatUsage(10080, 74.6, 1501, "remaining"),
    "7d 75% left · resets 1d 1h",
  );
  assert.equal(formatUsageLength(45), "45m");
  assert.equal(formatUsageDuration(89), "1h 29m");
  assert.equal(formatUsageDuration(12.9), "12m");
});

test("last update is shown in the selected language and never in the future", () => {
  const now = 10_000_000;
  assert.equal(formatUpdatedAt(now + 1000, "en", now), "Updated just now");
  assert.equal(
    formatUpdatedAt(now - 2 * 60000, "ja-JP", now),
    "最終更新: 2分前",
  );
  assert.equal(formatUpdatedAt(now - 120 * 60000, "en", now), "Updated 2h ago");
});

test("usage pace estimates depletion time only when over pace and past minimum elapsed time", () => {
  const now = 1_700_000_000_000;
  const minute = 60_000;

  // 7d window, 6d remaining, 80% left -> elapsed 1d, depletion 4d (5760m)
  const weekOverPace = {
    minutes: 10080,
    remaining: 80,
    resetsAt: now + 6 * 1440 * minute,
  };
  assert.equal(usageDepletionMinutes(weekOverPace, now), 5760);
  assert.equal(
    formatUsagePace(weekOverPace, "ja-JP", now),
    "あと約 4d 0h で上限",
  );
  assert.equal(
    formatUsagePace(weekOverPace, "en-US", now),
    "Runs out in ~4d 0h",
  );

  // 5h window: min elapsed is 15m
  assert.equal(
    usageDepletionMinutes(
      { minutes: 300, remaining: 80, resetsAt: now + 285 * minute },
      now,
    ),
    60,
  );
  assert.equal(
    usageDepletionMinutes(
      { minutes: 300, remaining: 80, resetsAt: now + 286 * minute },
      now,
    ),
    undefined,
  );

  // 30d window: min elapsed is also 15m
  assert.equal(
    usageDepletionMinutes(
      { minutes: 43200, remaining: 50, resetsAt: now + (43200 - 15) * minute },
      now,
    ),
    15,
  );
  assert.equal(
    usageDepletionMinutes(
      { minutes: 43200, remaining: 50, resetsAt: now + (43200 - 14) * minute },
      now,
    ),
    undefined,
  );

  // On pace (depletion === remaining) or comfortable -> undefined
  assert.equal(
    usageDepletionMinutes(
      { minutes: 300, remaining: 50, resetsAt: now + 150 * minute },
      now,
    ),
    undefined,
  );
  assert.equal(
    usageDepletionMinutes(
      { minutes: 10080, remaining: 90, resetsAt: now + 6 * 1440 * minute },
      now,
    ),
    undefined,
  );

  // Boundary values
  assert.equal(
    usageDepletionMinutes({ minutes: 300, remaining: 50 }, now),
    undefined,
  );
  assert.equal(
    usageDepletionMinutes(
      { minutes: 300, remaining: 50, resetsAt: now - minute },
      now,
    ),
    undefined,
  );
  assert.equal(
    usageDepletionMinutes(
      { minutes: 300, remaining: 50, resetsAt: now + 310 * minute },
      now,
    ),
    undefined,
  );
  assert.equal(
    usageDepletionMinutes(
      { minutes: 300, remaining: 100, resetsAt: now + 150 * minute },
      now,
    ),
    undefined,
  );
  assert.equal(
    usageDepletionMinutes(
      { minutes: 300, remaining: 0, resetsAt: now + 150 * minute },
      now,
    ),
    undefined,
  );

  // Minimum 1m when depletionMinutes < 1
  const subMinute = {
    minutes: 300,
    remaining: 1,
    resetsAt: now + 285 * minute,
  };
  assert.equal(usageDepletionMinutes(subMinute, now), 1);
  assert.equal(formatUsagePace(subMinute, "en", now), "Runs out in ~1m");
  assert.equal(formatUsagePace(subMinute, "ja", now), "あと約 1m で上限");
});
