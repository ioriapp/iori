/// <reference types="node" />
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import test from "node:test";
import { terminalDropText } from "./terminal-drop-path.ts";

// File names may hold any character but NUL and "/"; the shell must receive the
// name itself, with nothing expanded.
const names = [
  "plain.txt",
  "with space.md",
  "it's.txt",
  "$HOME and `date`.txt",
  "glob*?[a].txt",
  "~tilde",
  "-dash.txt",
  "back\\slash.txt",
  "!bang;&|<>(){}.txt",
];

test("bashが受け取る引数はドロップした名前そのもの", () => {
  for (const name of names) {
    for (const [cwd, path] of [
      ["/srv/repo", `/srv/repo/src/${name}`],
      ["/srv/other", `/srv/repo/${name}`],
    ] as const) {
      const typed = terminalDropText(path, cwd, "bash") ?? "";
      assert.equal(typed.endsWith(" "), true);
      const received = execFileSync(
        "bash",
        ["--norc", "--noprofile", "-c", `printf '%s' ${typed}`],
        { encoding: "utf8" },
      );
      assert.equal(
        received,
        cwd === "/srv/repo" ? `src/${name}` : path,
        JSON.stringify(name),
      );
    }
  }
});

test("先頭が-の相対パスは./を前置し、bashはその名前のファイルとして受け取る", () => {
  for (const shell of ["bash", "fish", "git-bash"])
    assert.equal(
      terminalDropText("/srv/repo/-x.txt", "/srv/repo", shell),
      "./-x.txt ",
    );
  const typed = terminalDropText("/srv/repo/-a b.txt", "/srv/repo", "bash");
  assert.equal(
    execFileSync(
      "bash",
      ["--norc", "--noprofile", "-c", `printf '%s' ${typed}`],
      { encoding: "utf8" },
    ),
    "./-a b.txt",
  );
});

test("制御文字を含む名前は何も入力しない", () => {
  for (const name of [
    "改行\nあり.txt",
    "cr\r.txt",
    "esc\u001b[201~.txt",
    "c1\u009b.txt",
    "op\u000f.txt",
  ])
    for (const shell of ["bash", "fish", "powershell", "cmd", "git-bash"])
      assert.equal(
        terminalDropText(`/srv/repo/${name}`, "/srv/repo", shell),
        undefined,
      );
});
