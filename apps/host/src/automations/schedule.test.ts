import assert from "node:assert/strict";
import { test } from "node:test";
import type { Automation } from "@iori/protocol";
import { nextSchedule, dueSchedules, missedSchedule } from "./schedule.ts";
const at = (text: string) => Date.parse(text);
test("nextSchedule: manual, once, daily and weekly use Host local time", () => {
  const now = at("2026-10-20T00:00:00Z");
  assert.equal(nextSchedule({ kind: "manual" }, now, "Asia/Tokyo"), undefined);
  assert.equal(
    nextSchedule({ kind: "once", at: now + 60_000 }, now, "Asia/Tokyo"),
    now + 60_000,
  );
  assert.equal(
    nextSchedule({ kind: "once", at: now }, now, "Asia/Tokyo"),
    undefined,
  );
  assert.equal(
    nextSchedule({ kind: "daily", time: "09:00" }, now, "Asia/Tokyo"),
    at("2026-10-21T00:00:00Z"),
  );
  assert.equal(
    nextSchedule(
      { kind: "weekly", time: "09:00", days: [0, 3] },
      now,
      "Asia/Tokyo",
    ),
    at("2026-10-21T00:00:00Z"),
  );
});
test("nextSchedule: DST gaps move forward and repeated hours execute once", () => {
  const schedule = { kind: "daily", time: "02:30" } as const;
  assert.equal(
    nextSchedule(schedule, at("2026-03-08T05:00:00Z"), "America/New_York"),
    at("2026-03-08T07:30:00Z"),
  );
  assert.equal(
    nextSchedule(schedule, at("2026-03-08T07:30:00Z"), "America/New_York"),
    at("2026-03-09T06:30:00Z"),
  );
  const repeated = { kind: "daily", time: "01:30" } as const;
  assert.equal(
    nextSchedule(repeated, at("2026-11-01T04:00:00Z"), "America/New_York"),
    at("2026-11-01T05:30:00Z"),
  );
  assert.equal(
    nextSchedule(repeated, at("2026-11-01T05:30:00Z"), "America/New_York"),
    at("2026-11-02T06:30:00Z"),
  );
  assert.equal(
    nextSchedule(
      { kind: "weekly", time: "01:30", days: [0] },
      at("2026-11-01T05:30:00Z"),
      "America/New_York",
    ),
    at("2026-11-08T06:30:00Z"),
  );
});
test("missedSchedule: same-minute end, next-minute start and Host startup", () => {
  const scheduled = at("2026-10-20T09:00:00Z");
  assert.equal(missedSchedule(scheduled, scheduled + 59_999, false), false);
  assert.equal(missedSchedule(scheduled, scheduled + 60_000, false), true);
  assert.equal(missedSchedule(scheduled, scheduled + 1, true), true);
});
const automation: Automation = {
  id: "a",
  name: "Daily",
  instruction: "Read the project",
  cwd: "/project",
  enabled: true,
  missed: "latest",
  target: { kind: "team", teamId: "t" },
  schedule: { kind: "daily", time: "09:00" },
  nextAt: at("2026-10-18T00:00:00Z"),
};
test("dueSchedules: only latest missed run executes; record-only and disabled retain every occurrence", () => {
  const now = at("2026-10-20T01:00:00Z");
  const due = dueSchedules(automation, now, "Asia/Tokyo", true);
  assert.deepEqual(due, [
    { at: at("2026-10-18T00:00:00Z"), reason: "offline" },
    { at: at("2026-10-19T00:00:00Z"), reason: "offline" },
    { at: at("2026-10-20T00:00:00Z") },
  ]);
  assert.deepEqual(
    dueSchedules(
      { ...automation, missed: "skip" },
      now,
      "Asia/Tokyo",
      true,
    ).map((d) => d.reason),
    ["offline", "offline", "offline"],
  );
  assert.deepEqual(
    dueSchedules(
      { ...automation, enabled: false },
      now,
      "Asia/Tokyo",
      false,
    ).map((d) => d.reason),
    ["disabled", "disabled", "disabled"],
  );
  assert.equal(
    dueSchedules({ ...automation, nextAt: now + 1 }, now, "Asia/Tokyo", true)
      .length,
    0,
  );
});
test("dueSchedules: one-time schedule is consumed once and current minute runs with record-only", () => {
  const now = at("2026-10-20T00:00:00Z");
  const once: Automation = {
    ...automation,
    missed: "skip",
    schedule: { kind: "once", at: now },
    nextAt: now,
  };
  assert.deepEqual(dueSchedules(once, now + 59_999, "Asia/Tokyo", false), [
    { at: now },
  ]);
  assert.deepEqual(dueSchedules(once, now + 60_000, "Asia/Tokyo", false), [
    { at: now, reason: "offline" },
  ]);
});
