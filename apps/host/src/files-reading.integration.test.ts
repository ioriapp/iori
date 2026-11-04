import assert from "node:assert/strict";
import {
  appendFile,
  mkdir,
  mkdtemp,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { MAX_TEXT_RANGE_BYTES } from "@iori/protocol";
import { handleFileRead, ReadingFailure } from "./files-reading.ts";

// E2E cannot combine real cancellation with appends at this speed through screen operations.
test("追記と色分けの取り消しを重ねても後の末尾ページが完了し、取り消した要求も全て終わる", async () => {
  const root = await mkdtemp(join(tmpdir(), "iori-syntax-cancel-"));
  const path = "growing.log";
  const line =
    "2026-10-27 12:00:00.123 INFO [main] request handled id=12345 status=200 path=/api/v1/items ok\n";
  const requests: Promise<void>[] = [];
  const cancellationDelays = [20, 0, -1, 1, 2, 5, 10, 50, 100];
  let cancellationRound = 0;
  let controller: AbortController | undefined;
  try {
    await writeFile(join(root, path), line.repeat(60_000));
    for (let round = 0; round < 24; round += 1) {
      await appendFile(join(root, path), line.repeat(10));
      controller = new AbortController();
      const signal = controller.signal;
      const lastLine = 60_000 + (round + 1) * 10;
      const request = handleFileRead(
        "files.syntax",
        {
          root,
          path,
          startLine: lastLine - 127,
          lineCount: 128,
        },
        signal,
      ).then(
        (result) => {
          assert.equal(result.language, "log");
          assert.ok(result.lines.length > 0);
          assert.ok(result.lines.some((item) => item.line === lastLine));
        },
        (error: unknown) => {
          if (!signal.aborted) throw error;
        },
      );
      requests.push(request);
      if (round < 21 && round % 4 !== 3) {
        // Spread cancellation across stages; the delay and reached stage do not determine success.
        const delay =
          cancellationDelays[cancellationRound++ % cancellationDelays.length]!;
        if (delay === -1)
          await new Promise<void>((resolve) => setImmediate(resolve));
        else if (delay > 0)
          await new Promise<void>((resolve) => setTimeout(resolve, delay));
        controller.abort();
      } else {
        await request;
      }
    }
    await Promise.all(requests);
  } finally {
    controller?.abort();
    await rm(root, { recursive: true, force: true });
  }
});

// The UI cannot send raw traversal paths, and the E2E fixture only links folders.
test("files.readはフォルダー外のパス・外へ出る祖先symlink・外を指すファイルのsymlinkを拒否する", async () => {
  const base = await mkdtemp(join(tmpdir(), "iori-files-boundary-"));
  const root = join(base, "selected");
  const outside = join(base, "outside");
  try {
    await Promise.all([mkdir(root), mkdir(outside)]);
    await writeFile(join(outside, "secret.txt"), "external secret");
    await symlink(
      outside,
      join(root, "portal"),
      process.platform === "win32" ? "junction" : "dir",
    );
    await symlink(join(outside, "secret.txt"), join(root, "secret-link.txt"));

    const paths = [
      "../outside/secret.txt",
      join(outside, "secret.txt"),
      "portal/secret.txt",
      "secret-link.txt",
    ];
    for (const path of paths) {
      await assert.rejects(
        handleFileRead("files.read", {
          root,
          path,
          offset: 0,
          length: 128,
        }),
        (error: unknown) =>
          error instanceof ReadingFailure && error.code === "path_outside_root",
      );
    }
  } finally {
    await rm(base, { recursive: true, force: true });
  }
});

// E2E cannot force a multibyte character to straddle the Host's finite byte window.
test("files.lineRangeは巨大行をUTF-8境界で分けて続きを返し、BOMとCRを本文に含めない", async () => {
  const root = await mkdtemp(join(tmpdir(), "iori-files-line-range-"));
  const path = "large.txt";
  const asciiPrefixBytes = MAX_TEXT_RANGE_BYTES - 1;
  const firstLine = `${"a".repeat(asciiPrefixBytes)}${"界".repeat(200_000)}`;
  try {
    await writeFile(
      join(root, path),
      Buffer.concat([
        Buffer.from([0xef, 0xbb, 0xbf]),
        Buffer.from(`${firstLine}\r\nsecond Ω\r\n`, "utf8"),
      ]),
    );

    let page = await handleFileRead("files.lineRange", {
      root,
      path,
      startLine: 1,
      lineCount: 1,
      byteLimit: MAX_TEXT_RANGE_BYTES,
    });
    assert.equal(page.totalLines, 2);
    assert.equal(page.lines.length, 1);
    assert.equal(page.lines[0]!.complete, false);
    assert.equal(page.lines[0]!.line, 1);
    assert.equal(page.lines[0]!.byteOffset, 3);
    assert.equal(page.lines[0]!.nextByteOffset, 3 + asciiPrefixBytes);
    assert.equal(page.lines[0]!.text.length, asciiPrefixBytes);
    assert.equal(page.lines[0]!.text === "a".repeat(asciiPrefixBytes), true);

    let reconstructed = page.lines[0]!.text;
    let continuation = page.next;
    while (continuation) {
      const previousOffset = continuation.byteOffset;
      page = await handleFileRead("files.lineRange", {
        root,
        path,
        startLine: 1,
        lineCount: 1,
        byteLimit: MAX_TEXT_RANGE_BYTES,
        continuation,
      });
      assert.equal(page.lines.length, 1);
      assert.equal(page.lines[0]!.line, 1);
      assert.equal(page.lines[0]!.byteOffset, previousOffset);
      assert.equal(page.lines[0]!.nextByteOffset > previousOffset, true);
      reconstructed += page.lines[0]!.text;
      continuation = page.next;
    }
    assert.equal(reconstructed === firstLine, true);

    const secondLine = await handleFileRead("files.lineRange", {
      root,
      path,
      startLine: 2,
      lineCount: 1,
      byteLimit: MAX_TEXT_RANGE_BYTES,
    });
    assert.equal(secondLine.totalLines, 2);
    assert.equal(secondLine.lines[0]!.text, "second Ω");
    assert.equal(secondLine.lines[0]!.complete, true);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
