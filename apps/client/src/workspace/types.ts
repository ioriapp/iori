import { creationOrder } from "@iori/protocol";
import type {
  ChildSummary,
  CliSummary,
  FolderHistoryItem,
  HostInfo,
  TerminalEvent,
  TerminalListResult,
} from "@iori/protocol";
import type { AttentionItem } from "../attention.ts";
import type { ConnectionState } from "../connection.ts";
import type { NotificationPreferences } from "../notifications.ts";
import type { TerminalLinkOpen } from "../terminal/link-click.ts";
import type { TerminalAccessoryLayout } from "../terminal/terminal-accessory-layout.ts";
import type {
  TerminalInputPreferences,
  UpdateTerminalInputPreferences,
} from "../terminal/TerminalPane.tsx";
import type { WorktreePrefill } from "../WorktreeCreator.tsx";
import {
  initialTabTitle,
  type WorkspacePanelRenderer,
  type WorkspaceTab,
  type WorkspaceTarget,
  type WorkspaceViewKind,
} from "../workspace-panel.tsx";

export type LastWorkspaceTarget = {
  hostKey: string;
  workspacePath: string;
  folderPath: string;
  worktreePath: string;
};

export type WorkspaceFrameProps = {
  onMaintenanceClisReader: (
    read: () => Record<string, Record<string, CliSummary>>,
  ) => void;
  terminalToOpen?: { hostKey: string; terminalId: string; nonce: number };
  notificationPreferences?: NotificationPreferences;
  state: ConnectionState;
  t: (key: string) => string;
  showConnection: boolean;
  disconnectedSeconds: number;
  staleNote?: string;
  onSettings: (hostKey?: string, repositoryPath?: string) => void;
  onOpenIntegrations?: (hostKey: string) => void;
  onOpenWorkspaceSettings?: (hostKey: string, workspacePath: string) => void;
  language: string;
  onClisChanged: (hostKey: string) => void;
  clisRevision: number;
  onBackHandler: (handler: () => boolean) => void;
  renderPanel?: WorkspacePanelRenderer;
  showForgeStatus?: boolean;
  doubleClickMaximize: boolean;
  panelWidths: Partial<Record<WorkspaceViewKind, number>>;
  panelFullWidth: Partial<Record<WorkspaceViewKind, boolean>>;
  onPanelWidthsChange: (
    widths: Partial<Record<WorkspaceViewKind, number>>,
  ) => void;
  onPanelFullWidthChange: (
    widths: Partial<Record<WorkspaceViewKind, boolean>>,
  ) => void;
  hostOrder?: string[];
  onReorderHosts: (keys: string[]) => void;
  sidebarWidth: number;
  onSidebarWidthChange: (width: number) => void;
  sidebarCollapsed?: string[];
  onSidebarCollapsedChange: (keys: string[], automatic?: boolean) => void;
  lastWorkspaceTarget?: LastWorkspaceTarget;
  onLastWorkspaceTargetChange: (target: LastWorkspaceTarget) => void;
  /** The key band of this device's Client settings. */
  accessoryLayout: TerminalAccessoryLayout;
  terminalFontSize: number;
  terminalFontFamily: string;
  onTerminalFontSize: (size: number, save: boolean) => void;
  terminalRightClick: "menu" | "copyPaste";
  terminalLinkOpen: TerminalLinkOpen;
  /** Undefined until this device's Client settings have been read. */
  inputPreferences?: TerminalInputPreferences;
  onInputPreferences: UpdateTerminalInputPreferences;
  /** Set when a Host's default shell changed in the settings. */
  defaultShellChange?: { hostKey: string; revision: number };
};

export type AttentionRequest = AttentionItem & { started?: boolean };

export type TeamToOpen = {
  hostKey: string;
  teamId: string;
  roleId?: string;
  nonce: number;
};

export type CreationTarget = {
  host: HostInfo;
  folder: FolderHistoryItem;
  /** "Start with this Issue": the values, and which press opened them. */
  prefill?: WorktreePrefill & { id: number };
};

export type ChildDisplayEntry = {
  displayed: ChildSummary[];
  byWorktree: Map<string, ChildSummary[]>;
  terminalIds: Set<string>;
  parentCwds: Set<string>;
  childCwds: Set<string>;
};

export type PendingFocusRequest = {
  tabId: string;
  nonce: number;
};

/** Files and a file tab are read wide, so they maximize to the full width unless set otherwise. */
export function maximizesFullWidth(
  kind: WorkspaceViewKind,
  saved: Partial<Record<WorkspaceViewKind, boolean>>,
) {
  return saved[kind] ?? (kind === "files" || kind === "file");
}

export function terminalTabId(terminalId: string) {
  return `terminal:${terminalId}`;
}

export function applyTerminalEvent(
  list: TerminalListResult,
  event: TerminalEvent,
): TerminalListResult {
  if (event.type === "terminal.closed")
    return {
      ...list,
      terminals: list.terminals.filter(
        (terminal) => terminal.id !== event.terminalId,
      ),
    };
  const index = list.terminals.findIndex(
    (terminal) => terminal.id === event.terminal.id,
  );
  const terminals = [...list.terminals];
  if (index === -1) terminals.push(event.terminal);
  else terminals[index] = event.terminal;
  return { ...list, terminals: terminals.sort(creationOrder) };
}

export function scopeKey(
  hostKey: string,
  workspacePath: string,
  worktreePath: string,
) {
  return JSON.stringify([hostKey, workspacePath, worktreePath]);
}

export function defaultTabsForTarget(
  target: WorkspaceTarget,
  mobile: boolean,
): WorkspaceTab[] {
  return (
    [
      "start",
      ...(!mobile ? ["files" as const] : []),
      ...(!mobile && target.folder.kind === "git" ? ["git" as const] : []),
    ] as const
  ).map((kind) => ({
    id: `${kind}:${crypto.randomUUID()}`,
    kind,
    title: initialTabTitle(kind),
    target,
  }));
}
