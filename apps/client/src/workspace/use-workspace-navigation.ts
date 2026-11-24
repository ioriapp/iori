import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type RefObject,
} from "react";
import type { FolderHistoryItem, HostInfo, Worktree } from "@iori/protocol";
import { connection } from "../connection.ts";
import type { LeaveGuard } from "../teams/TeamEditor.tsx";
import type { createWorkspaceDockAdapter } from "../workspace-dock-adapter.ts";
import type { WorkspaceTab, WorkspaceTarget } from "../workspace-panel.tsx";
import {
  selectWorkspaceTab,
  type createWorkspaceStore,
} from "../workspace-state.ts";
import {
  locallyRemoving,
  type useWorktreeRemovalFlow,
} from "../worktree-removal-flow.ts";
import {
  activeDockGroup,
  activeDockPanelId,
  type DockGroup,
} from "./dock-adapter.ts";
import {
  scopeKey,
  type LastWorkspaceTarget,
  type TeamToOpen,
} from "./types.ts";

export function useWorkspaceSelection({
  isMobile,
  openMobile,
  setOpenMobile,
  onLastWorkspaceTargetChange,
  workspace,
  setTeamToOpen,
}: {
  isMobile: boolean;
  openMobile: boolean;
  setOpenMobile: (open: boolean) => void;
  onLastWorkspaceTargetChange: (target: LastWorkspaceTarget) => void;
  workspace: ReturnType<typeof createWorkspaceStore>;
  setTeamToOpen: (value: TeamToOpen | undefined) => void;
}) {
  const [teamsHost, setTeamsHost] = useState<HostInfo>();
  const [openedTeams, setOpenedTeams] = useState<HostInfo[]>([]);
  const [teamsInitialPage, setTeamsInitialPage] = useState<
    "agents" | "teams"
  >();
  const [teamsEntry, setTeamsEntry] = useState(0);
  const teamBacks = useRef(new Map<string, () => boolean>());
  const teamGuards = useRef(new Map<string, LeaveGuard>());
  const teamsHostRef = useRef(teamsHost);
  teamsHostRef.current = teamsHost;

  const [selectedTarget, setSelectedTarget] = useState<WorkspaceTarget>();
  const [visitedTargets, setVisitedTargets] = useState<WorkspaceTarget[]>([]);
  const shownMobileTarget = useRef<WorkspaceTarget | undefined>(undefined);
  const [tabVisitHistories, setTabVisitHistories] = useState<
    Record<string, string[]>
  >({});
  const shownMobileTab = useRef<{ scope: string; id: string } | undefined>(
    undefined,
  );

  const leaveTeams = useCallback((action: () => void) => {
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
  }, []);

  const openTeams = useCallback(
    (host: HostInfo, page?: "agents" | "teams") => {
      leaveTeams(() => {
        // A worktree selected only inside the drawer was never shown.
        if (isMobile && openMobile)
          setSelectedTarget(shownMobileTarget.current);
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
    },
    [isMobile, leaveTeams, openMobile, setOpenMobile, setTeamToOpen],
  );

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
    [
      isMobile,
      leaveTeams,
      onLastWorkspaceTargetChange,
      selectedTarget,
      setOpenMobile,
    ],
  );

  const goHome = useCallback(() => {
    if (!selectedTarget) return false;
    setVisitedTargets([]);
    setSelectedTarget(undefined);
    return true;
  }, [selectedTarget]);

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
    [isMobile, scope, setTabVisitHistory, workspace],
  );

  return {
    teamsHost,
    setTeamsHost,
    teamsHostRef,
    openedTeams,
    teamsInitialPage,
    teamsEntry,
    teamBacks,
    teamGuards,
    leaveTeams,
    openTeams,
    selectedTarget,
    setSelectedTarget,
    scope,
    visitedTargets,
    setVisitedTargets,
    tabVisitHistory,
    setTabVisitHistory,
    shownMobileTab,
    openTarget,
    goHome,
    activateTab,
  };
}

export function useWorkspaceRestoreAndRemoval({
  hosts,
  histories,
  removalState,
  isMobile,
  selectedTarget,
  lastWorkspaceTarget,
  openTarget,
}: {
  hosts: HostInfo[];
  histories: Record<string, FolderHistoryItem[]>;
  removalState: ReturnType<typeof useWorktreeRemovalFlow>;
  isMobile: boolean;
  selectedTarget?: WorkspaceTarget;
  lastWorkspaceTarget?: LastWorkspaceTarget;
  openTarget: (
    host: HostInfo,
    folder: FolderHistoryItem,
    worktree?: Worktree,
    rememberPrevious?: boolean,
    closeDrawer?: boolean,
  ) => void;
}) {
  const restoredTargetKey = useRef("");

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
}

export function useWorkspaceBackAndShortcuts({
  isMobile,
  openMobile,
  setOpenMobile,
  scope,
  tabs,
  activeTabId,
  workspace,
  dock,
  folderHostKey,
  setFolderHostKey,
  shellPickerOpen,
  setShellPickerOpen,
  quickOpen,
  setQuickOpen,
  canQuickOpen,
  onWorkspaceSearch,
  maximizedGroup,
  closeMaximize,
  toggleMaximize,
  teamsHost,
  setTeamsHost,
  teamBacks,
  leaveTeams,
  backHandlers,
  tabVisitHistory,
  setTabVisitHistory,
  visitedTargets,
  setVisitedTargets,
  openTarget,
  goHome,
  onBackHandler,
  shownMobileTab,
  hasPendingTransition,
}: {
  isMobile: boolean;
  openMobile: boolean;
  setOpenMobile: (open: boolean) => void;
  scope: string;
  tabs: WorkspaceTab[];
  activeTabId: string;
  workspace: ReturnType<typeof createWorkspaceStore>;
  dock: ReturnType<typeof createWorkspaceDockAdapter>;
  folderHostKey?: string;
  setFolderHostKey: (key?: string) => void;
  shellPickerOpen: boolean;
  setShellPickerOpen: (open: boolean) => void;
  quickOpen: boolean;
  setQuickOpen: (open: boolean) => void;
  canQuickOpen: boolean;
  onWorkspaceSearch?: () => void;
  maximizedGroup?: string;
  closeMaximize: () => void;
  toggleMaximize: (group: DockGroup) => void;
  teamsHost?: HostInfo;
  setTeamsHost: (host?: HostInfo) => void;
  teamBacks: RefObject<Map<string, () => boolean>>;
  leaveTeams: (action: () => void) => void;
  backHandlers: RefObject<Map<string, () => boolean>>;
  tabVisitHistory: string[];
  setTabVisitHistory: (
    update: string[] | ((current: string[]) => string[]),
  ) => void;
  visitedTargets: WorkspaceTarget[];
  setVisitedTargets: (
    update:
      WorkspaceTarget[] | ((current: WorkspaceTarget[]) => WorkspaceTarget[]),
  ) => void;
  openTarget: (
    host: HostInfo,
    folder: FolderHistoryItem,
    worktree?: Worktree,
    rememberPrevious?: boolean,
    closeDrawer?: boolean,
  ) => void;
  goHome: () => boolean;
  onBackHandler: (handler: () => boolean) => void;
  shownMobileTab: RefObject<{ scope: string; id: string } | undefined>;
  hasPendingTransition: boolean;
}) {
  const touchStart = useRef<{ x: number; y: number } | undefined>(undefined);
  const keySequence = useRef(false);

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

  useEffect(() => {
    if (!isMobile || !scope) {
      shownMobileTab.current = undefined;
      return;
    }
    if (openMobile || teamsHost || hasPendingTransition) return;
    const id = tabs.find((tab) => tab.id === activeTabId)?.id ?? tabs[0]?.id;
    shownMobileTab.current = id ? { scope, id } : undefined;
  }, [
    isMobile,
    scope,
    openMobile,
    teamsHost,
    hasPendingTransition,
    tabs,
    activeTabId,
    shownMobileTab,
  ]);

  const handleBack = useCallback(() => {
    if (folderHostKey) {
      setFolderHostKey(undefined);
      return true;
    }
    if (shellPickerOpen) {
      setShellPickerOpen(false);
      return true;
    }
    if (quickOpen) {
      setQuickOpen(false);
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
      : activeDockPanelId(dock.api);
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
    backHandlers,
    closeMaximize,
    dock,
    folderHostKey,
    goHome,
    isMobile,
    leaveTeams,
    maximizedGroup,
    openMobile,
    openTarget,
    setFolderHostKey,
    setOpenMobile,
    setShellPickerOpen,
    setTabVisitHistory,
    setTeamsHost,
    setVisitedTargets,
    shellPickerOpen,
    quickOpen,
    setQuickOpen,
    tabVisitHistory,
    tabs,
    teamBacks,
    teamsHost,
    visitedTargets,
    workspace,
  ]);
  useEffect(() => onBackHandler(handleBack), [handleBack, onBackHandler]);

  useEffect(() => {
    const keydown = (event: KeyboardEvent) => {
      if (
        // The terminal's search field can unmount while handling Escape.
        event
          .composedPath()
          .some(
            (node) =>
              node instanceof HTMLElement &&
              node.dataset.ioriView === "terminal",
          )
      ) {
        keySequence.current = false;
        return;
      }
      const key = event.key.toLowerCase();
      if (
        (event.ctrlKey || event.metaKey) &&
        !event.shiftKey &&
        !event.altKey &&
        key === "p" &&
        canQuickOpen &&
        !event.isComposing
      ) {
        event.preventDefault();
        setQuickOpen(true);
        return;
      }
      if (
        (event.ctrlKey || event.metaKey) &&
        event.shiftKey &&
        !event.altKey &&
        key === "f" &&
        canQuickOpen &&
        onWorkspaceSearch &&
        !event.isComposing
      ) {
        event.preventDefault();
        onWorkspaceSearch();
        return;
      }
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
          const group = activeDockGroup(dock.api);
          if (group) toggleMaximize(group);
          event.preventDefault();
        }
      }
    };
    window.addEventListener("keydown", keydown);
    return () => window.removeEventListener("keydown", keydown);
  }, [
    canQuickOpen,
    onWorkspaceSearch,
    closeMaximize,
    dock,
    maximizedGroup,
    setQuickOpen,
    toggleMaximize,
  ]);
}
