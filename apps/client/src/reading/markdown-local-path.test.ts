import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { test } from "node:test";
import remarkParse from "remark-parse";
import { defaultRehypePlugins, type AllowElement } from "streamdown";
import { unified, type Plugin, type PluggableList } from "unified";
import {
  parseStandaloneLocalAbsolutePath,
  resolveStandaloneTarget,
  standaloneRehypePlugins,
} from "./markdown-local-path.ts";
import { markdownRemarkPluginsForTheme } from "./markdown-plugins.ts";

type Root = Extract<Parameters<AllowElement>[2], { type: "root" }>;
// Use the same remark-rehype dependency as Streamdown's renderer.
const streamdownRequire = createRequire(import.meta.resolve("streamdown"));
const parser = unified().use(remarkParse);
const remarkRehype: Plugin<
  [],
  ReturnType<typeof parser.parse>,
  Root
> = streamdownRequire("remark-rehype").default;

function elements(markdown: string, plugins: PluggableList) {
  const processor = parser()
    .use(markdownRemarkPluginsForTheme("light"))
    .use(remarkRehype)
    .use(plugins);
  const root = processor.runSync(processor.parse(markdown));
  const result: Parameters<AllowElement>[0][] = [];
  function visit(parent: Root | Parameters<AllowElement>[0]) {
    for (const child of parent.children) {
      if (child.type !== "element") continue;
      if (child.tagName === "img" || child.tagName === "a") result.push(child);
      visit(child);
    }
  }
  visit(root);
  return result;
}

const localTargets = [
  ["C:/docs/figure.png", "C:/docs/figure.png"],
  [String.raw`c:\docs\figure.png`, String.raw`c:\docs\figure.png`],
  ["C:/a%20b/%2520.png?view#figure", "C:/a b/%20.png"],
  ["file:///C:/docs/figure.png", "C:/docs/figure.png"],
  ["FILE:///C%3A/docs/figure.png", "C:/docs/figure.png"],
  ["file:///home/reader/figure.png", "/home/reader/figure.png"],
] as const;

test("ファイルのタブではドライブの絶対パスと file URI を画像・リンクに使える", () => {
  for (const [target, path] of localTargets) {
    const markdown = [
      `![figure](${target})`,
      `[manual](${target})`,
      `<img src="${target}">`,
      `<picture><source media="(prefers-color-scheme: light)" srcset="${target} 1x"><img src="fallback.png"></picture>`,
    ].join("\n\n");
    const nodes = elements(markdown, standaloneRehypePlugins);
    assert.deepEqual(
      nodes.map((n) => n.tagName),
      ["img", "a", "img", "img"],
    );
    for (const { tagName, properties } of nodes) {
      const raw =
        properties[
          tagName === "img" ? "dataIoriLocalSrc" : "dataIoriLocalHref"
        ];
      assert.equal(typeof raw, "string", target);
      assert.equal(resolveStandaloneTarget(String(raw)), path);
      assert.equal(properties.src ?? properties.href, undefined);
    }
    for (const { properties } of elements(markdown, [
      defaultRehypePlugins.sanitize!,
    ])) {
      assert.equal(properties.src ?? properties.href, undefined);
      assert.equal(
        properties.dataIoriLocalSrc ?? properties.dataIoriLocalHref,
        undefined,
      );
    }
  }
});

test("リモートの file URI、ネットワークパス、ドライブ相対パスとスクリプトは Host に渡さない", () => {
  for (const target of [
    "javascript:bad",
    "vbscript:bad",
    "data:image/png,abc",
    "file://attacker/share/a",
    "file://///attacker/a",
    "file:///%5C%5Cattacker/a",
    "//attacker/share/a",
    String.raw`\\attacker\share\a`,
    "%2F%2Fattacker/share/a",
    "c:relative.png",
    "c%3Arelative.png",
    "file:///bad%FF",
    "bad%FF",
  ]) {
    const nodes = elements(
      `![a](${target})\n\n[a](${target})`,
      standaloneRehypePlugins,
    );
    assert.equal(nodes.length, 2);
    for (const { properties } of nodes) {
      assert.equal(
        properties.dataIoriLocalSrc ?? properties.dataIoriLocalHref,
        undefined,
        target,
      );
      const raw = properties.src ?? properties.href;
      if (typeof raw === "string")
        assert.equal(resolveStandaloneTarget(raw), undefined, target);
    }
  }
});

test("HTML や変換前の要素にある data 属性をローカルの参照先として使わない", () => {
  const nodes = elements(
    '<img src="art.png" data-iori-local-src="C:/fake.png">\n\n[manual](manual.md)',
    [
      // Simulate properties supplied by an earlier Markdown transform.
      () => (tree: Root) => {
        for (const paragraph of tree.children) {
          if (paragraph.type !== "element") continue;
          for (const child of paragraph.children) {
            if (child.type !== "element") continue;
            child.properties.dataIoriLocalSrc = "C:/fake.png";
            child.properties.dataIoriLocalHref = "C:/fake.md";
          }
        }
      },
      ...standaloneRehypePlugins,
    ],
  );
  assert.deepEqual(
    nodes.map((node) => node.properties.src ?? node.properties.href),
    ["art.png", "manual.md"],
  );
  for (const { properties } of nodes) {
    assert.equal(properties.dataIoriLocalSrc, undefined);
    assert.equal(properties.dataIoriLocalHref, undefined);
  }
});

test("相対パス、ホーム、POSIX の絶対パスは通常の Markdown 属性から解決する", () => {
  for (const [raw, expected] of [
    ["../a%20b.png?view#figure", "../a b.png"],
    ["/home/a.png", "/home/a.png"],
    ["~/a.png", "~/a.png"],
    ["~%5Ca.png", "~\\a.png"],
  ] as const) {
    assert.equal(parseStandaloneLocalAbsolutePath(raw), undefined);
    const [image] = elements(`![a](${raw})`, standaloneRehypePlugins);
    assert.equal(
      resolveStandaloneTarget(String(image?.properties.src)),
      expected,
    );
  }
});
