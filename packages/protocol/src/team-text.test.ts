import assert from "node:assert/strict";
import test from "node:test";
import { teamCheckInNotice, teamStallNotice } from "./team-text.ts";

test("止まりの知らせは1件の書式と複数件の連結を保ち、制御文字を1行へ潰す", () => {
  assert.equal(
    teamStallNotice([
      { role: "Worker", title: "Alpha", childId: "c1", reason: "output" },
    ]),
    '[iori] Worker "Alpha" is not responding (no output for 2m). Read its screen with iori screen c1, act once, and do not check it again.',
  );
  assert.equal(
    teamStallNotice([{ title: "NoRole", childId: "c2", reason: "stopped" }]),
    '[iori] "NoRole" is not responding (a command it started is stopped). Read its screen with iori screen c2, act once, and do not check it again.',
  );
  assert.equal(
    teamStallNotice([
      {
        role: "Worker\r",
        title: "First\nline",
        childId: "c1",
        reason: "output",
      },
      {
        role: "Reviewer",
        title: "Second",
        childId: "c2\n",
        reason: "stopped",
      },
    ]),
    '[iori] Worker  "First line" is not responding (no output for 2m). Read its screen with iori screen c1; Reviewer "Second" is not responding (a command it started is stopped). Read its screen with iori screen c2 , act once, and do not check it again.',
  );
});

test("作業中の確認の知らせは1件と複数件の文形を保ち、制御文字を1行へ潰す", () => {
  assert.equal(
    teamCheckInNotice([
      { role: "Worker", title: "Alpha", childId: "c1", minutes: 30 },
    ]),
    '[iori] Worker "Alpha" has been working for 30m. Read its screen with iori screen c1. If it repeats itself or works off task, act; otherwise do nothing.',
  );
  assert.equal(
    teamCheckInNotice([
      {
        role: "Worker\r",
        title: "First\nline",
        childId: "c1",
        minutes: 15,
      },
      { role: "Reviewer", title: "Second", childId: "c2\n", minutes: 15 },
    ]),
    '[iori] Worker  "First line" has been working for 15m. Read its screen with iori screen c1; Reviewer "Second" has been working for 15m. Read its screen with iori screen c2 . If one repeats itself or works off task, act; otherwise do nothing.',
  );
});
