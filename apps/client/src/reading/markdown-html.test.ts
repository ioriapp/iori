import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import remarkParse from "remark-parse";
import { unified } from "unified";
import { forgeHtml, type MarkdownNode } from "./markdown-html.ts";

// A real Issue body (cli/cli#14691, read 2026-10-22): a workflow's report with
// <details> blocks, one inside a quote, HTML comments inside a list item and at
// the end, and code holding the same characters.
const body = readFileSync(
  new URL("markdown-html.fixture.txt", import.meta.url),
  "utf8",
);

const nodes = (node: MarkdownNode): MarkdownNode[] => [
  node,
  ...(node.children ?? []).flatMap(nodes),
];
const values = (tree: MarkdownNode, type: string) =>
  nodes(tree)
    .filter((node) => node.type === type)
    .map((node) => node.value ?? "");

test("cli/cliのIssueの本文で、HTMLコメントとdetails・summaryのタグを消し、summaryと中の文は段落に残し、コードは元のまま", () => {
  const tree: MarkdownNode = unified().use(remarkParse).parse(body);
  const code = values(tree, "code");
  forgeHtml()(tree);
  assert.deepEqual(
    values(tree, "html").filter((value) =>
      /<!--|<\/?(?:details|summary)\b/iu.test(value),
    ),
    [],
  );
  const text = values(tree, "text");
  for (const summary of [
    "Optimize token consumption",
    "Debug with any coding agent",
    "Manually invoke the agent",
    "Stop reporting this workflow as a failure",
  ])
    assert.ok(text.includes(summary), summary);
  // The comment inside the list item goes; the item's words stay.
  assert.ok(text.some((value) => value.includes("on Oct 21, 2026")));
  assert.equal(
    text.some((value) => value.includes("gh-aw-expires")),
    false,
  );
  assert.deepEqual(values(tree, "code"), code);
});
