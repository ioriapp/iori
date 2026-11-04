import assert from "node:assert/strict";
import { test } from "node:test";
import { cliTitle } from "./title.ts";

test("CLI titles omit leading Unicode other symbols and their whitespace", () => {
  for (const [title, expected] of [
    ["◐ 題名", "題名"],
    ["◑ 題名", "題名"],
    ["✳ Claude Code", "Claude Code"],
    ["⠋ 題名", "題名"],
    ["⠙ 題名", "題名"],
    ["◐✳　⠹ 題名", "題名"],
    ["✳題名", "題名"],
    ["  ◑　題名 ◐  ", "題名 ◐"],
    ["✳ (題名)", "(題名)"],
  ]) {
    for (const windows of [false, true]) {
      assert.equal(cliTitle(title, "CLI", windows), expected, title);
    }
  }
});

test("CLI titles preserve leading letters, numbers, brackets and punctuation", () => {
  for (const title of [
    "題名 ◐",
    "Claude Code ✳",
    "123 題名",
    "(題名)",
    "[題名]",
    "「題名」",
    '"題名"',
    "'題名'",
    "#85 題名",
    "- 題名",
    "/root/project",
    "~/projects/iori",
    "$ npm run dev",
    "+ 題名",
    "^ 題名",
  ]) {
    for (const windows of [false, true]) {
      assert.equal(cliTitle(title, "CLI", windows), title);
    }
  }
});

test("empty or symbol-only CLI titles use the CLI name", () => {
  for (const title of ["", "  ", "◐", "✳ ", "⠋　◑ ✳", "\u0000◐\u007f"]) {
    for (const windows of [false, true]) {
      assert.equal(cliTitle(title, "CLI", windows), "CLI", title);
    }
  }
});

test("CLI title normalization retains control cleanup and Windows shell fallback", () => {
  assert.equal(cliTitle("\u0000 ◐ 題名\u009f ", "CLI", false), "題名");
  for (const title of [
    "cmd.exe",
    "C:\\Windows\\System32\\cmd.exe",
    '"C:\\Program Files\\PowerShell\\7\\pwsh.exe"',
    "✳ powershell.exe",
    "bash.exe",
  ]) {
    assert.equal(cliTitle(title, "CLI", true), "CLI", title);
  }
  assert.equal(cliTitle("cmd.exe", "CLI", false), "cmd.exe");
  assert.equal(cliTitle("cmd.exe 題名", "CLI", true), "cmd.exe 題名");
});
