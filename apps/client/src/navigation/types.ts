import type { DragEvent as ReactDragEvent } from "react";
import { worktreeOrder } from "@iori/protocol";
import type {
  CliSummary,
  FolderHistoryItem,
  ForgeIssueRepository,
  HostInfo,
  TerminalSummary,
  Worktree,
} from "@iori/protocol";
import type { ChildRowProps } from "../teams/ChildRows.tsx";
import { elapsedTime } from "../teams/board-i18n.ts";
import { isStalledCliStatus } from "../CliStatus.tsx";
import { worktreeLabel, type WorkspaceViewKind } from "../workspace-panel.tsx";

export type SidebarFolder = { host: HostInfo; folder: FolderHistoryItem };

export type ActivityGroup = { cli?: CliSummary; count: number };

export type NavigationProps = {
  showForgeStatus: boolean;
  clisRevision: number;
  childRows: (hostKey: string, path: string) => ChildRowProps;
  isChildWorktree: (hostKey: string, path: string) => boolean;
  sessionsFor: (hostKey: string, path: string) => TerminalSummary[];
  t: (key: string) => string;
  hosts: HostInfo[];
  onReorderHosts: (keys: string[]) => void;
  collapsedKeys?: string[];
  onCollapsedChange: (keys: string[], automatic?: boolean) => void;
  loadedHistoryHosts: string[];
  onReorderFolders: (hostKey: string, paths: string[]) => void;
  observedHosts: Record<string, HostInfo>;
  homeActive: boolean;
  onHome: () => void;
  teamsHostKey?: string;
  onTeams: (host: HostInfo) => void;
  connectedHosts: string[];
  issueRepositories: Record<string, ForgeIssueRepository | null>;
  folders: SidebarFolder[];
  selected?: { hostKey: string; workspacePath: string; worktreePath: string };
  historyError: Record<string, string>;
  removeError: string;
  dragViews: boolean;
  onRetryHistory: (hostKey: string) => void;
  onDeleteWorktree: (
    host: HostInfo,
    path: string,
    cleanup: boolean,
    label?: string,
  ) => void;
  onCreate: (host: HostInfo, folder: FolderHistoryItem) => void;
  onOpenIssues: (host: HostInfo, folder: FolderHistoryItem) => void;
  onSelectWorktree: (
    host: HostInfo,
    folder: FolderHistoryItem,
    worktree: Worktree,
  ) => void;
  onOpenView: (kind: WorkspaceViewKind) => void;
  /** A worktree row's CI mark: that worktree's CI View. */
  onOpenCi: (host: HostInfo, folder: FolderHistoryItem, item: Worktree) => void;
  onDragView: (
    kind: WorkspaceViewKind,
    terminalId?: string,
    source?: { hostKey: string; workspacePath: string; worktreePath: string },
  ) => (event: ReactDragEvent<HTMLButtonElement>) => void;
  attentionCount: number;
  onAttention: () => void;
  activeTerminalId?: string;
  terminalErrors: Record<string, string>;
  onOpenTerminal: (terminalId: string, hostKey: string) => void;
  onCloseTerminal: (terminalId: string) => void;
  onAddFolder: (hostKey: string) => void;
  onRemoveFolder: (hostKey: string, folder: FolderHistoryItem) => void;
  onSettings: (hostKey?: string, repositoryPath?: string) => void;
};

export function worktreesOf(folder: FolderHistoryItem): Worktree[] {
  return folder.kind === "git"
    ? [...(folder.worktrees ?? [])].sort((a, b) =>
        worktreeOrder(
          {
            ...a,
            label: worktreeLabel(a.branch, a.path, folder.workspacePath),
          },
          {
            ...b,
            label: worktreeLabel(b.branch, b.path, folder.workspacePath),
          },
        ),
      )
    : [{ path: folder.path, detached: false, primary: true }];
}

export function parentStateLabel(
  terminal: TerminalSummary,
  t: (key: string) => string,
  now: number,
) {
  if (terminal.state === "exited" || terminal.state === "error")
    return t("Exited");
  if (terminal.cliResumePending) return t("Stopped");
  const status = terminal.cliStatus;
  if (!status) return undefined;
  if (isStalledCliStatus(status))
    return `${t("Not responding")} · ${elapsedTime(now - status.stalledSince)}`;
  if (status.state === "waiting")
    return t(status.attention?.kind === "question" ? "Question" : "Approval");
  if (status.state === "active") return t("Running");
  if (status.state === "done")
    return t(status.outcome === "failure" ? "Failed" : "Done");
  return t("Idle");
}
