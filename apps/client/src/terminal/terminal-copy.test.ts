/// <reference types="node" />
import assert from "node:assert/strict";
import test from "node:test";
import { trimTerminalCopyMargin } from "./terminal-copy.ts";

test("共通の余白だけ外し、相対の字下げを残す", () => {
  assert.equal(
    trimTerminalCopyMargin("  reply\n    nested\n      code\n  end", 0),
    "reply\n  nested\n    code\nend",
  );
});

test("余白の無い行を含むと変えない", () => {
  for (const text of ["reply\n  nested", "  reply\nend"])
    assert.equal(trimTerminalCopyMargin(text, 0), text);
});

test("行の途中から始まる選択では共通の空白を残す", () => {
  const text = "  reply\n    nested";
  assert.equal(trimTerminalCopyMargin(text, 2), text);
});

test("空行と空白だけの行は共通の余白の判定に入れない", () => {
  assert.equal(
    trimTerminalCopyMargin("\n  reply\n \n    \n    nested\n", 0),
    "\nreply\n\n\n  nested\n",
  );
  assert.equal(trimTerminalCopyMargin("", 0), "");
  assert.equal(trimTerminalCopyMargin("\n \n   ", 0), "\n\n");
});

test("空行を含むCRLFを保つ", () => {
  assert.equal(
    trimTerminalCopyMargin("  reply\r\n\r\n \r\n    nested\r\n", 0),
    "reply\r\n\r\n\r\n  nested\r\n",
  );
});

test("1行の選択は行頭の空白をすべて外す", () => {
  assert.equal(trimTerminalCopyMargin("     reply  ", 0), "reply");
});

test("複数行の行末の空白を削除し、行内の空白と字下げを残す", () => {
  assert.equal(
    trimTerminalCopyMargin("  first  words  \n    nested   \n  last ", 0),
    "first  words\n  nested\nlast",
  );
});

test("行の途中からの選択や左端から始まる行も行末の空白を削除する", () => {
  assert.equal(
    trimTerminalCopyMargin("  first  \n    second  ", 2),
    "  first\n    second",
  );
  assert.equal(
    trimTerminalCopyMargin("first  \n  second  ", 0),
    "first\n  second",
  );
  assert.equal(trimTerminalCopyMargin("first  ", undefined), "first");
});

test("CRLFとタブを保持して行末の半角スペースだけを削除する", () => {
  assert.equal(
    trimTerminalCopyMargin("  first  \r\n   \r\n  second\t  \r\n  third \t", 0),
    "first\r\n\r\nsecond\t\r\nthird \t",
  );
});
