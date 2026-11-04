import assert from "node:assert/strict";
import { unified } from "unified";
import remarkParse from "remark-parse";
import GithubSlugger from "github-slugger";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";

const repositoryRoot = path.resolve(import.meta.dirname, "..");

// Check every maintained Markdown file, including new files before staging.
// Git's exclusions keep generated outputs, local evidence and dependencies out.
function maintainedMarkdownFiles(root) {
  return [
    ...new Set(
      execFileSync(
        "git",
        [
          "ls-files",
          "-z",
          "--cached",
          "--others",
          "--exclude-standard",
          "--",
          "*.md",
          // Third-party skills copied from skills.sh keep their own links and formatting.
          ":(exclude).claude/skills/**",
        ],
        { cwd: root, encoding: "utf8" },
      )
        .split("\0")
        .filter(Boolean),
    ),
  ]
    .map((name) => path.join(root, name))
    .filter((file) => fs.existsSync(file));
}

function retiredDocumentationErrors(root) {
  return ["docs/history", "docs/implementation"]
    .filter((name) => fs.existsSync(path.join(root, name)))
    .map(
      (name) =>
        `${name}: historical records belong in Git history, not maintained documentation`,
    );
}

const markdown = unified().use(remarkParse);
function walk(node, visit) {
  visit(node);
  for (const child of node.children ?? []) walk(child, visit);
}
function visibleText(node) {
  if (node.type === "text" || node.type === "inlineCode") return node.value;
  if (node.type === "image") return node.alt ?? "";
  return (node.children ?? []).map(visibleText).join("");
}
function githubHeadingAnchors(source) {
  const anchors = new Set();
  const slugger = new GithubSlugger();
  walk(markdown.parse(source), (node) => {
    if (node.type === "heading") anchors.add(slugger.slug(visibleText(node)));
    if (node.type === "html")
      for (const match of node.value.matchAll(
        /<[^>]+(?:id|name)=["']([^"']+)["'][^>]*>/g,
      ))
        anchors.add(match[1]);
  });
  return anchors;
}
function markdownReferences(source) {
  const references = [];
  const tree = markdown.parse(source);
  walk(tree, (node) => {
    if (
      node.type === "link" ||
      node.type === "image" ||
      node.type === "definition"
    )
      references.push(node.url);
  });
  return references;
}
function withoutFencedCode(source) {
  // Preserve line numbers for table diagnostics while excluding code blocks.
  const lines = source.split(/\r?\n/);
  walk(markdown.parse(source), (node) => {
    if (node.type === "code")
      for (
        let i = node.position.start.line - 1;
        i < node.position.end.line;
        i++
      )
        lines[i] = "";
  });
  return lines.join("\n");
}

function tableErrors(source, displayFile) {
  const errors = [];
  const lines = source.split(/\r?\n/);
  const pipeCount = (line) => (line.match(/(?<!\\)\|/g) ?? []).length;
  const isSeparator = (line) =>
    /^\s*\|?\s*:?-{3,}:?\s*(?:\|\s*:?-{3,}:?\s*)+\|?\s*$/.test(line);

  for (let index = 0; index < lines.length; index += 1) {
    if (!isSeparator(lines[index])) continue;
    const expected = pipeCount(lines[index]);
    if (index === 0 || pipeCount(lines[index - 1]) !== expected) {
      errors.push(
        `${displayFile}:${index + 1}: malformed Markdown table header`,
      );
    }
    for (
      let row = index + 1;
      row < lines.length && lines[row].includes("|");
      row += 1
    ) {
      if (pipeCount(lines[row]) !== expected) {
        errors.push(
          `${displayFile}:${row + 1}: inconsistent Markdown table columns`,
        );
      }
    }
  }
  return errors;
}

function checkFiles(root, files) {
  const errors = [];
  let links = 0;
  for (const file of files) {
    const source = fs.readFileSync(file, "utf8");
    const display = path.relative(root, file);
    errors.push(...tableErrors(withoutFencedCode(source), display));
    const references = markdownReferences(source);
    for (const raw of references) {
      const reference = raw
        .trim()
        .replace(/^<([^>]+)>.*$/, "$1")
        .replace(/\s+["'].*$/, "");
      if (/^(?:[a-z][a-z0-9+.-]*:|\/\/)/i.test(reference)) continue;
      links += 1;
      let targetName, fragment;
      try {
        const split = reference.indexOf("#");
        targetName = decodeURIComponent(
          split < 0 ? reference : reference.slice(0, split),
        );
        fragment =
          split < 0 ? "" : decodeURIComponent(reference.slice(split + 1));
      } catch {
        errors.push(`${display}: invalid link encoding ${reference}`);
        continue;
      }
      const target = targetName
        ? path.resolve(path.dirname(file), targetName)
        : file;
      if (!fs.existsSync(target)) {
        errors.push(`${display}: missing Markdown target ${reference}`);
      } else if (fragment && target.endsWith(".md")) {
        const targetSource = fs.readFileSync(target, "utf8");
        const anchors = githubHeadingAnchors(targetSource);
        if (!anchors.has(fragment))
          errors.push(`${display}: missing Markdown heading ${reference}`);
      }
    }
  }
  return { errors, links, files: files.length };
}

function runSelfTest() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "iori-doc-check-"));
  try {
    fs.mkdirSync(path.join(root, "docs"));
    const target = path.join(root, "docs", "target.md");
    const entry = path.join(root, "README.md");
    fs.writeFileSync(target, "# 日本語 Header\n\n## Again\n\n## Again\n");
    fs.writeFileSync(
      entry,
      "# Fixture\n\n[valid](docs/target.md#日本語-header)\n[duplicate](docs/target.md#again-1)\n[external](https://example.com)\n",
    );
    fs.appendFileSync(
      target,
      "\nSetext Heading\n--------------\n\n## [Linked Heading](https://example.com)\n",
    );
    fs.appendFileSync(
      entry,
      "\n[setext](docs/target.md#setext-heading)\n[linked](docs/target.md#linked-heading)\n`[example](missing-inline-code.md)`\n\n```md\n[example](missing-fenced-code.md)\n```\n",
    );
    assert.deepEqual(checkFiles(root, [entry, target]).errors, []);
    fs.appendFileSync(
      entry,
      "\n[missing](docs/missing.md)\n[bad fragment](docs/target.md#missing)\n[bad encoding](docs/%zz.md)\n\n[ref]: docs/no-ref.md\n\n| A | B |\n| --- | --- |\n| one |\n",
    );
    const failures = checkFiles(root, [entry, target]).errors;
    for (const expected of [
      "missing Markdown target docs/missing.md",
      "missing Markdown heading",
      "invalid link encoding",
      "missing Markdown target docs/no-ref.md",
      "inconsistent Markdown table",
    ])
      assert(
        failures.some((failure) => failure.includes(expected)),
        expected,
      );
    execFileSync("git", ["init", "--quiet", root]);
    fs.writeFileSync(path.join(root, ".gitignore"), ".local/\n");
    fs.mkdirSync(path.join(root, ".local"));
    fs.writeFileSync(
      path.join(root, ".local", "ignored.md"),
      "[bad](missing.md)",
    );
    assert.equal(
      maintainedMarkdownFiles(root).length,
      2,
      "include untracked docs; exclude ignored outputs",
    );
    execFileSync("git", ["add", "README.md"], { cwd: root });
    fs.unlinkSync(entry);
    fs.mkdirSync(path.join(root, "docs", "history"));
    assert.equal(
      retiredDocumentationErrors(root).length,
      1,
      "reject historical documentation",
    );
    assert.equal(
      maintainedMarkdownFiles(root).length,
      1,
      "deleted tracked docs are not current docs",
    );
    console.log(
      "OK: valid links and negative file/heading/encoding/reference/table/scope checks",
    );
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}

if (process.argv.includes("--self-test")) runSelfTest();
else {
  const result = checkFiles(
    repositoryRoot,
    maintainedMarkdownFiles(repositoryRoot),
  );
  result.errors.push(...retiredDocumentationErrors(repositoryRoot));
  if (result.errors.length) {
    result.errors.forEach((error) => console.error(error));
    process.exitCode = 1;
  } else
    console.log(
      `OK: ${result.files} maintained Markdown files; ${result.links} local links`,
    );
}
