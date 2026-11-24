import type { TerminalSummary, Worktree } from "@iori/protocol";
import { samePath } from "../host-path.ts";
import type { AgentTarget } from "../forge/AgentTargetPicker.tsx";

function basename(path: string) {
  const parts = path.replace(/[\\/]+$/u, "").split(/[\\/]/u);
  return parts.at(-1) || path;
}

function worktreeLabel(
  branch: string | undefined,
  worktreePath: string,
  workspacePath: string,
) {
  const folderName = basename(worktreePath);
  const repositoryName = basename(workspacePath);
  return (
    branch ??
    (folderName.startsWith(`${repositoryName}-`)
      ? folderName.slice(repositoryName.length + 1)
      : folderName)
  );
}

export type ResolveAgentTargetsInput = {
  selectedCwd: string;
  workspacePath: string;
  terminals: readonly TerminalSummary[];
  childTerminalIds: ReadonlySet<string>;
  repoWorktrees: readonly Worktree[];
  lastTerminalId?: string;
};

function sortPreferred(
  list: readonly TerminalSummary[],
  lastTerminalId?: string,
): TerminalSummary[] {
  return [...list].sort((a, b) => {
    if (a.id === lastTerminalId) return -1;
    if (b.id === lastTerminalId) return 1;
    return 0;
  });
}

function toTarget(
  terminal: TerminalSummary,
  repoWorktrees: readonly Worktree[],
  workspacePath: string,
): AgentTarget {
  const path = terminal.worktreePath ?? terminal.cwd;
  const worktree = repoWorktrees.find((item) => samePath(item.path, path));
  const label = worktree
    ? worktreeLabel(worktree.branch, worktree.path, workspacePath)
    : basename(path);
  return {
    terminalId: terminal.id,
    worktreePath: path,
    label,
    isTeamParent: Boolean(terminal.teamConversation),
    ...(terminal.cli?.name ? { cliName: terminal.cli.name } : {}),
  };
}

/**
 * Resolves eligible Agent/Terminal destinations for inserting review comments
 * or CI failure context without Enter:
 * 1. Always excludes Team child terminals.
 * 2. Prefers the currently displayed workspace layout's worktree (`selectedCwd`):
 *    Team parent (Orchestrator) -> standalone CLI -> plain Terminal.
 * 3. When `selectedCwd` has no eligible terminal (e.g. viewing `main`'s CI
 *    while working in a feature worktree), falls back to Team parents or
 *    standalone CLIs in other worktrees of the same repository.
 */
export function resolveAgentTargets({
  selectedCwd,
  workspacePath,
  terminals,
  childTerminalIds,
  repoWorktrees,
  lastTerminalId,
}: ResolveAgentTargetsInput): AgentTarget[] {
  const nonChild = terminals.filter(
    (terminal) =>
      !terminal.teamChild &&
      !childTerminalIds.has(terminal.id) &&
      terminal.state !== "exited" &&
      terminal.state !== "error" &&
      !terminal.cliResumePending,
  );
  if (nonChild.length === 0) return [];

  const local = nonChild.filter((terminal) =>
    samePath(terminal.worktreePath ?? terminal.cwd, selectedCwd),
  );
  if (local.length > 0) {
    const pickOne = (pool: readonly TerminalSummary[]) => {
      const ordered = sortPreferred(pool, lastTerminalId);
      const chosen =
        ordered.find((t) => t.id === lastTerminalId) ?? ordered.at(-1);
      return chosen ? [toTarget(chosen, repoWorktrees, workspacePath)] : [];
    };
    const teamParents = local.filter((terminal) =>
      Boolean(terminal.teamConversation),
    );
    if (teamParents.length > 0) return pickOne(teamParents);
    const clis = local.filter((terminal) => Boolean(terminal.cli));
    if (clis.length > 0) return pickOne(clis);
    return pickOne(local);
  }

  // Fallback across other worktrees of the same repository.
  const repoNonChild = nonChild.filter((terminal) =>
    repoWorktrees.some((wt) =>
      samePath(terminal.worktreePath ?? terminal.cwd, wt.path),
    ),
  );
  if (repoNonChild.length === 0) return [];

  const repoTeamParents = sortPreferred(
    repoNonChild.filter((terminal) => Boolean(terminal.teamConversation)),
    lastTerminalId,
  );
  if (repoTeamParents.length > 0) {
    return repoTeamParents.map((terminal) =>
      toTarget(terminal, repoWorktrees, workspacePath),
    );
  }
  const repoClis = sortPreferred(
    repoNonChild.filter((terminal) => Boolean(terminal.cli)),
    lastTerminalId,
  );
  return repoClis.map((terminal) =>
    toTarget(terminal, repoWorktrees, workspacePath),
  );
}
