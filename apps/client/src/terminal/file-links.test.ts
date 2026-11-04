import assert from "node:assert/strict";
import { test } from "node:test";
import { pathCandidates } from "./file-links.ts";

test("path candidates retain terminal string offsets and compiler line/column suffixes", () => {
  const text =
    '参照: src/日本語.ts:12:4 (/tmp/report.txt:2), ~/notes.md and "C:\\My Project\\src.ts:30:5" https://example.com/a.ts';
  const candidates = pathCandidates(text);
  const files = candidates.filter((item) => /[/.\\]/u.test(item.path));
  assert.deepEqual(
    files.map(({ path, line, column }) => ({ path, line, column })),
    [
      { path: "src/日本語.ts", line: 12, column: 4 },
      { path: "/tmp/report.txt", line: 2, column: undefined },
      { path: "~/notes.md", line: undefined, column: undefined },
      { path: "C:\\My Project\\src.ts", line: 30, column: 5 },
    ],
  );
  for (const candidate of files)
    assert.equal(text.slice(candidate.start, candidate.end), candidate.text);
});

test("relative filenames without directories and parent directories remain candidates for Host resolution", () => {
  const text =
    "README ../shared/config.toml:9 ./Makefile 'notes with spaces.md'";
  assert.deepEqual(
    pathCandidates(text).map((item) => item.path),
    ["README", "../shared/config.toml", "./Makefile", "notes with spaces.md"],
  );
});

test("compiler and rg diagnostics, English prose and Japanese references retain file candidates", () => {
  const text =
    "main.go:12:5: src/app.py:12: src/foo.ts:12: I've read src/a.ts and it's in src/b.ts apps/client/src/x.tsxの123行目 日本語/設計.md";
  const files = pathCandidates(text)
    .filter((item) => item.path.includes("."))
    .map(({ path, line, column }) => ({ path, line, column }));
  assert.deepEqual(files, [
    { path: "main.go", line: 12, column: 5 },
    { path: "src/app.py", line: 12, column: undefined },
    { path: "src/foo.ts", line: 12, column: undefined },
    { path: "src/a.ts", line: undefined, column: undefined },
    { path: "src/b.ts", line: undefined, column: undefined },
    {
      path: "apps/client/src/x.tsxの123行目",
      line: undefined,
      column: undefined,
    },
    { path: "apps/client/src/x.tsx", line: undefined, column: undefined },
    { path: "日本語/設計.md", line: undefined, column: undefined },
  ]);
  for (const candidate of pathCandidates(text))
    assert.equal(text.slice(candidate.start, candidate.end), candidate.text);
});

test("quoted CLI paths after prose, assignment and JSON, plus pipe-separated paths", () => {
  const text =
    "ファイルは`src/foo.ts`を直しました --file='src/a.ts' {\"path\":\"src/b.ts\"} foo.ts|bar.ts I've read it and it's done";
  const files = pathCandidates(text).filter((item) =>
    item.path.endsWith(".ts"),
  );
  assert.deepEqual(
    files.map((item) => item.path),
    ["src/foo.ts", "src/a.ts", "src/b.ts", "foo.ts", "bar.ts"],
  );
  for (const candidate of files)
    assert.equal(text.slice(candidate.start, candidate.end), candidate.text);
});
