import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdir, symlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";
import { runHostTest } from "../../verification/host/process.mjs";
import { pngBytes } from "../../verification/reading/png.mjs";

async function repository(dataRoot) {
  await symlink(
    execFileSync("which", ["git"], { encoding: "utf8" }).trim(),
    join(dataRoot, "bin", "git"),
  );
  const root = join(dataRoot, "repository");
  await mkdir(root);
  const git = (...args) =>
    execFileSync("git", ["-C", root, ...args], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    }).trim();
  git("init", "-b", "main");
  git("config", "user.name", "Reading E2E");
  git("config", "user.email", "reading@localhost");
  return { root, git };
}

test("変更一覧と差分から追加と削除を読める", (t) =>
  runHostTest(t, async ({ client, dataRoot }) => {
    const { root, git } = await repository(dataRoot);
    await writeFile(join(root, "sample.txt"), "変更前\n");
    git("add", "sample.txt");
    git("commit", "-m", "initial");
    await writeFile(join(root, "sample.txt"), "変更後\n");
    const status = await client.request("git.status", {
      root,
      start: 0,
      count: 20,
    });
    assert.ok(
      status.entries.some(
        (entry) => entry.path === "sample.txt" && entry.area === "unstaged",
      ),
    );
    const source = { kind: "change", area: "unstaged", path: "sample.txt" };
    const diff = await client.request("git.diffRows", {
      root,
      source,
      startRow: 0,
      rowCount: 20,
      byteLimit: 4096,
    });
    assert.ok(
      diff.rows.some((row) => row.kind === "deleted" && row.text === "変更前"),
    );
    assert.ok(
      diff.rows.some((row) => row.kind === "added" && row.text === "変更後"),
    );
  }));

test("履歴とコミットの変更ファイルを読める", (t) =>
  runHostTest(t, async ({ client, dataRoot }) => {
    const { root, git } = await repository(dataRoot);
    await writeFile(join(root, "sample.txt"), "履歴の本文\n");
    git("add", "sample.txt");
    git("commit", "-m", "履歴の変更");
    const history = await client.request("git.history", {
      root,
      start: 0,
      count: 20,
    });
    const commit = history.commits.find(
      (entry) => entry.subject === "履歴の変更",
    );
    assert.ok(commit);
    const detail = await client.request("git.commit", {
      root,
      hash: commit.hash,
    });
    assert.match(detail.message, /履歴の変更/u);
    const files = await client.request("git.commitFiles", {
      root,
      hash: commit.hash,
      start: 0,
      count: 20,
    });
    assert.ok(files.files.some((entry) => entry.path === "sample.txt"));
  }));

test("画像の変更前後を比較元から読み出せる", (t) =>
  runHostTest(t, async ({ client, dataRoot }) => {
    const { root, git } = await repository(dataRoot);
    const before = pngBytes(8, 6);
    const after = pngBytes(5, 4);
    await writeFile(join(root, "image.png"), before);
    git("add", "image.png");
    git("commit", "-m", "initial");
    await writeFile(join(root, "image.png"), after);
    const source = { kind: "change", area: "unstaged", path: "image.png" };
    for (const [side, expected] of [
      ["old", before],
      ["new", after],
    ]) {
      const info = await client.request("git.imageInfo", {
        root,
        source,
        side,
      });
      assert.equal(info.present, true);
      const result = await client.request("git.imageRead", {
        root,
        source,
        side,
        offset: 0,
        length: 4096,
      });
      assert.deepEqual(Buffer.from(result.bytesBase64, "base64"), expected);
    }
  }));
