import assert from "node:assert/strict";
import { test } from "node:test";
import type { GitChangeEntry } from "@iori/protocol";
import type { TextRow } from "../reading/TextRows.tsx";
import {
  buildChangesTreeRows,
  formatDiffCommentsForAgent,
  pairDiffRows,
  type DiffComment,
} from "./diff-review.ts";

function makeRow(
  kind: TextRow["kind"],
  text: string,
  lines?: { oldLine?: number; newLine?: number; omitted?: number },
): TextRow {
  return {
    kind,
    text,
    complete: true,
    byteOffset: 0,
    ...lines,
  };
}

function makeEntry(
  path: string,
  overrides: Partial<GitChangeEntry> = {},
): GitChangeEntry {
  return {
    area: "unstaged",
    kind: "modified",
    path,
    absolutePath: `/repo/${path}`,
    ...overrides,
  };
}

test("formatDiffCommentsForAgent returns empty string when there are no comments", () => {
  assert.equal(formatDiffCommentsForAgent([]), "");
});

test("formatDiffCommentsForAgent groups by file, formats single/range lines, and sorts by line", () => {
  const comments: DiffComment[] = [
    {
      id: "c1",
      path: "src/b.ts",
      absolutePath: "/repo/src/b.ts",
      side: "new",
      startLine: 20,
      endLine: 25,
      codeExcerpt: "const x = 1;\nconst y = 2;",
      body: "Extract this into a helper.",
    },
    {
      id: "c2",
      path: "src/a.ts",
      absolutePath: "/repo/src/a.ts",
      side: "old",
      startLine: 10,
      endLine: 10,
      codeExcerpt: "oldCall();",
      body: "Keep the fallback path.",
    },
    {
      id: "c3",
      path: "src/b.ts",
      absolutePath: "/repo/src/b.ts",
      side: "new",
      startLine: 5,
      endLine: 5,
      codeExcerpt: "",
      body: "Check null before accessing.",
    },
  ];

  const output = formatDiffCommentsForAgent(comments);
  assert.ok(
    output.indexOf("### `src/b.ts`") < output.indexOf("### `src/a.ts`"),
  );
  assert.ok(
    output.indexOf("`src/b.ts:L5` (new)") <
      output.indexOf("`src/b.ts:L20-L25` (new)"),
  );
  assert.ok(output.includes("`src/a.ts:L10` (old)"));
  assert.ok(output.includes("const x = 1;\nconst y = 2;"));
  assert.ok(output.includes("Extract this into a helper."));
  assert.ok(output.includes("Check null before accessing."));
  assert.ok(output.includes("Keep the fallback path."));
});

test("formatDiffCommentsForAgent safely fences code excerpts containing triple backticks", () => {
  const output = formatDiffCommentsForAgent([
    {
      id: "c1",
      path: "README.md",
      absolutePath: "/repo/README.md",
      side: "new",
      startLine: 3,
      endLine: 5,
      codeExcerpt: "```ts\nconst a = 1;\n```",
      body: "Update this example.",
    },
  ]);

  assert.ok(output.includes("````\n```ts\nconst a = 1;\n```\n````"));
});

test("pairDiffRows pairs consecutive deleted and added runs and preserves omissions and context", () => {
  const rows: Array<{ sourceIndex: number; row: TextRow }> = [
    {
      sourceIndex: 0,
      row: makeRow("context", "ctx", { oldLine: 1, newLine: 1 }),
    },
    { sourceIndex: 1, row: makeRow("deleted", "del1", { oldLine: 2 }) },
    { sourceIndex: 2, row: makeRow("deleted", "del2", { oldLine: 3 }) },
    { sourceIndex: 3, row: makeRow("added", "add1", { newLine: 2 }) },
    { sourceIndex: 4, row: makeRow("omission", "", { omitted: 12 }) },
    { sourceIndex: 5, row: makeRow("added", "addOnly", { newLine: 15 }) },
    { sourceIndex: 6, row: makeRow("note", "No newline at end of file") },
  ];

  const pairs = pairDiffRows(rows);
  assert.equal(pairs.length, 6);

  assert.equal(pairs[0]?.kind, "pair");
  if (pairs[0]?.kind === "pair") {
    assert.equal(pairs[0].left?.sourceIndex, 0);
    assert.equal(pairs[0].right?.sourceIndex, 0);
  }

  assert.equal(pairs[1]?.kind, "pair");
  if (pairs[1]?.kind === "pair") {
    assert.equal(pairs[1].left?.sourceIndex, 1);
    assert.equal(pairs[1].right?.sourceIndex, 3);
  }

  assert.equal(pairs[2]?.kind, "pair");
  if (pairs[2]?.kind === "pair") {
    assert.equal(pairs[2].left?.sourceIndex, 2);
    assert.equal(pairs[2].right, undefined);
  }

  assert.deepEqual(pairs[3], { kind: "omission", sourceIndex: 4, omitted: 12 });

  assert.equal(pairs[4]?.kind, "pair");
  if (pairs[4]?.kind === "pair") {
    assert.equal(pairs[4].left, undefined);
    assert.equal(pairs[4].right?.sourceIndex, 5);
  }

  assert.equal(pairs[5]?.kind, "pair");
  if (pairs[5]?.kind === "pair") {
    assert.equal(pairs[5].left?.sourceIndex, 6);
    assert.equal(pairs[5].right?.sourceIndex, 6);
  }
});

test("pairDiffRows handles more added lines than deleted lines", () => {
  const rows = [
    { sourceIndex: 0, row: makeRow("deleted", "old", { oldLine: 1 }) },
    { sourceIndex: 1, row: makeRow("added", "new1", { newLine: 1 }) },
    { sourceIndex: 2, row: makeRow("added", "new2", { newLine: 2 }) },
  ];

  const pairs = pairDiffRows(rows);
  assert.equal(pairs.length, 2);
  assert.equal(pairs[0]?.kind, "pair");
  assert.equal(pairs[1]?.kind, "pair");
  if (pairs[0]?.kind === "pair" && pairs[1]?.kind === "pair") {
    assert.equal(pairs[0].left?.sourceIndex, 0);
    assert.equal(pairs[0].right?.sourceIndex, 1);
    assert.equal(pairs[1].left, undefined);
    assert.equal(pairs[1].right?.sourceIndex, 2);
  }
});

test("buildChangesTreeRows compacts single-child folders and orders folders before files", () => {
  const entries = [
    makeEntry("README.md"),
    makeEntry("a/b/c/deep.ts"),
    makeEntry("src/git/ChangesTree.tsx"),
    makeEntry("src/git/SplitDiffView.tsx"),
    makeEntry("src/index.css"),
  ];

  const nodes = buildChangesTreeRows(entries, new Set(), "");
  assert.deepEqual(
    nodes.map((node) =>
      node.kind === "folder"
        ? `D:${node.depth}:${node.path}:${node.label}:${node.count}`
        : `F:${node.depth}:${node.name}:${node.entry.area}`,
    ),
    [
      "D:0:a/b/c:a/b/c:1",
      "F:1:deep.ts:unstaged",
      "D:0:src:src:3",
      "D:1:src/git:git:2",
      "F:2:ChangesTree.tsx:unstaged",
      "F:2:SplitDiffView.tsx:unstaged",
      "F:1:index.css:unstaged",
      "F:0:README.md:unstaged",
    ],
  );
});

test("buildChangesTreeRows respects collapsedFolders, case-insensitive filter, and duplicate paths across areas", () => {
  const entries = [
    makeEntry("src/git/DiffComments.tsx", { area: "staged" }),
    makeEntry("src/git/DiffComments.tsx", { area: "unstaged" }),
    makeEntry("src/other/Foo.tsx"),
  ];

  const collapsed = buildChangesTreeRows(entries, new Set(["src/git"]), "");
  assert.deepEqual(
    collapsed.map((node) =>
      node.kind === "folder"
        ? `D:${node.depth}:${node.path}:${node.count}`
        : `F:${node.depth}:${node.name}:${node.entry.area}`,
    ),
    ["D:0:src:3", "D:1:src/git:2", "D:1:src/other:1", "F:2:Foo.tsx:unstaged"],
  );

  const filtered = buildChangesTreeRows(entries, new Set(), "DIFFCOMMENTS");
  assert.deepEqual(
    filtered.map((node) =>
      node.kind === "folder"
        ? `D:${node.depth}:${node.path}:${node.label}:${node.count}`
        : `F:${node.depth}:${node.name}:${node.entry.area}`,
    ),
    [
      "D:0:src/git:src/git:2",
      "F:1:DiffComments.tsx:staged",
      "F:1:DiffComments.tsx:unstaged",
    ],
  );
});
