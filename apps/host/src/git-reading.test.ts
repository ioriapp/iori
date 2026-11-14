import assert from "node:assert/strict";
import test from "node:test";
import { parseNumstatField } from "./git-reading.ts";

test("numstat preserves tabs and newlines in the entire inline path", () => {
  assert.deepEqual(parseNumstatField("2\t1\tdir/a\tb\nc.txt"), {
    added: "2",
    removed: "1",
    path: "dir/a\tb\nc.txt",
  });
  assert.deepEqual(parseNumstatField("-\t-\ta\tb.bin"), {
    added: "-",
    removed: "-",
    path: "a\tb.bin",
  });
});

test("numstat keeps the empty path that introduces NUL-delimited rename paths", () => {
  assert.deepEqual(parseNumstatField("0\t0\t"), {
    added: "0",
    removed: "0",
    path: "",
  });
});
