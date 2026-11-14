import { readFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { collectGit } from "./git-process.ts";
import { inventory } from "./worktree-creation.ts";

export async function worktreeDirectory(path: string): Promise<string> {
  const dotGit = join(path, ".git");
  try {
    const content = await readFile(dotGit, "utf8");
    const match = /^gitdir: (.+)$/mu.exec(content);
    if (match) return resolve(path, match[1]!);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "EISDIR") throw error;
  }
  return dotGit;
}
export async function rebasingBranch(
  path: string,
): Promise<string | undefined> {
  try {
    const directory = await worktreeDirectory(path);
    for (const rebase of ["rebase-merge", "rebase-apply"]) {
      const head = await readFile(join(directory, rebase, "head-name"), "utf8")
        .then((value) => value.trim())
        .catch(() => "");
      const match = /^refs\/heads\/(.+)$/u.exec(head);
      if (match) return match[1];
    }
  } catch {
    // No readable rebase information: retain the detached HEAD warning.
  }
  return undefined;
}
export async function recordWorktreeBase(
  path: string,
  base: string,
): Promise<void> {
  try {
    await writeFile(
      join(await worktreeDirectory(path), "iori-base-commit"),
      base + "\n",
    );
  } catch {
    // Worktree creation succeeded; the branch reflog remains the fallback.
  }
}
/**
 * Records the commit a team parent accepted when it finished a child. A child
 * worktree still standing on that commit is merged, even when the parent had to
 * change the content to take it in.
 */
export async function recordWorktreeAccepted(
  path: string,
  commit: string,
): Promise<void> {
  try {
    await writeFile(
      join(await worktreeDirectory(path), "iori-accepted-commit"),
      commit + "\n",
    );
  } catch {
    // The accepted commit lives only in this file: without it the child is
    // never taken as merged through the parent's acceptance.
  }
}
type State = {
  merged: boolean;
  commits?: number;
  createdCommits?: number;
  target?: string;
};
const cache = new Map<string, { key: string; state: State }>();

/** Repository refs are read once per list; unchanged commits reuse their comparison. */
export async function worktreeStateReader(
  cwd: string,
  records?: { path: string; branch?: string }[],
): Promise<
  (path: string, branch?: string, directory?: string) => Promise<State>
> {
  const entries = records ?? (await inventory(cwd));
  const refs = (
    await collectGit(cwd, [
      "for-each-ref",
      "--format=%(refname:short)%09%(objectname)%09%(symref)",
      "refs/heads",
      "refs/remotes",
    ])
  ).stdout
    .toString("utf8")
    .trim()
    .split("\n")
    .map((line) => line.split("\t"));
  const shas = new Map(refs.map(([name, sha]) => [name!, sha!]));
  const defaultBranch = shas.has("origin/main")
    ? "origin/main"
    : refs
        .find(([name]) => name === "origin/HEAD")?.[2]
        ?.replace(/^refs\/remotes\//u, "") ||
      entries[0]?.branch ||
      "HEAD";
  const names = [defaultBranch];
  if (defaultBranch.startsWith("origin/") && shas.has(defaultBranch.slice(7)))
    names.push(defaultBranch.slice(7));
  const common = (
    await collectGit(cwd, [
      "rev-parse",
      "--path-format=absolute",
      "--git-common-dir",
    ])
  ).stdout
    .toString("utf8")
    .trim();
  const trees = new Map<string, Promise<string>>();
  return async (path, branch, directory) => {
    try {
      directory ??= await worktreeDirectory(path);
      const head = branch
        ? shas.get(branch)
        : (await readFile(join(directory, "HEAD"), "utf8")).trim();
      const targets = names.filter((name) => name !== branch && shas.has(name));
      let base: string | undefined;
      const accepted = await readFile(
        join(directory, "iori-accepted-commit"),
        "utf8",
      )
        .then((value) => value.trim())
        .catch(() => undefined);
      try {
        base = (
          await readFile(join(directory, "iori-base-commit"), "utf8")
        ).trim();
      } catch {
        if (branch) {
          const reflog = await readFile(
            join(common, "logs", "refs", "heads", branch),
            "utf8",
          ).catch(() => "");
          base = reflog
            .split("\n")
            .find((line) => line.includes("\tbranch: Created from "))
            ?.split(" ")[1];
        }
      }
      if (!head || targets.length === 0) return { merged: false };
      const key = JSON.stringify([
        head,
        base,
        accepted,
        branch,
        targets.map((name) => [name, shas.get(name)]),
      ]);
      const previous = cache.get(path);
      if (previous?.key === key) return previous.state;
      const count = async (range: string) =>
        Number(
          (
            await collectGit(path, ["rev-list", "--count", range, "--"])
          ).stdout.toString("utf8"),
        );
      const counts = await Promise.all(
        targets.map((name) => count(`${shas.get(name)}..${head}`)),
      );
      const index = counts.indexOf(Math.min(...counts));
      const state: State = {
        merged: false,
        commits: counts[index],
        target: targets[index],
      };
      if (base && branch) {
        state.createdCommits = await count(`${base}..${head}`);
        if (state.createdCommits > 0) {
          const merges = await collectGit(path, [
            "rev-list",
            "--merges",
            "--parents",
            `${base}..${head}`,
          ])
            .then((result) =>
              result.stdout.toString("utf8").trim().split("\n").filter(Boolean),
            )
            .catch(() => undefined);
          const hasMerges =
            !merges ||
            !(
              await Promise.all(
                merges.map(async (line) => {
                  const [sha, ...parents] = line.split(" ");
                  if (parents.length !== 2) return false;
                  return collectGit(path, [
                    "show",
                    "--format=",
                    "--remerge-diff",
                    "--no-ext-diff",
                    sha!,
                  ])
                    .then((result) => result.stdout.length === 0)
                    .catch(() => false);
                }),
              )
            ).every(Boolean);
          for (const target of targets)
            if (
              await matchesTarget(
                path,
                shas.get(target)!,
                head,
                base,
                trees,
                cwd,
                hasMerges,
              )
            ) {
              state.merged = true;
              state.target = target;
              break;
            }
          // The parent accepted this child's commits as they stand, and every
          // one of them has a counterpart in the target, even when taking it in
          // changed the content. Accepted but not yet taken in does not count.
          if (!state.merged && !hasMerges && accepted === head)
            for (const target of targets)
              if (await pairsWithTarget(path, base, head, shas.get(target)!)) {
                state.merged = true;
                state.target = target;
                break;
              }
        }
      }
      cache.set(path, { key, state });
      return state;
    } catch {
      return { merged: false };
    }
  };
}
/**
 * Whether a worktree's own commits are all in the target: either a trial merge
 * leaves the target unchanged (merge commit, squash merge, rebase), or every
 * commit has an equivalent patch there (`git cherry`), as after a cherry-pick
 * that the target edited again on the same lines.
 */
async function matchesTarget(
  path: string,
  sha: string,
  head: string,
  base: string,
  trees: Map<string, Promise<string>>,
  cwd: string,
  hasMerges: boolean,
): Promise<boolean> {
  if (!trees.has(sha))
    trees.set(
      sha,
      collectGit(cwd, ["rev-parse", `${sha}^{tree}`]).then((result) =>
        result.stdout.toString("utf8").trim(),
      ),
    );
  const merged = await collectGit(
    path,
    ["merge-tree", "--write-tree", sha, head],
    undefined,
    [0, 1],
  );
  if (
    merged.code === 0 &&
    merged.stdout.toString("utf8").trim() === (await trees.get(sha))
  )
    return true;
  if (hasMerges) return false;
  const cherry = await collectGit(
    path,
    ["cherry", sha, head, base],
    undefined,
    [0, 1],
  );
  if (cherry.code !== 0) return false;
  const lines = cherry.stdout
    .toString("utf8")
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
  return lines.length > 0 && lines.every((line) => line.startsWith("-"));
}
/**
 * Whether every child commit has a distinct target counterpart with the same
 * author name, email, date and subject and at least one changed path in common.
 */
async function pairsWithTarget(
  path: string,
  base: string,
  head: string,
  sha: string,
): Promise<boolean> {
  try {
    const readCommits = async (end: string) => {
      const result = await collectGit(path, [
        "log",
        "--no-merges",
        "-z",
        "--format=%H%x00%an%x00%ae%x00%aI%x00%s",
        `${base}..${end}`,
      ]);
      const fields = result.stdout.toString("utf8").split("\0");
      fields.pop();
      const commits: { sha: string; identity: string }[] = [];
      for (let i = 0; i < fields.length; i += 5)
        commits.push({
          sha: fields[i]!,
          identity: JSON.stringify(fields.slice(i + 1, i + 5)),
        });
      return commits;
    };
    const [children, targets] = await Promise.all([
      readCommits(head),
      readCommits(sha),
    ]);
    if (children.length === 0 || children.length > targets.length) return false;
    const paths = new Map<string, Promise<Set<string>>>();
    const changedPaths = (commit: string) => {
      if (!paths.has(commit))
        paths.set(
          commit,
          collectGit(path, [
            "diff-tree",
            "--no-commit-id",
            "--no-renames",
            "--name-only",
            "-r",
            "-z",
            commit,
          ]).then((result) => {
            const names = result.stdout.toString("utf8").split("\0");
            names.pop();
            return new Set(names);
          }),
        );
      return paths.get(commit)!;
    };
    const candidates = await Promise.all(
      children.map(async (child) => {
        const childPaths = await changedPaths(child.sha);
        const matches = await Promise.all(
          targets.map(async (target, index) => {
            if (child.identity !== target.identity) return -1;
            const targetPaths = await changedPaths(target.sha);
            return [...childPaths].some((name) => targetPaths.has(name))
              ? index
              : -1;
          }),
        );
        return matches.filter((index) => index !== -1);
      }),
    );
    const owners = new Map<number, number>();
    const pair = (child: number, visited: Set<number>): boolean => {
      for (const target of candidates[child]!) {
        if (visited.has(target)) continue;
        visited.add(target);
        const owner = owners.get(target);
        if (owner === undefined || pair(owner, visited)) {
          owners.set(target, child);
          return true;
        }
      }
      return false;
    };
    return children.every((_, index) => pair(index, new Set()));
  } catch {
    return false;
  }
}
export async function worktreeState(
  path: string,
  branch?: string,
): Promise<State> {
  try {
    return await (
      await worktreeStateReader(path)
    )(path, branch);
  } catch {
    return { merged: false };
  }
}
