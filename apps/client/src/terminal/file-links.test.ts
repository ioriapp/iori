import assert from "node:assert/strict";
import { test } from "node:test";
import {
  parseFileUri,
  pathCandidates,
  terminalUrlRegex,
} from "./file-links.ts";

test("file URI links decode Host paths without using the URI authority", () => {
  for (const [uri, path] of [
    ["file:///tmp/report.md", "/tmp/report.md"],
    ["file://localhost/tmp/report.md", "/tmp/report.md"],
    ["file://example-host/tmp/report.md", "/tmp/report.md"],
    ["file:///tmp/%E8%A8%AD%E8%A8%88%20notes.md", "/tmp/設計 notes.md"],
    ["file:///C:/Users/a.md", "C:/Users/a.md"],
    ["file:///C%3A/Users/a.md", "C:/Users/a.md"],
  ] as const) {
    assert.deepEqual(parseFileUri(uri), { path }, uri);
  }
});

test("file URI links use the start of the line fragment or a path suffix", () => {
  const path = "/tmp/report.md";
  for (const [suffix, line, column] of [
    ["#L10", 10],
    ["#L10-L20", 10],
    ["#L10C5", 10, 5],
    ["#l10c5-l20c15", 10, 5],
    ["#10", 10],
    ["#10:5", 10, 5],
    [":12", 12],
    [":12:4", 12, 4],
    [":12:4#L0", 12, 4],
  ] as const) {
    assert.deepEqual(
      parseFileUri(`file://${path}${suffix}`),
      { path, line, ...(column === undefined ? {} : { column }) },
      suffix,
    );
  }
});

test("file URI links reject other schemes and invalid paths", () => {
  for (const uri of [
    "https://example.com",
    "javascript:alert(1)",
    "file:///tmp/%ZZ.md",
    "file:///tmp/%00.md",
    "file:///",
    "file:///.",
    "file:///..",
    "file:////server/share/notes.md",
    "file:///%5Cserver/share/notes.md",
    "file:///%2Fserver/share/notes.md",
  ]) {
    assert.equal(parseFileUri(uri), undefined, uri);
  }
});

test("Japanese punctuation separates terminal paths and URLs from prose", () => {
  const path =
    "/root/projects/iori/.local/design-drafts/374-daemon-only-emulator.md";
  for (const [before, after] of [
    ["- 全文: #374 のコメントと ", "。"],
    ["参照 ", "、"],
    ["（", "）"],
    ["「", "」"],
    ["『", "』"],
    ["【", "】"],
    ["“", "”"],
  ]) {
    const text = `${before}${path}${after}`;
    const candidate = pathCandidates(text).find((item) => item.path === path);
    assert.ok(candidate, text);
    assert.equal(text.slice(candidate.start, candidate.end), path);
    const url = "https://example.com/file";
    assert.equal(`${before}${url}${after}`.match(terminalUrlRegex)?.[0], url);
  }
  const candidates = pathCandidates(`${path}:12:4。`);
  assert.deepEqual(
    candidates.map(({ path, line, column }) => ({ path, line, column })),
    [
      { path: `${path}:12:4。`, line: undefined, column: undefined },
      { path, line: 12, column: 4 },
    ],
  );
  assert.deepEqual(
    pathCandidates(`"${path}。"`).map((item) => item.path),
    [`${path}。`],
  );
});

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
