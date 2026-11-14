import { createContext, useContext } from "react";
import type { ReactNode } from "react";
import {
  CircleDot,
  Play,
  Files,
  File,
  GitBranch,
  LayoutDashboard,
  Terminal as TerminalIcon,
  Workflow,
} from "lucide-react";
import type {
  FolderHistoryItem,
  HostInfo,
  Worktree,
  CliSummary,
  CliStatus,
} from "@iori/protocol";
import { samePath } from "./host-path.ts";
import type { WorktreeChoice } from "./reading/WorktreePicker.tsx";

export type WorkspaceViewKind =
  "start" | "file" | "files" | "git" | "terminal" | "board" | "issues" | "ci";

export function initialTabTitle(
  kind: Exclude<WorkspaceViewKind, "terminal" | "file">,
): string {
  return {
    start: "Start",
    files: "Files",
    git: "Git",
    board: "Board",
    issues: "Issues",
    ci: "CI",
  }[kind];
}

/**
 * Contract for the Files, Git, and Terminal panel implementations.
 * folderPath is the folder explicitly opened by the user; workspacePath groups
 * repository worktrees; cwd is the selected worktree root or non-Git folder.
 */
export type WorkspacePanelProps = {
  file?: OpenFile;
  fileOpenRequest?: FileOpenRequest;
  onFileOpened: (id: number) => void;
  onOpenFile: (file: OpenFile, standalone?: boolean) => void;
  tabId: string;
  panelId: string;
  kind: WorkspaceViewKind;
  host: HostInfo;
  folderPath: string;
  workspacePath: string;
  worktreePath: string;
  cwd: string;
  /** The Host Terminal shown by a terminal tab. */
  terminalId?: string;
  /** Whether the view is on screen: the selected tab of its group, or the
   * Mobile view being shown. Retained views stay mounted while hidden. */
  visible: boolean;
  /** The View's own state as saved with the worktree's layout, read once. */
  viewState?: unknown;
  /** Saves the View's state with the worktree's layout. */
  onViewState: (state: unknown) => void;
  /** What going back does in this View first (detail → list); undefined when
   * the View has nothing to go back to. */
  onBackHandler: (handler: (() => boolean) | undefined) => void;
  /** Shows the history of this file in the worktree's Git View. */
  onFileHistory: (absolutePath: string) => void;
  /** A file whose history this Git View is asked to show. */
  fileHistoryRequest?: FileHistoryRequest;
  /** The request was shown; it is not shown again. */
  onFileHistoryShown: (id: number) => void;
  /** The worktrees of the opened folder, to switch this View between. */
  worktrees: WorktreeChoice[];
  onSelectWorktree: (path: string) => void;
  /** The sidebar's CI mark asked this CI View to show its failed job. */
  ciOpenRequest?: CiOpenRequest;
  onCiOpenShown: (id: number) => void;
  /** Opens this repository's worktree screen filled in for the Issue. */
  onStartIssue: (issue: StartIssue) => void;
};

/** An Issue that "Start with this Issue" fills the worktree screen for. */
export type StartIssue = { number: number; title: string };

export type { WorktreeChoice } from "./reading/WorktreePicker.tsx";

export type OpenFile = {
  absolutePath: string;
  root: string;
  path: string;
  displayPath: string;
  line?: number;
  column?: number;
};
export type FileOpenRequest = {
  tabId: string;
  path: string;
  line?: number;
  id: number;
};

export type FileHistoryRequest = { tabId: string; path: string; id: number };
export type CiOpenRequest = { tabId: string; id: number };

/** The frame's side of the Views: their saved state, back and history requests. */
export type WorkspaceViewServices = {
  openFile: (file: OpenFile, standalone?: boolean) => void;
  fileOpenRequest?: FileOpenRequest;
  fileOpened: (id: number) => void;
  viewState: (key: string) => unknown;
  setViewState: (key: string, state: unknown) => void;
  setBackHandler: (key: string, handler: (() => boolean) | undefined) => void;
  openFileHistory: (absolutePath: string, worktreePath: string) => void;
  fileHistoryRequest?: FileHistoryRequest;
  fileHistoryShown: (id: number) => void;
  worktrees: WorktreeChoice[];
  selectWorktree: (tabId: string, path: string) => void;
  ciOpenRequest?: CiOpenRequest;
  ciOpenShown: (id: number) => void;
  startIssue: (target: WorkspaceTarget, issue: StartIssue) => void;
};

export const WorkspaceViewServicesContext =
  createContext<WorkspaceViewServices | null>(null);

/** A View's state belongs to its panel; the Mobile view uses the tab's first panel. */
export const viewStateKey = (panelId: string) =>
  panelId.replace(/^mobile:/, "");

export type WorkspacePanelRenderer = (props: WorkspacePanelProps) => ReactNode;

export type WorkspaceTarget = {
  host: HostInfo;
  folder: FolderHistoryItem;
  folderPath: string;
  worktree: Worktree;
  cwd: string;
};

export type WorkspaceTab = {
  file?: OpenFile;
  id: string;
  kind: WorkspaceViewKind;
  title: string;
  cli?: CliSummary;
  cliStatus?: CliStatus;
  /** The Host Terminal of a terminal tab; one tab per Terminal. */
  terminalId?: string;
  childId?: string;
  canStopChild?: boolean;
  filesWorktreePath?: string;
  gitWorktreePath?: string;
  ciWorktreePath?: string;
  target: WorkspaceTarget;
};

export const viewIcons = {
  start: Play,
  board: LayoutDashboard,
  file: File,
  files: Files,
  git: GitBranch,
  terminal: TerminalIcon,
  issues: CircleDot,
  ci: Workflow,
};

export function basename(path: string) {
  const parts = path.replace(/[\\/]+$/, "").split(/[\\/]/);
  return parts.at(-1) || path;
}

export function worktreeLabel(
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

export function tabTitle(tab: WorkspaceTab, t: (key: string) => string) {
  return tab.kind === "start" || tab.kind === "files" || tab.kind === "git"
    ? t(tab.title)
    : tab.title;
}

const WorkspacePanelContext = createContext<WorkspacePanelProps | null>(null);

export function useWorkspacePanel() {
  const target = useContext(WorkspacePanelContext);
  if (!target) throw new Error("Workspace panel context is missing");
  return target;
}

function PanelPlaceholder({
  kind,
  host,
  folderPath,
  workspacePath,
  worktreePath,
  cwd,
  t,
}: WorkspacePanelProps & { t: (key: string) => string }) {
  const Icon = viewIcons[kind];
  return (
    <section
      className="workspace-panel-placeholder"
      data-iori-panel-kind={kind}
    >
      <h2>
        <Icon aria-hidden="true" size={16} />
        {kind === "files" ? t("Files") : kind === "git" ? "Git" : t("Terminal")}
      </h2>
      <dl>
        <dt>{t("Host")}</dt>
        <dd>{host.hostName}</dd>
        <dt>{t("Opened folder")}</dt>
        <dd title={folderPath}>{folderPath}</dd>
        <dt>{t("Repository")}</dt>
        <dd title={workspacePath}>{workspacePath}</dd>
        <dt>{t("Worktree")}</dt>
        <dd title={worktreePath}>{worktreePath}</dd>
        <dt>{t("Working directory")}</dt>
        <dd title={cwd}>{cwd}</dd>
      </dl>
    </section>
  );
}

export function panelProps(
  tab: WorkspaceTab,
  panelId: string,
  visible: boolean,
  services: WorkspaceViewServices | null,
) {
  const key = viewStateKey(panelId);
  const selectedPath =
    tab.kind === "git"
      ? tab.gitWorktreePath
      : tab.kind === "ci"
        ? tab.ciWorktreePath
        : tab.filesWorktreePath;
  const selectedWorktree = selectedPath
    ? services?.worktrees.find((worktree) =>
        samePath(worktree.path, selectedPath),
      )
    : undefined;
  const path = selectedWorktree?.path ?? tab.target.cwd;
  const reading =
    tab.kind === "files" || tab.kind === "git" || tab.kind === "ci";
  const stateKey = reading ? `${key}:reading:${path}` : key;
  return {
    file: tab.file,
    fileOpenRequest:
      services?.fileOpenRequest?.tabId === tab.id
        ? services.fileOpenRequest
        : undefined,
    onFileOpened: (id) => services?.fileOpened(id),
    onOpenFile: (file, standalone) => services?.openFile(file, standalone),
    tabId: tab.id,
    panelId,
    kind: tab.kind,
    host: tab.target.host,
    folderPath: tab.target.folderPath,
    workspacePath: tab.target.folder.workspacePath,
    worktreePath: reading ? path : tab.target.worktree.path,
    cwd: reading ? path : tab.target.cwd,
    terminalId: tab.terminalId,
    visible,
    viewState: services?.viewState(stateKey),
    onViewState: (state) => services?.setViewState(stateKey, state),
    onBackHandler: (handler) => services?.setBackHandler(key, handler),
    onFileHistory: (absolutePath) =>
      services?.openFileHistory(absolutePath, path),
    fileHistoryRequest:
      services?.fileHistoryRequest?.tabId === tab.id
        ? services.fileHistoryRequest
        : undefined,
    onFileHistoryShown: (id) => services?.fileHistoryShown(id),
    worktrees: services?.worktrees ?? [],
    onSelectWorktree: (path) => services?.selectWorktree(tab.id, path),
    ciOpenRequest:
      services?.ciOpenRequest?.tabId === tab.id
        ? services.ciOpenRequest
        : undefined,
    onCiOpenShown: (id) => services?.ciOpenShown(id),
    onStartIssue: (issue) => services?.startIssue(tab.target, issue),
  } satisfies WorkspacePanelProps;
}

/** Renders one tab's content for both the PC dock and the Mobile full-screen view. */
export function PanelView({
  tab,
  panelId,
  renderPanel,
  visible,
  t,
}: {
  tab: WorkspaceTab;
  panelId: string;
  renderPanel?: WorkspacePanelRenderer;
  visible: boolean;
  t: (key: string) => string;
}) {
  const props = panelProps(
    tab,
    panelId,
    visible,
    useContext(WorkspaceViewServicesContext),
  );
  return (
    <WorkspacePanelContext.Provider value={props}>
      {renderPanel?.(props) ?? <PanelPlaceholder {...props} t={t} />}
    </WorkspacePanelContext.Provider>
  );
}

/**
 * Dockview shows a panel's content (its render overlay) one animation frame
 * after the panel becomes visible, and a hidden element cannot take focus.
 * Consume the request once that frame has passed. A newer focus choice or an
 * open popup owns input now, so an older tab selection must not take it back.
 */
export function focusAfterDockLayout(
  target: HTMLElement,
  consume: (takeFocus: boolean) => void,
) {
  const previousFocus = document.activeElement;
  let frame = requestAnimationFrame(() => {
    frame = requestAnimationFrame(() => {
      const currentFocus = document.activeElement;
      const popup = currentFocus?.closest(
        '[data-state="open"][role="dialog"], [data-state="open"][role="menu"], [data-state="open"][role="listbox"]',
      );
      consume(
        (!popup || popup.contains(target)) &&
          (currentFocus === previousFocus ||
            target.contains(currentFocus) ||
            (currentFocus === document.body && !previousFocus?.isConnected)),
      );
    });
  });
  return () => cancelAnimationFrame(frame);
}

// CLI window titles can contain an empty title before their worktree suffix.
export function terminalTitle(title: string) {
  return title.replace(/^\s*\|\s*/u, "");
}
