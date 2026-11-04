/// <reference types="node" />
import assert from "node:assert/strict";
import test from "node:test";
import { trimTerminalCopyMargin } from "./terminal-copy.ts";

test("共通の余白だけ外し、相対の字下げを残す", () => {
  assert.equal(
    trimTerminalCopyMargin("  reply\n    nested\n      code\n  end"),
    "reply\n  nested\n    code\nend",
  );
});

test("左端の行や行の途中からの選択を含むと変えない", () => {
  for (const text of ["reply\n  nested", "  reply\nend"])
    assert.equal(trimTerminalCopyMargin(text), text);
});

test("空行と空白だけの行は共通の余白の判定に入れない", () => {
  assert.equal(
    trimTerminalCopyMargin("\n  reply\n \n    \n    nested\n"),
    "\nreply\n\n  \n  nested\n",
  );
  for (const text of ["", "\n \n   "])
    assert.equal(trimTerminalCopyMargin(text), text);
});

test("空行を含むCRLFを保つ", () => {
  assert.equal(
    trimTerminalCopyMargin("  reply\r\n\r\n \r\n    nested\r\n"),
    "reply\r\n\r\n\r\n  nested\r\n",
  );
});

test("1行の選択は行頭の空白をすべて外す", () => {
  assert.equal(trimTerminalCopyMargin("     reply  "), "reply  ");
});
