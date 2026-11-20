import assert from "node:assert/strict";
import test from "node:test";
import { isNonKeyTerminalInput } from "./non-key-input.ts";

const click = "\x1b[<0;10;5M";
const release = "\x1b[<0;10;5m";
const x10 = "\x1b[M *%";
const urxvt = "\x1b[32;10;5M";
const focusIn = "\x1b[I";
const focusOut = "\x1b[O";

test("recognizes chunks containing only complete mouse and focus reports", () => {
  for (const data of [
    click,
    release,
    x10,
    urxvt,
    focusIn,
    focusOut,
    click + release + x10 + urxvt + focusIn + focusOut,
  ]) {
    assert.equal(isNonKeyTerminalInput(data), true, JSON.stringify(data));
  }
});

test("preserves keys, pasted text, and chunks with incomplete or mixed input", () => {
  for (const data of [
    "",
    "a",
    "y",
    "\r",
    "\n",
    "確定",
    "\x1b",
    "\x03",
    "\x1b[A",
    "\x1bOP",
    "\x1b[27;5u",
    "\x1b[200~hello\x1b[201~",
    "\x1b[M *",
    click + "a",
    "a" + click,
    focusOut + "\n",
  ]) {
    assert.equal(isNonKeyTerminalInput(data), false, JSON.stringify(data));
  }
});
