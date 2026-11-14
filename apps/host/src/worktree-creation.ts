import { parseGitWorktrees } from "./worktree-list.ts";
import { recordWorktreeBase } from "./worktree-state.ts";
import { basename, dirname, join, relative } from "node:path";
import { lstat, realpath } from "node:fs/promises";
import { randomBytes } from "node:crypto";
import type { WorktreeCreation, ResultByMethod } from "@iori/protocol";
import { collectGit } from "./git-process.ts";
import { addGitWorktree } from "./teams/worktrees.ts";
import { HostStore, type StoreContext } from "./store.ts";

export async function inventory(cwd: string) {
  const { stdout } = await collectGit(cwd, [
    "worktree",
    "list",
    "--porcelain",
    "-z",
  ]);
  return parseGitWorktrees(stdout.toString("utf8"));
}

export async function worktreeOptions(
  cwd: string,
): Promise<Omit<ResultByMethod["worktrees.options"], "setupCommand">> {
  const main = (await inventory(cwd))[0]!;
  const refs = await collectGit(cwd, [
    "for-each-ref",
    "--format=%(refname:short)%09%(symref)%09%(refname)",
    "refs/heads",
    "refs/remotes",
  ]);
  const branchRefs = refs.stdout
    .toString("utf8")
    .trim()
    .split("\n")
    .filter((ref) => ref && !ref.split("\t")[1])
    .map((ref) => {
      const [name, , fullName] = ref.split("\t");
      return { name: name!, remote: fullName!.startsWith("refs/remotes/") };
    });
  const branches = branchRefs.map((ref) => ref.name);
  const head = await collectGit(
    cwd,
    ["symbolic-ref", "--quiet", "--short", "refs/remotes/origin/HEAD"],
    undefined,
    [0, 1],
  );
  const defaultBranch = branches.includes("origin/main")
    ? "origin/main"
    : head.stdout.toString("utf8").trim() || main.branch || "HEAD";
  if (!branches.includes(defaultBranch)) branches.push(defaultBranch);
  const remoteNames = new Set(
    branchRefs.filter((ref) => ref.remote).map((ref) => ref.name),
  );
  branches.sort(
    (a, b) =>
      Number(remoteNames.has(a)) - Number(remoteNames.has(b)) ||
      a.localeCompare(b),
  );
  return {
    mainPath: await realpath(main.path),
    branches,
    defaultBranch,
  };
}

export async function worktreeSetup(cwd: string, store: HostStore) {
  const { mainPath } = await worktreeOptions(cwd);
  const command = store.worktreeSetupCommand(mainPath);
  return command.trim() ? { command, rootPath: mainPath } : undefined;
}

// Orca's worktree-logic.ts naming convention, without the optional emoji dictionary.
function namedSlug(name: string): string {
  return name
    .trim()
    .replace(/[^\p{L}\p{N}._-]+/gu, "-")
    .replace(/-+/gu, "-")
    .replace(/\.{2,}/gu, ".")
    .replace(/^[.-]+|[.-]+$/gu, "");
}

export class WorktreeCreator {
  readonly running = new Map<string, Promise<WorktreeCreation>>();
  readonly store: HostStore;
  constructor(store: HostStore) {
    this.store = store;
  }

  async status(
    context: StoreContext,
    finished = false,
  ): Promise<WorktreeCreation | undefined> {
    const saved = this.store.worktreeCreation(context);
    if (
      !finished &&
      this.running.has(`${context.clientPublicKey}:${context.operationId}`)
    )
      return saved ?? { state: "pending" };
    if (!saved || saved.state !== "pending" || !saved.path) return saved;
    // The created path locates its own repository, including nested repositories.
    // Read Git after a lost response; never replay worktree add.
    try {
      const entries = await inventory(saved.path);
      if (
        entries.some(
          (entry) =>
            relative(entry.path, saved.path!) === "" &&
            entry.branch === saved.branch,
        )
      ) {
        const result: WorktreeCreation = { ...saved, state: "created" };
        this.store.saveWorktreeCreation(context, result);
        return result;
      }
    } catch {
      /* No Git evidence yet. */
    }
    return saved;
  }

  create(
    context: StoreContext,
    cwd: string,
    name: string,
    base: string,
    setupCommand: string,
    reuseBranch = false,
  ): Promise<WorktreeCreation> {
    const key = `${context.clientPublicKey}:${context.operationId}`;
    const current = this.running.get(key);
    if (current) return current;
    const task = this.run(
      context,
      cwd,
      name,
      base,
      setupCommand,
      reuseBranch,
    ).finally(() => this.running.delete(key));
    this.running.set(key, task);
    return task;
  }

  private async run(
    context: StoreContext,
    cwd: string,
    name: string,
    base: string,
    setupCommand: string,
    reuseBranch: boolean,
  ): Promise<WorktreeCreation> {
    const previous = await this.status(context);
    if (previous) return previous;
    const save = (result: WorktreeCreation) => {
      this.store.saveWorktreeCreation(context, result);
      return result;
    };
    let planned: WorktreeCreation | undefined;
    try {
      const { mainPath } = await worktreeOptions(cwd);
      this.store.saveWorktreeSetupCommand(mainPath, setupCommand);
      const generated = !name.trim();
      const slug = generated
        ? `worktree-${randomBytes(4).toString("hex")}`
        : namedSlug(name);
      const branch = generated ? `iori/${slug}` : slug;
      if (
        !slug ||
        (
          await collectGit(
            cwd,
            ["check-ref-format", "--branch", branch],
            undefined,
            [0, 1, 128],
          )
        ).code !== 0
      )
        return save({ state: "failed", error: "invalid_name" });
      const path = join(
        await realpath(dirname(mainPath)),
        `${basename(mainPath)}-${slug}`,
      );
      const refs = await collectGit(cwd, [
        "for-each-ref",
        "--format=%(refname:strip=2)",
        "refs/heads",
      ]);
      let exists = false;
      try {
        await lstat(path);
        exists = true;
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      }
      const localBranches = refs.stdout.toString("utf8").split("\n");
      const existingBranch = reuseBranch && localBranches.includes(branch);
      if (
        exists ||
        localBranches.some(
          (existing) =>
            (existing === branch && !existingBranch) ||
            existing.startsWith(branch + "/") ||
            branch.startsWith(existing + "/"),
        ) ||
        (await inventory(cwd)).some(
          (entry) => relative(entry.path, path) === "",
        )
      )
        return save({ state: "failed", error: "name_conflict" });
      // Resolve user-supplied refs to a commit before passing the starting point to worktree add.
      const resolved = await collectGit(cwd, [
        "rev-parse",
        "--verify",
        "--end-of-options",
        `${base}^{commit}`,
      ]);
      planned = save({ state: "pending", path, branch });
      if (existingBranch)
        await collectGit(mainPath, ["worktree", "add", "--", path, branch]);
      else
        await addGitWorktree(
          mainPath,
          path,
          branch,
          resolved.stdout.toString("utf8").trim(),
        );
      if (!existingBranch)
        await recordWorktreeBase(path, resolved.stdout.toString("utf8").trim());
      return save({ ...planned, state: "created" });
    } catch {
      if (planned) {
        const actual = await this.status(context, true);
        if (actual?.state === "created") return actual;
      }
      return save({ ...planned, state: "failed", error: "git_failed" });
    }
  }
}
