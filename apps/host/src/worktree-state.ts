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
 * Whether every commit the child made has a counterpart in the target: `git
 * range-diff` pairs them even when the parent had to change their content
 * (`!`). Each pair must also have the same author identity and date. A commit
 * only on the child's side (`<`) or a failure means not taken in.
 */
async function pairsWithTarget(
  path: string,
  base: string,
  head: string,
  sha: string,
): Promise<boolean> {
  // An empty range is an error for `git range-diff`; that is "not taken in",
  // not a reason to forget the worktree's commit counts.
  const diff = await collectGit(
    path,
    [
      "range-diff",
      "--no-color",
      "--no-abbrev",
      "--no-patch",
      `${base}..${head}`,
      `${base}..${sha}`,
    ],
    undefined,
    [0, 1],
  ).catch(() => undefined);
  if (!diff || diff.code !== 0) return false;
  const lines = diff.stdout
    .toString("utf8")
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
  const headers = lines.filter((line) =>
    /^(?:\d+|-):\s+\S+\s+[=!<>]\s+(?:\d+|-):\s+\S+/u.test(line),
  );
  const pairs = headers.filter((line) => /^\d+:\s+\S+\s+[=!]/u.test(line));
  if (
    headers.length !== lines.length ||
    pairs.length === 0 ||
    headers.some((line) => /^\d+:\s+\S+\s+</u.test(line))
  )
    return false;
  try {
    const authors = await Promise.all(
      pairs.map(async (line) => {
        const match = /^\d+:\s+([0-9a-f]+)\s+[=!]\s+\d+:\s+([0-9a-f]+)/u.exec(
          line,
        );
        if (!match) return false;
        const [left, right] = await Promise.all(
          [match[1]!, match[2]!].map((commit) =>
            collectGit(path, [
              "show",
              "-s",
              "--format=%an%x00%ae%x00%aI",
              commit,
            ]),
          ),
        );
        return left.stdout.equals(right.stdout);
      }),
    );
    return authors.every(Boolean);
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
