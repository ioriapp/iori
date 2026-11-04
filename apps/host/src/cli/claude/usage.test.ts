import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { belowUsageMinimum, usageAppliesToModel } from "@iori/protocol";
import { readUsage } from "./usage.ts";
// Claude Code 2.1.310, /usage --output-format json, TZ=UTC (2026-10-25 JST).
const output = JSON.parse(
  readFileSync(new URL("./usage.fixture.json", import.meta.url), "utf8"),
);
test("Claude usage text becomes session, all-model and named weekly windows", () => {
  const usage = readUsage(output, Date.parse("2026-10-25T05:20:00Z"))!;
  assert.deepEqual(
    usage.windows.map(({ name, remaining, minutes, resetsAt }) => ({
      name,
      remaining,
      minutes,
      resetsAt,
    })),
    [
      {
        name: undefined,
        remaining: 87,
        minutes: 300,
        resetsAt: Date.parse("2026-10-24T20:59:00Z"),
      },
      {
        name: undefined,
        remaining: 60,
        minutes: 10080,
        resetsAt: Date.parse("2026-10-26T02:59:00Z"),
      },
      {
        name: "Fable",
        remaining: 100,
        minutes: 10080,
        resetsAt: Date.parse("2026-10-26T03:00:00Z"),
      },
    ],
  );
  assert.equal(usageAppliesToModel(usage.windows[2]!, "fable"), true);
  assert.equal(usageAppliesToModel(usage.windows[2]!, "claude-fable-5"), true);
  assert.equal(usageAppliesToModel(usage.windows[2]!, "sonnet"), false);
  assert.equal(belowUsageMinimum("61", usage, "sonnet"), true);
  assert.equal(belowUsageMinimum("60", usage, "fable"), false);
});
test("Claude's yearless UTC reset stays in this year just after its displayed minute", () => {
  assert.equal(
    readUsage(output, Date.parse("2026-10-24T21:00:01Z"))?.windows[0]?.resetsAt,
    Date.parse("2026-10-24T20:59:00Z"),
  );
});
test("Claude's explicit UTC reset year is retained", () => {
  assert.equal(
    readUsage(
      { result: "Current session: 5% used · resets Jan 2, 2027, 3am (UTC)" },
      Date.parse("2026-12-31T00:00:00Z"),
    )?.windows[0]?.resetsAt,
    Date.parse("2027-01-02T03:00:00Z"),
  );
});
