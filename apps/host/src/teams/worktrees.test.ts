import assert from "node:assert/strict";
import { test } from "node:test";
import { childWorktreeSlug } from "./worktrees.ts";

test("child worktree names retain a readable ASCII title, cut at a word end, without path or ref punctuation", () => {
  assert.equal(childWorktreeSlug("Ｆｉｘ café / sidebar"), "fix-cafe-sidebar");
  assert.equal(childWorktreeSlug("../../日本語\\\u0000"), "worker");
  const slug = childWorktreeSlug(
    "Improve sidebar child states and long titles",
  );
  assert.equal(slug, "improve-sidebar-child");
  assert.match(slug, /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/u);
  assert.equal(
    childWorktreeSlug("abcdefghijklmnopqrstuvw - rest"),
    "abcdefghijklmnopqrstuvw",
  );
});
