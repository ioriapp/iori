import assert from "node:assert/strict";
import { test } from "node:test";
import {
  formatUpdatedAt,
  formatUsage,
  formatUsageDuration,
  formatUsageLength,
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
