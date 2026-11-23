import assert from "node:assert/strict";
import { test } from "node:test";
import {
  formatUpdatedAt,
  formatUsage,
  formatUsageDuration,
  formatUsageIdeal,
  formatUsageLength,
  formatUsageOverPace,
  usagePaceInfo,
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

test("usage pace computes ideal marker, signed diff, and depletion time across modes", () => {
  const now = 1_700_000_000_000;
  const minute = 60_000;

  // 7d window, 6d remaining, 80% left -> elapsed 1d (expected used 14.2857%), depletion 4d (5760m)
  const weekOverPace = {
    minutes: 10080,
    remaining: 80,
    resetsAt: now + 6 * 1440 * minute,
  };
  const usedInfo = usagePaceInfo(weekOverPace, "used", now);
  assert.ok(usedInfo);
  assert.ok(Math.abs(usedInfo.markerPercent - 100 / 7) < 1e-9);
  assert.equal(usedInfo.idealPercent, 14);
  assert.equal(usedInfo.overPace, true);
  assert.equal(usedInfo.diffPercent, 6);
  assert.equal(usedInfo.depletionMinutes, 5760);
  assert.equal(formatUsageIdeal(usedInfo.idealPercent, "ja-JP"), "理想 14%");
  assert.equal(formatUsageIdeal(usedInfo.idealPercent, "en-US"), "Ideal 14%");
  assert.equal(
    formatUsageOverPace(usedInfo, "ja-JP"),
    "+6% · あと約 4d 0h で上限",
  );
  assert.equal(
    formatUsageOverPace(usedInfo, "en-US"),
    "+6% · Runs out in ~4d 0h",
  );

  const remainingInfo = usagePaceInfo(weekOverPace, "remaining", now);
  assert.ok(remainingInfo);
  assert.ok(Math.abs(remainingInfo.markerPercent - (100 - 100 / 7)) < 1e-9);
  assert.equal(remainingInfo.idealPercent, 86);
  assert.equal(remainingInfo.overPace, true);
  assert.equal(remainingInfo.diffPercent, -6);
  assert.equal(remainingInfo.depletionMinutes, 5760);
  assert.equal(
    formatUsageIdeal(remainingInfo.idealPercent, "ja-JP"),
    "理想 86%",
  );
  assert.equal(
    formatUsageIdeal(remainingInfo.idealPercent, "en-US"),
    "Ideal 86%",
  );
  assert.equal(
    formatUsageOverPace(remainingInfo, "ja-JP"),
    "-6% · あと約 4d 0h で上限",
  );
  assert.equal(
    formatUsageOverPace(remainingInfo, "en-US"),
    "-6% · Runs out in ~4d 0h",
  );

  // Comfortable and on-pace -> overPace false, ideal/marker still returned
  const comfortable = usagePaceInfo(
    { minutes: 10080, remaining: 90, resetsAt: now + 6 * 1440 * minute },
    "used",
    now,
  );
  assert.ok(comfortable);
  assert.ok(Math.abs(comfortable.markerPercent - 100 / 7) < 1e-9);
  assert.equal(comfortable.idealPercent, 14);
  assert.equal(comfortable.overPace, false);
  assert.equal(comfortable.diffPercent, 0);
  assert.equal(comfortable.depletionMinutes, undefined);
  assert.equal(formatUsageOverPace(comfortable, "en"), undefined);

  const onPace = usagePaceInfo(
    { minutes: 300, remaining: 50, resetsAt: now + 150 * minute },
    "remaining",
    now,
  );
  assert.deepEqual(onPace, {
    markerPercent: 50,
    idealPercent: 50,
    overPace: false,
    diffPercent: 0,
  });
  assert.equal(formatUsageOverPace(onPace, "ja"), undefined);

  // Over-pace with elapsed < 15m -> diff only, no depletion estimate
  const earlyOverPace = {
    minutes: 10080,
    remaining: 95,
    resetsAt: now + (10080 - 10) * minute,
  };
  const earlyUsed = usagePaceInfo(earlyOverPace, "used", now);
  assert.ok(earlyUsed);
  assert.equal(earlyUsed.overPace, true);
  assert.equal(earlyUsed.diffPercent, 5);
  assert.equal(earlyUsed.depletionMinutes, undefined);
  assert.equal(formatUsageOverPace(earlyUsed, "ja"), "+5%");
  assert.equal(formatUsageOverPace(earlyUsed, "en"), "+5%");

  const earlyRemaining = usagePaceInfo(earlyOverPace, "remaining", now);
  assert.ok(earlyRemaining);
  assert.equal(earlyRemaining.overPace, true);
  assert.equal(earlyRemaining.diffPercent, -5);
  assert.equal(earlyRemaining.depletionMinutes, undefined);
  assert.equal(formatUsageOverPace(earlyRemaining, "ja"), "-5%");
  assert.equal(formatUsageOverPace(earlyRemaining, "en"), "-5%");

  // 5h & 30d minimum elapsed threshold (15m) for depletion estimate
  assert.equal(
    usagePaceInfo(
      { minutes: 300, remaining: 80, resetsAt: now + 285 * minute },
      "used",
      now,
    )?.depletionMinutes,
    60,
  );
  assert.equal(
    usagePaceInfo(
      { minutes: 300, remaining: 80, resetsAt: now + 286 * minute },
      "used",
      now,
    )?.depletionMinutes,
    undefined,
  );
  assert.equal(
    usagePaceInfo(
      { minutes: 43200, remaining: 50, resetsAt: now + (43200 - 15) * minute },
      "used",
      now,
    )?.depletionMinutes,
    15,
  );
  assert.equal(
    usagePaceInfo(
      { minutes: 43200, remaining: 50, resetsAt: now + (43200 - 14) * minute },
      "used",
      now,
    )?.depletionMinutes,
    undefined,
  );

  // Tiny over-pace where rounded diff is 0% (elapsed >= 15m) -> depletion only
  const tinyOverPace = usagePaceInfo(
    { minutes: 10080, remaining: 85.6, resetsAt: now + 6 * 1440 * minute },
    "used",
    now,
  );
  assert.ok(tinyOverPace);
  assert.equal(tinyOverPace.overPace, true);
  assert.equal(tinyOverPace.diffPercent, 0);
  assert.equal(tinyOverPace.depletionMinutes, 8559);
  assert.equal(formatUsageOverPace(tinyOverPace, "ja"), "あと約 5d 22h で上限");
  assert.equal(formatUsageOverPace(tinyOverPace, "en"), "Runs out in ~5d 22h");

  // Remaining 0% and 100% -> overPace false, marker and ideal still returned
  const full = usagePaceInfo(
    { minutes: 300, remaining: 100, resetsAt: now + 150 * minute },
    "used",
    now,
  );
  assert.deepEqual(full, {
    markerPercent: 50,
    idealPercent: 50,
    overPace: false,
    diffPercent: 0,
  });
  const empty = usagePaceInfo(
    { minutes: 300, remaining: 0, resetsAt: now + 150 * minute },
    "remaining",
    now,
  );
  assert.deepEqual(empty, {
    markerPercent: 50,
    idealPercent: 50,
    overPace: false,
    diffPercent: 0,
  });

  // Invalid / boundary inputs -> undefined
  assert.equal(
    usagePaceInfo({ minutes: 300, remaining: 50 }, "used", now),
    undefined,
  );
  assert.equal(
    usagePaceInfo(
      { minutes: 300, remaining: 50, resetsAt: now - minute },
      "used",
      now,
    ),
    undefined,
  );
  assert.equal(
    usagePaceInfo(
      { minutes: 300, remaining: 50, resetsAt: now + 310 * minute },
      "used",
      now,
    ),
    undefined,
  );

  // Minimum 1m when depletionMinutes < 1
  const subMinute = usagePaceInfo(
    { minutes: 300, remaining: 1, resetsAt: now + 285 * minute },
    "used",
    now,
  );
  assert.ok(subMinute);
  assert.equal(subMinute.depletionMinutes, 1);
  assert.equal(formatUsageOverPace(subMinute, "en"), "+94% · Runs out in ~1m");
  assert.equal(formatUsageOverPace(subMinute, "ja"), "+94% · あと約 1m で上限");
});
