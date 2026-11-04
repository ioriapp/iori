import assert from "node:assert/strict";
import { test } from "node:test";
import { issueWorktreeName } from "./worktree-name.ts";

test("an ASCII Issue title becomes the number and the title cut within 24 characters at a word end when it has one", () => {
  assert.equal(
    issueWorktreeName(134, "Keep the scroll position after reconnecting"),
    "134-keep-the-scroll-position",
  );
  assert.equal(
    issueWorktreeName(2, "Keep the token out of the logs"),
    "2-keep-the-token-out-of",
  );
  assert.equal(
    issueWorktreeName(7, "Fix: CI's `log` tab (again)!"),
    "7-fix-ci-s-log-tab-again",
  );
  // A first word longer than 24 characters has no word end to cut at.
  assert.equal(
    issueWorktreeName(14, "Internationalizationworkflowsupport"),
    "14-internationalizationwork",
  );
});

test("an Issue title with other characters, or with nothing left after shaping, becomes issue-<number>", () => {
  assert.equal(
    issueWorktreeName(142, "CIの失敗の原因をアプリの中で読みたい"),
    "issue-142",
  );
  assert.equal(issueWorktreeName(9, "Ｆｉｘ the café"), "issue-9");
  assert.equal(issueWorktreeName(12, "!!! ???"), "issue-12");
  assert.equal(issueWorktreeName(13, ""), "issue-13");
});
