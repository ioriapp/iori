import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { failedStepEnd, lineText, logLines, parseLogLine } from "./ci-log.ts";

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
