import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import {
  extractFileLinks,
  failedStepEnd,
  findErrorLines,
  findStepLineIndices,
  formatCiFailureForAgent,
  lineText,
  logLines,
  parseLogLine,
} from "./ci-log.ts";

// The ends of real logs read through the Host's Forge reads (GET only):
// GitHub vitest-dev/vitest job 119625388475 and Forgejo example/iori run 161 job 3053.
const read = (name: string) =>
  readFileSync(new URL(name, import.meta.url), "utf8");
const github = logLines(read("ci-log-github.fixture.txt")).map(parseLogLine);
const forgejo = logLines(read("ci-log-forgejo.fixture.txt")).map(parseLogLine);

test("a GitHub log line shows without its timestamp, in its own colors", () => {
  const line = github.find((item) => lineText(item).startsWith(" FAIL "))!;
  assert.deepEqual(line.spans.slice(0, 4), [
    { text: " FAIL ", style: { background: 1, bold: true } },
    { text: " specs/playwright-trace.test.ts", style: {} },
    { text: " > ", style: { dim: true } },
    { text: "playwright tracing", style: {} },
  ]);
  const summary = github.find((item) =>
    lineText(item).startsWith(" Test Files "),
  )!;
  assert.deepEqual(summary.spans, [
    { text: " Test Files ", style: { dim: true } },
    { text: " ", style: {} },
    { text: "1 failed", style: { bold: true, foreground: 1 } },
    { text: " | ", style: { dim: true } },
    { text: "23 passed", style: { bold: true, foreground: 2 } },
    { text: " (24)", style: { foreground: 8 } },
  ]);
  assert.ok(github.every((item) => !lineText(item).includes("\u001b")));
});

test("the GitHub failed step ends at its error line, not at the test's own errors", () => {
  const end = failedStepEnd(github)!;
  assert.equal(
    lineText(github[end]!),
    "##[error]Process completed with exit code 1.",
  );
  assert.equal(github[end]!.kind, "error");
});

test("a Forgejo log ends its failed step at the runner's failure line", () => {
  const end = failedStepEnd(forgejo)!;
  assert.equal(lineText(forgejo[end]!), "⚙️ [runner]: exitcode '1': failure");
  assert.equal(lineText(forgejo[end + 1]!), "⭐ Run Post actions/checkout@v4");
});

test("the job's own failure lines after the failed step are not a step end", () => {
  // From the post step on: "🏁  Job failed" and "Job 'check' failed".
  const after = forgejo.slice(39);
  assert.ok(after.some((line) => lineText(line) === "Job 'check' failed"));
  assert.equal(failedStepEnd(after), undefined);
});

test("extractFileLinks extracts workspace-relative path:line, path:line:col, and path(line,col)", () => {
  const line =
    "Check src/app.ts:42 and apps/client/src/git/GitPane.tsx:123:5 then src/foo.ts(18,4): error TS2322";
  const links = extractFileLinks(line);
  assert.deepEqual(links, [
    {
      start: line.indexOf("src/app.ts:42"),
      end: line.indexOf("src/app.ts:42") + "src/app.ts:42".length,
      path: "src/app.ts",
      line: 42,
    },
    {
      start: line.indexOf("apps/client/src/git/GitPane.tsx:123:5"),
      end:
        line.indexOf("apps/client/src/git/GitPane.tsx:123:5") +
        "apps/client/src/git/GitPane.tsx:123:5".length,
      path: "apps/client/src/git/GitPane.tsx",
      line: 123,
      column: 5,
    },
    {
      start: line.indexOf("src/foo.ts(18,4)"),
      end: line.indexOf("src/foo.ts(18,4)") + "src/foo.ts(18,4)".length,
      path: "src/foo.ts",
      line: 18,
      column: 4,
    },
  ]);

  const stack = "    at fn (./src/bar.ts:7:2) and src/baz.ts(9)";
  assert.deepEqual(extractFileLinks(stack), [
    {
      start: stack.indexOf("./src/bar.ts:7:2"),
      end: stack.indexOf("./src/bar.ts:7:2") + "./src/bar.ts:7:2".length,
      path: "src/bar.ts",
      line: 7,
      column: 2,
    },
    {
      start: stack.indexOf("src/baz.ts(9)"),
      end: stack.indexOf("src/baz.ts(9)") + "src/baz.ts(9)".length,
      path: "src/baz.ts",
      line: 9,
    },
  ]);
  assert.deepEqual(extractFileLinks("##[error]base.txt:1: assertion failed"), [
    { start: 9, end: 19, path: "base.txt", line: 1 },
  ]);
});

test("extractFileLinks excludes URLs, parent-traversal paths, absolute paths, and line 0", () => {
  const excluded = [
    "See https://example.com:8080/src/app.ts:42 for details",
    "See http://localhost:3000/apps/client/src/app.ts:10",
    "at Socket.<anonymous> (file:///work/apps/host/src/terminal/daemon/channel.ts:62:24)",
    "../secret/file.ts:10 and src/../escape.ts:20:3",
    "/abs/path/src/app.ts:42 and (/etc/hosts:1)",
    "src/app.ts:0 and node:events:514:28",
  ];
  for (const line of excluded) {
    assert.deepEqual(
      extractFileLinks(line),
      [],
      `unexpected match in: ${line}`,
    );
  }

  // Real fixture lines: relative test path matches, file:// URL does not.
  const githubRef = github.find((item) =>
    lineText(item).includes("specs/playwright-trace.test.ts:95:3"),
  )!;
  assert.deepEqual(
    extractFileLinks(lineText(githubRef)).map(({ path, line, column }) => ({
      path,
      line,
      column,
    })),
    [{ path: "specs/playwright-trace.test.ts", line: 95, column: 3 }],
  );
  const forgejoRef = forgejo.find((item) =>
    lineText(item).includes("runtime-shutdown.integration.test.ts:187:1"),
  )!;
  assert.deepEqual(
    extractFileLinks(lineText(forgejoRef)).map(({ path, line, column }) => ({
      path,
      line,
      column,
    })),
    [
      {
        path: "apps/host/src/terminal/runtime-shutdown.integration.test.ts",
        line: 187,
        column: 1,
      },
    ],
  );
});

test("findErrorLines returns 0-based indices of error and failure lines in ascending order", () => {
  assert.deepEqual(findErrorLines(github), [failedStepEnd(github)!]);
  assert.deepEqual(findErrorLines(forgejo), [failedStepEnd(forgejo)!]);

  const lines = [
    parseLogLine("normal line"),
    parseLogLine("##[error]first error"),
    {
      spans: [{ text: "custom error kind", style: {} }],
      kind: "error" as const,
    },
    parseLogLine("  ❌  Failure - Run test"),
    parseLogLine("⚙️ [runner]: exitcode '2': failure"),
    parseLogLine("##[warning]just a warning"),
  ];
  assert.deepEqual(findErrorLines(lines), [1, 2, 3, 4]);
  assert.deepEqual(findErrorLines([]), []);
});

test("findStepLineIndices maps steps to heading indices and omits unmatched steps", () => {
  const synthetic = [
    "##[group]Set up job",
    "Preparing runner",
    "##[endgroup]",
    "##[group]Run pnpm test",
    "running tests...",
    "##[error]Test failed",
    "##[group]Post Checkout",
    "cleanup",
  ].map(parseLogLine);

  const steps = [
    { name: "Set up job", status: "passed" as const },
    { name: "Missing step", status: "skipped" as const },
    { name: "pnpm test", status: "failed" as const },
    { name: "Post Checkout", status: "passed" as const },
  ];

  const mapped = findStepLineIndices(synthetic, steps);
  assert.deepEqual(
    [...mapped.entries()],
    [
      [0, 0],
      [2, 3],
      [3, 6],
    ],
  );

  // Works against real GitHub ##[start-action] and Forgejo ⭐ Run headings.
  const ghSteps = [
    { name: "Cache Playwright v1.64.1", status: "skipped" as const },
    { name: "Install pnpm", status: "passed" as const },
  ];
  const ghMap = findStepLineIndices(github, ghSteps);
  assert.equal(
    lineText(github[ghMap.get(0)!]!).startsWith(
      "##[start-action display=Cache Playwright v1.64.1;",
    ),
    true,
  );
  assert.equal(
    lineText(github[ghMap.get(1)!]!).startsWith(
      "##[start-action display=Install pnpm;",
    ),
    true,
  );

  const fjMap = findStepLineIndices(forgejo, [
    { name: "Post actions/checkout@v4", status: "passed" as const },
  ]);
  assert.equal(
    lineText(forgejo[fjMap.get(0)!]!),
    "⭐ Run Post actions/checkout@v4",
  );
});

test("formatCiFailureForAgent formats summary, command hint, and trims tail excerpt safely", () => {
  const formatted = formatCiFailureForAgent({
    runName: "CI",
    jobName: "unit-tests",
    jobId: "12345",
    failedStepName: "Run tests",
    errorExcerpt: "line 1\n##[error]Process completed with exit code 1.\n",
  });
  assert.ok(formatted.includes("CI / unit-tests"));
  assert.ok(formatted.includes("Run tests"));
  assert.ok(formatted.includes("iori ci log 12345"));
  assert.ok(formatted.includes("##[error]Process completed with exit code 1."));

  // More than 40 lines: keeps only the last 40 lines.
  const manyLines = Array.from({ length: 60 }, (_, i) => `line-${i + 1}`).join(
    "\n",
  );
  const trimmedLines = formatCiFailureForAgent({
    jobName: "build",
    jobId: "99",
    errorExcerpt: manyLines,
  });
  assert.ok(!trimmedLines.includes("line-20\n"));
  assert.ok(trimmedLines.includes("line-21"));
  assert.ok(trimmedLines.includes("line-60"));

  // More than 4000 chars with surrogate pairs: keeps <= 4000 chars without broken surrogates.
  const emoji = "🔥".repeat(2500); // 5000 UTF-16 code units
  const trimmedChars = formatCiFailureForAgent({
    jobName: "lint",
    jobId: "77",
    errorExcerpt: `x${emoji}`,
  });
  const blockMatch = /```\n([\s\S]*)\n```$/u.exec(trimmedChars);
  assert.ok(blockMatch);
  const body = blockMatch[1]!;
  assert.ok(body.length <= 4000);
  assert.equal(body.startsWith("🔥"), true);
  assert.equal(body.length % 2, 0);
});
