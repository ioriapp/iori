import assert from "node:assert/strict";
import { test } from "node:test";
import { formatPrCommentsForAgent } from "./pr-agent.ts";

const samplePr = {
  number: 42,
  title: "Add PR pane",
  baseBranch: "main",
  headBranch: "feat/pr-pane",
};

test("formats a conversation comment with PR metadata", () => {
  const result = formatPrCommentsForAgent(samplePr, [
    {
      author: "alice",
      body: "Please handle empty descriptions gracefully.",
    },
  ]);

  assert.equal(
    result,
    [
      "PR #42: Add PR pane",
      "Branch: main ← feat/pr-pane",
      "",
      "Comment by alice:",
      "Please handle empty descriptions gracefully.",
    ].join("\n"),
  );
});

test("formats an inline review comment with path, line, and trimmed diffHunk", () => {
  const longHunk = Array.from(
    { length: 16 },
    (_, i) => `+const line${i + 1} = ${i + 1};`,
  ).join("\n");

  const result = formatPrCommentsForAgent(samplePr, [
    {
      author: "bob",
      path: "apps/client/src/forge/PrPane.tsx",
      line: 128,
      diffHunk: longHunk,
      body: "Avoid hardcoding the default branch name.",
    },
  ]);

  assert.match(result, /^PR #42: Add PR pane\nBranch: main ← feat\/pr-pane/u);
  assert.ok(
    result.includes(
      "Comment by bob on `apps/client/src/forge/PrPane.tsx:128`:",
    ),
  );
  assert.ok(result.includes("```diff\n"));
  // First 4 lines should be trimmed so at most 12 lines remain.
  assert.ok(!result.includes("const line4 = 4;"));
  assert.ok(result.includes("+const line5 = 5;"));
  assert.ok(result.includes("+const line16 = 16;"));
  assert.ok(result.endsWith("Avoid hardcoding the default branch name."));
});

test("formats an inline comment without line number", () => {
  const result = formatPrCommentsForAgent(samplePr, [
    {
      author: "carol",
      path: "README.md",
      body: "Update the section title.",
    },
  ]);

  assert.ok(result.includes("Comment by carol on `README.md`:"));
  assert.ok(!result.includes("```diff"));
  assert.ok(result.endsWith("Update the section title."));
});

test("formats multiple comments in bulk with indices", () => {
  const result = formatPrCommentsForAgent(samplePr, [
    {
      author: "alice",
      body: "Looks good overall.",
    },
    {
      author: "bob",
      path: "src/index.ts",
      line: 10,
      diffHunk: "@@ -8,3 +8,4 @@\n-old()\n+new()",
      body: "Check null case here.",
    },
  ]);

  assert.ok(result.includes("[1/2] Comment by alice:\nLooks good overall."));
  assert.ok(
    result.includes(
      "[2/2] Comment by bob on `src/index.ts:10`:\n```diff\n@@ -8,3 +8,4 @@\n-old()\n+new()\n```\nCheck null case here.",
    ),
  );
});

test("returns only PR header when comments list is empty", () => {
  const result = formatPrCommentsForAgent(samplePr, []);
  assert.equal(result, "PR #42: Add PR pane\nBranch: main ← feat/pr-pane");
});
