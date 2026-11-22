import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { access, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { collectGit } from "./git-process.ts";

test("Git status does not run the repository's fsmonitor hook", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "iori-git-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const git = (...args: string[]) =>
    execFileSync("git", args, { cwd: root, stdio: "pipe" });
  git("init");
  await writeFile(join(root, "tracked.txt"), "initial\n");
  git("add", "tracked.txt");
  await writeFile(
    join(root, ".git", "fsmonitor-hook"),
    "#!/bin/sh\n: > .git/fsmonitor-called\n",
    { mode: 0o700 },
  );
  git("config", "core.fsmonitor", ".git/fsmonitor-hook");
  await writeFile(join(root, "tracked.txt"), "edited\n");

  const status = await collectGit(root, ["status", "--porcelain"]);

  assert.equal(status.stdout.toString("utf8"), "AM tracked.txt\n");
  await assert.rejects(access(join(root, ".git", "fsmonitor-called")), {
    code: "ENOENT",
  });
});
