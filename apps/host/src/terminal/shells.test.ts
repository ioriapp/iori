import assert from "node:assert/strict";
import test from "node:test";
import type { ShellDefinition } from "./platform.ts";
import { deduplicateShellsByRealPath, resolveShell } from "./shells.ts";

const shell = (id: string): ShellDefinition => ({
  id,
  label: id,
  executable: `/bin/${id}`,
  args: ["-l"],
});

test("同じ実体のPOSIX shellは先のIDを残し、旧IDから解決する", () => {
  const shells = deduplicateShellsByRealPath([
    { shell: shell("sh"), realpath: "/usr/bin/dash" },
    { shell: shell("dash"), realpath: "/usr/bin/dash" },
  ]);

  assert.deepEqual(
    shells.map((entry) => entry.id),
    ["sh"],
  );
  assert.equal(resolveShell(shells, "dash")?.id, "sh");
});

test("/bin/shがbashと同じ実体ならbashを残す", () => {
  const shells = deduplicateShellsByRealPath([
    { shell: shell("bash"), realpath: "/usr/bin/bash" },
    { shell: shell("sh"), realpath: "/usr/bin/bash" },
  ]);

  assert.deepEqual(
    shells.map((entry) => entry.id),
    ["bash"],
  );
  assert.equal(resolveShell(shells, "sh")?.id, "bash");
});

test("実体パスが取れないshellは一覧に残す", () => {
  const shells = deduplicateShellsByRealPath([
    { shell: shell("sh") },
    { shell: shell("dash"), realpath: "/usr/bin/dash" },
  ]);

  assert.deepEqual(
    shells.map((entry) => entry.id),
    ["sh", "dash"],
  );
});
