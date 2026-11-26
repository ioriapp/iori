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

test("<picture>と<img>をMarkdown画像ノードに変換し、dark/lightのsourceとwidthを反映する", () => {
  const markdown = [
    "<picture>",
    '  <source media="(prefers-color-scheme: dark)" srcset="docs/images/hero-dark.png">',
    '  <source media="(prefers-color-scheme: light)" srcset="docs/images/hero-light.png 1x, docs/images/hero-light@2x.png 2x">',
    '  <img alt="Hero &amp; Preview" src="docs/images/hero-dark.png">',
    "</picture>",
    "",
    '<img alt="Animation" src="docs/images/demo.gif">',
    "",
    "<p>",
    "  <picture>",
    '    <source media="(prefers-color-scheme: dark)" srcset="docs/images/mobile-dark.png">',
    '    <source media="(prefers-color-scheme: light)" srcset="docs/images/mobile-light.png">',
    '    <img alt="Mobile 1" src="docs/images/mobile-dark.png" width="320">',
    "  </picture>",
    "  <picture>",
    '    <source media="(prefers-color-scheme: dark)" srcset="docs/images/mobile2-dark.png">',
    '    <source media="(prefers-color-scheme: light)" srcset="docs/images/mobile2-light.png">',
    '    <img alt="Mobile 2" src="docs/images/mobile2-dark.png" width="320">',
    "  </picture>",
    "</p>",
  ].join("\n");

  const lightTree: MarkdownNode = unified().use(remarkParse).parse(markdown);
  forgeHtml({ theme: "light" })(lightTree);
  const lightImages = nodes(lightTree).filter((node) => node.type === "image");
  assert.deepEqual(
    lightImages.map((node) => ({
      url: node.url,
      alt: node.alt,
      width: node.data?.hProperties?.width,
    })),
    [
      {
        url: "docs/images/hero-light.png",
        alt: "Hero & Preview",
        width: undefined,
      },
      { url: "docs/images/demo.gif", alt: "Animation", width: undefined },
      { url: "docs/images/mobile-light.png", alt: "Mobile 1", width: 320 },
      { url: "docs/images/mobile2-light.png", alt: "Mobile 2", width: 320 },
    ],
  );

  const darkTree: MarkdownNode = unified().use(remarkParse).parse(markdown);
  forgeHtml({ theme: "dark" })(darkTree);
  const darkImages = nodes(darkTree).filter((node) => node.type === "image");
  assert.deepEqual(
    darkImages.map((node) => node.url),
    [
      "docs/images/hero-dark.png",
      "docs/images/demo.gif",
      "docs/images/mobile-dark.png",
      "docs/images/mobile2-dark.png",
    ],
  );
});

test("想定外のHTMLタグを含む<picture>や<script>は画像ノードへ変換しない", () => {
  const markdown = [
    "<picture>",
    "  <script>alert(1)</script>",
    '  <img alt="Bad" src="docs/images/hero-dark.png">',
    "</picture>",
    "",
    "line1<br/>line2",
  ].join("\n");
  const tree: MarkdownNode = unified().use(remarkParse).parse(markdown);
  forgeHtml({ theme: "dark" })(tree);
  assert.deepEqual(
    nodes(tree).filter((node) => node.type === "image"),
    [],
  );
  assert.equal(nodes(tree).filter((node) => node.type === "break").length, 1);
});

test("<img> と <picture> は Host の絶対パスを画像ノードに保持する", () => {
  for (const url of [
    "C:/a.png",
    "D:\\docs\\a.png",
    "file:///C:/a.png",
    "file:///home/a.png",
  ]) {
    const tree = unified()
      .use(remarkParse)
      .parse(
        `<img src="${url}">\n\n<picture><source srcset="${url} 1x"><img src="fallback.png"></picture>`,
      );
    forgeHtml({ theme: "dark" })(tree);
    assert.deepEqual(
      nodes(tree)
        .filter((n) => n.type === "image")
        .map((n) => n.url),
      [url, url],
    );
  }
});
