import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { handleGitRead } from "./git-reading.ts";

// E2E cannot prove that Git never enumerates the contents behind a directory reparse point.
test(
  "未追跡directory linkをleafとして扱い、外部の子pathをstatusへ含めない",
  { skip: process.platform !== "win32" },
  async () => {
    const root = await mkdtemp(join(tmpdir(), "iori-git-link-status-"));
    const outside = await mkdtemp(join(tmpdir(), "iori-git-link-target-"));
    const git = (args: string[]): void => {
      execFileSync("git", args, {
        cwd: root,
        env: {
          ...process.env,
          GIT_AUTHOR_NAME: "Fixture",
          GIT_AUTHOR_EMAIL: "fixture@example.invalid",
          GIT_COMMITTER_NAME: "Fixture",
          GIT_COMMITTER_EMAIL: "fixture@example.invalid",
        },
        stdio: "ignore",
      });
    };

    try {
      git(["init", "--initial-branch=main"]);
      await writeFile(
        join(outside, "external-secret.txt"),
        "outside content\n",
      );
      await writeFile(join(root, "visible.txt"), "inside content\n");
      await symlink(outside, join(root, "outside-link"), "junction");

      const result = await handleGitRead("git.status", {
        root,
        start: 0,
        count: 512,
      });
      const paths = result.entries.map((entry) => entry.path);
      assert.equal(paths.includes("visible.txt"), true);
      assert.equal(paths.includes("outside-link"), true);
      assert.equal(
        paths.some((path) => path.startsWith("outside-link/")),
        false,
      );
      assert.equal(
        paths.some((path) => path.includes("external-secret")),
        false,
      );
    } finally {
      await Promise.all([
        rm(root, { recursive: true, force: true }),
        rm(outside, { recursive: true, force: true }),
      ]);
    }
  },
);

test("worktree の起点を指すブランチを優先し、ブランチが残っていない時は起点のコミットを選ぶ", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "iori-review-base-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const git = (...args: string[]) =>
    execFileSync(
      "git",
      [
        "-c",
        "user.name=Fixture",
        "-c",
        "user.email=fixture@example.invalid",
        ...args,
      ],
      { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] },
    ).trim();
  git("init", "-b", "topic");
  git("commit", "--allow-empty", "-m", "base");
  const base = git("rev-parse", "HEAD");
  git("branch", "release");
  git("commit", "--allow-empty", "-m", "topic");
  git("update-ref", "refs/remotes/origin/main", "HEAD");
  git("symbolic-ref", "refs/remotes/origin/HEAD", "refs/remotes/origin/main");
  const branches = () => handleGitRead("git.branches", { root });
  assert.deepEqual(await branches(), {
    current: "topic",
    defaultBase: "origin/main",
    branches: ["release", "topic", "origin/main"],
  });
  await writeFile(join(root, ".git", "iori-base-commit"), base + "\n");
  assert.equal((await branches()).defaultBase, "release");
  git("branch", "-D", "release");
  git("update-ref", "-d", "refs/remotes/origin/main");
  const fallback = await branches();
  assert.equal(fallback.defaultBase, base);
  assert.ok(fallback.branches.includes(base));
});
