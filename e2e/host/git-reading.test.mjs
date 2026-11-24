import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { lstat, mkdir, readFile, symlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";
import { linkGit } from "../../verification/host/environment.mjs";
import { runHostTest } from "../../verification/host/process.mjs";
import { pngBytes } from "../../verification/reading/png.mjs";

async function repository(dataRoot) {
  await linkGit(join(dataRoot, "bin"));
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

test("Gitの変更通知を受けた後は一覧の途中から最新の変更を読める", (t) =>
  runHostTest(t, async ({ client, dataRoot }) => {
    const { root } = await repository(dataRoot);
    await writeFile(join(root, "a.txt"), "");
    await writeFile(join(root, "c.txt"), "");
    const watch = await client.readingWatch(root, "git");
    const ready = await watch.waitFor(
      (event) =>
        event.ok === false ||
        (event.type === "reading.changed" && !event.paths),
    );
    assert.equal(ready.type, "reading.changed");
    const first = await client.request("git.status", {
      root,
      start: 0,
      count: 1,
    });
    assert.equal(first.entries[0].path, "a.txt");
    await writeFile(join(root, "b.txt"), "");
    const changed = await watch.waitFor(
      (event) =>
        event.ok === false ||
        (event.type === "reading.changed" && event.paths?.includes("b.txt")),
    );
    assert.equal(changed.type, "reading.changed");
    const second = await client.request("git.status", {
      root,
      start: 1,
      count: 1,
    });
    assert.equal(second.counts.untracked, 3);
    assert.equal(second.entries[0].path, "b.txt");
    await watch.close();
  }));

test("画像の変更前後を比較元から読み出せる", (t) =>
  runHostTest(t, async ({ client, dataRoot }) => {
    const { root, git } = await repository(dataRoot);
    const before = pngBytes(8, 6);
    const after = pngBytes(5, 4);
    await writeFile(join(root, "image.png"), before);
    git("add", "image.png");
    git("commit", "-m", "initial");
    git("switch", "-c", "topic");
    const staged = pngBytes(4, 3);
    await writeFile(join(root, "image.png"), staged);
    git("add", "image.png");
    await writeFile(join(root, "image.png"), after);
    const branch = { kind: "branch", base: "main", path: "image.png" };
    const unstaged = { kind: "change", area: "unstaged", path: branch.path };
    for (const [source, side, expected] of [
      [unstaged, "old", staged],
      [unstaged, "new", after],
      [branch, "old", before],
      [branch, "new", after],
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

test("ブランチの起点から作業ツリーまでの変更を色分けして読める", (t) =>
  runHostTest(t, async ({ client, dataRoot }) => {
    const { root, git } = await repository(dataRoot);
    const path = "sample.ts";
    const body = (first, last) => [first, "// unchanged", last, ""].join("\n");
    await writeFile(
      join(root, path),
      body('export const label = "before";', "const count = 1;"),
    );
    git("add", ".");
    git("commit", "-m", "base");
    const mergeBase = git("rev-parse", "HEAD");
    git("branch", "topic");
    await writeFile(join(root, "main-only"), "main\n");
    git("add", ".");
    git("commit", "-m", "advance main");
    git("switch", "topic");
    await writeFile(
      join(root, path),
      body("export const label = 42;", "const count = 1;"),
    );
    git("add", ".");
    git("commit", "-m", "topic");
    await writeFile(
      join(root, path),
      body("export const label = 42;", "const count = 2;"),
    );
    await writeFile(join(root, "staged"), "staged\n");
    git("add", "staged");
    await writeFile(join(root, "draft"), "untracked\n");
    const branches = await client.request("git.branches", { root });
    assert.equal(branches.current, "topic");
    assert.equal(branches.defaultBase, "main");
    const base = branches.defaultBase;
    const changes = await client.request("git.branchChanges", {
      root,
      base,
      start: 0,
      count: 20,
    });
    assert.equal(changes.mergeBase, mergeBase);
    assert.equal(changes.total, 3);
    assert.deepEqual(
      changes.entries.map(({ path, kind }) => [path, kind]).sort(),
      [
        ["draft", "untracked"],
        [path, "modified"],
        ["staged", "added"],
      ],
    );
    const change = changes.entries.find((entry) => entry.path === path);
    assert.deepEqual([change.addedLines, change.removedLines], [2, 2]);
    const source = { kind: "branch", path, base };
    const opened = await client.request("git.diffOpen", { root, source });
    const page = { root, source, startRow: 0, rowCount: 20 };
    const { rows } = await client.request("git.diffRows", {
      ...page,
      byteLimit: 4096,
    });
    assert.deepEqual(
      rows.map(({ kind }) => kind),
      ["deleted", "added", "context", "deleted", "added"],
    );
    assert.deepEqual(opened.hunks, [0, 3]);
    const found = await client.request("git.diffSearch", {
      root,
      source,
      query: "before",
      caseSensitive: true,
      direction: "forward",
      from: { row: 0, column: 0 },
    });
    assert.equal(found.match?.row, 0);
    const copied = await client.request("git.diffRead", {
      root,
      source,
      offset: found.match.byteOffset,
      length: found.match.byteLength,
    });
    assert.equal(
      Buffer.from(copied.bytesBase64, "base64").toString("utf8"),
      "before",
    );
    const syntax = await client.request("git.diffSyntax", page);
    assert.equal(syntax.revision, opened.revision);
    assert.equal(syntax.endRow, rows.length);
    for (const [row, token, kind] of [
      [0, '"before"', "string"],
      [1, "42", "number"],
      [2, "// unchanged", "comment"],
    ]) {
      const spans = syntax.rows.find((entry) => entry.row === row)?.spans;
      assert.ok(
        spans?.some(
          ([column, length, tokenKind]) =>
            tokenKind === kind &&
            rows[row].text.slice(column, column + length) === token,
        ),
      );
    }
    const draft = await client.request("git.diffRows", {
      ...page,
      source: { ...source, path: "draft", untracked: true },
      byteLimit: 4096,
    });
    assert.deepEqual(
      draft.rows.map(({ kind, text }) => [kind, text]),
      [["added", "untracked"]],
    );
  }));

test("ファイルごと・全件のステージと解除、初回コミットと修正", (t) =>
  runHostTest(t, async ({ client, dataRoot }) => {
    const { root, git } = await repository(dataRoot);
    const write = (method, params) =>
      client.request(method, { root, ...params });
    for (const file of ["one", "two"])
      await writeFile(join(root, file), "initial\n");
    const checkSelection = async () => {
      assert.ok((await write("git.stage", { paths: ["two"] })).ok);
      assert.equal(git("diff", "--cached", "--name-only"), "two");
      assert.ok((await write("git.unstage", { paths: ["two"] })).ok);
      assert.equal(git("diff", "--cached", "--name-only"), "");
      assert.ok((await write("git.stage", { all: true })).ok);
      assert.equal(git("diff", "--cached", "--name-only"), "one\ntwo");
      assert.ok((await write("git.unstage", { all: true })).ok);
      assert.equal(git("diff", "--cached", "--name-only"), "");
    };
    await checkSelection();
    assert.deepEqual(await write("git.createCommit", { message: "empty" }), {
      ok: false,
      message: "No staged changes to commit.",
    });
    assert.ok((await write("git.stage", { all: true })).ok);
    const message = "initial's subject\n\na body with $vars";
    const created = await write("git.createCommit", { message });
    assert.deepEqual(created, { ok: true, hash: git("rev-parse", "HEAD") });
    assert.equal(git("log", "-1", "--format=%B"), message);
    const amended = await write("git.createCommit", {
      message: "amended",
      amend: true,
    });
    assert.deepEqual(amended, { ok: true, hash: git("rev-parse", "HEAD") });
    assert.notEqual(amended.hash, created.hash);
    assert.equal(git("rev-list", "--count", "HEAD"), "1");
    for (const file of ["one", "two"])
      await writeFile(join(root, file), "changed\n");
    await checkSelection();
  }));

test("選択した差分だけをステージ・解除・破棄できる", (t) =>
  runHostTest(t, async ({ client, dataRoot }) => {
    const { root, git } = await repository(dataRoot);
    const path = "変更 [1].txt";
    const base =
      Array.from({ length: 22 }, (_, i) => String(i)).join("\n") + "\n";
    const first = base.replace("1\n", "first\n").replace("3\n", "nearby\n");
    const second = base.replace("20\n", "second\n");
    const both = first.replace("20\n", "second\n");
    await writeFile(join(root, path), base);
    git("add", ".");
    git("commit", "-m", "base");
    await writeFile(join(root, path), both);
    const opened = await client.request("git.diffOpen", {
      root,
      source: { kind: "change", area: "unstaged", path },
    });
    assert.deepEqual(
      opened.patchHunks.map((hunk) => hunk.row),
      [0, 19],
    );
    assert.equal(opened.hunks.length, 3);
    const apply = (
      action,
      hunkIndex = 0,
      expectedFingerprint = opened.patchHunks[hunkIndex]?.fingerprint,
    ) =>
      client.request("git.applyHunk", {
        root,
        path,
        action,
        hunkIndex,
        expectedFingerprint,
      });
    assert.deepEqual(await apply("discard", 2), {
      ok: false,
      message: "Hunk is no longer available.",
    });
    await writeFile(join(root, path), second);
    assert.deepEqual(await apply("discard"), {
      ok: false,
      message: "Diff has changed. Reload and try again.",
    });
    assert.equal(await readFile(join(root, path), "utf8"), second);
    await writeFile(join(root, path), both);
    assert.ok((await apply("stage")).ok);
    assert.equal(git("show", ":" + path), first.trimEnd());
    git("add", ".");
    assert.ok((await apply("unstage")).ok);
    assert.equal(git("show", ":" + path), second.trimEnd());
    git("reset", "-q", "HEAD");
    assert.ok((await apply("discard")).ok);
    assert.equal(await readFile(join(root, path), "utf8"), second);
  }));

test("変更の破棄でステージ済みの内容とリンク先を保つ", (t) =>
  runHostTest(t, async ({ client, dataRoot }) => {
    const { root, git } = await repository(dataRoot);
    const path = join(root, "tracked");
    await writeFile(path, "base");
    git("add", ".");
    git("commit", "-m", "base");
    await writeFile(path, "index");
    git("add", ".");
    await writeFile(path, "worktree");
    const discard = (paths, untracked = false) =>
      client.request("git.discard", { root, paths, untracked });
    assert.equal((await discard(["tracked"], true)).ok, false);
    assert.equal(await readFile(path, "utf8"), "worktree");
    assert.ok((await discard(["tracked"])).ok);
    assert.equal(await readFile(path, "utf8"), "index");
    const outside = join(dataRoot, "outside");
    await writeFile(outside, "keep");
    await symlink(outside, join(root, "link"), "file");
    await writeFile(join(root, "draft"), "remove");
    assert.ok((await discard(["draft", "link"], true)).ok);
    for (const file of ["draft", "link"])
      await assert.rejects(lstat(join(root, file)), { code: "ENOENT" });
    assert.equal(await readFile(outside, "utf8"), "keep");
  }));

test("上流の設定、取得、fast-forward と分岐した履歴の保護", (t) =>
  runHostTest(t, async ({ client, dataRoot }) => {
    const { root, git } = await repository(dataRoot);
    const remote = join(dataRoot, "remote.git");
    git("init", "--bare", "-b", "main", remote);
    git("remote", "add", "upstream", remote);
    git("commit", "--allow-empty", "-m", "local");
    const request = (method) => client.request(method, { root });
    assert.ok((await request("git.push")).ok);
    assert.equal(
      git("rev-parse", "--abbrev-ref", "@{upstream}"),
      "upstream/main",
    );
    const local = git("rev-parse", "HEAD");
    assert.equal(git("--git-dir=" + remote, "rev-parse", "main"), local);
    const other = join(dataRoot, "other");
    git("clone", remote, other);
    const advance = () => {
      git(
        "-C",
        other,
        "-c",
        "user.name=Peer",
        "-c",
        "user.email=peer@localhost",
        "commit",
        "--allow-empty",
        "-m",
        "peer",
      );
      git("-C", other, "push");
      return git("-C", other, "rev-parse", "HEAD");
    };
    const next = advance();
    assert.ok((await request("git.fetch")).ok);
    assert.equal(git("rev-parse", "@{upstream}"), next);
    assert.equal(git("rev-parse", "HEAD"), local);
    assert.ok((await request("git.pull")).ok);
    assert.equal(git("rev-parse", "HEAD"), next);
    git("commit", "--allow-empty", "-m", "diverged");
    const divergent = git("rev-parse", "HEAD");
    const remoteHead = advance();
    const pull = await request("git.pull");
    assert.equal(pull.ok, false);
    assert.match(pull.message, /fast.forward/iu);
    assert.equal(git("rev-parse", "HEAD"), divergent);
    git("config", "remote.upstream.push", "+refs/heads/main:refs/heads/main");
    assert.equal((await request("git.push")).ok, false);
    assert.equal(git("--git-dir=" + remote, "rev-parse", "main"), remoteHead);
    git("config", "remote.upstream.mirror", "true");
    assert.equal((await request("git.push")).ok, false);
    assert.equal(git("--git-dir=" + remote, "rev-parse", "main"), remoteHead);
  }));
