import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import {
  chmod,
  mkdir,
  readFile,
  readdir,
  stat,
  symlink,
  writeFile,
} from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";
import { runHostTest } from "../../verification/host/process.mjs";

async function folder(dataRoot) {
  const root = join(dataRoot, "reading");
  await mkdir(root);
  return root;
}

test("フォルダー一覧と本文をClientの通信から読める", (t) =>
  runHostTest(t, async ({ client, dataRoot }) => {
    const root = await folder(dataRoot);
    await mkdir(join(root, "inside"));
    await writeFile(join(root, "sample.txt"), "一行目\n二行目\n");
    const listing = await client.request("files.list", {
      root,
      path: "",
      start: 0,
      count: 20,
    });
    assert.deepEqual(
      listing.entries.map(({ name, kind }) => [name, kind]),
      [
        ["inside", "directory"],
        ["sample.txt", "file"],
      ],
    );
    const result = await client.request("files.lineRange", {
      root,
      path: "sample.txt",
      startLine: 1,
      lineCount: 10,
      byteLimit: 4096,
    });
    assert.deepEqual(
      result.lines.map(({ text }) => text),
      ["一行目", "二行目"],
    );
  }));

test("一覧とファイル名の絞り込みに.gitなどを出さず、直接指せば読める", (t) =>
  runHostTest(t, async ({ client, dataRoot }) => {
    const root = await folder(dataRoot);
    await symlink(
      execFileSync("which", ["git"], { encoding: "utf8" }).trim(),
      join(dataRoot, "bin", "git"),
    );
    execFileSync("git", ["-C", root, "init", "-q", "-b", "main"]);
    await writeFile(join(root, ".git", "direct.txt"), "git内部\n");
    await writeFile(join(root, ".DS_Store"), "ds\n");
    await mkdir(join(root, "sub"));
    await writeFile(join(root, "sub", "Thumbs.db"), "thumb\n");
    await writeFile(join(root, "sub", "visible.txt"), "見える\n");
    const listing = await client.request("files.list", {
      root,
      path: "",
      start: 0,
      count: 20,
    });
    assert.deepEqual(
      listing.entries.map(({ name }) => name),
      ["sub"],
    );
    const subListing = await client.request("files.list", {
      root,
      path: "sub",
      start: 0,
      count: 20,
    });
    assert.deepEqual(
      subListing.entries.map(({ name }) => name),
      ["visible.txt"],
    );
    for (const query of ["direct", "DS_Store", "Thumbs"]) {
      const found = await client.request("files.find", {
        root,
        query,
        start: 0,
        count: 20,
      });
      assert.deepEqual(found.entries, []);
    }
    const foundVisible = await client.request("files.find", {
      root,
      query: "visible",
      start: 0,
      count: 20,
    });
    assert.deepEqual(
      foundVisible.entries.map(({ path }) => path),
      ["sub/visible.txt"],
    );
    const direct = await client.request("files.read", {
      root,
      path: ".git/direct.txt",
      offset: 0,
      length: 128,
    });
    assert.equal(
      Buffer.from(direct.bytesBase64, "base64").toString(),
      "git内部\n",
    );
  }));

test("フォルダーの外へ出るパスと外を指すリンクを読めない", (t) =>
  runHostTest(t, async ({ client, dataRoot }) => {
    const root = await folder(dataRoot);
    await writeFile(join(dataRoot, "outside.txt"), "outside");
    await symlink(join(dataRoot, "outside.txt"), join(root, "link.txt"));
    for (const [path, code] of [
      ["../outside.txt", "invalid_request"],
      ["link.txt", "path_outside_root"],
    ]) {
      await assert.rejects(
        client.request("files.read", { root, path, offset: 0, length: 128 }),
        new RegExp(`\\(${code}\\)`, "u"),
      );
    }
  }));

test("転送したファイルは内容を保って保存される", (t) =>
  runHostTest(t, async ({ client, dataRoot }) => {
    const root = await folder(dataRoot);
    const sessionId = randomUUID();
    const uploadId = randomUUID();
    await client.request("files.put.session", { sessionId });
    await client.request("files.put.begin", {
      sessionId,
      uploadId,
      root,
      path: "input.txt",
      replace: false,
    });
    const contents = Buffer.from("転送した内容\n");
    await client.request("files.put.chunk", {
      sessionId,
      uploadId,
      offset: 0,
      data: contents.toString("base64"),
    });
    await client.request("files.put.finish", { sessionId, uploadId });
    assert.deepEqual(await readFile(join(root, "input.txt")), contents);
    const downloaded = await client.request("files.read", {
      root,
      path: "input.txt",
      offset: 0,
      length: 128,
    });
    assert.deepEqual(Buffer.from(downloaded.bytesBase64, "base64"), contents);
  }));

test("転送先がフォルダーの外へ逃げるパスを拒む", (t) =>
  runHostTest(t, async ({ client, dataRoot }) => {
    const root = await folder(dataRoot);
    const sessionId = randomUUID();
    await client.request("files.put.session", { sessionId });
    await symlink(dataRoot, join(root, "outside"));
    for (const path of ["../outside.txt", "outside/outside.txt"]) {
      await assert.rejects(
        client.request("files.put.begin", {
          sessionId,
          uploadId: randomUUID(),
          root,
          path,
          replace: false,
        }),
        /\(path_outside_root\)/u,
      );
    }
  }));

test("転送を取り消すと元のファイルを残す", (t) =>
  runHostTest(t, async ({ client, dataRoot }) => {
    const root = await folder(dataRoot);
    await writeFile(join(root, "input.txt"), "元の内容");
    const sessionId = randomUUID();
    const uploadId = randomUUID();
    await client.request("files.put.session", { sessionId });
    await client.request("files.put.begin", {
      sessionId,
      uploadId,
      root,
      path: "input.txt",
      replace: true,
    });
    await client.request("files.put.chunk", {
      sessionId,
      uploadId,
      offset: 0,
      data: Buffer.from("新しい内容").toString("base64"),
    });
    await client.request("files.put.cancel", { sessionId, uploadId });
    assert.equal(await readFile(join(root, "input.txt"), "utf8"), "元の内容");
    assert.deepEqual(await readdir(root), ["input.txt"]);
  }));

test("既存ファイルへの転送は権限を保って置き換える", (t) =>
  runHostTest(t, async ({ client, dataRoot }) => {
    const root = await folder(dataRoot);
    const path = join(root, "input.txt");
    await writeFile(path, "元の内容");
    await chmod(path, 0o640);
    const sessionId = randomUUID();
    const uploadId = randomUUID();
    await client.request("files.put.session", { sessionId });
    await client.request("files.put.begin", {
      sessionId,
      uploadId,
      root,
      path: "input.txt",
      replace: true,
    });
    await client.request("files.put.chunk", {
      sessionId,
      uploadId,
      offset: 0,
      data: Buffer.from("新しい内容").toString("base64"),
    });
    await client.request("files.put.finish", { sessionId, uploadId });
    assert.equal(await readFile(path, "utf8"), "新しい内容");
    assert.equal((await stat(path)).mode & 0o777, 0o640);
  }));

test("同じ大きさの外部変更を監視中のClientへ知らせる", (t) =>
  runHostTest(t, async ({ client, dataRoot }) => {
    const root = await folder(dataRoot);
    await writeFile(join(root, "sample.txt"), "変更前\n");
    const watch = await client.readingWatch(root, "files");
    const initial = await watch.waitFor(
      (event) =>
        event.ok === false ||
        (event.type === "reading.changed" && !event.paths),
    );
    assert.equal(initial.type, "reading.changed");
    await writeFile(join(root, "sample.txt"), "変更後\n");
    const changed = await watch.waitFor(
      (event) =>
        event.ok === false ||
        (event.type === "reading.changed" &&
          event.paths?.includes("sample.txt")),
    );
    assert.equal(changed.type, "reading.changed");
    const result = await client.request("files.read", {
      root,
      path: "sample.txt",
      offset: 0,
      length: 128,
    });
    assert.equal(
      Buffer.from(result.bytesBase64, "base64").toString(),
      "変更後\n",
    );
  }));
