import { worktreeTitleSlug } from "@iori/protocol";
import { worktreeOptions } from "../worktree-creation.ts";
import { recordWorktreeBase } from "../worktree-state.ts";
import { basename, dirname, join, relative } from "node:path";
import { realpath, readFile, lstat } from "node:fs/promises";
import { randomBytes } from "node:crypto";
import { collectGit } from "../git-process.ts";
import { discoverRepository } from "../git-reading.ts";
import { removeRemainingWorktreeFolder } from "../worktree-residual.ts";

export function childWorktreeSlug(title: string): string {
  return worktreeTitleSlug(title) || "worker";
}

export async function childWorktree(
  parent: string,
  requested: string,
  title: string,
  repo?: string,
): Promise<string> {
  if (repo) parent = repo;
  if (requested === "parent") return realpath(parent);
  let repository: Awaited<ReturnType<typeof discoverRepository>>;
  try {
    repository = await discoverRepository(parent);
  } catch (error) {
    if (
      !repo &&
      requested === "new" &&
      (error as { code?: string }).code === "not_git_repository"
    )
      return realpath(parent);
    throw error;
  }
  const { stdout } = await collectGit(parent, [
    "worktree",
    "list",
    "--porcelain",
    "-z",
  ]);
  const entries = stdout
    .toString("utf8")
    .split("\0\0")
    .flatMap((record) => {
      const fields = record.split("\0");
      const path = fields.find((v) => v.startsWith("worktree "))?.slice(9);
      const branch = fields
        .find((v) => v.startsWith("branch refs/heads/"))
        ?.slice(18);
      return path ? [{ path, branch }] : [];
    });
  if (requested !== "new") {
    // A CLI can select a name from this repository's real Git inventory,
    // never submit a path or reach another repository through a symlink.
    const matches = entries.filter(
      (e) => basename(e.path) === requested || e.branch === requested,
    );
    if (matches.length !== 1)
      throw new Error(
        "Worktree name is absent or ambiguous. Use a name from this repository.",
      );
    const path = await realpath(matches[0]!.path);
    if ((await discoverRepository(path)).commonDir !== repository.commonDir)
      throw new Error("Worktree is outside this repository.");
    return path;
  }
  const primary = await realpath(entries[0]!.path);
  const slug = childWorktreeSlug(title);
  const directory = await realpath(dirname(primary));
  const refs = await collectGit(parent, [
    "for-each-ref",
    "--format=%(refname)",
    "refs/heads",
  ]);
  const branches = refs.stdout.toString("utf8").split("\n");
  for (;;) {
    const name = `${slug}-${randomBytes(4).toString("hex")}`;
    const branch = `refs/heads/iori/${name}`;
    const path = join(directory, `${basename(primary)}-${name}`);
    if (
      branches.some((ref) => ref === branch || ref.startsWith(branch + "/")) ||
      entries.some((entry) => relative(entry.path, path) === "")
    )
      continue;
    try {
      await lstat(path);
      continue;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
    // Git's refusal may follow a partly completed checkout. Do not replay
    // creation or override an existing branch after an ambiguous failure.
    await addGitWorktree(
      parent,
      path,
      `iori/${name}`,
      repo
        ? (
            await collectGit(parent, [
              "rev-parse",
              `${(await worktreeOptions(parent)).defaultBranch}^{commit}`,
            ])
          ).stdout
            .toString("utf8")
            .trim()
        : "HEAD",
    );
    const base = (await collectGit(path, ["rev-parse", "HEAD"])).stdout
      .toString("utf8")
      .trim();
    await recordWorktreeBase(path, base);
    return realpath(path);
  }
}
export async function checkChildWorktreeRemoval(
  parent: string,
  child: string,
): Promise<void> {
  const [parentPath, childPath] = await Promise.all([
    realpath(parent),
    realpath(child),
  ]);
  if (parentPath === childPath)
    throw new Error(
      "Cannot remove the parent's worktree. Use --worktree keep.",
    );
  const [a, b] = await Promise.all([
    discoverRepository(parentPath),
    discoverRepository(childPath),
  ]);
  if (a.commonDir !== b.commonDir)
    throw new Error("Worktree is outside this repository.");
  const inventory = await collectGit(parentPath, [
    "worktree",
    "list",
    "--porcelain",
    "-z",
  ]);
  const primary = inventory.stdout.toString("utf8").split("\0")[0]?.slice(9);
  if (primary && (await realpath(primary)) === childPath)
    throw new Error("Cannot remove the main worktree. Use --worktree keep.");
}
export async function removeChildWorktree(
  parent: string,
  child: string,
  discard: boolean,
): Promise<void> {
  await checkChildWorktreeRemoval(parent, child);
  // Do not retry with force, unlock or prune after Git's refusal.
  await collectGit(parent, [
    "worktree",
    "remove",
    ...(discard ? ["--force"] : []),
    "--",
    child,
  ]);
  // Git may leave (or a surviving process may recreate) files such as
  // ignored output after removing the worktree. Delete what remains at
  // the verified child path; a failure surfaces as a failed removal.
  await removeRemainingWorktreeFolder(child);
}
export async function worktreeChanges(
  cwd: string,
  base?: string,
): Promise<Required<import("@iori/protocol").Changes>> {
  // Deletion shows both the index and the working tree, including staged edits
  // subsequently reverted only in the working tree. Team reports keep their base diff.
  const revisions = base === undefined ? [[], ["--cached"]] : [[base]];
  const changed = new Set<string>();
  let added = 0,
    removed = 0;
  for (const revision of revisions) {
    const diff = await collectGit(cwd, [
      "diff",
      "--no-ext-diff",
      "--no-textconv",
      "--numstat",
      "-z",
      ...revision,
      "--",
    ]);
    const fields = diff.stdout.toString("utf8").split("\0");
    for (let i = 0; i < fields.length; i++) {
      if (!fields[i]) continue;
      const match = /^([0-9]+|-)\t([0-9]+|-)\t(.*)$/su.exec(fields[i]!);
      if (!match) continue;
      added += match[1] === "-" ? 0 : Number(match[1]);
      removed += match[2] === "-" ? 0 : Number(match[2]);
      changed.add(match[3] || fields[i + 2]!);
      if (match[3] === "") i += 2;
    }
  }
  const untracked = await collectGit(cwd, [
    "ls-files",
    "--others",
    "--exclude-standard",
    "-z",
  ]);
  for (const path of untracked.stdout
    .toString("utf8")
    .split("\0")
    .filter(Boolean)) {
    const absolute = join(cwd, path);
    changed.add(path);
    // Count a symlink as a file without reading its target outside the worktree.
    if ((await lstat(absolute)).isSymbolicLink()) continue;
    const content = await readFile(absolute);
    if (!content.includes(0) && content.length)
      added +=
        content.toString("utf8").split("\n").length -
        (content.at(-1) === 10 ? 1 : 0);
  }
  return { added, removed, files: changed.size };
}

/** Shared native Git boundary for user-created and delegated worktrees. */
export async function addGitWorktree(
  cwd: string,
  path: string,
  branch: string,
  base: string,
): Promise<void> {
  await collectGit(cwd, ["worktree", "add", "-b", branch, "--", path, base]);
}
