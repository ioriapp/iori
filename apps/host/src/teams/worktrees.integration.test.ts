import assert from "node:assert/strict";
import { mock, test } from "node:test";
import crypto from "node:crypto";
import { syncBuiltinESMExports } from "node:module";
import { execFileSync } from "node:child_process";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { childWorktree } from "./worktrees.ts";

// A UI cannot choose cryptographic random bytes to collide with existing names.
// Only the bytes are controlled: production naming, real Git inventories and
// actual worktree creation must preserve the existing branches and folders.
test("name collisions select a new mark without resetting existing branches or reusing folders", async () => {
  const root = await mkdtemp(join(tmpdir(), "iori-worktree-names-"));
  const repository = join(root, "repository");
  await mkdir(repository);
  const git = (...args: string[]) =>
    execFileSync(
      "git",
      [
        "-c",
        "user.name=iori test",
        "-c",
        "user.email=test@example.invalid",
        ...args,
      ],
      { cwd: repository, encoding: "utf8" },
    );
  let randomness: ReturnType<typeof mock.method> | undefined;
  try {
    git("init");
    await writeFile(join(repository, "README.md"), "original\n");
    git("add", ".");
    git("commit", "-m", "original");
    const original = git("rev-parse", "HEAD").trim();
    for (const mark of ["00000000", "00000001"])
      git("branch", `iori/fix-sidebar-${mark}`);
    await writeFile(join(repository, "README.md"), "new parent\n");
    git("commit", "-am", "new parent");
    const folder = join(root, "repository-fix-sidebar-00000002");
    await mkdir(folder);
    await writeFile(join(folder, "keep.txt"), "keep\n");
    const registered = join(root, "repository-fix-sidebar-00000003");
    git("worktree", "add", "--detach", registered, "HEAD");
    let next = 0;
    randomness = mock.method(crypto, "randomBytes", () =>
      Buffer.from((next++).toString(16).padStart(8, "0"), "hex"),
    );
    syncBuiltinESMExports();
    const created = await childWorktree(repository, "new", "Fix sidebar");
    assert.equal(created, join(root, "repository-fix-sidebar-00000004"));
    assert.equal(
      git("-C", created, "branch", "--show-current").trim(),
      "iori/fix-sidebar-00000004",
    );
    for (const mark of ["00000000", "00000001"])
      assert.equal(
        git("rev-parse", `iori/fix-sidebar-${mark}`).trim(),
        original,
      );
    assert.equal(await readFile(join(folder, "keep.txt"), "utf8"), "keep\n");
    assert.equal(
      await readFile(join(registered, "README.md"), "utf8"),
      "new parent\n",
    );
  } finally {
    randomness?.mock.restore();
    syncBuiltinESMExports();
    await rm(root, { recursive: true, force: true });
  }
});
