import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { belowUsageMinimum, usageAppliesToModel } from "@iori/protocol";
import { readUsage } from "./usage.ts";
// Claude Code 2.1.310, /usage --output-format json, TZ=UTC (2026-10-25 JST).
const output = JSON.parse(
  readFileSync(new URL("./usage.fixture.json", import.meta.url), "utf8"),
);
test("OSのタイムゾーンで出たClaude Codeの利用枠を読む", () => {
  const usage = readUsage(
    {
      result:
        "You are currently using your subscription to power your Claude Code usage\n\nCurrent session: 5% used · resets Nov 20, 12:09am (Asia/Tokyo)\nCurrent week (all models): 20% used · resets Nov 23, 11:59am (Asia/Tokyo)\nCurrent week (Fable): 5% used · resets Nov 23, 11:59am (Asia/Tokyo)",
    },
    Date.parse("2026-11-19T00:00:00Z"),
  );
  assert.deepEqual(
    usage?.windows.map(({ name, remaining, minutes, resetsAt }) => ({
      name,
      remaining,
      minutes,
      resetsAt,
    })),
    [
      {
        name: undefined,
        remaining: 95,
        minutes: 300,
        resetsAt: Date.parse("2026-11-19T15:09:00Z"),
      },
      {
        name: undefined,
        remaining: 80,
        minutes: 10080,
        resetsAt: Date.parse("2026-11-23T02:59:00Z"),
      },
      {
        name: "Fable",
        remaining: 95,
        minutes: 10080,
        resetsAt: Date.parse("2026-11-23T02:59:00Z"),
      },
    ],
  );
});
test("夏時間のある地域の利用枠を夏時間でUTCへ変換する", () => {
  assert.equal(
    readUsage(
      {
        result:
          "Current session: 5% used · resets Jul 15, 12pm (America/New_York)",
      },
      Date.parse("2026-07-01T00:00:00Z"),
    )?.windows[0]?.resetsAt,
    Date.parse("2026-07-15T16:00:00Z"),
  );
});
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
test("日付のないリセット時刻を現在時刻に最も近い現地日時として読む", () => {
  for (const [now, reset, expected] of [
    ["2026-11-20T12:00:00Z", "11:30pm", "2026-11-20T14:30:00Z"],
    ["2026-11-20T14:55:00Z", "12:30am", "2026-11-20T15:30:00Z"],
    ["2026-11-20T15:00:10Z", "11:59pm", "2026-11-20T14:59:00Z"],
  ]) {
    assert.deepEqual(
      readUsage(
        { result: `Current session: 15% used · resets ${reset} (Asia/Tokyo)` },
        Date.parse(now!),
      ),
      {
        windows: [
          { remaining: 85, minutes: 300, resetsAt: Date.parse(expected!) },
        ],
      },
    );
  }
});
test("リセット時刻のない利用枠を読み、不正なリセット文字列は無視する", () => {
  assert.deepEqual(
    readUsage({
      result:
        "Current session: 0% used\nCurrent week (Fable): 0% used\nCurrent session: 5% used · resets invalid",
    }),
    {
      windows: [
        { remaining: 100, minutes: 300 },
        {
          remaining: 100,
          minutes: 10080,
          name: "Fable",
          modelPatterns: ["fable", "fable-*", "claude-fable-*", "claude-fable"],
        },
      ],
    },
  );
});
