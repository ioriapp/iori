import { execFileSync } from "node:child_process";
import assert from "node:assert/strict";
import {
  chmod,
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  readlink,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test, { type TestContext } from "node:test";
import { handleFileRead } from "./files-reading.ts";
import { handleFileManage } from "./files-manage.ts";

async function fixture(t: TestContext) {
  const base = await mkdtemp(join(tmpdir(), "iori-files-manage-"));
  t.after(() => rm(base, { recursive: true, force: true }));
  const root = join(base, "work");
  await mkdir(root);
  const frame = { kind: "request", operationId: "manage" } as const;
  return {
    base,
    root,
    save: (
      path: string,
      content: string | Buffer,
      expectedRevision?: string,
      force?: boolean,
    ) =>
      handleFileManage({
        ...frame,
        method: "files.write",
        params: {
          root,
          path,
          contentBase64: Buffer.from(content).toString("base64"),
          expectedRevision,
          force,
        },
      }),
    create: (path: string, kind: "directory" | "file" = "file") =>
      handleFileManage({
        ...frame,
        method: "files.create",
        params: { root, path, kind },
      }),
    rename: (from: string, to: string) =>
      handleFileManage({
        ...frame,
        method: "files.rename",
        params: { root, from, to },
      }),
    duplicate: (path: string) =>
      handleFileManage({
        ...frame,
        method: "files.duplicate",
        params: { root, path },
      }),
    remove: (path: string) =>
      handleFileManage({
        ...frame,
        method: "files.delete",
        params: { root, path },
      }),
  };
}

test("入れ子のファイルを作成し、名前の変更・移動・複製・削除ができる", async (t) => {
  const { root, create, rename, duplicate, remove } = await fixture(t);
  await create("src/lib/note.ts");
  assert.equal(await readFile(join(root, "src/lib/note.ts"), "utf8"), "");
  await writeFile(join(root, "src/lib/note.ts"), "content");
  await rename("src/lib/note.ts", "src/lib/title.ts");
  await create("dest/nested", "directory");
  await rename("src/lib/title.ts", "dest/nested/file.ts");
  assert.deepEqual(await readdir(join(root, "src/lib")), []);
  for (const name of ["file copy.ts", "file copy 2.ts"]) {
    const path = "dest/nested/" + name;
    assert.deepEqual(await duplicate("dest/nested/file.ts"), {
      path,
      absolutePath: join(root, path),
      kind: "file",
    });
    assert.equal(await readFile(join(root, path), "utf8"), "content");
  }
  await create("dest copy", "directory");
  await duplicate("dest");
  assert.deepEqual(await readdir(join(root, "dest copy")), []);
  assert.equal(
    await readFile(join(root, "dest copy 2/nested/file.ts"), "utf8"),
    "content",
  );
  await remove("dest/nested/file.ts");
  await remove("dest copy 2");
  for (const path of ["dest/nested/file.ts", "dest copy 2"])
    await assert.rejects(lstat(join(root, path)), { code: "ENOENT" });
  for (const name of [".env", "README"]) {
    await create(name);
    await duplicate(name);
    assert.ok((await lstat(join(root, name + " copy"))).isFile());
  }
});

test("作成・移動は既存の項目を保護し、無効なパスと存在しないパスを区別する", async (t) => {
  const { root, create, rename, duplicate, remove } = await fixture(t);
  await create("src/item");
  await writeFile(join(root, "src/item"), "keep");
  await create("other");
  for (const path of ["src/item", "src"])
    await assert.rejects(create(path), { code: "put_exists" });
  await assert.rejects(rename("other", "src/item"), { code: "put_exists" });
  assert.equal(await readFile(join(root, "src/item"), "utf8"), "keep");
  await assert.rejects(create("src/item/nested"), { code: "not_a_directory" });
  for (const args of [
    ["src", "src"],
    ["src", "src/sub"],
  ] as const)
    await assert.rejects(rename(args[0], args[1]), { code: "invalid_request" });
  for (const path of ["", "..", "src/../other"])
    await assert.rejects(remove(path), { code: "invalid_request" });
  for (const operation of [
    () => rename("missing", "other2"),
    () => rename("other", "missing/child"),
    () => duplicate("missing"),
    () => remove("missing"),
  ])
    await assert.rejects(operation(), { code: "path_not_found" });
});

test("フォルダー外へ出るリンクを経由した操作を拒否し、リンクの削除では参照先を残す", async (t) => {
  const { base, root, create, rename, duplicate, remove } = await fixture(t);
  const outside = join(base, "outside");
  await mkdir(outside);
  await writeFile(join(outside, "item"), "keep");
  await symlink(outside, join(root, "link"), "dir");
  await create("inside");
  for (const operation of [
    () => create("link/nested/file"),
    () => rename("inside", "link/moved"),
    () => rename("link/item", "moved"),
    () => duplicate("link"),
    () => remove("link/item"),
  ])
    await assert.rejects(operation(), { code: "path_outside_root" });
  await assert.rejects(create("link", "directory"), { code: "put_exists" });
  await remove("link");
  assert.deepEqual(await readdir(outside), ["item"]);
  assert.equal(await readFile(join(outside, "item"), "utf8"), "keep");
  await symlink("inside", join(root, "local-link"), "file");
  await duplicate("local-link");
  assert.equal(await readlink(join(root, "local-link copy")), "inside");
  await remove("local-link");
  assert.ok((await lstat(join(root, "inside"))).isFile());
});

test("テキストの保存は権限と改行を保ち、外部変更と削除を検出する", async (t) => {
  const { root, save } = await fixture(t);
  const path = "script";
  const target = join(root, path);
  await writeFile(target, "original");
  await chmod(target, 0o755);
  const info = () => handleFileRead("files.info", { root, path });
  const initial = await info();
  const text = "日本語\r\nlast\r\n";
  const saved = await save(path, text, initial.revision);
  const after = await info();
  assert.deepEqual(saved, {
    revision: after.revision,
    modifiedAtMs: after.modifiedAtMs,
    sizeBytes: Buffer.byteLength(text),
  });
  assert.equal(await readFile(target, "utf8"), text);
  if (process.platform !== "win32")
    assert.equal((await lstat(target)).mode & 0o777, 0o755);
  await writeFile(target, "changed outside");
  await assert.rejects(save(path, "", after.revision), {
    code: "file_conflict",
  });
  assert.equal(await readFile(target, "utf8"), "changed outside");
  await save(path, "", after.revision, true);
  assert.equal(await readFile(target, "utf8"), "");
  await rm(target);
  await assert.rejects(save(path, "new", after.revision), {
    code: "path_not_found",
  });
  await save(path, "new", after.revision, true);
  assert.equal(await readFile(target, "utf8"), "new");
});

test("テキストの保存はリンク・フォルダー・不正な UTF-8・上限を超える内容を拒否する", async (t) => {
  const { root, base, save } = await fixture(t);
  const outside = join(base, "outside");
  await writeFile(outside, "outside");
  await writeFile(join(root, "file"), "original");
  await mkdir(join(root, "dir"));
  await symlink(outside, join(root, "external"), "file");
  await symlink("file", join(root, "internal"), "file");
  await symlink("missing", join(root, "broken"), "file");
  for (const name of ["internal", "broken", "dir"])
    await assert.rejects(save(name, "x", undefined, true), {
      code: "put_not_a_file",
    });
  await assert.rejects(save("external", "x", undefined, true), {
    code: "path_outside_root",
  });
  for (const bytes of [Buffer.from([0xff]), Buffer.alloc(2_500_001)])
    await assert.rejects(save("file", bytes), { code: "invalid_request" });
  assert.equal(await readFile(join(root, "file"), "utf8"), "original");
  assert.equal(await readFile(outside, "utf8"), "outside");
});

test("全文検索で対象を絞り込み、一致位置とプレビューを返す", async (t) => {
  const { root, base } = await fixture(t);
  execFileSync("git", ["init", "--quiet"], { cwd: root });
  await mkdir(join(root, "src"));
  const path = "src/main";
  const target = join(root, path);
  const prefix = "x".repeat(400) + "😀";
  await writeFile(target, "\ufeffAb.c\r\n" + prefix + "ab.c\r\n");
  await writeFile(join(root, "other"), "ab.c");
  await writeFile(join(root, ".gitignore"), "ignored\n");
  await writeFile(join(root, "ignored"), "ab.c");
  await writeFile(join(root, ".git", "private"), "ab.c");
  const binary = Buffer.alloc(8192, 0x20);
  binary.write("ab.c");
  binary[8191] = 0;
  await writeFile(join(root, "binary"), binary);
  await writeFile(join(base, "outside"), "ab.c");
  await symlink(join(base, "outside"), join(root, "link"), "file");
  const search = (
    options: {
      query?: string;
      caseSensitive?: boolean;
      regex?: boolean;
      folder?: string;
      maxResults?: number;
    } = {},
  ) =>
    handleFileRead("files.searchWorkspace", {
      root,
      query: "ab.c",
      caseSensitive: false,
      ...options,
    });
  const result = await search();
  assert.equal(result.truncated, false);
  assert.equal(result.fileCount, 2);
  assert.deepEqual(result.matches.map((m) => m.path).sort(), [
    "other",
    path,
    path,
  ]);
  const scoped = await search({ folder: "src" });
  assert.deepEqual(scoped.matches[0], {
    path,
    absolutePath: target,
    line: 1,
    column: 0,
    length: 4,
    text: "Ab.c",
    previewColumn: 0,
  });
  const literal = await search({ folder: "src", caseSensitive: true });
  assert.equal(literal.matches.length, 1);
  const [hit] = literal.matches;
  assert.ok(hit);
  assert.equal(hit.line, 2);
  assert.equal(hit.column, prefix.length);
  assert.ok(hit.text.length <= 300);
  assert.equal(hit.text.slice(hit.previewColumn), "ab.c");
  assert.equal(
    (await search({ folder: "src", query: "ab[.]c$", regex: true })).matches
      .length,
    2,
  );
  assert.equal(
    (await search({ folder: "src", query: "^", regex: true })).matches.length,
    2,
  );
  await assert.rejects(search({ regex: true, query: "[" }), {
    code: "invalid_request",
  });
  await assert.rejects(search({ folder: "other" }), {
    code: "not_a_directory",
  });
  const limited = await search({ maxResults: 1 });
  assert.equal(limited.truncated, true);
  assert.equal(limited.matches.length, 1);
});
