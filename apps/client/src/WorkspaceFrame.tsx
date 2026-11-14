import { createWorkspaceDockAdapter } from "./workspace-dock-adapter.ts";
import { UsageStatus } from "./usage/UsageStatus.tsx";
import {
  pruneLayout,
  type LayoutSlot,
  type LayoutSlotKind,
  type WorktreeLayoutTemplate,
} from "./new-worktree-layout.ts";
import { worktreeLayoutDefault } from "./new-worktree-layout-store.ts";
import {
  useIssueRepositories,
  issueRepositoryKey,
} from "./issues/issue-repositories.ts";
import { creationOrder, issueWorktreeName, sidebarOrder } from "@iori/protocol";
import {
  locallyRemoving,
  useWorktreeRemovalFlow,
  worktreeRemovalFlow,
} from "./worktree-removal-flow.ts";
import { WorktreeRemoval } from "./WorktreeRemoval.tsx";
import { WorktreeCreator, type WorktreePrefill } from "./WorktreeCreator.tsx";
import { useMobileBoards } from "./teams/mobile-boards.ts";
import { Board } from "./teams/Board.tsx";
import { childCliStatus, useTeamChildren } from "./teams/children.ts";
import type { ChildSummary } from "@iori/protocol";
import { TeamsScreen } from "./teams/TeamsScreen.tsx";
import type { LeaveGuard } from "./teams/TeamEditor.tsx";
import { samePath, hostPathKey } from "./host-path.ts";
import type { AttentionItem } from "./attention.ts";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import type {
  CSSProperties,
  DragEvent as ReactDragEvent,
  PointerEvent as ReactPointerEvent,
} from "react";
import { hasWindowChrome } from "./native.ts";
import type { DockviewApi, SerializedDockview } from "dockview-react";
import { createPortal } from "react-dom";
import { X } from "lucide-react";
import type {
  Event as HostEvent,
  FolderHistoryItem,
  HostInfo,
  TerminalEvent,
  CliSummary,
  TerminalListResult,
  TerminalShell,
  TerminalSummary,
  Worktree,
} from "@iori/protocol";
import { connection, type ConnectionState } from "./connection.ts";
import { DEFAULT_SIDEBAR_WIDTH } from "./Settings.tsx";
import { native } from "./native.ts";
import { Button } from "./components/ui/button.tsx";
import { ScrollArea } from "./components/ui/scroll-area.tsx";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "./components/ui/dialog.tsx";
import {
  SidebarProvider,
  SidebarTrigger,
  useSidebar,
} from "./components/ui/sidebar.tsx";
import { TooltipProvider } from "./components/ui/tooltip.tsx";
import { StatusDot } from "./components/StatusDot.tsx";
import { Navigation, worktreesOf } from "./Navigation.tsx";
import {
  DockLayout,
  sidebarViewTransferType,
  type DockContextValue,
  type DockGroup,
  type DropDirection,
} from "./DockLayout.tsx";
import { MobileWorkspace } from "./MobileWorkspace.tsx";
import { MobileHome, type OpenWorktree } from "./MobileHome.tsx";
import { CliLauncher, type ShellStatus } from "./CliLauncher.tsx";
import { FolderPicker } from "./FolderPicker.tsx";
import {
  TerminalPane,
  type TerminalInputPreferences,
  type UpdateTerminalInputPreferences,
} from "./terminal/TerminalPane.tsx";
import type { TerminalLinkOpen } from "./terminal/link-click.ts";
import type { TerminalAccessoryLayout } from "./terminal/terminal-accessory-layout.ts";
import { useTerminalClose } from "./terminal/terminal-close.tsx";
import { terminalDropText } from "./terminal/terminal-drop-path.ts";
import { typeIntoTerminal } from "./terminal/terminal-input.ts";
import {
  basename,
  worktreeLabel,
  terminalTitle,
  PanelView,
  initialTabTitle,
  WorkspaceViewServicesContext,
  type CiOpenRequest,
  type FileHistoryRequest,
  type WorkspacePanelRenderer,
  type WorkspaceTab,
  type WorkspaceTarget,
  type WorkspaceViewKind,
  type WorkspaceViewServices,
  type FileOpenRequest,
} from "./workspace-panel.tsx";
import "./workspace.css";
import {
  useCliNotifications,
  type NotificationPreferences,
} from "./notifications.ts";
import { useCliList } from "./cli-list.ts";
import {
  addWorkspaceTab,
  closeWorkspaceTab,
  closeMobileWorkspaceTab,
  forgetWorkspacePanelState,
  setWorkspaceViewState,
  rememberWorkspaceTerminal,
  createWorkspaceStore,
  missingWorkspaceTerminals,
  replaceWorkspaceStartTab,
  selectWorkspaceReadingWorktree,
  selectWorkspaceTab,
  terminalWorkspaceTab,
  readWorkspaceState,
  writeSavedLayout,
  type SavedLayout,
} from "./workspace-state.ts";

export {
  useWorkspacePanel,
  type WorkspacePanelProps,
  type WorkspacePanelRenderer,
  type WorkspaceViewKind,
} from "./workspace-panel.tsx";

export type LastWorkspaceTarget = {
  hostKey: string;
  workspacePath: string;
  folderPath: string;
  worktreePath: string;
};

/** Files and a file tab are read wide, so they maximize to the full width unless set otherwise. */
function maximizesFullWidth(
  kind: WorkspaceViewKind,
  saved: Partial<Record<WorkspaceViewKind, boolean>>,
) {
  return saved[kind] ?? (kind === "files" || kind === "file");
}

type Props = {
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

function terminalTabId(terminalId: string) {
  return `terminal:${terminalId}`;
}

function applyTerminalEvent(
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

function scopeKey(
  hostKey: string,
  workspacePath: string,
  worktreePath: string,
) {
  return JSON.stringify([hostKey, workspacePath, worktreePath]);
}

function StatusBar({
  state,
  t,
  showConnection,
  disconnectedSeconds,
  staleNote,
  language,
  clisRevision,
  usageHost,
  defaultShellChange,
}: { usageHost: string } & Pick<
  Props,
  | "state"
  | "t"
  | "showConnection"
  | "disconnectedSeconds"
  | "staleNote"
  | "language"
  | "clisRevision"
  | "defaultShellChange"
>) {
  const reconnecting =
    !state.connected && !state.revoked && disconnectedSeconds >= 5;
  return (
    <div className="status-bar">
      {showConnection && state.host && state.connected && (
        <span data-iori-state="connected">
          <StatusDot
            state="active"
            animated={false}
            aria-label={t("Connected")}
          />
          {t("Connected")}
        </span>
      )}
      {showConnection && state.host && reconnecting && (
        <span data-iori-state="disconnected">
          <StatusDot state="stopped" aria-label={t("Reconnecting…")} />
          {t("Reconnecting…")}
          <Button
            variant="ghost"
            size="sm"
            data-iori-action="reconnect"
            onClick={() => void connection.reconnect()}
          >
            {t("Reconnect")}
          </Button>
        </span>
      )}
      {showConnection && staleNote && <span>{staleNote}</span>}
      <UsageStatus
        key={usageHost}
        hostKey={usageHost}
        connected={state.connectedHosts.includes(usageHost)}
        revision={`${clisRevision}:${defaultShellChange?.revision ?? 0}:${state.connectedHosts.join(",")}`}
        language={language}
      />
    </div>
  );
}

function WorkspaceFrameInner({
  terminalToOpen,
  notificationPreferences,
  state,
  t,
  onSettings,
  onOpenIntegrations,
  onOpenWorkspaceSettings,
  language,
  onClisChanged,
  clisRevision,
  onBackHandler,
  renderPanel,
  showForgeStatus = true,
  doubleClickMaximize,
  panelWidths,
  panelFullWidth,
  onPanelWidthsChange,
  onPanelFullWidthChange,
  hostOrder,
  onReorderHosts,
  sidebarWidth,
  onSidebarWidthChange,
  sidebarCollapsed,
  onSidebarCollapsedChange,
  lastWorkspaceTarget,
  onLastWorkspaceTargetChange,
  accessoryLayout,
  terminalFontSize,
  terminalFontFamily,
  onTerminalFontSize,
  terminalRightClick,
  terminalLinkOpen,
  inputPreferences,
  onInputPreferences,
  defaultShellChange,
  onMaintenanceClisReader,
  onUsageHostChange,
}: Props & { onUsageHostChange: (hostKey: string) => void }) {
  const { isMobile, openMobile, setOpenMobile } = useSidebar();
  const [teamsHost, setTeamsHost] = useState<HostInfo>();
  const [openedTeams, setOpenedTeams] = useState<HostInfo[]>([]);
  const [teamsInitialPage, setTeamsInitialPage] = useState<
    "agents" | "teams"
  >();
  const teamBacks = useRef(new Map<string, () => boolean>());
  const teamGuards = useRef(new Map<string, LeaveGuard>());
  const teamsHostRef = useRef(teamsHost);
  teamsHostRef.current = teamsHost;
  const leaveTeams = (action: () => void) => {
    const guard =
      teamsHostRef.current &&
      teamGuards.current.get(teamsHostRef.current.publicKey);
    const leave = () => {
      teamsHostRef.current = undefined;
      setTeamsHost(undefined);
      action();
    };
    if (guard) guard(leave);
    else leave();
  };
  const [teamsEntry, setTeamsEntry] = useState(0);
  const openTeams = (host: HostInfo, page?: "agents" | "teams") => {
    leaveTeams(() => {
      // A worktree selected only inside the drawer was never shown.
      if (isMobile && openMobile) setSelectedTarget(shownMobileTarget.current);
      setTeamsInitialPage(page);
      setTeamsEntry((value) => value + 1);
      if (page === "agents") setTeamToOpen(undefined);
      setOpenedTeams((current) =>
        current.some((item) => item.publicKey === host.publicKey)
          ? current
          : [...current, host],
      );
      setTeamsHost(host);
      setOpenMobile(false);
    });
  };
  const [terminalLists, setTerminalLists] = useState<
    Record<string, TerminalListResult>
  >({});
  // Only received Host lists prune saved input; a disconnected Host retains it.
  useEffect(() => {
    onInputPreferences((current) => {
      if (!current.terminals) return current;
      let changed = false;
      const terminals = { ...current.terminals };
      for (const [hostKey, list] of Object.entries(terminalLists)) {
        const saved = terminals[hostKey];
        if (!saved) continue;
        const ids = new Set(list.terminals.map((terminal) => terminal.id));
        const retained = Object.fromEntries(
          Object.entries(saved).filter(([id]) => ids.has(id)),
        );
        if (Object.keys(retained).length === Object.keys(saved).length)
          continue;
        changed = true;
        if (Object.keys(retained).length) terminals[hostKey] = retained;
        else delete terminals[hostKey];
      }
      return changed ? { ...current, terminals } : current;
    });
  }, [terminalLists, inputPreferences, onInputPreferences]);
  const childrenByHost = useTeamChildren(state.connectedHosts, terminalLists);
  const maintenanceSources = useRef({ terminalLists, childrenByHost });
  maintenanceSources.current = { terminalLists, childrenByHost };
  useEffect(() => {
    onMaintenanceClisReader(() => {
      const { terminalLists, childrenByHost } = maintenanceSources.current;
      const clis: Record<string, Record<string, CliSummary>> = {};
      for (const [host, list] of Object.entries(terminalLists)) {
        clis[host] = Object.fromEntries(
          list.terminals.flatMap((terminal) =>
            terminal.cli ? [[terminal.id, terminal.cli]] : [],
          ),
        );
      }
      for (const [host, children] of Object.entries(childrenByHost)) {
        clis[host] ??= {};
        for (const child of children)
          if (child.terminalId && child.cli)
            clis[host][child.terminalId] = child.cli;
      }
      return clis;
    });
    return () => onMaintenanceClisReader(() => ({}));
  }, [onMaintenanceClisReader]);
  const [childErrors, setChildErrors] = useState<Record<string, string>>({});
  const [boardToOpen, setBoardToOpen] = useState<{
    hostKey: string;
    cwd: string;
    conversation: string;
  }>();
  const [branchToOpen, setBranchToOpen] = useState<{
    hostKey: string;
    parentCwd: string;
    cwd: string;
  }>();
  // Issues open in the layout of the repository's worktree shown, or else
  // of its main worktree.
  const [issuesToOpen, setIssuesToOpen] = useState<{
    hostKey: string;
    workspacePath: string;
  }>();
  // A sidebar CI mark: the CI View of that worktree, in its own layout.
  const [ciToOpen, setCiToOpen] = useState<{
    hostKey: string;
    cwd: string;
  }>();
  const [ciOpenRequest, setCiOpenRequest] = useState<CiOpenRequest>();
  const [teamToOpen, setTeamToOpen] = useState<{
    hostKey: string;
    teamId: string;
    roleId?: string;
    nonce: number;
  }>();
  const [closedParents, setClosedParents] = useState<
    Record<string, Set<string>>
  >({});
  const childTerminalStatuses = useMemo(
    () =>
      Object.fromEntries(
        Object.entries(terminalLists).map(([host, list]) => [
          host,
          new Map(
            list.terminals.map((terminal) => [terminal.id, terminal.cliStatus]),
          ),
        ]),
      ),
    [terminalLists],
  );
  const childDisplay = useMemo(
    () =>
      Object.fromEntries(
        Object.entries(childrenByHost).map(([host, children]) => {
          const byWorktree = new Map<string, ChildSummary[]>();
          const terminalIds = new Set<string>();
          const parentCwds = new Set<string>();
          const childCwds = new Set<string>();
          const displayed = children.map((child) => ({
            ...child,
            cliStatus: childTerminalStatuses[host]?.get(child.terminalId ?? ""),
          }));
          const parents = new Set(
            (terminalLists[host]?.terminals ?? []).map(
              (terminal) => terminal.id,
            ),
          );
          for (const child of displayed) {
            if (child.terminalId) terminalIds.add(child.terminalId);
            parentCwds.add(hostPathKey(child.parentCwd));
            const closed = closedParents[host]?.has(child.parentTerminalId);
            if (
              !closed &&
              !child.worktreeRemoved &&
              child.cwd &&
              !child.repositoryName &&
              !samePath(child.cwd, child.parentCwd)
            )
              childCwds.add(hostPathKey(child.cwd));
            if (!parents.has(child.parentTerminalId)) continue;
            let list = byWorktree.get(hostPathKey(child.parentCwd));
            if (!list)
              byWorktree.set(hostPathKey(child.parentCwd), (list = []));
            list.push(child);
          }
          return [
            host,
            { displayed, byWorktree, terminalIds, parentCwds, childCwds },
          ];
        }),
      ),
    [childrenByHost, childTerminalStatuses, terminalLists, closedParents],
  );
  const childrenFor = (hostKey: string) =>
    childDisplay[hostKey]?.displayed ?? [];
  const stopChild = async (hostKey: string, child: ChildSummary) => {
    try {
      const result = await connection.requestHost(hostKey, "teams.child.stop", {
        childId: child.id,
      });
      setChildErrors((current) => ({
        ...current,
        [child.id]: result?.ok
          ? ""
          : "Could not stop child. Reconnect and retry.",
      }));
    } catch {
      setChildErrors((current) => ({
        ...current,
        [child.id]: "Could not stop child. Reconnect and retry.",
      }));
    }
  };
  const hosts = useMemo(() => state.initial?.hosts ?? [], [state.initial]);
  const [histories, setHistories] = useState<
    Record<string, FolderHistoryItem[]>
  >({});
  const historiesRef = useRef(histories);
  historiesRef.current = histories;
  const [loadedHistoryHosts, setLoadedHistoryHosts] = useState<string[]>([]);
  const [historyError, setHistoryError] = useState<Record<string, string>>({});
  const [removeError, setRemoveError] = useState("");
  const [selectedTarget, setSelectedTarget] = useState<WorkspaceTarget>();
  const [visitedTargets, setVisitedTargets] = useState<WorkspaceTarget[]>([]);
  const shownMobileTarget = useRef<WorkspaceTarget | undefined>(undefined);
  useEffect(() => {
    if (isMobile && (openMobile || teamsHost)) return;
    const previous = shownMobileTarget.current;
    shownMobileTarget.current = selectedTarget;
    if (
      isMobile &&
      previous &&
      selectedTarget &&
      scopeKey(
        previous.host.publicKey,
        previous.folder.workspacePath,
        previous.worktree.path,
      ) !==
        scopeKey(
          selectedTarget.host.publicKey,
          selectedTarget.folder.workspacePath,
          selectedTarget.worktree.path,
        )
    )
      setVisitedTargets((stack) => [...stack, previous]);
  }, [isMobile, openMobile, selectedTarget, teamsHost]);
  const [folderHostKey, setFolderHostKey] = useState<string>();
  const [terminalStatus, setTerminalStatus] = useState<
    Record<string, ShellStatus>
  >({});
  const [terminalError, setTerminalError] = useState("");
  // The launcher item whose start waits for the Host, in the layout scope it
  // was pressed in.
  const [launching, setLaunching] = useState<{ scope: string; item: string }>();
  // Terminals the user just opened take the Host size from this view once.
  const [claimTerminals, setClaimTerminals] = useState<Set<string>>(
    () => new Set(),
  );
  // PC and Mobile layouts recreate their panes, but a Terminal's logical view
  // in this Client keeps its identity. A different Client has its own IDs.
  const terminalViewIds = useRef(new Map<string, string>());
  const [workspace] = useState(createWorkspaceStore);
  const workspaceState = useSyncExternalStore(
    workspace.subscribe,
    workspace.getSnapshot,
  );
  const { tabs, activeTabId } = workspaceState;
  const [tabVisitHistories, setTabVisitHistories] = useState<
    Record<string, string[]>
  >({});
  const shownMobileTab = useRef<{ scope: string; id: string } | undefined>(
    undefined,
  );
  const [viewToOpen, setViewToOpen] = useState<{
    scope: string;
    kind: WorkspaceViewKind;
  }>();
  const [layoutLoading, setLayoutLoading] = useState(false);
  const [loadedLayoutScope, setLoadedLayoutScope] = useState("");
  const [layoutErrors, setLayoutErrors] = useState<
    Record<string, "load" | "save">
  >({});
  const [maximizedGroup, setMaximizedGroup] = useState<string>();
  const [maximizedWidths, setMaximizedWidths] = useState(panelWidths);
  const [maximizedFullWidth, setMaximizedFullWidth] = useState(panelFullWidth);
  const maximizedWidthsRef = useRef(maximizedWidths);
  maximizedWidthsRef.current = maximizedWidths;
  const maximizedFullWidthRef = useRef(maximizedFullWidth);
  maximizedFullWidthRef.current = maximizedFullWidth;
  // A maximized pane is never narrower than the same pane before maximizing.
  const unmaximizedWidth = useRef(0);
  const [creationTarget, setCreationTarget] = useState<{
    host: HostInfo;
    folder: FolderHistoryItem;
    /** "Start with this Issue": the values, and which press opened them. */
    prefill?: WorktreePrefill & { id: number };
  }>();
  const [creationOpen, setCreationOpen] = useState(false);
  const removalState = useWorktreeRemovalFlow();
  const removalTarget = removalState.target;
  const setRemovalTarget = worktreeRemovalFlow.open;
  const [shellPickerOpen, setShellPickerOpen] = useState(false);
  const [dock] = useState(() => createWorkspaceDockAdapter(workspace));
  const dockRoot = useRef<HTMLDivElement>(null);
  const layoutScope = useRef("");
  const layoutSaved = useRef(false);
  const saveQueue = useRef<Promise<void>>(Promise.resolve());
  const pendingLayoutSaves = useRef<Record<string, SavedLayout>>({});
  // Worktrees whose most recent save failed; only they show the save failure.
  const failedLayoutSaves = useRef(new Set<string>());
  const pendingSidebarOrders = useRef<Record<string, string[] | undefined>>({});
  const historyRevision = useRef<Record<string, number>>({});
  const historyOverrides = useRef<
    Record<
      string,
      Record<string, { revision: number; folders: FolderHistoryItem[] }>
    >
  >({});
  // Panels closed by the user; the save a closing View sends is not kept.
  const closedPanels = useRef(new Set<string>());
  const backHandlers = useRef(new Map<string, () => boolean>());
  const [fileHistoryRequest, setFileHistoryRequest] =
    useState<FileHistoryRequest>();
  const touchStart = useRef<{ x: number; y: number } | undefined>(undefined);
  const keySequence = useRef(false);
  const terminalRequests = useRef(new Set<string>());
  const terminalEventsDuringLoad = useRef(new Map<string, TerminalEvent[]>());
  const removeTerminalRef = useRef<
    (hostKey: string, id: string, processExited?: boolean) => void
  >(() => undefined);
  const restoredTargetKey = useRef("");

  useEffect(() => setMaximizedWidths(panelWidths), [panelWidths]);
  useEffect(() => setMaximizedFullWidth(panelFullWidth), [panelFullWidth]);

  // Mobile: a swipe from the left edge opens the sidebar drawer. Vertical
  // scrolling wins whenever the gesture moves more vertically.
  useEffect(() => {
    if (!isMobile) return;
    const handleTouchStart = (event: TouchEvent) => {
      if (openMobile || event.touches.length !== 1) {
        touchStart.current = undefined;
        return;
      }
      const touch = event.touches[0];
      touchStart.current =
        touch && touch.clientX <= 24
          ? { x: touch.clientX, y: touch.clientY }
          : undefined;
    };
    const handleTouchMove = (event: TouchEvent) => {
      const start = touchStart.current;
      const touch = event.touches[0];
      if (!start || !touch || openMobile) return;
      const deltaX = touch.clientX - start.x;
      const deltaY = Math.abs(touch.clientY - start.y);
      if (deltaX > 0 && deltaX > deltaY) {
        if (event.cancelable) event.preventDefault();
        if (deltaX > 60) setOpenMobile(true);
      } else if (deltaY > deltaX) {
        touchStart.current = undefined;
      }
    };
    const handleTouchFinish = (event: TouchEvent) => {
      const start = touchStart.current;
      const touch = event.changedTouches[0];
      touchStart.current = undefined;
      if (!start || !touch || openMobile) return;
      const deltaX = touch.clientX - start.x;
      const deltaY = Math.abs(touch.clientY - start.y);
      if (deltaX > 60 && deltaX > deltaY) setOpenMobile(true);
    };
    document.addEventListener("touchstart", handleTouchStart, true);
    document.addEventListener("touchmove", handleTouchMove, {
      capture: true,
      passive: false,
    });
    document.addEventListener("touchend", handleTouchFinish, true);
    document.addEventListener("touchcancel", handleTouchFinish, true);
    return () => {
      touchStart.current = undefined;
      document.removeEventListener("touchstart", handleTouchStart, true);
      document.removeEventListener("touchmove", handleTouchMove, true);
      document.removeEventListener("touchend", handleTouchFinish, true);
      document.removeEventListener("touchcancel", handleTouchFinish, true);
    };
  }, [isMobile, openMobile, setOpenMobile]);

  const loadTerminals = useCallback(async (hostKey: string) => {
    if (terminalRequests.current.has(hostKey)) return;
    terminalRequests.current.add(hostKey);
    terminalEventsDuringLoad.current.set(hostKey, []);
    setTerminalStatus((current) => ({
      ...current,
      [hostKey]: current[hostKey] === "loaded" ? "loaded" : "loading",
    }));
    try {
      const result = await connection.requestHost(hostKey, "terminal.list", {});
      if (!result?.ok) {
        setTerminalStatus((current) => ({ ...current, [hostKey]: "error" }));
        return;
      }
      const list = (terminalEventsDuringLoad.current.get(hostKey) ?? []).reduce(
        applyTerminalEvent,
        result.result,
      );
      setTerminalLists((current) => ({ ...current, [hostKey]: list }));
      setTerminalStatus((current) => ({ ...current, [hostKey]: "loaded" }));
    } catch {
      setTerminalStatus((current) => ({ ...current, [hostKey]: "error" }));
    } finally {
      terminalRequests.current.delete(hostKey);
      terminalEventsDuringLoad.current.delete(hostKey);
    }
  }, []);

  const refreshHistory = useCallback(async (hostKey: string) => {
    const requestedRevision = historyRevision.current[hostKey] ?? 0;
    try {
      const result = await connection.requestHost(
        hostKey,
        "folders.history",
        {},
      );
      if (!result?.ok) {
        setHistoryError((current) => ({
          ...current,
          [hostKey]: result?.error.code ?? "Could not load folders. Retry.",
        }));
        return;
      }
      setHistoryError((current) => {
        const next = { ...current };
        delete next[hostKey];
        return next;
      });
      let folders = [...result.result.folders];
      for (const [workspacePath, override] of Object.entries(
        historyOverrides.current[hostKey] ?? {},
      )) {
        if (override.revision <= requestedRevision) continue;
        folders = [
          ...override.folders,
          ...folders.filter((folder) => folder.workspacePath !== workspacePath),
        ];
      }
      const pendingOrder = pendingSidebarOrders.current[hostKey];
      if (pendingOrder)
        folders = folders.map((folder) => ({
          ...folder,
          sidebarPosition: pendingOrder.includes(folder.workspacePath)
            ? pendingOrder.indexOf(folder.workspacePath) + 1
            : folder.sidebarPosition,
        }));
      historiesRef.current = { ...historiesRef.current, [hostKey]: folders };
      setHistories((current) => ({ ...current, [hostKey]: folders }));
      setLoadedHistoryHosts((current) =>
        current.includes(hostKey) ? current : [...current, hostKey],
      );
    } catch {
      setHistoryError((current) => ({
        ...current,
        [hostKey]: "Could not load folders. Retry.",
      }));
    }
  }, []);

  const translateEvent = useCallback(
    (hostKey: string, event: HostEvent) => {
      if (
        event.type === "terminal.created" ||
        event.type === "terminal.updated" ||
        event.type === "terminal.closed"
      )
        terminalEventsDuringLoad.current.get(hostKey)?.push(event);
      if (event.type === "folders.changed") {
        void refreshHistory(hostKey);
      } else if (event.type === "worktrees.changed") {
        setHistories((current) => ({
          ...current,
          [hostKey]: (current[hostKey] ?? []).map((folder) =>
            folder.workspacePath === event.repositoryPath
              ? { ...folder, worktrees: event.worktrees }
              : folder,
          ),
        }));
      } else if (event.type === "terminal.closed") {
        removeTerminalRef.current(
          hostKey,
          event.terminalId,
          event.processExited,
        );
      } else if (
        event.type === "terminal.created" ||
        event.type === "terminal.updated"
      ) {
        setTerminalLists((current) => {
          const list = current[hostKey];
          return list
            ? { ...current, [hostKey]: applyTerminalEvent(list, event) }
            : current;
        });
      }
    },
    [refreshHistory],
  );

  useEffect(() => {
    const unsubscribe = connection.subscribeHostEvents(translateEvent);
    return () => {
      unsubscribe();
    };
  }, [translateEvent]);

  // The folder history is read when a Host connects, and again after a
  // reconnect so changes made while disconnected appear.
  const connectedHostsRef = useRef<string[]>([]);
  useEffect(() => {
    const before = new Set(connectedHostsRef.current);
    connectedHostsRef.current = state.connectedHosts;
    for (const hostKey of state.connectedHosts)
      if (!before.has(hostKey)) {
        void refreshHistory(hostKey);
        void loadTerminals(hostKey);
      }
  }, [state.connectedHosts, refreshHistory, loadTerminals]);

  // Terminals are read when the Host connects, and again after a reconnect so
  // changes made while disconnected appear.
  const terminalHostKey = selectedTarget?.host.publicKey ?? "";
  const terminalHostConnected = state.connectedHosts.includes(terminalHostKey);
  useEffect(() => {
    if (terminalHostKey && terminalHostConnected)
      void loadTerminals(terminalHostKey);
  }, [terminalHostKey, terminalHostConnected, loadTerminals]);
  // A new default shell changes the default mark and order of the shells.
  useEffect(() => {
    if (defaultShellChange) void loadTerminals(defaultShellChange.hostKey);
  }, [defaultShellChange, loadTerminals]);

  const allFolders = useMemo(
    () =>
      hosts.flatMap((host) =>
        (histories[host.publicKey] ?? []).map((folder) => ({ host, folder })),
      ),
    [hosts, histories],
  );
  const sidebarFolders = allFolders.filter(({ folder }) => folder.inSidebar);

  const openTarget = useCallback(
    (
      host: HostInfo,
      folder: FolderHistoryItem,
      worktree?: Worktree,
      rememberPrevious = true,
      closeDrawer = true,
    ): void => {
      if (teamsHostRef.current && rememberPrevious) {
        leaveTeams(() =>
          openTarget(host, folder, worktree, rememberPrevious, closeDrawer),
        );
        return;
      }
      const primary = folder.worktrees?.find((item) => item.primary);
      const selectedWorktree = worktree ??
        primary ?? { path: folder.path, detached: false, primary: true };
      const target: WorkspaceTarget = {
        host,
        folder,
        folderPath:
          folder.kind === "git" && worktree && worktree.path !== primary?.path
            ? worktree.path
            : folder.path,
        worktree: selectedWorktree,
        cwd: folder.kind === "git" ? selectedWorktree.path : folder.path,
      };
      if (
        !isMobile &&
        rememberPrevious &&
        selectedTarget &&
        scopeKey(
          selectedTarget.host.publicKey,
          selectedTarget.folder.workspacePath,
          selectedTarget.worktree.path,
        ) !==
          scopeKey(host.publicKey, folder.workspacePath, selectedWorktree.path)
      )
        setVisitedTargets((stack) => [...stack, selectedTarget]);
      if (!rememberPrevious) shownMobileTarget.current = target;
      setSelectedTarget(target);
      onLastWorkspaceTargetChange({
        hostKey: host.publicKey,
        workspacePath: folder.workspacePath,
        folderPath: target.folderPath,
        worktreePath: selectedWorktree.path,
      });
      void connection.selectHost(host.publicKey);
      if (isMobile && closeDrawer) setOpenMobile(false);
    },
    [isMobile, onLastWorkspaceTargetChange, selectedTarget, setOpenMobile],
  );

  useEffect(() => {
    if (!selectedTarget) return;
    const { host, folder, worktree } = selectedTarget;
    const currentFolder = (histories[host.publicKey] ?? []).find(
      (item) => item.workspacePath === folder.workspacePath,
    );
    const removing =
      locallyRemoving(removalState, host.publicKey, worktree.path) ||
      currentFolder?.worktrees?.some(
        (item) => item.path === worktree.path && item.removing,
      );
    if (!removing) return;
    openTarget(
      host,
      currentFolder ?? folder,
      (currentFolder ?? folder).worktrees?.find((item) => item.primary),
      false,
    );
  }, [histories, removalState, selectedTarget, openTarget]);

  // PC reopens the last worktree. Mobile starts from its first screen.
  useEffect(() => {
    if (isMobile || selectedTarget || !lastWorkspaceTarget) return;
    const { hostKey, workspacePath, folderPath, worktreePath } =
      lastWorkspaceTarget;
    if (
      !hostKey ||
      !workspacePath ||
      !folderPath ||
      !worktreePath ||
      !histories[hostKey]
    )
      return;
    const restoreKey = scopeKey(hostKey, workspacePath, worktreePath);
    if (restoredTargetKey.current === restoreKey) return;
    restoredTargetKey.current = restoreKey;
    const host = hosts.find((item) => item.publicKey === hostKey);
    const folder =
      (histories[hostKey] ?? []).find(
        (item) =>
          item.path === folderPath && item.workspacePath === workspacePath,
      ) ??
      (histories[hostKey] ?? []).find(
        (item) => item.workspacePath === workspacePath,
      );
    if (!host || !folder) return;
    const worktree =
      folder.kind === "git"
        ? folder.worktrees?.find((item) => item.path === worktreePath)
        : folder.path === worktreePath
          ? { path: folder.path, detached: false, primary: true }
          : undefined;
    if (worktree) openTarget(host, folder, worktree, false);
  }, [
    histories,
    hosts,
    isMobile,
    lastWorkspaceTarget,
    openTarget,
    selectedTarget,
  ]);

  const openFolder = async (hostKey: string, path: string) => {
    try {
      const result = await connection.requestHost(hostKey, "folders.open", {
        path,
      });
      if (!result?.ok)
        return result?.error.code ?? "Could not open this folder. Retry.";
      const host = hosts.find((item) => item.publicKey === hostKey);
      if (!host) return undefined;
      const folder = result.result.folder;
      const revision = (historyRevision.current[hostKey] ?? 0) + 1;
      historyRevision.current[hostKey] = revision;
      const folders = [
        folder,
        ...(historiesRef.current[hostKey] ?? [])
          .filter((item) => item.path !== folder.path)
          .map((item) =>
            item.workspacePath === folder.workspacePath
              ? { ...item, inSidebar: false }
              : item,
          ),
      ];
      historiesRef.current = { ...historiesRef.current, [hostKey]: folders };
      historyOverrides.current[hostKey] = {
        ...historyOverrides.current[hostKey],
        [folder.workspacePath]: {
          revision,
          folders: folders.filter(
            (item) => item.workspacePath === folder.workspacePath,
          ),
        },
      };
      setHistories((current) => ({ ...current, [hostKey]: folders }));
      setFolderHostKey(undefined);
      openTarget(host, folder);
      return undefined;
    } catch {
      return "Could not open this folder. Retry.";
    }
  };

  const reorderFolders = async (hostKey: string, paths: string[]) => {
    setRemoveError("");
    pendingSidebarOrders.current[hostKey] = paths;
    const folders = (historiesRef.current[hostKey] ?? []).map((folder) => ({
      ...folder,
      sidebarPosition: paths.includes(folder.workspacePath)
        ? paths.indexOf(folder.workspacePath) + 1
        : folder.sidebarPosition,
    }));
    historiesRef.current = { ...historiesRef.current, [hostKey]: folders };
    setHistories((current) => ({ ...current, [hostKey]: folders }));
    try {
      const result = await connection.requestHost(
        hostKey,
        "folders.sidebar.reorder",
        { paths },
      );
      if (!result?.ok) setRemoveError("Could not reorder folders. Retry.");
    } catch {
      setRemoveError("Could not reorder folders. Retry.");
    } finally {
      if (pendingSidebarOrders.current[hostKey] === paths)
        delete pendingSidebarOrders.current[hostKey];
      await refreshHistory(hostKey);
    }
  };

  const removeFromSidebar = async (
    hostKey: string,
    folder: FolderHistoryItem,
  ) => {
    setRemoveError("");
    try {
      const result = await connection.requestHost(
        hostKey,
        "folders.sidebar.remove",
        { path: folder.workspacePath },
      );
      if (!result?.ok) {
        setRemoveError(
          result?.error.code ??
            "Could not remove this folder from the sidebar. Retry.",
        );
        return;
      }
      const revision = (historyRevision.current[hostKey] ?? 0) + 1;
      historyRevision.current[hostKey] = revision;
      const folders = (historiesRef.current[hostKey] ?? []).map((item) =>
        item.workspacePath === folder.workspacePath
          ? { ...item, inSidebar: false }
          : item,
      );
      historiesRef.current = { ...historiesRef.current, [hostKey]: folders };
      historyOverrides.current[hostKey] = {
        ...historyOverrides.current[hostKey],
        [folder.workspacePath]: {
          revision,
          folders: folders.filter(
            (item) => item.workspacePath === folder.workspacePath,
          ),
        },
      };
      setHistories((current) => ({ ...current, [hostKey]: folders }));
    } catch {
      setRemoveError("Could not remove this folder from the sidebar. Retry.");
    }
  };

  const scope = selectedTarget
    ? scopeKey(
        selectedTarget.host.publicKey,
        selectedTarget.folder.workspacePath,
        selectedTarget.worktree.path,
      )
    : "";
  const tabVisitHistory = tabVisitHistories[scope] ?? [];
  const setTabVisitHistory = useCallback(
    (update: string[] | ((current: string[]) => string[])) => {
      setTabVisitHistories((current) => ({
        ...current,
        [scope]:
          typeof update === "function" ? update(current[scope] ?? []) : update,
      }));
    },
    [scope],
  );

  const nativeMobileRef = useRef(state.initial?.mobile);
  nativeMobileRef.current = state.initial?.mobile;
  const templateApplied = useRef(false);
  const templateAgentPanel = useRef<string>(undefined);
  const startingAttention = useRef<AttentionItem & { started?: boolean }>(
    undefined,
  );
  const issueRepositories = useIssueRepositories(
    allFolders
      .filter(({ folder }) => folder.kind === "git")
      .map(({ host, folder }) => ({
        host: host.publicKey,
        workspacePath: folder.workspacePath,
      })),
    state.connectedHosts,
  );
  const issueRepositoriesRef = useRef(issueRepositories);
  issueRepositoriesRef.current = issueRepositories;
  const defaultTabs = (
    target: WorkspaceTarget,
    mobile: boolean,
  ): WorkspaceTab[] =>
    (
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

  const loadTargetLayout = useCallback(
    async (targetScope: string, target?: WorkspaceTarget, mobile = false) => {
      setLayoutLoading(true);
      layoutSaved.current = false;
      templateApplied.current = false;
      templateAgentPanel.current = undefined;
      try {
        const pending = pendingLayoutSaves.current[targetScope];
        if (pending) {
          if (layoutScope.current !== targetScope) return;
          layoutSaved.current = true;
          workspace.update(() => ({
            ...pending,
            mobileClosedTabs: pending.mobileClosedTabs ?? [],
            views: pending.views ?? {},
            lastTerminalId: pending.lastTerminalId ?? "",
            activeTabId: pending.activeTabId ?? pending.tabs[0]?.id ?? "",
          }));
          setLoadedLayoutScope(targetScope);
          if (failedLayoutSaves.current.has(targetScope))
            setLayoutErrors((current) => ({
              ...current,
              [targetScope]: "save",
            }));
          setLayoutLoading(false);
          return;
        }
        const saved = readWorkspaceState(
          await native.loadWorkspaceLayout<unknown>(targetScope),
        );
        if (layoutScope.current !== targetScope) return;
        let initialTabs: WorkspaceTab[] =
          !saved && target ? defaultTabs(target, mobile) : [];
        let templateLayout: SerializedDockview | undefined;
        let templateActive: string | undefined;
        if (!saved && target && !mobile && !nativeMobileRef.current) {
          const template = await worktreeLayoutDefault.load();
          if (layoutScope.current !== targetScope) return;
          if (template) {
            const attention = startingAttention.current;
            const startedHere = Boolean(
              attention?.started &&
              attention.host.publicKey === target.host.publicKey &&
              samePath(
                attention.terminal.worktreePath ?? attention.terminal.cwd,
                target.cwd,
              ),
            );
            const team = Boolean(
              startedHere && attention?.terminal.teamConversation,
            );
            const forge = Boolean(
              issueRepositoriesRef.current[
                issueRepositoryKey(
                  target.host.publicKey,
                  target.folder.workspacePath,
                )
              ],
            );
            const mapped = new Map<string, string>();
            const restored: WorkspaceTab[] = [];
            for (const slot of template.slots) {
              if (
                (slot.kind === "git" && target.folder.kind !== "git") ||
                (slot.kind === "board" && !team) ||
                ((slot.kind === "issues" || slot.kind === "ci") && !forge)
              )
                continue;
              const kind = slot.kind === "agent" ? "start" : slot.kind;
              let tab: WorkspaceTab;
              if (kind === "terminal") {
                if (!startedHere) continue;
                if (layoutScope.current !== targetScope) break;
                try {
                  const result = await connection.requestHost(
                    target.host.publicKey,
                    "terminal.create",
                    { cwd: target.cwd },
                  );
                  if (!result?.ok) continue;
                  const terminal = result.result.terminal;
                  setTerminalLists((current) => {
                    const list = current[target.host.publicKey];
                    return list
                      ? {
                          ...current,
                          [target.host.publicKey]: applyTerminalEvent(list, {
                            type: "terminal.created",
                            terminal,
                          }),
                        }
                      : current;
                  });
                  tab = {
                    id: terminalTabId(terminal.id),
                    kind,
                    terminalId: terminal.id,
                    title: terminal.title || terminal.shell,
                    target,
                  };
                } catch {
                  continue;
                }
              } else {
                tab = {
                  id: `${kind}:${crypto.randomUUID()}`,
                  kind,
                  title: initialTabTitle(kind),
                  target,
                };
              }
              if (slot.kind === "agent") templateAgentPanel.current = tab.id;
              mapped.set(slot.id, tab.id);
              restored.push(tab);
            }
            if (layoutScope.current !== targetScope) return;
            templateLayout = pruneLayout(template.layout, mapped);
            if (templateLayout) {
              initialTabs = restored;
              templateActive = mapped.get(template.activeSlot ?? "");
              if (!templateActive) {
                const selected = (
                  node: SerializedDockview["grid"]["root"],
                ): string | undefined =>
                  Array.isArray(node.data)
                    ? node.data.map(selected).find(Boolean)
                    : node.data.id === templateLayout!.activeGroup
                      ? node.data.activeView
                      : undefined;
                templateActive = selected(templateLayout.grid.root);
              }
              if (!initialTabs.some((tab) => tab.kind === "start")) {
                const start: WorkspaceTab = {
                  id: `start:${crypto.randomUUID()}`,
                  kind: "start",
                  title: "Start",
                  target,
                };
                initialTabs.push(start);
                templateAgentPanel.current = start.id;
                const append = (
                  node: SerializedDockview["grid"]["root"],
                ): boolean => {
                  if (Array.isArray(node.data)) return node.data.some(append);
                  if (node.data.id !== templateLayout!.activeGroup)
                    return false;
                  node.data.views.push(start.id);
                  node.data.activeView = start.id;
                  return true;
                };
                append(templateLayout.grid.root);
                templateLayout.panels[start.id] = {
                  id: start.id,
                  contentComponent: "workspace",
                  params: { tabId: start.id },
                };
                templateActive = start.id;
              }
              templateApplied.current = true;
            }
          }
        }
        const restoredTabs = saved?.tabs ?? initialTabs;
        if (
          target &&
          restoredTabs.length === 0 &&
          Object.keys(saved?.layout?.panels ?? {}).length === 0
        )
          restoredTabs.push({
            id: `start:${crypto.randomUUID()}`,
            kind: "start",
            title: "Start",
            target,
          });
        // A closing View can save while React is committing the new layout.
        // Keep the synchronous snapshot aligned with the new scope first.
        delete pendingLayoutSaves.current[targetScope];
        layoutSaved.current = true;
        workspace.update(() => ({
          ...saved,
          mobileClosedTabs: saved?.mobileClosedTabs ?? [],
          views: saved?.views ?? {},
          lastTerminalId:
            saved?.lastTerminalId ??
            saved?.tabs.filter((tab) => tab.kind === "terminal").at(-1)?.id ??
            "",
          tabs: restoredTabs,
          layout: saved?.layout ?? templateLayout,
          activeTabId:
            saved?.activeTabId || templateActive || restoredTabs[0]?.id || "",
        }));
        setLoadedLayoutScope(targetScope);
        setLayoutErrors((current) => {
          const next = { ...current };
          delete next[targetScope];
          return next;
        });
        setLayoutLoading(false);
      } catch {
        if (layoutScope.current !== targetScope) return;
        setLayoutErrors((current) => ({ ...current, [targetScope]: "load" }));
        setLayoutLoading(false);
      }
    },
    [],
  );

  useEffect(() => {
    layoutScope.current = scope;
    layoutSaved.current = false;
    setMaximizedGroup(undefined);
    setFileHistoryRequest(undefined);
    closedPanels.current.clear();
    if (!scope) {
      workspace.update(() => ({ tabs: [], activeTabId: "" }));
      setLoadedLayoutScope("");
      setLayoutLoading(false);
      return;
    }
    void loadTargetLayout(scope, selectedTarget, isMobile);
  }, [scope, loadTargetLayout]);

  // Each change saves the latest layout, also after a failed save; the failure
  // shows only while the most recent save of that worktree has failed.
  const saveLayout = useCallback(
    (targetScope: string, payload: SavedLayout) => {
      pendingLayoutSaves.current[targetScope] = payload;
      saveQueue.current = saveQueue.current
        .catch(() => undefined)
        .then(() => native.saveWorkspaceLayout(targetScope, payload))
        .then(
          () => {
            if (pendingLayoutSaves.current[targetScope] !== payload) return;
            delete pendingLayoutSaves.current[targetScope];
            failedLayoutSaves.current.delete(targetScope);
            setLayoutErrors((current) => {
              const next = { ...current };
              delete next[targetScope];
              return next;
            });
          },
          () => {
            if (pendingLayoutSaves.current[targetScope] !== payload) return;
            failedLayoutSaves.current.add(targetScope);
            setLayoutErrors((current) => ({
              ...current,
              [targetScope]: "save",
            }));
          },
        );
    },
    [],
  );

  // The handler belongs to the ledger, so a closing View can still queue its
  // final state while React unmounts the Frame and its effect subscriptions.
  useEffect(() => {
    workspace.onChange(() => {
      const currentScope = layoutScope.current;
      if (currentScope && layoutSaved.current)
        saveLayout(currentScope, writeSavedLayout(workspace.getSnapshot()));
    });
  }, [workspace, saveLayout]);

  const retryLayoutSave = (targetScope: string) => {
    const pending = pendingLayoutSaves.current[targetScope];
    if (pending) saveLayout(targetScope, pending);
  };

  // Discarding an unreadable layout leaves a usable Start tab in its place.
  const discardLayout = (targetScope: string) => {
    if (layoutScope.current !== targetScope || !selectedTarget) return;
    const start: WorkspaceTab = {
      id: `start:${crypto.randomUUID()}`,
      kind: "start",
      title: "Start",
      target: selectedTarget,
    };
    layoutSaved.current = true;
    workspace.update(() => ({
      tabs: [start],
      activeTabId: start.id,
      mobileClosedTabs: [],
      views: {},
      lastTerminalId: "",
    }));
    setLoadedLayoutScope(targetScope);
    setLayoutErrors((current) => {
      const next = { ...current };
      delete next[targetScope];
      return next;
    });
  };

  const currentHostKey = selectedTarget?.host.publicKey ?? "";
  const usageHostKey =
    teamsHost?.publicKey || currentHostKey || state.host?.publicKey || "";
  useEffect(
    () => onUsageHostChange(usageHostKey),
    [usageHostKey, onUsageHostChange],
  );
  const terminalList = terminalLists[currentHostKey];
  const {
    pickers: cliList,
    error: cliError,
    reload: reloadClis,
  } = useCliList(
    currentHostKey,
    `${clisRevision}:${defaultShellChange?.revision ?? 0}:${state.connectedHosts.join(",")}`,
  );
  const shells = terminalList?.shells ?? [];
  const shellStatus: ShellStatus = terminalStatus[currentHostKey] ?? "loading";
  const targetTerminals = useMemo(
    () =>
      selectedTarget
        ? (terminalList?.terminals ?? []).filter((terminal) =>
            samePath(terminal.worktreePath ?? terminal.cwd, selectedTarget.cwd),
          )
        : [],
    [selectedTarget, terminalList],
  );
  const targetTerminalsRef = useRef(targetTerminals);
  targetTerminalsRef.current = targetTerminals;
  const shellLabel = (id: string) =>
    shells.find((shell) => shell.id === id)?.label ?? id;

  // Opening a view on PC moves focus into it, as in VS Code. Mobile does not,
  // so the keyboard does not open by itself.
  const [focusRequest, setFocusRequest] = useState<{
    tabId: string;
    nonce: number;
  }>();
  const focusNonceRef = useRef(0);
  const focusConsumed = useCallback((nonce: number) => {
    setFocusRequest((current) =>
      current?.nonce === nonce ? undefined : current,
    );
  }, []);
  const mobileView = Boolean(state.initial?.mobile);
  const requestFocus = useCallback(
    (tabId: string) => {
      if (mobileView) return;
      setFocusRequest({ tabId, nonce: ++focusNonceRef.current });
    },
    [mobileView],
  );

  const activateTab = useCallback(
    (id: string) => {
      // A restored tab behind the drawer has not been visited. Only the tab
      // actually shown in this worktree can precede the newly opened one.
      const previous = isMobile
        ? shownMobileTab.current?.scope === scope
          ? shownMobileTab.current.id
          : undefined
        : workspace.getSnapshot().activeTabId;
      if (previous && previous !== id)
        setTabVisitHistory((current) => [...current, previous]);
      workspace.update((current) => selectWorkspaceTab(current, id));
    },
    [isMobile, scope, setTabVisitHistory],
  );

  const showPanel = (id: string) => {
    activateTab(id);
    dock.select(id);
  };

  const addTab = useCallback(
    (
      tab: WorkspaceTab,
      groupId?: string,
      direction: DropDirection = "within",
    ) => {
      dock.pendingPosition = groupId ? { groupId, direction } : undefined;
      const next = workspace.update((current) => addWorkspaceTab(current, tab));
      const opened = tab.terminalId
        ? (terminalWorkspaceTab(
            next,
            tab.target.host.publicKey,
            tab.terminalId,
          ) ?? tab)
        : tab;
      activateTab(opened.id);
      requestFocus(opened.id);
      setShellPickerOpen(false);
    },
    [activateTab, requestFocus],
  );

  const addPanel = useCallback(
    (
      kind: Exclude<WorkspaceViewKind, "terminal">,
      groupId?: string,
      direction: DropDirection = "within",
    ) => {
      if (!selectedTarget) return;
      const existing = workspace
        .getSnapshot()
        .tabs.find((tab) => tab.kind === kind);
      if (existing) {
        activateTab(existing.id);
        dock.select(existing.id);
        requestFocus(existing.id);
        return existing.id;
      }
      const id = `${kind}:${crypto.randomUUID()}`;
      addTab(
        {
          id,
          kind,
          title: initialTabTitle(
            kind === "file" || kind === "start" ? "git" : kind,
          ),
          target: selectedTarget,
        },
        groupId,
        direction,
      );
      return id;
    },
    [activateTab, addTab, requestFocus, selectedTarget],
  );

  // One tab per Terminal: opening a Terminal that has a tab moves to it.
  const openTerminal = useCallback(
    (
      summary: TerminalSummary,
      groupId?: string,
      direction: DropDirection = "within",
      launch?: { startTabId?: string },
    ) => {
      if (!selectedTarget) return;
      if (launch) {
        if (
          launch.startTabId &&
          workspace
            .getSnapshot()
            .tabs.some((tab) => tab.id === launch.startTabId)
        ) {
          const id =
            terminalWorkspaceTab(
              workspace.getSnapshot(),
              selectedTarget.host.publicKey,
              summary.id,
            )?.id ?? terminalTabId(summary.id);
          const alreadyOpen = workspace
            .getSnapshot()
            .tabs.some((tab) => tab.id === id);
          workspace.update((current) =>
            replaceWorkspaceStartTab(current, launch.startTabId!, {
              id,
              kind: "terminal",
              title: summary.title || summary.shell,
              terminalId: summary.id,
              target: selectedTarget,
            }),
          );
          dock.replaceTab(
            launch.startTabId,
            {
              id,
              kind: "terminal",
              title: summary.title || summary.shell,
              terminalId: summary.id,
              target: selectedTarget,
            },
            alreadyOpen,
          );
        }
        if (
          summary.teamConversation &&
          !isMobile &&
          !workspace.getSnapshot().tabs.some((tab) => tab.kind === "board")
        ) {
          workspace.update((current) =>
            addWorkspaceTab(current, {
              id: `board:${crypto.randomUUID()}`,
              kind: "board",
              title: "Board",
              target: selectedTarget,
            }),
          );
        }
      }
      if (scope)
        workspace.update((current) =>
          rememberWorkspaceTerminal(current, summary.id),
        );
      setClaimTerminals((current) => new Set(current).add(summary.id));
      const id =
        terminalWorkspaceTab(
          workspace.getSnapshot(),
          selectedTarget.host.publicKey,
          summary.id,
        )?.id ?? terminalTabId(summary.id);
      if (workspace.getSnapshot().tabs.some((tab) => tab.id === id)) {
        showPanel(id);
        requestFocus(id);
        return;
      }
      addTab(
        {
          id,
          kind: "terminal",
          title: summary.title || summary.shell,
          terminalId: summary.id,
          target: selectedTarget,
        },
        groupId,
        direction,
      );
    },
    [addTab, requestFocus, scope, selectedTarget, isMobile],
  );

  const [attentionToOpen, setAttentionToOpen] = useState<
    AttentionItem & { started?: boolean }
  >();
  startingAttention.current = attentionToOpen;
  const attentionItems: AttentionItem[] = hosts
    .flatMap((host) =>
      state.connectedHosts.includes(host.publicKey)
        ? (terminalLists[host.publicKey]?.terminals ?? [])
            .filter(
              (terminal) =>
                terminal.cliStatus?.state === "waiting" &&
                terminal.cliStatus.attention,
            )
            .map((terminal) => ({ host, terminal }))
        : [],
    )
    .sort(
      (a, b) =>
        a.terminal.cliStatus!.since - b.terminal.cliStatus!.since ||
        creationOrder(a.terminal, b.terminal) ||
        a.host.publicKey.localeCompare(b.host.publicKey),
    );
  const openAttention = async (
    item?: AttentionItem & { started?: boolean },
  ) => {
    if (!item) return;
    if (teamsHostRef.current) {
      leaveTeams(() => {
        void openAttention(item);
      });
      return;
    }
    const child = childrenByHost[item.host.publicKey]?.find(
      (child) => child.terminalId === item.terminal.id,
    );
    const layoutCwd =
      child?.parentCwd ?? item.terminal.worktreePath ?? item.terminal.cwd;
    const entry = allFolders.find(
      (entry) =>
        entry.host.publicKey === item.host.publicKey &&
        worktreesOf(entry.folder).some((worktree) =>
          samePath(worktree.path, layoutCwd),
        ),
    );
    let folder = entry?.folder;
    if (!folder) {
      const result = await connection.requestHost(
        item.host.publicKey,
        "folders.open",
        { path: layoutCwd },
      );
      if (!result?.ok) return;
      folder = result.result.folder;
    }
    const worktree = worktreesOf(folder).find((worktree) =>
      samePath(worktree.path, layoutCwd),
    );
    setAttentionToOpen(item);
    openTarget(item.host, folder, worktree);
  };
  const openAttentionRef = useRef(openAttention);
  openAttentionRef.current = openAttention;
  useEffect(() => {
    if (!terminalToOpen) return;
    const { hostKey, terminalId } = terminalToOpen;
    const host = connection
      .getSnapshot()
      .initial?.hosts.find((host) => host.publicKey === hostKey);
    if (!host) return;
    void connection
      .requestHost(hostKey, "terminal.list", {})
      .then((result) => {
        const terminal = result?.ok
          ? result.result.terminals.find(
              (terminal) => terminal.id === terminalId,
            )
          : undefined;
        if (terminal) void openAttentionRef.current({ host, terminal });
      })
      .catch(() => {});
  }, [terminalToOpen]);
  useCliNotifications(
    hosts,
    terminalLists,
    childrenByHost,
    state.connectedHosts,
    allFolders,
    notificationPreferences,
    t,
    (target) => {
      const host = hosts.find((host) => host.publicKey === target.hostKey);
      if (!host) return;
      if (target.teamId) {
        void connection
          .requestHost(target.hostKey, "teams.read", { teamId: target.teamId })
          .then((result) => {
            if (!result?.ok) return;
            leaveTeams(() => {
              setTeamToOpen({
                hostKey: host.publicKey,
                teamId: target.teamId!,
                nonce: Date.now(),
              });
              openTeams(host, "teams");
            });
          })
          .catch(() => {});
        return;
      }
      void connection
        .requestHost(target.hostKey, "terminal.list", {})
        .then((result) => {
          const terminal = result?.ok
            ? result.result.terminals.find(
                (terminal) => terminal.id === target.terminalId,
              )
            : undefined;
          if (terminal) {
            void openAttention({ host, terminal });
          }
        })
        .catch(() => {});
    },
  );
  useEffect(() => {
    if (
      !attentionToOpen ||
      layoutLoading ||
      loadedLayoutScope !== scope ||
      selectedTarget?.host.publicKey !== attentionToOpen.host.publicKey ||
      !samePath(
        selectedTarget.cwd,
        childrenByHost[attentionToOpen.host.publicKey]?.find(
          (child) => child.terminalId === attentionToOpen.terminal.id,
        )?.parentCwd ??
          attentionToOpen.terminal.worktreePath ??
          attentionToOpen.terminal.cwd,
      )
    )
      return;
    openTerminal(
      attentionToOpen.terminal,
      undefined,
      undefined,
      attentionToOpen.started
        ? {
            startTabId: workspace
              .getSnapshot()
              .tabs.find((tab) => tab.kind === "start")?.id,
          }
        : undefined,
    );
    setAttentionToOpen(undefined);
  }, [
    attentionToOpen,
    layoutLoading,
    loadedLayoutScope,
    scope,
    selectedTarget,
    openTerminal,
    childrenByHost,
  ]);

  const applyTerminalEventFor = useCallback(
    (hostKey: string, event: TerminalEvent) => {
      setTerminalLists((current) => {
        const list = current[hostKey];
        return list
          ? { ...current, [hostKey]: applyTerminalEvent(list, event) }
          : current;
      });
    },
    [],
  );

  // A new Terminal starts in the selected worktree. The result is applied once;
  // a failed request is reported and never sent again automatically.
  const createTerminal = useCallback(
    async (
      shellId?: string,
      groupId?: string,
      direction?: DropDirection,
      cli?: CliSummary,
      team?: import("@iori/protocol").Team,
      startTabId?: string,
    ) => {
      if (!selectedTarget) return;
      const target = selectedTarget;
      const hostKey = target.host.publicKey;
      const startedIn = layoutScope.current;
      setShellPickerOpen(false);
      setTerminalError("");
      const item = team
        ? `team:${team.id}`
        : cli
          ? `cli:${cli.id}`
          : `shell:${shellId ?? ""}`;
      setLaunching({ scope: startedIn, item });
      try {
        const result = team
          ? await connection.requestHost(hostKey, "team.launch", {
              cwd: target.cwd,
              teamId: team.id,
            })
          : cli
            ? await connection.requestHost(hostKey, "cli.launch", {
                cwd: target.cwd,
                cliId: cli.id,
              })
            : await connection.requestHost(hostKey, "terminal.create", {
                cwd: target.cwd,
                ...(shellId ? { shell: shellId } : {}),
              });
        if (!result?.ok) {
          setTerminalError(
            team
              ? "Could not start the team. Check its parent CLI settings and try again."
              : "Could not create a terminal. Check the folder and try again.",
          );
          return;
        }
        const terminal = result.result.terminal;
        applyTerminalEventFor(hostKey, { type: "terminal.created", terminal });
        if (layoutScope.current === startedIn) {
          openTerminal(terminal, groupId, direction, { startTabId });
        }
      } catch {
        setTerminalError(
          team
            ? "Could not start the team. Check its parent CLI settings and try again."
            : "Could not create a terminal. Check the folder and try again.",
        );
      } finally {
        setLaunching((current) =>
          current?.item === item && current.scope === startedIn
            ? undefined
            : current,
        );
      }
    },
    [applyTerminalEventFor, openTerminal, selectedTarget],
  );

  const chooseShell = useCallback(
    (shell: TerminalShell) => {
      const pending = dock.pendingPosition;
      dock.pendingPosition = undefined;
      void createTerminal(shell.id, pending?.groupId, pending?.direction);
    },
    [createTerminal],
  );

  const closeTab = (id: string, panelId?: string, preservePane = false) => {
    const api = dock.api;
    dock.close(id, {
      panelId,
      preservePane,
      onLastPanel: selectedTarget
        ? (groupId) =>
            addTab(
              {
                id: `start:${crypto.randomUUID()}`,
                kind: "start",
                title: "Start",
                target: selectedTarget,
              },
              groupId,
            )
        : undefined,
      onPanelClose: (closedId) => {
        closedPanels.current.add(closedId);
        workspace.update((current) =>
          forgetWorkspacePanelState(current, closedId),
        );
      },
    });
    if (panelId && api) return;
    workspace.update((current) =>
      api
        ? closeWorkspaceTab(current, id)
        : closeMobileWorkspaceTab(current, id, preservePane),
    );
    setTabVisitHistory((current) => current.filter((tabId) => tabId !== id));
    if (
      !api &&
      workspace.getSnapshot().tabs.length === 0 &&
      selectedTarget &&
      !(preservePane && workspace.getSnapshot().layout)
    )
      addTab({
        id: `start:${crypto.randomUUID()}`,
        kind: "start",
        title: "Start",
        target: selectedTarget,
      });
  };

  // The Terminal was closed or ended: its tab and row go away together.
  const removeTerminal = useCallback(
    (hostKey: string, terminalId: string, processExited = false) => {
      terminalViewIds.current.delete(`${hostKey}:${terminalId}`);
      applyTerminalEventFor(hostKey, { type: "terminal.closed", terminalId });
      const tab = terminalWorkspaceTab(
        workspace.getSnapshot(),
        hostKey,
        terminalId,
      );
      if (tab) closeTab(tab.id, undefined, processExited);
    },
    [applyTerminalEventFor, closeTab],
  );

  removeTerminalRef.current = removeTerminal;

  const terminalClose = useTerminalClose({
    onRefresh: () => {
      if (currentHostKey) void loadTerminals(currentHostKey);
    },
    onClosed: (terminalId) => {
      setClosedParents((current) => ({
        ...current,
        [currentHostKey]: new Set([
          ...(current[currentHostKey] ?? []),
          terminalId,
        ]),
      }));
      removeTerminal(currentHostKey, terminalId);
    },
    t,
  });
  const closeTerminal = (terminalId: string) => {
    const connectionId = connection.connectionIdOf(currentHostKey);
    if (connectionId) terminalClose.request(connectionId, terminalId);
  };

  const recentTerminal = useCallback(
    () =>
      targetTerminalsRef.current.find(
        (terminal) => terminal.id === workspace.getSnapshot().lastTerminalId,
      ) ?? targetTerminalsRef.current.at(-1),
    [scope],
  );

  const splitGroup = (group: DockGroup, direction: "right" | "below") => {
    if (!selectedTarget) return;
    addTab(
      {
        id: `start:${crypto.randomUUID()}`,
        kind: "start",
        title: "Start",
        target: selectedTarget,
      },
      group.id,
      direction,
    );
  };

  const dropSidebarView: DockContextValue["dropSidebarView"] = (
    payload,
    group,
    direction,
  ) => {
    const target = selectedTarget;
    if (
      !target ||
      payload.hostKey !== target.host.publicKey ||
      payload.workspacePath !== target.folder.workspacePath ||
      payload.worktreePath !== target.worktree.path
    ) {
      if (payload.terminalId) {
        const host = hosts.find((host) => host.publicKey === payload.hostKey);
        const terminal = terminalLists[
          payload.hostKey ?? currentHostKey
        ]?.terminals.find((terminal) => terminal.id === payload.terminalId);
        if (host && terminal) void openAttention({ host, terminal });
      }
      return;
    }
    const summary =
      payload.kind !== "terminal"
        ? undefined
        : payload.terminalId
          ? terminalLists[currentHostKey]?.terminals.find(
              (terminal) => terminal.id === payload.terminalId,
            )
          : recentTerminal();
    const existing =
      payload.kind === "terminal"
        ? summary &&
          workspace
            .getSnapshot()
            .tabs.find((tab) => tab.id === terminalTabId(summary.id))
        : workspace.getSnapshot().tabs.find((tab) => tab.kind === payload.kind);
    if (existing) {
      dock.move(existing.id, group, direction);
      activateTab(existing.id);
      if (summary && scope)
        workspace.update((current) =>
          rememberWorkspaceTerminal(current, summary.id),
        );
      return;
    }
    if (payload.kind === "terminal") {
      if (summary) openTerminal(summary, group.id, direction);
      else void createTerminal(undefined, group.id, direction);
      return;
    }
    addPanel(payload.kind, group.id, direction);
  };

  const widthForKind = useCallback(
    (kind: WorkspaceViewKind) =>
      maximizedWidthsRef.current[kind] ?? (kind === "terminal" ? 1100 : 1400),
    [],
  );

  const kindOfGroup = dock.kindOfGroup;

  const setGroupWidth = useCallback(
    (group: DockGroup, fullWidth: boolean) => {
      const kind = kindOfGroup(group);
      const width = fullWidth
        ? "calc(100vw - 24px)"
        : `min(${Math.max(widthForKind(kind), unmaximizedWidth.current)}px, calc(100vw - 24px))`;
      group.element.style.setProperty("--iori-pane-width", width);
      dockRoot.current?.style.setProperty("--iori-maximized-pane-width", width);
    },
    [widthForKind],
  );

  const toggleMaximize = (group: DockGroup) => {
    if (isMobile) return;
    const element = group.element;
    if (element.classList.contains("iori-dock-maximized")) {
      element.classList.remove("iori-dock-maximized");
      setMaximizedGroup(undefined);
      return;
    }
    dockRoot.current
      ?.querySelectorAll(".iori-dock-maximized")
      .forEach((item) => item.classList.remove("iori-dock-maximized"));
    unmaximizedWidth.current = Math.round(
      element.getBoundingClientRect().width,
    );
    setGroupWidth(
      group,
      maximizesFullWidth(kindOfGroup(group), maximizedFullWidthRef.current),
    );
    element.classList.add("iori-dock-maximized");
    setMaximizedGroup(group.id);
  };

  const toggleMaximizedFullWidth = (group: DockGroup) => {
    const kind = kindOfGroup(group);
    const next = {
      ...maximizedFullWidthRef.current,
      [kind]: !maximizesFullWidth(kind, maximizedFullWidthRef.current),
    };
    maximizedFullWidthRef.current = next;
    setMaximizedFullWidth(next);
    setGroupWidth(group, maximizesFullWidth(kind, next));
    onPanelFullWidthChange(next);
  };

  const beginMaximizedResize =
    (kind: WorkspaceViewKind, side: "left" | "right") =>
    (event: ReactPointerEvent<HTMLDivElement>) => {
      event.preventDefault();
      event.stopPropagation();
      const group = dock.api?.groups.find((item) => item.id === maximizedGroup);
      if (!group || maximizesFullWidth(kind, maximizedFullWidthRef.current))
        return;
      const startWidth = group.element.getBoundingClientRect().width;
      const startX = event.clientX;
      const direction = side === "right" ? 1 : -1;
      const move = (moveEvent: PointerEvent) => {
        const maxWidth = Math.max(240, window.innerWidth - 24);
        const nextWidth = Math.round(
          Math.min(
            Math.max(
              Math.min(360, maxWidth),
              startWidth + (moveEvent.clientX - startX) * direction * 2,
            ),
            maxWidth,
          ),
        );
        const paneWidth = `min(${nextWidth}px, calc(100vw - 24px))`;
        group.element.style.setProperty("--iori-pane-width", paneWidth);
        dockRoot.current?.style.setProperty(
          "--iori-maximized-pane-width",
          paneWidth,
        );
        const next = { ...maximizedWidthsRef.current, [kind]: nextWidth };
        maximizedWidthsRef.current = next;
        setMaximizedWidths(next);
      };
      const finish = () => {
        window.removeEventListener("pointermove", move);
        window.removeEventListener("pointercancel", finish);
        window.removeEventListener("pointerup", finish);
        onPanelWidthsChange(maximizedWidthsRef.current);
      };
      window.addEventListener("pointermove", move);
      window.addEventListener("pointercancel", finish, { once: true });
      window.addEventListener("pointerup", finish, { once: true });
    };

  const closeMaximize = useCallback(() => {
    dockRoot.current
      ?.querySelectorAll(".iori-dock-maximized")
      .forEach((item) => item.classList.remove("iori-dock-maximized"));
    setMaximizedGroup(undefined);
  }, []);

  useEffect(() => {
    if (maximizedGroup) return;
    // Switching tabs while maximized makes Dockview measure the lifted group.
    // Refresh its overlay coordinates once the normal group geometry is back.
    dock.refreshOverlays();
  }, [maximizedGroup]);

  // Keep the overlay of the maximized group's visible panel lifted with it,
  // also when the view changes inside the group. Split ratios stay unchanged.
  useEffect(() => {
    if (!maximizedGroup) return;
    const group = dock.api?.groups.find((item) => item.id === maximizedGroup);
    if (!group) {
      setMaximizedGroup(undefined);
      return;
    }
    setGroupWidth(
      group,
      maximizesFullWidth(kindOfGroup(group), maximizedFullWidthRef.current),
    );
  }, [activeTabId, maximizedGroup, tabs, setGroupWidth]);

  useEffect(() => {
    if (isMobile) closeMaximize();
  }, [isMobile, closeMaximize]);

  const onDockReady = (api: DockviewApi) => {
    if (!dock.restore(api, scope, () => layoutScope.current)) {
      // Preserve a parent that already replaced Start before the dock mounted.
      const agentId =
        workspace.getSnapshot().layout?.panels?.[
          templateAgentPanel.current ?? ""
        ]?.params?.tabId;
      const agent = workspace
        .getSnapshot()
        .tabs.find((tab) => tab.id === agentId);
      const board = workspace
        .getSnapshot()
        .tabs.find((tab) => tab.kind === "board");
      // A layout Dockview cannot read opens as one group of the saved tabs.
      workspace.update((current) => ({ ...current, layout: undefined }));
      dock.clear();
      if (templateApplied.current && selectedTarget) {
        const restored = defaultTabs(selectedTarget, false);
        if (agent) restored[0] = agent;
        if (board) restored.push(board);
        workspace.update((current) => ({
          ...current,
          tabs: restored,
          activeTabId: restored[0].id,
        }));
        templateApplied.current = false;
      }
      if (selectedTarget && workspace.getSnapshot().tabs.length === 0) {
        const start: WorkspaceTab = {
          id: `start:${crypto.randomUUID()}`,
          kind: "start",
          title: "Start",
          target: selectedTarget,
        };
        workspace.update((current) => ({
          ...current,
          tabs: [start],
          activeTabId: start.id,
        }));
      }
    }
    return dock.observe({
      onActive: activateTab,
      onRemoveGroup: (id) =>
        setMaximizedGroup((current) => (current === id ? undefined : current)),
    });
  };

  useEffect(() => {
    if (!dock.api || isMobile || layoutLoading || loadedLayoutScope !== scope)
      return;
    dock.sync();
  }, [tabs, activeTabId, layoutLoading, isMobile, loadedLayoutScope, scope]);

  // The worktrees of the opened folder as the sidebar knows them now.
  const targetFolder = selectedTarget
    ? (sidebarFolders.find(
        ({ host, folder }) =>
          host.publicKey === selectedTarget.host.publicKey &&
          folder.workspacePath === selectedTarget.folder.workspacePath,
      )?.folder ?? selectedTarget.folder)
    : undefined;
  const targetWorktrees = useMemo(() => {
    const own = targetFolder ? worktreesOf(targetFolder) : [];
    if (!selectedTarget) return [];
    const parent =
      own.find((worktree) => samePath(worktree.path, selectedTarget.cwd)) ??
      selectedTarget.worktree;
    const choices = new Map([
      [
        hostPathKey(selectedTarget.cwd),
        {
          path: selectedTarget.cwd,
          primary: parent.primary,
          label: parent.branch ?? basename(selectedTarget.cwd),
        },
      ],
    ]);
    const children =
      childDisplay[selectedTarget.host.publicKey]?.displayed ?? [];
    for (const child of children) {
      const childPath = child.cwd;
      if (
        !childPath ||
        child.worktreeRemoved ||
        !samePath(selectedTarget.cwd, child.parentCwd) ||
        samePath(selectedTarget.cwd, childPath)
      )
        continue;
      const ownWorktree = own.find((worktree) =>
        samePath(worktree.path, childPath),
      );
      choices.set(hostPathKey(childPath), {
        path: childPath,
        primary: false,
        label: child.repositoryName
          ? `${child.repositoryName} › ${child.branch ?? basename(childPath)}`
          : (ownWorktree?.branch ?? child.branch ?? basename(childPath)),
      });
    }
    const primary = own.find((worktree) => worktree.primary);
    if (primary)
      choices.set(hostPathKey(primary.path), {
        path: primary.path,
        primary: true,
        label: primary.branch ?? basename(primary.path),
      });
    return [...choices.values()];
  }, [targetFolder, selectedTarget, childDisplay]);
  const selectReadingWorktree = useCallback((tabId: string, path: string) => {
    workspace.update((current) =>
      selectWorkspaceReadingWorktree(current, tabId, path),
    );
  }, []);
  const [fileOpenRequest, setFileOpenRequest] = useState<FileOpenRequest>();
  const viewServices = useMemo<WorkspaceViewServices>(
    () => ({
      openFile: (file, standalone) => {
        if (!selectedTarget) return;
        const normalize = (path: string) =>
          path.replaceAll("\\", "/").replace(/\/$/, "");
        const absolute = normalize(file.absolutePath);
        const worktree = standalone
          ? undefined
          : [...targetWorktrees]
              .sort((a, b) => b.path.length - a.path.length)
              .find((item) =>
                hostPathKey(absolute).startsWith(`${hostPathKey(item.path)}/`),
              );
        let tabId: string | undefined;
        let path = file.path;
        if (worktree) {
          tabId = addPanel("files");
          if (tabId) selectReadingWorktree(tabId, worktree.path);
          path = absolute.slice(normalize(worktree.path).length + 1);
        } else {
          const existing = workspace
            .getSnapshot()
            .tabs.find(
              (tab) =>
                tab.kind === "file" &&
                tab.file &&
                samePath(tab.file.absolutePath, file.absolutePath),
            );
          tabId = existing?.id ?? `file:${crypto.randomUUID()}`;
          if (existing) activateTab(tabId);
          else
            addTab({
              id: tabId,
              kind: "file",
              title: basename(file.path),
              file,
              target: selectedTarget,
            });
        }
        if (tabId)
          setFileOpenRequest({ tabId, path, line: file.line, id: Date.now() });
      },
      fileOpenRequest,
      fileOpened: (id) =>
        setFileOpenRequest((value) => (value?.id === id ? undefined : value)),
      viewState: (key) => workspace.getSnapshot().views?.[key],
      setViewState: (key, state) => {
        if (
          [...closedPanels.current].some(
            (panel) => key === panel || key.startsWith(`${panel}:reading:`),
          )
        )
          return;
        workspace.update((current) =>
          setWorkspaceViewState(current, key, state),
        );
      },
      setBackHandler: (key, handler) => {
        if (handler) backHandlers.current.set(key, handler);
        else backHandlers.current.delete(key);
      },
      openFileHistory: (path, worktreePath) => {
        const tabId = addPanel("git");
        if (tabId) {
          selectReadingWorktree(tabId, worktreePath);
          setFileHistoryRequest((current) => ({
            tabId,
            path,
            id: (current?.id ?? 0) + 1,
          }));
        }
      },
      fileHistoryRequest,
      fileHistoryShown: (id) =>
        setFileHistoryRequest((current) =>
          current?.id === id ? undefined : current,
        ),
      worktrees: targetWorktrees,
      selectWorktree: selectReadingWorktree,
      ciOpenRequest,
      ciOpenShown: (id) =>
        setCiOpenRequest((current) =>
          current?.id === id ? undefined : current,
        ),
      // The repository's worktree screen with the Issue's values; nothing
      // starts until the user creates or starts here (forge.md).
      startIssue: ({ host, folder }, { number, title }) => {
        setCreationTarget({
          host,
          folder,
          prefill: {
            id: Date.now(),
            name: issueWorktreeName(number, title),
            instruction: t(
              "Work on Issue #{number}. Read its body and comments with `iori issue show {number}`.",
            ).replaceAll("{number}", String(number)),
          },
        });
        setCreationOpen(true);
      },
    }),
    [
      addPanel,
      addTab,
      activateTab,
      selectedTarget,
      fileOpenRequest,
      fileHistoryRequest,
      targetWorktrees,
      selectReadingWorktree,
      ciOpenRequest,
      t,
    ],
  );

  const goHome = () => {
    if (!selectedTarget) return false;
    setVisitedTargets([]);
    setSelectedTarget(undefined);
    return true;
  };

  const handleBack = useCallback(() => {
    if (folderHostKey) {
      setFolderHostKey(undefined);
      return true;
    }
    if (shellPickerOpen) {
      setShellPickerOpen(false);
      return true;
    }
    if (maximizedGroup) {
      closeMaximize();
      return true;
    }
    if (isMobile && openMobile) {
      setOpenMobile(false);
      return true;
    }
    if (teamsHost) {
      if (isMobile && teamBacks.current.get(teamsHost.publicKey)?.())
        return true;
      leaveTeams(() => setTeamsHost(undefined));
      return true;
    }
    // Inside the shown View first: a detail goes back to its list.
    const shownPanel = isMobile
      ? workspace.getSnapshot().activeTabId ||
        workspace.getSnapshot().tabs[0]?.id
      : dock.api?.activePanel?.id;
    if (shownPanel && backHandlers.current.get(shownPanel)?.()) return true;
    // After the shown tab closes, the tab shown in its place can still be in
    // the history; going back skips it so every press moves somewhere.
    const previousTab = [...tabVisitHistory]
      .reverse()
      .find(
        (id) =>
          id !== workspace.getSnapshot().activeTabId &&
          tabs.some((tab) => tab.id === id),
      );
    if (previousTab) {
      setTabVisitHistory((current) =>
        current.slice(0, current.lastIndexOf(previousTab)),
      );
      workspace.update((current) => selectWorkspaceTab(current, previousTab));
      dock.select(previousTab);
      return true;
    }
    const previous = visitedTargets.at(-1);
    if (previous) {
      setVisitedTargets((current) => current.slice(0, -1));
      openTarget(previous.host, previous.folder, previous.worktree, false);
      return true;
    }
    // Mobile came to the worktree from its first screen.
    return isMobile ? goHome() : false;
  }, [
    teamsHost,
    folderHostKey,
    shellPickerOpen,
    maximizedGroup,
    closeMaximize,
    isMobile,
    openMobile,
    setOpenMobile,
    tabVisitHistory,
    setTabVisitHistory,
    tabs,
    visitedTargets,
    openTarget,
    selectedTarget,
  ]);
  useEffect(() => onBackHandler(handleBack), [handleBack, onBackHandler]);

  useEffect(() => {
    const keydown = (event: KeyboardEvent) => {
      const key = event.key.toLowerCase();
      if (key === "escape" && maximizedGroup && !event.isComposing) {
        event.preventDefault();
        closeMaximize();
        return;
      }
      if ((event.ctrlKey || event.metaKey) && key === "k") {
        keySequence.current = true;
        event.preventDefault();
        return;
      }
      if (keySequence.current) {
        keySequence.current = false;
        if ((event.ctrlKey || event.metaKey) && key === "m") {
          const group = dock.api?.activePanel?.api.group;
          if (group) toggleMaximize(group);
          event.preventDefault();
        }
      }
    };
    window.addEventListener("keydown", keydown);
    return () => window.removeEventListener("keydown", keydown);
  });

  // A sidebar entry may be pressed while the chosen worktree is loading.
  // Open it only in that layout, never in the previous worktree's tabs.
  useEffect(() => {
    if (!viewToOpen) return;
    if (viewToOpen.scope !== scope) {
      setViewToOpen(undefined);
      return;
    }
    if (layoutLoading || loadedLayoutScope !== scope) return;
    setViewToOpen(undefined);
    if (viewToOpen.kind !== "terminal") addPanel(viewToOpen.kind);
    else {
      const recent = recentTerminal();
      if (recent) openTerminal(recent);
      else void createTerminal();
    }
  }, [
    viewToOpen,
    scope,
    layoutLoading,
    loadedLayoutScope,
    addPanel,
    recentTerminal,
    openTerminal,
    createTerminal,
  ]);

  useEffect(() => {
    if (!isMobile || !scope) {
      shownMobileTab.current = undefined;
      return;
    }
    if (
      openMobile ||
      teamsHost ||
      layoutLoading ||
      loadedLayoutScope !== scope ||
      viewToOpen ||
      attentionToOpen ||
      branchToOpen ||
      ciToOpen ||
      boardToOpen ||
      issuesToOpen
    )
      return;
    const id = tabs.find((tab) => tab.id === activeTabId)?.id ?? tabs[0]?.id;
    shownMobileTab.current = id ? { scope, id } : undefined;
  }, [
    isMobile,
    scope,
    openMobile,
    teamsHost,
    layoutLoading,
    loadedLayoutScope,
    viewToOpen,
    attentionToOpen,
    branchToOpen,
    ciToOpen,
    boardToOpen,
    issuesToOpen,
    tabs,
    activeTabId,
  ]);

  const beginSidebarViewDrag =
    (
      kind: WorkspaceViewKind,
      terminalId?: string,
      source?: { hostKey: string; workspacePath: string; worktreePath: string },
    ) =>
    (event: ReactDragEvent<HTMLButtonElement>) => {
      if (!selectedTarget && !source) return;
      event.dataTransfer.effectAllowed = "move";
      event.dataTransfer.setData(
        sidebarViewTransferType,
        JSON.stringify({
          kind,
          terminalId,
          ...(source ?? {
            hostKey: selectedTarget!.host.publicKey,
            workspacePath: selectedTarget!.folder.workspacePath,
            worktreePath: selectedTarget!.worktree.path,
          }),
        }),
      );
    };

  useEffect(() => {
    if (
      !branchToOpen ||
      layoutLoading ||
      loadedLayoutScope !== scope ||
      selectedTarget?.host.publicKey !== branchToOpen.hostKey ||
      !samePath(selectedTarget.cwd, branchToOpen.parentCwd)
    )
      return;
    const id = addPanel("git");
    if (id) selectReadingWorktree(id, branchToOpen.cwd);
    setBranchToOpen(undefined);
  }, [
    branchToOpen,
    layoutLoading,
    loadedLayoutScope,
    scope,
    selectedTarget,
    addPanel,
    selectReadingWorktree,
  ]);
  useEffect(() => {
    if (
      !ciToOpen ||
      layoutLoading ||
      loadedLayoutScope !== scope ||
      selectedTarget?.host.publicKey !== ciToOpen.hostKey ||
      !samePath(selectedTarget.cwd, ciToOpen.cwd)
    )
      return;
    const id = addPanel("ci");
    if (id) {
      selectReadingWorktree(id, ciToOpen.cwd);
      setCiOpenRequest((current) => ({
        tabId: id,
        id: (current?.id ?? 0) + 1,
      }));
    }
    setCiToOpen(undefined);
  }, [
    ciToOpen,
    layoutLoading,
    loadedLayoutScope,
    scope,
    selectedTarget,
    addPanel,
    selectReadingWorktree,
  ]);
  const childStates = useRef(new Map<string, ChildSummary["state"]>());
  const finishedChildTabs = useRef(
    new Map<string, { hostKey: string; cwd: string; terminalId: string }>(),
  );
  useEffect(() => {
    for (const [hostKey, children] of Object.entries(childrenByHost))
      for (const child of children) {
        const key = JSON.stringify([hostKey, child.id]);
        const previous = childStates.current.get(key);
        childStates.current.set(key, child.state);
        // The initial list is history; only a transition seen here closes a tab.
        if (
          previous &&
          previous !== "finished" &&
          child.state === "finished" &&
          child.terminalId
        ) {
          finishedChildTabs.current.set(key, {
            hostKey,
            cwd: child.parentCwd,
            terminalId: child.terminalId,
          });
        }
      }
  }, [childrenByHost]);
  useEffect(() => {
    if (!selectedTarget || layoutLoading || loadedLayoutScope !== scope) return;
    for (const [key, child] of finishedChildTabs.current) {
      if (
        child.hostKey !== selectedTarget.host.publicKey ||
        !samePath(child.cwd, selectedTarget.cwd)
      )
        continue;
      finishedChildTabs.current.delete(key);
      if (
        workspace
          .getSnapshot()
          .tabs.some((tab) => tab.terminalId === child.terminalId)
      )
        closeTab(terminalTabId(child.terminalId), undefined, true);
    }
  }, [childrenByHost, selectedTarget, layoutLoading, loadedLayoutScope, scope]);
  // Tabs of Terminals that no longer exist on the Host leave the layout.
  useEffect(() => {
    if (
      !terminalList ||
      terminalStatus[currentHostKey] !== "loaded" ||
      loadedLayoutScope !== scope
    )
      return;
    const ids = new Set(terminalList.terminals.map((terminal) => terminal.id));
    // A launch can update the store before this effect runs. Only compare
    // tabs from this render with the Host list from the same render.
    for (const tab of missingWorkspaceTerminals({ tabs }, ids)) {
      terminalViewIds.current.delete(
        `${tab.target.host.publicKey}:${tab.terminalId}`,
      );
      closeTab(tab.id);
    }
  }, [
    terminalList,
    terminalStatus,
    currentHostKey,
    loadedLayoutScope,
    scope,
    tabs,
  ]);

  const mobileBoards = useMobileBoards(
    state.connectedHosts,
    terminalLists,
    isMobile && !selectedTarget,
  );
  const navigationHosts = [...hosts].sort((a, b) =>
    sidebarOrder(hostOrder ?? [])(a.publicKey, b.publicKey),
  );
  const navigationFolders = [...sidebarFolders].sort(
    (a, b) =>
      (a.folder.sidebarPosition ?? Infinity) -
      (b.folder.sidebarPosition ?? Infinity),
  );
  const openWorktrees: OpenWorktree[] = navigationHosts.flatMap((host) =>
    navigationFolders
      .filter((entry) => entry.host.publicKey === host.publicKey)
      .flatMap(({ folder }) =>
        worktreesOf(folder).map((worktree) => ({ host, folder, worktree })),
      ),
  );

  useEffect(() => {
    if (!boardToOpen) return;
    if (
      selectedTarget?.host.publicKey !== boardToOpen.hostKey ||
      !samePath(selectedTarget.cwd, boardToOpen.cwd)
    ) {
      setBoardToOpen(undefined);
      return;
    }
    if (layoutLoading || loadedLayoutScope !== scope) return;
    const id = addPanel("board");
    if (id) {
      workspace.update((current) =>
        setWorkspaceViewState(current, id, boardToOpen.conversation),
      );
      // The restored active tab was not visited on this trip from Home.
      setTabVisitHistory([]);
    }
    setBoardToOpen(undefined);
  }, [
    boardToOpen,
    layoutLoading,
    loadedLayoutScope,
    scope,
    selectedTarget,
    addPanel,
  ]);

  useEffect(() => {
    if (!issuesToOpen) return;
    if (
      selectedTarget?.host.publicKey !== issuesToOpen.hostKey ||
      selectedTarget.folder.workspacePath !== issuesToOpen.workspacePath
    ) {
      setIssuesToOpen(undefined);
      return;
    }
    if (layoutLoading || loadedLayoutScope !== scope) return;
    setIssuesToOpen(undefined);
    addPanel("issues");
  }, [
    issuesToOpen,
    layoutLoading,
    loadedLayoutScope,
    scope,
    selectedTarget,
    addPanel,
  ]);

  // Terminal tabs show the Host Terminal; Files and Git use renderPanel.
  const renderAll: WorkspacePanelRenderer = (props) => {
    if (props.kind === "start") return startScreen(props.tabId);
    if (props.kind === "board")
      return (
        <Board
          host={props.host.publicKey}
          cwd={props.cwd}
          visible={props.visible && !teamsHost}
          t={t}
          language={language}
          viewState={props.viewState}
          onViewState={props.onViewState}
          onOpenTerminal={(id) => {
            const terminal = terminalLists[
              props.host.publicKey
            ]?.terminals.find((item) => item.id === id);
            if (terminal) void openAttention({ host: props.host, terminal });
          }}
          onOpenGit={(cwd) => {
            const id = addPanel("git");
            if (id) selectReadingWorktree(id, cwd);
          }}
          onEditTeam={(teamId, roleId) => {
            openTeams(props.host, "teams");
            setTeamToOpen({
              hostKey: props.host.publicKey,
              teamId,
              roleId,
              nonce: Date.now(),
            });
          }}
        />
      );
    if (props.kind !== "terminal") return renderPanel?.(props);
    const hostKey = props.host.publicKey;
    const list = terminalLists[hostKey];
    const summary = list?.terminals.find(
      (terminal) => terminal.id === props.terminalId,
    );
    const connectionId = connection.connectionIdOf(hostKey);
    if (!list || !summary)
      return <div className="workspace-terminal-waiting" />;
    const viewKey = `${hostKey}:${summary.id}`;
    let viewId = terminalViewIds.current.get(viewKey);
    if (!viewId) {
      viewId = crypto.randomUUID();
      terminalViewIds.current.set(viewKey, viewId);
    }
    return (
      <TerminalPane
        key={`${summary.id}:${list.windowsPty?.backend ?? "none"}:${list.windowsPty?.buildNumber ?? ""}`}
        viewId={viewId}
        hostKey={hostKey}
        onOpenFile={props.onOpenFile}
        onBackHandler={props.onBackHandler}
        onResume={async () => {
          try {
            const result = await connection.requestHost(hostKey, "cli.resume", {
              terminalId: summary.id,
            });
            return Boolean(result?.ok);
          } catch {
            return false;
          }
        }}
        onStopChild={
          childrenByHost[hostKey]?.some(
            (child) =>
              child.terminalId === summary.id &&
              !["finished", "stopped", "failed"].includes(child.state),
          )
            ? () => {
                const child = childrenByHost[hostKey]!.find(
                  (child) => child.terminalId === summary.id,
                )!;
                void stopChild(hostKey, child);
              }
            : undefined
        }
        child={
          !!summary.teamChild ||
          childrenByHost[hostKey]?.some(
            (child) => child.terminalId === summary.id,
          )
        }
        onCloseTerminal={() => {
          if (connectionId) terminalClose.request(connectionId, summary.id);
        }}
        connectionId={connectionId ?? ""}
        connected={state.connectedHosts.includes(hostKey)}
        foreground={state.foreground}
        mobile={Boolean(state.initial?.mobile)}
        focusNonce={
          focusRequest?.tabId === props.tabId ? focusRequest.nonce : undefined
        }
        onFocusConsumed={focusConsumed}
        claimSizeOnOpen={claimTerminals.has(summary.id)}
        visible={props.visible && !teamsHost}
        terminal={summary}
        windowsPty={list.windowsPty}
        onClosed={(terminalId) => {
          if (
            summary.teamConversation ||
            childrenByHost[hostKey]?.some(
              (child) => child.terminalId === terminalId,
            )
          ) {
            closeTab(terminalTabId(terminalId), undefined, true);
            void loadTerminals(hostKey);
          } else removeTerminal(hostKey, terminalId, true);
        }}
        onOpenClaimConsumed={(terminalId) =>
          setClaimTerminals((current) => {
            const next = new Set(current);
            next.delete(terminalId);
            return next;
          })
        }
        fontSize={terminalFontSize}
        fontFamily={terminalFontFamily}
        onFontSize={onTerminalFontSize}
        rightClick={terminalRightClick}
        linkOpen={terminalLinkOpen}
        accessoryLayout={accessoryLayout}
        inputPreferences={inputPreferences}
        onInputPreferences={onInputPreferences}
        t={t}
      />
    );
  };
  // Terminal tabs carry the title the shell reports.
  const displayTabs = tabs.map((tab) => {
    if (tab.kind !== "terminal") return tab;
    const summary = terminalList?.terminals.find(
      (terminal) => terminal.id === tab.terminalId,
    );
    const child = childrenFor(currentHostKey).find(
      (child) => child.terminalId === tab.terminalId,
    );
    return summary
      ? {
          ...tab,
          title: child
            ? `${child.role} · ${child.title}`
            : terminalTitle(summary.title) ||
              summary.cli?.name ||
              shellLabel(summary.shell),
          childId: child?.id ?? summary.teamChild,
          canStopChild:
            !!child && !["finished", "stopped"].includes(child.state),
          cli: child?.cli ?? summary.cli,
          cliStatus: state.connectedHosts.includes(currentHostKey)
            ? child
              ? childCliStatus(child)
              : summary.cliStatus
            : undefined,
        }
      : tab;
  });

  const saveTemplateRef =
    useRef<() => WorktreeLayoutTemplate | undefined>(undefined);
  saveTemplateRef.current = () => {
    const layout = dock.api?.toJSON();
    if (!layout) return;
    const candidates = displayTabs.filter(
      (tab) => tab.kind === "terminal" && tab.cli && !tab.childId,
    );
    const agent =
      candidates[0] ?? displayTabs.find((tab) => tab.kind === "start");
    const slots: LayoutSlot[] = [];
    const mapped = new Map<string, string>();
    const seen = new Set<string>();
    for (const panel of Object.values(layout.panels)) {
      const tab = displayTabs.find((tab) => tab.id === panel.params?.tabId);
      if (
        !tab ||
        panel.id.includes(":split:") ||
        panel.id.includes(":reading:") ||
        seen.has(tab.id)
      )
        continue;
      let kind: LayoutSlotKind;
      if (tab.id === agent?.id) kind = "agent";
      else if (tab.kind === "terminal" && !tab.cli && !tab.childId)
        kind = "terminal";
      else if (["files", "git", "board", "issues", "ci"].includes(tab.kind))
        kind = tab.kind as LayoutSlotKind;
      else continue;
      if (kind !== "terminal" && slots.some((slot) => slot.kind === kind))
        continue;
      seen.add(tab.id);
      const id = `slot-${slots.length + 1}`;
      slots.push({ id, kind });
      mapped.set(panel.id, id);
    }
    const portable = pruneLayout(layout, mapped);
    if (!portable) return;
    const activePanel = dock.api?.activePanel?.id;
    const selected = (
      node: SerializedDockview["grid"]["root"],
    ): string | undefined =>
      Array.isArray(node.data)
        ? node.data.map(selected).find(Boolean)
        : node.data.id === portable.activeGroup
          ? node.data.activeView
          : undefined;
    return {
      version: 1,
      layout: portable,
      slots,
      activeSlot: mapped.get(activePanel ?? "") ?? selected(portable.grid.root),
    };
  };
  useEffect(
    () =>
      worktreeLayoutDefault.register(
        selectedTarget &&
          !isMobile &&
          !state.initial?.mobile &&
          !teamsHost &&
          !layoutLoading &&
          loadedLayoutScope === scope
          ? () => saveTemplateRef.current?.()
          : undefined,
      ),
    [
      selectedTarget,
      isMobile,
      state.initial?.mobile,
      teamsHost,
      layoutLoading,
      loadedLayoutScope,
      scope,
    ],
  );

  const launchingItem = launching?.scope === scope ? launching.item : undefined;
  const dockContext: DockContextValue = {
    saveNewWorktreeLayout:
      !isMobile && !state.initial?.mobile
        ? () => void worktreeLayoutDefault.save(t)
        : undefined,
    readingViews: [
      "files",
      ...(targetFolder?.kind === "git" ? ["git" as const] : []),
      ...(targetTerminals.some((terminal) => terminal.teamConversation)
        ? ["board" as const]
        : []),
    ],
    openReadingView: (kind, groupId) => addPanel(kind, groupId),
    tabs: displayTabs,
    t,
    renderPanel: renderAll,
    shells,
    clis: cliList.clis,
    hostKey: currentHostKey,
    addTeam: (team, groupId) =>
      void createTerminal(undefined, groupId, undefined, undefined, team),
    cliError,
    addCli: (cli, groupId) =>
      void createTerminal(undefined, groupId, undefined, cli),
    launcherActive: !teamsHost,
    launching: launchingItem,
    openTeams: (teamId) => {
      const host = hosts.find((h) => h.publicKey === currentHostKey);
      if (host) {
        setTeamToOpen(
          teamId
            ? { hostKey: host.publicKey, teamId, nonce: Date.now() }
            : undefined,
        );
        openTeams(host, "teams");
      }
    },
    openCliSettings: () => {
      const host = hosts.find((h) => h.publicKey === currentHostKey);
      if (host) openTeams(host, "agents");
    },
    defaultShellId: terminalList?.defaultShell,
    shellStatus,
    retryShells: () => {
      if (currentHostKey) void loadTerminals(currentHostKey);
      void reloadClis();
    },
    doubleClickMaximize,
    maximizedGroup,
    maximizedFullWidth: (() => {
      const group = dock.api?.groups.find((item) => item.id === maximizedGroup);
      return group
        ? maximizesFullWidth(kindOfGroup(group), maximizedFullWidth)
        : false;
    })(),
    toggleMaximizedFullWidth,
    maximize: toggleMaximize,
    closeTab,
    addTerminal: (shell, groupId) => void createTerminal(shell.id, groupId),
    closeTerminal,
    stopChild: (childId) => {
      const child = childrenByHost[currentHostKey]?.find(
        (child) => child.id === childId,
      );
      if (child) void stopChild(currentHostKey, child);
    },
    dropSidebarView,
    split: splitGroup,
    setActiveTab: activateTab,
    // The path is typed relative to the Terminal's working directory when the
    // shell reported that directory and the path is inside it, and absolute
    // otherwise. Enter is left to the user.
    dropPath: (tab, drag) => {
      const hostKey = tab.target.host.publicKey;
      const summary = terminalLists[hostKey]?.terminals.find(
        (terminal) => terminal.id === tab.terminalId,
      );
      if (!summary || drag.hostKey !== hostKey) return;
      const text = terminalDropText(
        drag.absolutePath,
        summary.cwdFromShell ? summary.cwd : undefined,
        summary.shell,
      );
      if (text === undefined) return;
      typeIntoTerminal(summary.id, text);
      showPanel(tab.id);
    },
    focusRequest,
    focusConsumed,
  };

  const maximizedDockGroup = maximizedGroup
    ? dock.api?.groups.find((group) => group.id === maximizedGroup)
    : undefined;
  const target = selectedTarget;
  const targetName = target ? basename(target.worktree.path) : "";
  const startName = target
    ? target.folder.kind === "git"
      ? worktreeLabel(
          target.worktree.branch,
          target.worktree.path,
          target.folder.workspacePath,
        )
      : basename(target.worktree.path)
    : "";
  const launcher = (large: boolean, startTabId?: string) => (
    <CliLauncher
      pending={launchingItem}
      hostKey={currentHostKey}
      active={!teamsHost}
      onOpenTeams={(teamId) => {
        setShellPickerOpen(false);
        const host = hosts.find((item) => item.publicKey === currentHostKey);
        if (host) {
          setTeamToOpen(
            teamId
              ? { hostKey: host.publicKey, teamId, nonce: Date.now() }
              : undefined,
          );
          openTeams(host, "teams");
        }
      }}
      onTeam={(team) => {
        const pending = dock.pendingPosition;
        dock.pendingPosition = undefined;
        void createTerminal(
          undefined,
          pending?.groupId,
          pending?.direction,
          undefined,
          team,
          startTabId,
        );
      }}
      t={t}
      large={large}
      shells={shells}
      clis={cliList.clis}
      cliError={cliError}
      onCli={(cli) => {
        const pending = dock.pendingPosition;
        dock.pendingPosition = undefined;
        void createTerminal(
          undefined,
          pending?.groupId,
          pending?.direction,
          cli,
          undefined,
          startTabId,
        );
      }}
      onAddCli={() => {
        setShellPickerOpen(false);
        const host = hosts.find((item) => item.publicKey === currentHostKey);
        if (host) openTeams(host, "agents");
      }}
      defaultShellId={terminalList?.defaultShell}
      status={shellStatus}
      onRetry={() => {
        if (currentHostKey) void loadTerminals(currentHostKey);
        void reloadClis();
      }}
      onShell={
        startTabId
          ? (shell) =>
              void createTerminal(
                shell.id,
                undefined,
                undefined,
                undefined,
                undefined,
                startTabId,
              )
          : chooseShell
      }
    />
  );
  const startScreen = (startTabId?: string) =>
    target && (
      <ScrollArea type="auto" className="start-workspace-scroll">
        <section className="start-workspace" data-iori-view="workspace-start">
          <h1>{t("Start in {name}").replace("{name}", startName)}</h1>
          <p>{target.host.hostName}</p>
          {launcher(true, startTabId)}
        </section>
      </ScrollArea>
    );
  const layoutReady = target && !layoutLoading && loadedLayoutScope === scope;
  const activeMobileTab = tabs.find((tab) => tab.id === activeTabId) ?? tabs[0];

  const body = !target ? (
    isMobile ? (
      <MobileHome
        t={t}
        worktrees={openWorktrees}
        connectedHosts={state.connectedHosts}
        summaries={mobileBoards}
        terminalLists={terminalLists}
        onBoard={(item, conversation) => {
          setBoardToOpen({
            hostKey: item.host.publicKey,
            cwd: item.worktree.path,
            conversation,
          });
          openTarget(item.host, item.folder, item.worktree);
        }}
        attention={attentionItems}
        running={hosts.flatMap((host) =>
          state.connectedHosts.includes(host.publicKey)
            ? (terminalLists[host.publicKey]?.terminals ?? [])
                .filter((terminal) => terminal.cliStatus?.state === "active")
                .map((terminal) => ({ host, terminal }))
            : [],
        )}
        onAttention={(item) => {
          void openAttention(item);
        }}
        onOpen={(item) => openTarget(item.host, item.folder, item.worktree)}
        onSettings={() => onSettings()}
      />
    ) : (
      <>
        <SidebarTrigger
          className="workspace-start-toggle"
          data-iori-action="sidebar-toggle"
          aria-label={t("Toggle sidebar")}
        />
        <section className="start-workspace">
          <p>
            {t(
              sidebarFolders.length
                ? "Select a worktree in the sidebar."
                : "Open a folder from the sidebar.",
            )}
          </p>
        </section>
      </>
    )
  ) : layoutErrors[scope] === "load" && !layoutLoading ? (
    <div className="workspace-inline-alert" role="alert">
      <p>{t("Could not restore this workspace layout.")}</p>
      <Button
        variant="outline"
        size="sm"
        onClick={() => void loadTargetLayout(scope, selectedTarget, isMobile)}
        data-iori-action="workspace-layout-retry-load"
      >
        {t("Retry")}
      </Button>
      <Button
        variant="outline"
        size="sm"
        onClick={() => discardLayout(scope)}
        data-iori-action="workspace-layout-discard"
      >
        {t("Discard the layout and open")}
      </Button>
    </div>
  ) : !layoutReady || boardToOpen || viewToOpen ? null : isMobile ? (
    <MobileWorkspace
      name={targetName}
      branch={target.worktree.branch}
      t={t}
      onStopChild={(() => {
        const child = childrenByHost[currentHostKey]?.find(
          (child) =>
            child.terminalId === activeMobileTab?.terminalId &&
            !["finished", "stopped", "failed"].includes(child.state),
        );
        return child ? () => void stopChild(currentHostKey, child) : undefined;
      })()}
      onNew={() => {
        dock.pendingPosition = undefined;
        setShellPickerOpen(true);
      }}
      onCloseView={
        activeMobileTab ? () => closeTab(activeMobileTab.id) : undefined
      }
    >
      {tabs.length === 0
        ? startScreen()
        : tabs.map((tab) => (
            <div
              key={tab.id}
              className="mobile-retained-view"
              hidden={tab.id !== activeMobileTab?.id}
              data-iori-mobile-view-kind={tab.kind}
              data-iori-workspace-panel={tab.id}
            >
              <PanelView
                tab={tab}
                panelId={`mobile:${tab.id}`}
                renderPanel={renderAll}
                visible={tab.id === activeMobileTab?.id}
                t={t}
              />
            </div>
          ))}
    </MobileWorkspace>
  ) : (
    <div
      ref={dockRoot}
      className={`workspace-dock-shell ${maximizedGroup ? "has-maximized" : ""}`}
    >
      {maximizedGroup && (
        <button
          type="button"
          className="workspace-maximize-backdrop"
          onClick={closeMaximize}
          aria-label={t("Restore pane")}
        />
      )}
      <DockLayout key={scope} context={dockContext} onReady={onDockReady} />
      {maximizedDockGroup &&
        createPortal(
          <>
            <div
              className="workspace-resize-handle workspace-resize-left"
              onPointerDown={beginMaximizedResize(
                kindOfGroup(maximizedDockGroup),
                "left",
              )}
            />
            <div
              className="workspace-resize-handle workspace-resize-right"
              onPointerDown={beginMaximizedResize(
                kindOfGroup(maximizedDockGroup),
                "right",
              )}
            />
          </>,
          maximizedDockGroup.element,
        )}
      {maximizedGroup && (
        <Button
          className="workspace-maximize-close"
          variant="ghost"
          size="icon-sm"
          onClick={closeMaximize}
          aria-label={t("Restore pane")}
          data-iori-action="workspace-restore"
        >
          <X size={16} />
        </Button>
      )}
    </div>
  );

  return (
    <>
      <SidebarResize
        width={sidebarWidth}
        onWidthChange={onSidebarWidthChange}
        t={t}
      />
      <Navigation
        issueRepositories={issueRepositories}
        showForgeStatus={showForgeStatus}
        onDeleteWorktree={(host, path, cleanup, label) =>
          setRemovalTarget({ host, path, cleanup, label })
        }
        onCreate={(host, folder) =>
          leaveTeams(() => {
            setTeamsHost(undefined);
            if (
              creationTarget?.host.publicKey !== host.publicKey ||
              creationTarget?.folder.workspacePath !== folder.workspacePath ||
              creationTarget.prefill
            )
              setCreationTarget({ host, folder });
            setCreationOpen(true);
          })
        }
        onOpenIssues={(host, folder) =>
          leaveTeams(() => {
            setTeamsHost(undefined);
            setIssuesToOpen({
              hostKey: host.publicKey,
              workspacePath: folder.workspacePath,
            });
            if (
              selectedTarget?.host.publicKey !== host.publicKey ||
              selectedTarget.folder.workspacePath !== folder.workspacePath
            )
              openTarget(
                host,
                folder,
                worktreesOf(folder).find((worktree) => worktree.primary),
                true,
                false,
              );
            setOpenMobile(false);
          })
        }
        attentionCount={attentionItems.length}
        onAttention={() => {
          void openAttention(attentionItems[0]);
        }}
        t={t}
        hosts={navigationHosts}
        clisRevision={clisRevision}
        onReorderHosts={onReorderHosts}
        collapsedKeys={sidebarCollapsed}
        onCollapsedChange={onSidebarCollapsedChange}
        loadedHistoryHosts={loadedHistoryHosts}
        onReorderFolders={(hostKey, paths) =>
          void reorderFolders(hostKey, paths)
        }
        observedHosts={state.observedHosts}
        homeActive={!target && !teamsHost}
        onHome={() => {
          leaveTeams(() => {
            goHome();
            setOpenMobile(false);
          });
        }}
        teamsHostKey={teamsHost?.publicKey}
        onTeams={(host) => {
          setTeamToOpen(undefined);
          openTeams(host);
        }}
        connectedHosts={state.connectedHosts}
        folders={navigationFolders}
        selected={
          target && !teamsHost
            ? {
                hostKey: target.host.publicKey,
                workspacePath: target.folder.workspacePath,
                worktreePath: target.worktree.path,
              }
            : undefined
        }
        historyError={historyError}
        removeError={removeError}
        dragViews={!isMobile}
        onRetryHistory={(hostKey) => void refreshHistory(hostKey)}
        onSelectWorktree={(host, folder, worktree) =>
          leaveTeams(() => {
            setTeamsHost(undefined);
            openTarget(host, folder, worktree, true, false);
          })
        }
        onOpenView={(kind) =>
          leaveTeams(() => {
            setTeamsHost(undefined);
            setViewToOpen({ scope, kind });
          })
        }
        onOpenCi={(host, folder, worktree) =>
          leaveTeams(() => {
            setTeamsHost(undefined);
            setCiToOpen({ hostKey: host.publicKey, cwd: worktree.path });
            openTarget(host, folder, worktree);
          })
        }
        onDragView={beginSidebarViewDrag}
        childRows={(hostKey, path) => ({
          hostKey,
          children:
            childDisplay[hostKey]?.byWorktree.get(hostPathKey(path)) ?? [],
          t,
          activeTerminalId: teamsHost
            ? undefined
            : tabs.find((tab) => tab.id === activeTabId)?.terminalId,
          dragViews: !isMobile,
          errors: childErrors,
          branches: Object.fromEntries(
            allFolders
              .filter((entry) => entry.host.publicKey === hostKey)
              .flatMap((entry) =>
                worktreesOf(entry.folder).flatMap((worktree) =>
                  worktree.branch ? [[worktree.path, worktree.branch]] : [],
                ),
              ),
          ),
          onOpen: (child) => {
            const host = hosts.find((host) => host.publicKey === hostKey);
            const terminal = terminalLists[hostKey]?.terminals.find(
              (terminal) => terminal.id === child.terminalId,
            );
            if (host && terminal) void openAttention({ host, terminal });
            setOpenMobile(false);
          },
          onStop: (child) => void stopChild(hostKey, child),
          onDrag: (child) => (event) => {
            const entry = allFolders.find(
              (entry) =>
                entry.host.publicKey === hostKey &&
                worktreesOf(entry.folder).some((worktree) =>
                  samePath(worktree.path, child.parentCwd),
                ),
            );
            if (!entry) return;
            event.dataTransfer.effectAllowed = "move";
            event.dataTransfer.setData(
              sidebarViewTransferType,
              JSON.stringify({
                kind: "terminal",
                terminalId: child.terminalId,
                hostKey,
                workspacePath: entry.folder.workspacePath,
                worktreePath: child.parentCwd,
              }),
            );
          },
          onBranch: (child) => {
            const entry = allFolders.find(
              (entry) =>
                entry.host.publicKey === hostKey &&
                worktreesOf(entry.folder).some((worktree) =>
                  samePath(worktree.path, child.parentCwd),
                ),
            );
            if (!entry || !child.cwd || child.worktreeRemoved) return;
            leaveTeams(() => {
              setBranchToOpen({
                hostKey,
                parentCwd: child.parentCwd,
                cwd: child.cwd!,
              });
              openTarget(
                entry.host,
                entry.folder,
                worktreesOf(entry.folder).find((worktree) =>
                  samePath(worktree.path, child.parentCwd),
                ),
              );
            });
            setOpenMobile(false);
          },
        })}
        isChildWorktree={(hostKey, path) =>
          !!childDisplay[hostKey]?.childCwds.has(hostPathKey(path)) &&
          !childDisplay[hostKey]?.parentCwds.has(hostPathKey(path))
        }
        sessionsFor={(hostKey, path) =>
          (terminalLists[hostKey]?.terminals ?? []).filter(
            (terminal) =>
              samePath(terminal.worktreePath ?? terminal.cwd, path) &&
              !terminal.teamChild &&
              !childDisplay[hostKey]?.terminalIds.has(terminal.id),
          )
        }
        activeTerminalId={
          teamsHost
            ? undefined
            : tabs.find((tab) => tab.id === activeTabId)?.terminalId
        }
        terminalErrors={terminalClose.errors}
        onOpenTerminal={(terminalId, hostKey) => {
          const host = hosts.find((host) => host.publicKey === hostKey);
          const summary = terminalLists[hostKey]?.terminals.find(
            (terminal) => terminal.id === terminalId,
          );
          if (summary)
            leaveTeams(() => {
              setTeamsHost(undefined);
              if (host) void openAttention({ host, terminal: summary });
            });
        }}
        onCloseTerminal={closeTerminal}
        onAddFolder={(hostKey) => {
          void connection.selectHost(hostKey);
          setFolderHostKey(hostKey);
        }}
        onRemoveFolder={(hostKey, folder) =>
          void removeFromSidebar(hostKey, folder)
        }
        onSettings={onSettings}
      />
      <main className="workspace-main">
        {hasWindowChrome && (
          <div className="window-workspace-drag-strip" data-tauri-drag-region />
        )}
        {openedTeams.map((host) => (
          <TeamsScreen
            key={host.publicKey}
            onOpenIntegrations={onOpenIntegrations}
            onOpenWorkspaceSettings={onOpenWorkspaceSettings}
            host={host}
            active={teamsHost?.publicKey === host.publicKey}
            t={t}
            language={language}
            initialPage={teamsInitialPage}
            entry={teamsEntry}
            onRequestedTeamOpened={() => setTeamToOpen(undefined)}
            requestedTeam={
              teamToOpen?.hostKey === host.publicKey ? teamToOpen : undefined
            }
            registerBack={(back) => {
              teamBacks.current.set(host.publicKey, back);
            }}
            registerGuard={(guard) => {
              teamGuards.current.set(host.publicKey, guard);
            }}
            onOpenTerminal={(id) => {
              const terminal = terminalLists[host.publicKey]?.terminals.find(
                (item) => item.id === id,
              );
              if (terminal) void openAttention({ host, terminal });
            }}
            onClisChanged={onClisChanged}
          />
        ))}
        <section
          className="workspace-content"
          hidden={Boolean(teamsHost)}
          data-iori-layout-scope={scope}
          data-iori-current-worktree-path={target?.worktree.path}
        >
          {target && layoutErrors[scope] === "save" && (
            <div className="workspace-inline-alert" role="alert">
              <p>{t("Could not save this workspace layout. Retry saving.")}</p>
              <Button
                variant="outline"
                size="sm"
                onClick={() => retryLayoutSave(scope)}
                data-iori-action="workspace-layout-retry-save"
              >
                {t("Retry saving")}
              </Button>
            </div>
          )}
          {terminalError && (
            <div className="workspace-inline-alert" role="alert">
              <p>{t(terminalError)}</p>
            </div>
          )}
          <WorkspaceViewServicesContext.Provider value={viewServices}>
            {body}
          </WorkspaceViewServicesContext.Provider>
        </section>
      </main>
      {terminalClose.dialog}
      {removalTarget && (
        <WorktreeRemoval
          key={`${removalTarget.host.publicKey}:${removalTarget.path}:${removalTarget.failures ? "retry" : "initial"}`}
          {...removalTarget}
          t={t}
          onClose={() => setRemovalTarget(undefined)}
          onStarted={(paths) => {
            if (
              selectedTarget?.host.publicKey === removalTarget.host.publicKey &&
              paths.includes(selectedTarget.worktree.path)
            ) {
              openTarget(
                selectedTarget.host,
                selectedTarget.folder,
                selectedTarget.folder.worktrees?.find((item) => item.primary),
                false,
              );
            }
          }}
          onRemoved={(paths) => {
            void refreshHistory(removalTarget.host.publicKey);
            setVisitedTargets((targets) =>
              targets.filter(
                (target) =>
                  target.host.publicKey !== removalTarget.host.publicKey ||
                  !paths.includes(target.worktree.path),
              ),
            );
          }}
        />
      )}
      {creationTarget && (
        <WorktreeCreator
          key={`${creationTarget.host.publicKey}:${creationTarget.folder.workspacePath}:${creationTarget.prefill?.id ?? ""}`}
          {...creationTarget}
          open={creationOpen}
          onOpenChange={setCreationOpen}
          t={t}
          onAddCli={() => {
            setCreationOpen(false);
            openTeams(creationTarget.host, "agents");
          }}
          onOpenTeams={(teamId) => {
            setCreationOpen(false);
            setTeamToOpen(
              teamId
                ? {
                    hostKey: creationTarget.host.publicKey,
                    teamId,
                    nonce: Date.now(),
                  }
                : undefined,
            );
            openTeams(creationTarget.host, "teams");
          }}
          onStarted={(terminal, path, setupWorktree) => {
            applyTerminalEventFor(creationTarget.host.publicKey, {
              type: "terminal.created",
              terminal,
            });
            void refreshHistory(creationTarget.host.publicKey);
            const item = {
              host: creationTarget.host,
              terminal,
              started: true,
            };
            if (setupWorktree) {
              const worktree = worktreesOf(creationTarget.folder).find(
                (entry) => samePath(entry.path, path),
              ) ?? { path, detached: false, primary: false };
              const select = () => {
                setAttentionToOpen(item);
                openTarget(
                  creationTarget.host,
                  creationTarget.folder,
                  worktree,
                );
              };
              if (teamsHostRef.current) leaveTeams(select);
              else select();
            } else void openAttention(item);
            setCreationTarget(undefined);
          }}
        />
      )}
      <FolderPicker
        t={t}
        hosts={hosts}
        hostKey={folderHostKey}
        onHostChange={(hostKey) => {
          void connection.selectHost(hostKey);
          setFolderHostKey(hostKey);
        }}
        onClose={() => setFolderHostKey(undefined)}
        onOpen={openFolder}
      />
      <Dialog open={shellPickerOpen} onOpenChange={setShellPickerOpen}>
        <DialogContent
          className="folder-dialog"
          data-iori-view="shell-picker"
          aria-describedby={undefined}
        >
          <DialogHeader>
            <DialogTitle>{t("New tab")}</DialogTitle>
          </DialogHeader>
          {launcher(false)}
        </DialogContent>
      </Dialog>
    </>
  );
}

function SidebarResize({
  width,
  onWidthChange,
  t,
}: {
  width: number;
  onWidthChange: (width: number) => void;
  t: (key: string) => string;
}) {
  const { isMobile, open } = useSidebar();
  if (isMobile || !open) return null;
  const begin = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return;
    const workspace = event.currentTarget.closest<HTMLElement>(".workspace");
    if (!workspace) return;
    event.preventDefault();
    const startX = event.clientX;
    const startWidth =
      workspace
        .querySelector<HTMLElement>('[data-slot="sidebar-gap"]')
        ?.getBoundingClientRect().width ?? width;
    let next = startWidth;
    let moved = false;
    workspace.dataset.sidebarResizing = "true";
    const move = (e: PointerEvent) => {
      if (e.pointerId !== event.pointerId) return;
      next = Math.max(
        240,
        Math.min(window.innerWidth / 2, startWidth + e.clientX - startX),
      );
      moved = true;
      workspace.style.setProperty("--sidebar-preferred-width", `${next}px`);
    };
    const finish = () => {
      document.removeEventListener("pointermove", move);
      document.removeEventListener("pointerup", finish);
      document.removeEventListener("pointercancel", finish);
      window.removeEventListener("blur", finish);
      delete workspace.dataset.sidebarResizing;
      if (moved) onWidthChange(next);
    };
    document.addEventListener("pointermove", move);
    document.addEventListener("pointerup", finish);
    document.addEventListener("pointercancel", finish);
    window.addEventListener("blur", finish);
  };
  return (
    <div
      className="workspace-resize-handle sidebar-resize-handle"
      role="separator"
      aria-label={t("Resize sidebar")}
      onPointerDown={begin}
      onDoubleClick={(event) => {
        event.currentTarget
          .closest<HTMLElement>(".workspace")
          ?.style.setProperty(
            "--sidebar-preferred-width",
            `${DEFAULT_SIDEBAR_WIDTH}px`,
          );
        onWidthChange(DEFAULT_SIDEBAR_WIDTH);
      }}
    />
  );
}

export function WorkspaceFrame(props: Props) {
  const [usageHost, setUsageHost] = useState(props.state.host?.publicKey ?? "");
  return (
    <TooltipProvider>
      <div className="workspace-app" data-iori-view="workspace">
        <SidebarProvider
          className="workspace"
          style={
            {
              "--sidebar-preferred-width": `${props.sidebarWidth}px`,
            } as CSSProperties
          }
        >
          <WorkspaceFrameInner {...props} onUsageHostChange={setUsageHost} />
        </SidebarProvider>
        <StatusBar
          state={props.state}
          t={props.t}
          showConnection={props.showConnection}
          disconnectedSeconds={props.disconnectedSeconds}
          staleNote={props.staleNote}
          language={props.language}
          clisRevision={props.clisRevision}
          usageHost={usageHost}
          defaultShellChange={props.defaultShellChange}
        />
      </div>
    </TooltipProvider>
  );
}
