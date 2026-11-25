import assert from "node:assert/strict";
import { test } from "node:test";
import { pasteImagePaths } from "./terminal-paste-data.ts";

test("Each attached image is a separate bracketed paste", () => {
  assert.equal(
    pasteImagePaths(["/tmp/1.png ", "/tmp/2.jpg "], true),
    "\x1b[200~/tmp/1.png \x1b[201~\x1b[200~/tmp/2.jpg \x1b[201~",
  );
  assert.equal(
    pasteImagePaths(["/tmp/1.png "], true),
    "\x1b[200~/tmp/1.png \x1b[201~",
  );
  assert.equal(
    pasteImagePaths(["/tmp/1.png ", "/tmp/2.jpg "], false),
    "/tmp/1.png /tmp/2.jpg ",
  );
});
