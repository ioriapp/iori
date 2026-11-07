import { worktreeOrder, creationOrder } from "@iori/protocol";
import { randomUUID } from "node:crypto";
import { stopWatchingPath } from "./directory-watch.ts";
import { checkWindowsWorktreeRemoval } from "./windows/worktree-removal.ts";
import { lstat, realpath } from "node:fs/promises";
import { relative } from "node:path";
import {
  cliWorkState,
  type WorktreeRemovalItem,
  type WorktreeRemovalPreview,
  type WorktreeRemovalResult,
  type WorktreeRemovalWorking,
} from "@iori/protocol";
import { HostStore, type StoreContext } from "./store.ts";
import type { TerminalManager } from "./terminal/manager.ts";
import type { TeamManager } from "./teams/manager.ts";
import { collectGit, startGit, finishGit } from "./git-process.ts";
import { worktreeOptions, inventory } from "./worktree-creation.ts";
import {
  worktreeDirectory,
  worktreeState,
  worktreeStateReader,
} from "./worktree-state.ts";
import {
  checkChildWorktreeRemoval,
  worktreeChanges,
} from "./teams/worktrees.ts";

interface Preview {
  items: WorktreeRemovalItem[];
}
const same = (a: string, b: string) => relative(a, b) === "";
export function hasOtherRunningTerminal(
  store: HostStore,
  path: string,
  excludedTerminalId: string | undefined,
): boolean {
  return store
    .listTerminals()
    .some(
      (terminal) =>
        terminal.id !== excludedTerminalId &&
        terminal.state === "running" &&
        same(store.terminalWorktree(terminal.id) ?? terminal.cwd, path),
    );
}
const workOrder: Record<WorktreeRemovalWorking["state"], number> = {
  running: 0,
  approval: 1,
  question: 2,
};

export class WorktreeRemover {
  readonly previews = new Map<string, Preview>();
  readonly store: HostStore;
  readonly terminals: () => TerminalManager;
  readonly teams: () => TeamManager;
  readonly stopRepositoryWatches: (path: string) => (removed: string[]) => void;
  constructor(
    store: HostStore,
    terminals: () => TerminalManager,
    teams: () => TeamManager,
    stopRepositoryWatches: (path: string) => (removed: string[]) => void,
  ) {
    this.store = store;
    this.terminals = terminals;
    this.teams = teams;
    this.stopRepositoryWatches = stopRepositoryWatches;
  }

  async preview(
    path: string,
    cleanup: boolean,
  ): Promise<WorktreeRemovalPreview> {
    path = await realpath(path);
    const { mainPath } = await worktreeOptions(path);
    let fetchFailed = false;
    if (cleanup)
      await collectGit(mainPath, ["fetch"]).catch(() => {
        fetchFailed = true;
      });
    const records = await inventory(mainPath);
    const terminals = new Map(
      this.store.listTerminals().map((terminal) => [terminal.id, terminal]),
    );
    const terminalActivity = (
      id: string,
      title: string,
      teamChild = false,
    ): WorktreeRemovalItem["terminals"][number] => {
      const terminal = terminals.get(id);
      const cliOpen = this.terminals().isCliRunning(id);
      const kind = cliOpen
        ? teamChild
          ? "team-child"
          : "cli"
        : terminal?.state === "running"
          ? "terminal"
          : false;
      return { id, title, open: kind };
    };
    const stateOf = await worktreeStateReader(mainPath, records);
    const targets = new Map<string, WorktreeRemovalItem>();
    const empty = new Set<string>();
    const childRecords = this.store.teamChildren();
    const childOf = new Map(childRecords.map((child) => [child.id, child]));
    const childByTerminal = new Map(
      childRecords.flatMap((child) =>
        child.terminalId ? [[child.terminalId, child] as const] : [],
      ),
    );
    const inspect = async (
      path: string,
      children = true,
    ): Promise<WorktreeRemovalItem> => {
      const ownMain = children
        ? mainPath
        : (await worktreeOptions(path)).mainPath;
      await checkChildWorktreeRemoval(ownMain, path);
      const symbolic = await collectGit(
        path,
        ["symbolic-ref", "--quiet", "--short", "HEAD"],
        undefined,
        [0, 1],
      );
      const branch = symbolic.stdout.toString("utf8").trim() || undefined;
      const detachedCommits =
        symbolic.code === 1
          ? await collectGit(path, [
              "rev-list",
              "--count",
              "HEAD",
              "--not",
              "--branches",
              "--tags",
              "--remotes",
            ])
              .then((result) => Number(result.stdout.toString("utf8").trim()))
              .catch(() => undefined)
          : undefined;
      const state = same(ownMain, mainPath)
        ? await stateOf(path, branch)
        : await worktreeState(path, branch);
      if (state.createdCommits === 0) empty.add(path);
      const conversations = new Set(
        children
          ? this.store
              .teamConversations()
              .filter((c) => same(c.cwd, path))
              .map((c) => c.id)
          : [],
      );
      const all = children ? [...childRecords].sort(creationOrder) : [];
      const teamChildren = all.filter((child) =>
        conversations.has(child.conversation),
      );
      const childTerminalIds = new Set(
        teamChildren.flatMap((child) =>
          child.terminalId ? [child.terminalId] : [],
        ),
      );
      const item: WorktreeRemovalItem = {
        path,
        branch,
        changes: cleanup
          ? {
              files: (
                await collectGit(path, [
                  "status",
                  "--porcelain",
                  "--untracked-files=normal",
                ])
              ).stdout.length
                ? 1
                : 0,
              added: 0,
              removed: 0,
            }
          : await worktreeChanges(path),
        target: state.target,
        commits: state.commits,
        ...(detachedCommits && detachedCommits > 0 ? { detachedCommits } : {}),
        merged: state.merged,
        deleteBranch: !!branch && (state.merged || state.createdCommits === 0),
        terminals: [...terminals.values()]
          .filter((terminal) =>
            same(
              this.store.terminalWorktree(terminal.id) ?? terminal.cwd,
              path,
            ),
          )
          .map(({ id, title }) =>
            terminalActivity(id, title, childTerminalIds.has(id)),
          ),
        children: [],
        worktrees: [],
      };
      targets.set(path, item);
      if (children) {
        for (const child of teamChildren) {
          const exists = child.cwd
            ? await realpath(child.cwd).catch(() => undefined)
            : undefined;
          const remove =
            !!exists &&
            !!child.cwd &&
            !same(child.cwd, path) &&
            child.createdWorktree === child.cwd &&
            !all.some(
              (other) =>
                other.id !== child.id &&
                other.cwd === child.cwd &&
                (other.state === "waiting" ||
                  this.terminals().isCliRunning(other.terminalId ?? "")),
            ) &&
            !hasOtherRunningTerminal(this.store, child.cwd, child.terminalId) &&
            !this.store
              .teamConversations()
              .some((c) => !conversations.has(c.id) && c.cwd === child.cwd);
          item.children.push({
            id: child.id,
            title: child.title,
            path: child.cwd,
            remove,
            open: Boolean(
              child.terminalId &&
              this.terminals().isCliRunning(child.terminalId),
            ),
          });
          if (child.terminalId) {
            if (!item.terminals.some((t) => t.id === child.terminalId))
              item.terminals.push(
                terminalActivity(child.terminalId, child.title, true),
              );
          }
          if (
            remove &&
            child.cwd &&
            !item.worktrees.some((worktree) => worktree.path === child.cwd)
          )
            item.worktrees.push(
              targets.get(child.cwd) ?? (await inspect(child.cwd, false)),
            );
        }
      }
      return item;
    };
    const work = (items: WorktreeRemovalItem[]): WorktreeRemovalWorking[] => {
      // Only the children this deletion takes in are shown from their child
      // record; a child of another conversation stays a child of its record too.
      const taken = new Set<string>();
      const collect = (item: WorktreeRemovalItem) => {
        for (const child of item.children) taken.add(child.id);
        item.worktrees.forEach(collect);
      };
      items.forEach(collect);
      const found: (WorktreeRemovalWorking & { at: number })[] = [];
      const seen = new Set<string>();
      const visit = (item: WorktreeRemovalItem) => {
        for (const terminal of item.terminals) {
          if (terminal.open !== "cli" || seen.has(terminal.id)) continue;
          seen.add(terminal.id);
          const status = this.terminals().summary(terminal.id)?.cliStatus;
          const child = childByTerminal.get(terminal.id);
          if (child) {
            if (taken.has(child.id)) continue;
            const state = cliWorkState(status, child);
            if (state)
              found.push({
                id: child.id,
                name: child.title,
                state,
                at: child.createdAt,
              });
            continue;
          }
          const state = cliWorkState(status);
          if (state)
            found.push({
              id: terminal.id,
              name: terminal.title,
              state,
              at: terminals.get(terminal.id)?.createdAt ?? 0,
            });
        }
        for (const item_ of item.children) {
          const child = childOf.get(item_.id);
          if (!child || seen.has(child.id)) continue;
          seen.add(child.id);
          const status = child.terminalId
            ? this.terminals().summary(child.terminalId)?.cliStatus
            : undefined;
          const state = cliWorkState(status, child);
          if (state)
            found.push({
              id: child.id,
              name: child.title,
              state,
              at: child.createdAt,
            });
        }
        item.worktrees.forEach(visit);
      };
      items.forEach(visit);
      return found
        .sort((a, b) => workOrder[a.state] - workOrder[b.state] || a.at - b.at)
        .map(({ id, name, state }) => ({ id, name, state }));
    };
    const items: WorktreeRemovalItem[] = [];
    if (cleanup) {
      for (const record of records) {
        if (same(record.path, mainPath)) continue;
        try {
          const item = await inspect(await realpath(record.path));
          const eligible = (
            item: WorktreeRemovalItem,
            child = false,
          ): boolean =>
            (item.merged || (child && empty.has(item.path))) &&
            item.changes.files === 0 &&
            item.worktrees.every((child) => eligible(child, true)) &&
            item.terminals.every(({ id }) => {
              const cli = this.store.terminalCli(id)?.runtime?.status;
              return cli?.state !== "active" && cli?.state !== "waiting";
            });
          if (eligible(item)) items.push(item);
        } catch {
          /* Unreadable or prunable worktrees are not cleanup candidates. */
        }
      }
      const grouped = new Set(
        items.flatMap((item) => item.worktrees.map((child) => child.path)),
      );
      for (let index = items.length - 1; index >= 0; index--)
        if (grouped.has(items[index]!.path)) items.splice(index, 1);
    } else items.push(await inspect(path));
    const id = randomUUID();
    items.sort(worktreeOrder);
    this.previews.set(id, { items });
    return {
      id,
      items,
      fetchFailed,
      ...(cleanup ? {} : { working: work(items) }),
    };
  }

  async remove(
    context: StoreContext,
    previewId: string,
    paths: string[],
    branches: string[],
  ): Promise<WorktreeRemovalResult> {
    const preview = this.previews.get(previewId);
    if (!preview) throw new Error("Open the deletion dialog again.");
    const selected = preview.items.filter((item) => paths.includes(item.path));
    const outcomes: WorktreeRemovalResult["outcomes"] = [];
    const repositories = new Map<string, (removed: string[]) => void>();
    const exists = async (path: string) => {
      try {
        await lstat(path);
        return true;
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;
        throw error;
      }
    };
    const remove = async (item: WorktreeRemovalItem): Promise<boolean> => {
      let error: string | undefined;
      const finishWatches: Array<(restore: boolean) => void> = [];
      try {
        for (const child of item.children)
          await this.teams().stopChild(
            { ...context, operationId: randomUUID() },
            child.id,
          );
        for (const terminal of item.terminals) {
          await this.terminals().stopTeamTerminal(terminal.id);
          const result = await this.terminals().closeTerminal(
            { ...context, operationId: randomUUID() },
            terminal.id,
            true,
          );
          if (!result.ok) throw new Error("Could not stop a Terminal.");
        }
        for (const child of item.worktrees)
          if (!(await remove(child)))
            throw new Error(
              "A child worktree could not be removed. Retry after resolving its error.",
            );
        const state = await worktreeState(item.path, item.branch);
        const branch = (
          await collectGit(
            item.path,
            ["symbolic-ref", "--quiet", "--short", "HEAD"],
            undefined,
            [0, 1],
          )
        ).stdout
          .toString("utf8")
          .trim();
        const deleteBranch =
          !!branch &&
          branch === item.branch &&
          ((item.deleteBranch &&
            (state.merged || state.createdCommits === 0)) ||
            branches.includes(branch));
        const { mainPath: ownMain } = await worktreeOptions(item.path);
        if (!repositories.has(ownMain))
          repositories.set(ownMain, this.stopRepositoryWatches(ownMain));
        finishWatches.push(await stopWatchingPath(item.path));
        finishWatches.push(
          await stopWatchingPath(await worktreeDirectory(item.path)),
        );
        if (process.platform === "win32")
          await checkWindowsWorktreeRemoval(item.path);
        const removal = startGit(ownMain, [
          "worktree",
          "remove",
          "--force",
          "--",
          item.path,
        ]);
        removal.child.stdout.resume();
        const code = await finishGit(removal, undefined, [0, 1, 128, 255]);
        if (code !== 0)
          error =
            removal.stderr().trim() ||
            "Git refused removal. Check whether the worktree is locked or files are open, then retry.";
        if (!(await exists(item.path))) {
          if (deleteBranch && item.branch) {
            const result = await collectGit(
              ownMain,
              ["branch", "-D", "--", item.branch],
              undefined,
              [0, 1, 128],
            );
            if (result.code !== 0)
              error =
                "The worktree was removed, but Git could not delete its branch.";
          }
        }
      } catch (reason) {
        error =
          reason instanceof Error
            ? reason.message
            : "Could not delete the worktree.";
      }
      const removed = !(await exists(item.path));
      for (const finish of finishWatches) finish(!removed);
      outcomes.push({ path: item.path, removed, ...(error ? { error } : {}) });
      return removed;
    };
    for (const item of selected) {
      const start = outcomes.length;
      await remove(item);
      const removed = outcomes
        .slice(start)
        .filter((outcome) => outcome.removed)
        .map((outcome) => outcome.path);
      // Remove the completed group from the sidebar before dropping child
      // identities. Otherwise the old list briefly exposes them as parent rows.
      for (const publish of repositories.values()) publish(removed);
      for (const path of removed) this.teams().forgetWorktree(path);
    }
    return { outcomes };
  }
}
