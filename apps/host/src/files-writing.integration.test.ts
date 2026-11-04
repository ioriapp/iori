import { spawnSync } from "node:child_process";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import {
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { FileUploads, FilePutFailure } from "./files-writing.ts";

// The UI cannot submit traversal paths, or create external symlinks.
test("ファイルを置く入口はRoot外へのパス・外を指すフォルダー・symlinkへの書込みを残さない", async () => {
  const base = await mkdtemp(join(tmpdir(), "iori-put-boundary-"));
  const root = join(base, "root");
  const outside = join(base, "outside");
  const uploads = new FileUploads(join(base, "storage"));
  try {
    await uploads.request("device", "files.put.session", { sessionId: "app" });
    await mkdir(root);
    await mkdir(outside);
    await writeFile(join(outside, "original.txt"), "untouched");
    await symlink(
      outside,
      join(root, "portal"),
      process.platform === "win32" ? "junction" : "dir",
    );
    await symlink(join(outside, "original.txt"), join(root, "alias.txt"));
    for (const path of [
      "../outside/original.txt",
      join(outside, "original.txt"),
      "portal/original.txt",
      "alias.txt",
      "portal",
      "C:/outside.txt",
      "a\0.txt",
      ...(process.platform === "win32"
        ? ["NUL.txt", "aux", "..\\outside\\original.txt"]
        : []),
    ]) {
      await assert.rejects(
        uploads.request("device", "files.put.begin", {
          sessionId: "app",
          root,
          path,
          uploadId: randomUUID(),
          replace: true,
        }),
        (error: unknown) =>
          error instanceof FilePutFailure &&
          ["path_outside_root", "put_not_a_file", "put_failed"].includes(
            error.code,
          ),
      );
    }
    assert.equal(
      await readFile(join(outside, "original.txt"), "utf8"),
      "untouched",
    );
    assert.equal(
      (await readdir(root)).some((name) => name.startsWith(".iori-put-")),
      false,
    );
  } finally {
    await uploads.close();
    await rm(base, { recursive: true, force: true });
  }
});

// E2E cannot force two deliveries of one chunk to execute concurrently after a lost acknowledgement.
test("同じ断片の同時配送で二重に書かず応答済みの総byte数から続けられる", async () => {
  const root = await mkdtemp(join(tmpdir(), "iori-put-replay-"));
  const uploads = new FileUploads(join(root, "storage"));
  const uploadId = randomUUID();
  try {
    await uploads.request("device", "files.put.session", { sessionId: "app" });
    await uploads.request("device", "files.put.begin", {
      sessionId: "app",
      root,
      path: "result.txt",
      uploadId,
      replace: false,
    });
    const chunk = {
      sessionId: "app",
      uploadId,
      offset: 0,
      data: Buffer.from("日本語").toString("base64"),
    };
    const results = await Promise.all([
      uploads.request("device", "files.put.chunk", chunk),
      uploads.request("device", "files.put.chunk", chunk),
    ]);
    assert.deepEqual(
      results.map((result) => result.written),
      [9, 9],
    );
    const status = await uploads.request("device", "files.put.status", {
      sessionId: "app",
      uploadId,
    });
    await uploads.request("device", "files.put.chunk", {
      sessionId: "app",
      uploadId,
      offset: status.written,
      data: Buffer.from("続き").toString("base64"),
    });
    await uploads.request("device", "files.put.finish", {
      sessionId: "app",
      uploadId,
    });
    assert.equal(
      await readFile(join(root, "result.txt"), "utf8"),
      "日本語続き",
    );
  } finally {
    await uploads.close();
    await rm(root, { recursive: true, force: true });
  }
});

// An app disappearing, and Host restart during a write, cannot be selected at a
// specific write boundary through UI. Exercise the real session and disk journal.
test("同じ端末の新しいアプリは前の転送だけを回収し、新しい転送を開始できる", async () => {
  const base = await mkdtemp(join(tmpdir(), "iori-put-session-"));
  const uploads = new FileUploads(join(base, "storage"));
  const uploadId = randomUUID();
  try {
    await uploads.request("device", "files.put.session", { sessionId: "old" });
    await uploads.request("device", "files.put.begin", {
      sessionId: "old",
      uploadId,
      root: base,
      path: "incomplete",
      replace: false,
    });
    await uploads.request("other", "files.put.session", { sessionId: "other" });
    await uploads.request("other", "files.put.begin", {
      sessionId: "other",
      uploadId,
      root: base,
      path: "other",
      replace: false,
    });
    assert.equal(
      (await readdir(base)).filter((name) => name.startsWith(".iori-put-"))
        .length,
      2,
    );
    await uploads.request("device", "files.put.session", { sessionId: "new" });
    assert.equal(
      (await readdir(base)).filter((name) => name.startsWith(".iori-put-"))
        .length,
      1,
    );
    await assert.rejects(
      uploads.request("device", "files.put.status", {
        sessionId: "old",
        uploadId,
      }),
      FilePutFailure,
    );
    await uploads.request("device", "files.put.begin", {
      sessionId: "new",
      uploadId,
      root: base,
      path: "complete",
      replace: false,
    });
    await uploads.request("device", "files.put.finish", {
      sessionId: "new",
      uploadId,
    });
    assert.equal(await readFile(join(base, "complete"), "utf8"), "");
  } finally {
    await uploads.close();
    await rm(base, { recursive: true, force: true });
  }
});
test("Hostの強制終了で残った一時ファイルを次のHostの起動で記録から回収する", async () => {
  const base = await mkdtemp(join(tmpdir(), "iori-put-recovery-"));
  const storage = join(base, "storage");
  const module = new URL("./files-writing.ts", import.meta.url).href;
  try {
    const child = spawnSync(
      process.execPath,
      [
        "--input-type=module",
        "-e",
        `
      import { FileUploads } from ${JSON.stringify(module)};
      const uploads = new FileUploads(${JSON.stringify(storage)});
      await uploads.request("device", "files.put.session", { sessionId: "old" });
      await uploads.request("device", "files.put.begin", { sessionId: "old", uploadId: ${JSON.stringify(randomUUID())}, root: ${JSON.stringify(base)}, path: "incomplete", replace: false });
      process.exit(0);
    `,
      ],
      { encoding: "utf8" },
    );
    assert.equal(child.status, 0, child.stderr);
    assert.equal(
      (await readdir(base)).filter((name) => name.startsWith(".iori-put-"))
        .length,
      1,
    );
    const uploads = new FileUploads(storage);
    try {
      await uploads.request("device", "files.put.session", {
        sessionId: "new",
      });
      assert.equal(
        (await readdir(base)).filter((name) => name.startsWith(".iori-put-"))
          .length,
        0,
      );
    } finally {
      await uploads.close();
    }
  } finally {
    await rm(base, { recursive: true, force: true });
  }
});
