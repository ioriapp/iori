import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import test from "node:test";

// 通常UIでは認証の無い96MiBの要求を作れない。
// 実際のmailboxとRustのioriを、本文より小さいV8 heapの別processで通す。
test("認証の無い96MiBの要求を繰り返し捨て、正しいioriコマンドを受ける", async () => {
  const result = await promisify(execFile)(process.execPath, [
    "--max-old-space-size=32",
    fileURLToPath(
      new URL("./command-receiver-memory.test.fixture.ts", import.meta.url),
    ),
  ]);
  assert.equal(result.stderr, "");
});
