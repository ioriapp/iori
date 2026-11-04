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
