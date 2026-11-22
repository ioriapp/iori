import {
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import type { CSSProperties, DragEvent as ReactDragEvent } from "react";
import { cn } from "cn";
import { sidebarOrder } from "@iori/protocol";
import type { ShellStatus } from "./CliLauncher.tsx";
import { useCliList } from "./cli-list.ts";
import { Button } from "./components/ui/button.tsx";
import { SidebarProvider, useSidebar } from "./components/ui/sidebar.tsx";
import { TooltipProvider } from "./components/ui/tooltip.tsx";
import { connection } from "./connection.ts";
import {
  sidebarViewTransferType,
  type DockContextValue,
} from "./DockLayout.tsx";
import { hostPathKey, samePath } from "./host-path.ts";
import { useIssueRepositories } from "./issues/issue-repositories.ts";
import type { OpenWorktree } from "./MobileHome.tsx";
import { hasWindowChrome } from "./native.ts";
import { Navigation, worktreesOf } from "./Navigation.tsx";
import { worktreeLayoutDefault } from "./new-worktree-layout-store.ts";
import { useMobileBoards } from "./teams/mobile-boards.ts";
import { createWorkspaceDockAdapter } from "./workspace-dock-adapter.ts";
import {
  basename,
  WorkspaceViewServicesContext,
  worktreeLabel,
  type WorkspaceTab,
  type WorkspaceViewKind,
} from "./workspace-panel.tsx";
import { createWorkspaceStore } from "./workspace-state.ts";
import {
  useWorktreeRemovalFlow,
  worktreeRemovalFlow,
} from "./worktree-removal-flow.ts";
import { SidebarResize } from "./workspace/SidebarResize.tsx";
import { StatusBar } from "./workspace/StatusBar.tsx";
import type {
  AttentionRequest,
  CreationTarget,
  LastWorkspaceTarget,
  TeamToOpen,
  WorkspaceFrameProps,
} from "./workspace/types.ts";
import { useHostData } from "./workspace/use-host-data.ts";
import { useWorkspaceLayout } from "./workspace/use-workspace-layout.ts";
import { useWorkspaceMaximize } from "./workspace/use-workspace-maximize.ts";
import {
  useWorkspaceBackAndShortcuts,
  useWorkspaceRestoreAndRemoval,
  useWorkspaceSelection,
} from "./workspace/use-workspace-navigation.ts";
import { useWorkspaceRouting } from "./workspace/use-workspace-routing.ts";
import { useWorkspaceTabs } from "./workspace/use-workspace-tabs.ts";
import {
  createWorkspacePanelRenderer,
  WorkspaceBody,
} from "./workspace/WorkspaceBody.tsx";
import {
  WorkspaceDialogs,
  WorkspaceTeamsOverlays,
} from "./workspace/WorkspaceOverlays.tsx";
import {
  WorkspaceInlineAlert,
  WorkspaceLauncher,
  WorkspaceStartScreen,
} from "./workspace/WorkspaceStart.tsx";

export {
  useWorkspacePanel,
  type WorkspacePanelProps,
  type WorkspacePanelRenderer,
  type WorkspaceViewKind,
} from "./workspace-panel.tsx";
export type { LastWorkspaceTarget };

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
}: WorkspaceFrameProps & { onUsageHostChange: (hostKey: string) => void }) {
  const { isMobile, openMobile, setOpenMobile } = useSidebar();
  const hosts = useMemo(() => state.initial?.hosts ?? [], [state.initial]);
  const nativeMobile = Boolean(state.initial?.mobile);

  const [workspace] = useState(createWorkspaceStore);
  const workspaceState = useSyncExternalStore(
    workspace.subscribe,
    workspace.getSnapshot,
  );
  const { tabs, activeTabId } = workspaceState;
  const [dock] = useState(() => createWorkspaceDockAdapter(workspace));
  const dockRoot = useRef<HTMLDivElement>(null);

  const [folderHostKey, setFolderHostKey] = useState<string>();
  const [shellPickerOpen, setShellPickerOpen] = useState(false);
  const [teamToOpen, setTeamToOpen] = useState<TeamToOpen>();
  const [creationTarget, setCreationTarget] = useState<CreationTarget>();
  const [creationOpen, setCreationOpen] = useState(false);

  const removalState = useWorktreeRemovalFlow();
  const removalTarget = removalState.target;
  const setRemovalTarget = worktreeRemovalFlow.open;

  const backHandlers = useRef(new Map<string, () => boolean>());
  const removeTerminalRef = useRef<
    (hostKey: string, id: string, processExited?: boolean) => void
  >(() => undefined);
  const openAttentionRef = useRef<(item?: AttentionRequest) => Promise<void>>(
    async () => undefined,
  );
  const startingAttentionRef = useRef<AttentionRequest | undefined>(undefined);
  const displayTabsRef = useRef<WorkspaceTab[]>(tabs);
  const resetScopeRef = useRef<() => void>(() => undefined);

  const {
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
    scope,
    visitedTargets,
    setVisitedTargets,
    tabVisitHistory,
    setTabVisitHistory,
    shownMobileTab,
    openTarget,
    goHome,
    activateTab,
  } = useWorkspaceSelection({
    isMobile,
    openMobile,
    setOpenMobile,
    onLastWorkspaceTargetChange,
    workspace,
    setTeamToOpen,
  });

  const currentHostKey = selectedTarget?.host.publicKey ?? "";

  const {
    terminalLists,
    terminalStatus,
    applyTerminalEventFor,
    loadTerminals,
    histories,
    loadedHistoryHosts,
    historyError,
    removeError,
    refreshHistory,
    openFolder,
    reorderFolders,
    removeFromSidebar,
    allFolders,
    sidebarFolders,
    childrenByHost,
    childDisplay,
    childrenFor,
    childErrors,
    stopChild,
    setClosedParents,
  } = useHostData({
    hosts,
    connectedHosts: state.connectedHosts,
    selectedHostKey: currentHostKey,
    defaultShellChange,
    inputPreferences,
    onInputPreferences,
    onMaintenanceClisReader,
    removeTerminalRef,
    onFolderOpened: (host, folder) => {
      setFolderHostKey(undefined);
      openTarget(host, folder);
    },
  });

  useWorkspaceRestoreAndRemoval({
    hosts,
    histories,
    removalState,
    isMobile,
    selectedTarget,
    lastWorkspaceTarget,
    openTarget,
  });

  const issueRepositories = useIssueRepositories(
    allFolders
      .filter(({ folder }) => folder.kind === "git")
      .map(({ host, folder }) => ({
        host: host.publicKey,
        workspacePath: folder.workspacePath,
      })),
    state.connectedHosts,
  );

  const {
    maximizedGroup,
    setMaximizedGroup,
    maximizedDockGroup,
    isMaximizedFullWidth,
    toggleMaximize,
    toggleMaximizedFullWidth,
    beginMaximizedResize,
    closeMaximize,
  } = useWorkspaceMaximize({
    dock,
    dockRoot,
    isMobile,
    activeTabId,
    tabs,
    panelWidths,
    panelFullWidth,
    onPanelWidthsChange,
    onPanelFullWidthChange,
  });

  const {
    layoutScope,
    layoutLoading,
    loadedLayoutScope,
    layoutErrors,
    closedPanels,
    loadTargetLayout,
    retryLayoutSave,
    discardLayout,
    onDockReady,
  } = useWorkspaceLayout({
    workspace,
    dock,
    scope,
    selectedTarget,
    displayTabsRef,
    tabs,
    activeTabId,
    isMobile,
    nativeMobile,
    teamsHost,
    issueRepositories,
    startingAttentionRef,
    applyTerminalEventFor,
    activateTab,
    onScopeChange: () => resetScopeRef.current(),
    onRemoveGroup: (id) =>
      setMaximizedGroup((current) => (current === id ? undefined : current)),
  });

  const usageHostKey =
    teamsHost?.publicKey || currentHostKey || state.host?.publicKey || "";
  useEffect(
    () => onUsageHostChange(usageHostKey),
    [usageHostKey, onUsageHostChange],
  );

  const {
    pickers: cliList,
    error: cliError,
    reload: reloadClis,
  } = useCliList(
    currentHostKey,
    `${clisRevision}:${defaultShellChange?.revision ?? 0}:${state.connectedHosts.join(",")}`,
  );
  const shellStatus: ShellStatus = terminalStatus[currentHostKey] ?? "loading";

  const {
    terminalList,
    shells,
    targetTerminals,
    terminalError,
    launchingItem,
    claimTerminals,
    setClaimTerminals,
    terminalViewIds,
    focusRequest,
    focusConsumed,
    addTab,
    addPanel,
    openTerminal,
    createTerminal,
    chooseShell,
    closeTab,
    removeTerminal,
    terminalClose,
    closeTerminal,
    recentTerminal,
    splitGroup,
    dropSidebarView,
    dropPath,
    displayTabs,
  } = useWorkspaceTabs({
    workspace,
    dock,
    scope,
    layoutScope,
    layoutLoading,
    loadedLayoutScope,
    closedPanels,
    selectedTarget,
    tabs,
    hosts,
    connectedHosts: state.connectedHosts,
    terminalLists,
    terminalStatus,
    childrenByHost,
    childrenFor,
    currentHostKey,
    isMobile,
    nativeMobile,
    t,
    applyTerminalEventFor,
    loadTerminals,
    activateTab,
    setTabVisitHistory,
    setShellPickerOpen,
    setClosedParents,
    removeTerminalRef,
    openAttentionRef,
  });
  displayTabsRef.current = displayTabs;

  const {
    attentionItems,
    setAttentionToOpen,
    openAttention,
    viewToOpen,
    setViewToOpen,
    boardToOpen,
    setBoardToOpen,
    setBranchToOpen,
    setIssuesToOpen,
    setCiToOpen,
    setFileHistoryRequest,
    targetFolder,
    selectReadingWorktree,
    viewServices,
    hasPendingTransition,
  } = useWorkspaceRouting({
    hosts,
    connectedHosts: state.connectedHosts,
    allFolders,
    sidebarFolders,
    terminalLists,
    childrenByHost,
    childDisplay,
    notificationPreferences,
    terminalToOpen,
    selectedTarget,
    scope,
    layoutLoading,
    loadedLayoutScope,
    teamsHostRef,
    workspace,
    closedPanels,
    backHandlers,
    t,
    leaveTeams,
    openTeams,
    openTarget,
    addTab,
    addPanel,
    activateTab,
    openTerminal,
    createTerminal,
    recentTerminal,
    setTabVisitHistory,
    setTeamToOpen,
    setCreationTarget,
    setCreationOpen,
    openAttentionRef,
    startingAttentionRef,
  });

  resetScopeRef.current = () => {
    setMaximizedGroup(undefined);
    setFileHistoryRequest(undefined);
  };

  useWorkspaceBackAndShortcuts({
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
  });

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
    <WorkspaceLauncher
      large={large}
      startTabId={startTabId}
      launchingItem={launchingItem}
      reloadClis={reloadClis}
      currentHostKey={currentHostKey}
      active={!teamsHost}
      hosts={hosts}
      dock={dock}
      shells={shells}
      clis={cliList.clis}
      cliError={cliError}
      defaultShellId={terminalList?.defaultShell}
      shellStatus={shellStatus}
      t={t}
      setShellPickerOpen={setShellPickerOpen}
      setTeamToOpen={setTeamToOpen}
      openTeams={openTeams}
      createTerminal={createTerminal}
      loadTerminals={loadTerminals}
      chooseShell={chooseShell}
    />
  );

  const startScreen = (startTabId?: string) =>
    target && (
      <WorkspaceStartScreen
        title={t("Start in {name}").replace("{name}", startName)}
        hostName={target.host.hostName}
      >
        {launcher(true, startTabId)}
      </WorkspaceStartScreen>
    );

  const renderAll = createWorkspacePanelRenderer({
    startScreen,
    teamsHost,
    t,
    language,
    terminalLists,
    openAttention,
    addPanel,
    selectReadingWorktree,
    openTeams,
    setTeamToOpen,
    renderPanel,
    terminalViewIds,
    childrenByHost,
    stopChild,
    onRequestCloseTerminal: terminalClose.request,
    connectedHosts: state.connectedHosts,
    foreground: state.foreground,
    nativeMobile,
    focusRequest,
    focusConsumed,
    claimTerminals,
    setClaimTerminals,
    closeTab,
    loadTerminals,
    removeTerminal,
    terminalFontSize,
    terminalFontFamily,
    onTerminalFontSize,
    terminalRightClick,
    terminalLinkOpen,
    accessoryLayout,
    inputPreferences,
    onInputPreferences,
  });

  const dockContext: DockContextValue = {
    saveNewWorktreeLayout:
      !isMobile && !nativeMobile
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
    reloadClis,
    launching: launchingItem,
    openTeams: (teamId) => {
      const host = hosts.find((item) => item.publicKey === currentHostKey);
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
      const host = hosts.find((item) => item.publicKey === currentHostKey);
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
    maximizedFullWidth: isMaximizedFullWidth,
    toggleMaximizedFullWidth,
    maximize: toggleMaximize,
    closeTab,
    addTerminal: (shell, groupId) => void createTerminal(shell.id, groupId),
    closeTerminal,
    stopChild: (childId) => {
      const child = childrenByHost[currentHostKey]?.find(
        (entry) => entry.id === childId,
      );
      if (child) void stopChild(currentHostKey, child);
    },
    dropSidebarView,
    split: splitGroup,
    setActiveTab: activateTab,
    dropPath,
    focusRequest,
    focusConsumed,
  };

  const layoutReady = Boolean(
    target && !layoutLoading && loadedLayoutScope === scope,
  );
  const activeMobileTab = tabs.find((tab) => tab.id === activeTabId) ?? tabs[0];

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
            const host = hosts.find((item) => item.publicKey === hostKey);
            const terminal = terminalLists[hostKey]?.terminals.find(
              (item) => item.id === child.terminalId,
            );
            if (host && terminal) void openAttention({ host, terminal });
            setOpenMobile(false);
          },
          onStop: (child) => void stopChild(hostKey, child),
          onDrag: (child) => (event) => {
            const entry = allFolders.find(
              (item) =>
                item.host.publicKey === hostKey &&
                worktreesOf(item.folder).some((worktree) =>
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
              (item) =>
                item.host.publicKey === hostKey &&
                worktreesOf(item.folder).some((worktree) =>
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
          const host = hosts.find((item) => item.publicKey === hostKey);
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
      <main
        className={cn(
          "workspace-main relative flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden bg-background",
          hasWindowChrome &&
            "pt-[var(--window-caption-height,35px)] has-[.workspace-content:not([hidden])_.iori-dock]:pt-0 has-[.workspace-content:not([hidden])_.mobile-location]:pt-0",
        )}
      >
        {hasWindowChrome && (
          <div
            className="window-workspace-drag-strip absolute top-0 right-[var(--window-controls-width,138px)] left-0 z-[1] h-[var(--window-caption-height,35px)] bg-sidebar in-[.workspace-main:has(.workspace-content:not([hidden])_.iori-dock)]:hidden in-[.workspace-main:has(.workspace-content:not([hidden])_.mobile-location)]:hidden"
            data-tauri-drag-region
          />
        )}
        <WorkspaceTeamsOverlays
          openedTeams={openedTeams}
          teamsHost={teamsHost}
          teamsInitialPage={teamsInitialPage}
          teamsEntry={teamsEntry}
          teamToOpen={teamToOpen}
          setTeamToOpen={setTeamToOpen}
          teamBacks={teamBacks}
          teamGuards={teamGuards}
          terminalLists={terminalLists}
          language={language}
          t={t}
          onOpenIntegrations={onOpenIntegrations}
          onOpenWorkspaceSettings={onOpenWorkspaceSettings}
          onOpenAttention={(item) => void openAttention(item)}
          onClisChanged={onClisChanged}
          onLeaveTeams={() => leaveTeams(() => setTeamsHost(undefined))}
        />
        <section
          className={cn(
            "workspace-content relative min-h-0 min-w-0 flex-1 flex-col [&[hidden]]:hidden",
            teamsHost ? "hidden" : "flex",
          )}
          hidden={Boolean(teamsHost)}
          data-iori-layout-scope={scope}
          data-iori-current-worktree-path={target?.worktree.path}
        >
          {target && layoutErrors[scope] === "save" && (
            <WorkspaceInlineAlert>
              <p>{t("Could not save this workspace layout. Retry saving.")}</p>
              <Button
                variant="outline"
                size="sm"
                onClick={() => retryLayoutSave(scope)}
                data-iori-action="workspace-layout-retry-save"
              >
                {t("Retry saving")}
              </Button>
            </WorkspaceInlineAlert>
          )}
          {terminalError && (
            <WorkspaceInlineAlert>
              <p>{t(terminalError)}</p>
            </WorkspaceInlineAlert>
          )}
          <WorkspaceViewServicesContext.Provider value={viewServices}>
            <WorkspaceBody
              target={target}
              targetName={targetName}
              scope={scope}
              isMobile={isMobile}
              sidebarHasFolders={sidebarFolders.length > 0}
              layoutError={layoutErrors[scope]}
              layoutLoading={layoutLoading}
              layoutReady={layoutReady}
              pendingOpen={Boolean(boardToOpen || viewToOpen)}
              tabs={tabs}
              activeMobileTab={activeMobileTab}
              openWorktrees={openWorktrees}
              connectedHosts={state.connectedHosts}
              mobileBoards={mobileBoards}
              terminalLists={terminalLists}
              sessionsFor={(hostKey, path) =>
                (terminalLists[hostKey]?.terminals ?? []).filter(
                  (terminal) =>
                    samePath(terminal.worktreePath ?? terminal.cwd, path) &&
                    !terminal.teamChild &&
                    !childDisplay[hostKey]?.terminalIds.has(terminal.id),
                )
              }
              hosts={hosts}
              attentionItems={attentionItems}
              childrenByHost={childrenByHost}
              currentHostKey={currentHostKey}
              dockRoot={dockRoot}
              dockContext={dockContext}
              maximizedGroup={maximizedGroup}
              maximizedDockGroup={maximizedDockGroup}
              kindOfGroup={dock.kindOfGroup}
              t={t}
              startScreen={startScreen}
              renderAll={renderAll}
              onBoard={(item, conversation) => {
                setBoardToOpen({
                  hostKey: item.host.publicKey,
                  cwd: item.worktree.path,
                  conversation,
                });
                openTarget(item.host, item.folder, item.worktree);
              }}
              onAttention={(item) => void openAttention(item)}
              onOpenWorktree={(item) =>
                openTarget(item.host, item.folder, item.worktree)
              }
              onSettings={() => onSettings()}
              onRetryLoadLayout={() =>
                void loadTargetLayout(scope, selectedTarget, isMobile)
              }
              onDiscardLayout={() => discardLayout(scope)}
              onStopChild={(child) => void stopChild(currentHostKey, child)}
              onNewMobileTab={() => {
                dock.pendingPosition = undefined;
                setShellPickerOpen(true);
              }}
              onSelectTab={(tabId) => activateTab(tabId)}
              onOpenView={(kind) => addPanel(kind)}
              onOpenTerminalSession={(terminal) => openTerminal(terminal)}
              onCloseTab={(tabId) => closeTab(tabId)}
              onDockReady={onDockReady}
              onCloseMaximize={closeMaximize}
              onBeginMaximizedResize={beginMaximizedResize}
            />
          </WorkspaceViewServicesContext.Provider>
        </section>
      </main>
      <WorkspaceDialogs
        terminalCloseDialog={terminalClose.dialog}
        removalTarget={removalTarget}
        setRemovalTarget={setRemovalTarget}
        creationTarget={creationTarget}
        setCreationTarget={setCreationTarget}
        creationOpen={creationOpen}
        setCreationOpen={setCreationOpen}
        folderHostKey={folderHostKey}
        setFolderHostKey={setFolderHostKey}
        shellPickerOpen={shellPickerOpen}
        setShellPickerOpen={setShellPickerOpen}
        hosts={hosts}
        selectedTarget={selectedTarget}
        teamsHostRef={teamsHostRef}
        t={t}
        openTarget={openTarget}
        refreshHistory={refreshHistory}
        setVisitedTargets={setVisitedTargets}
        openTeams={openTeams}
        setTeamToOpen={setTeamToOpen}
        applyTerminalEventFor={applyTerminalEventFor}
        setAttentionToOpen={setAttentionToOpen}
        openAttention={openAttention}
        leaveTeams={leaveTeams}
        openFolder={openFolder}
        shellPickerContent={launcher(false)}
      />
    </>
  );
}

export function WorkspaceFrame(props: WorkspaceFrameProps) {
  const [usageHost, setUsageHost] = useState(props.state.host?.publicKey ?? "");
  return (
    <TooltipProvider>
      <div
        className={cn(
          "workspace-app flex h-dvh flex-col overflow-hidden [&_.terminal-mobile-controls]:pb-[5px]",
          hasWindowChrome && "relative",
        )}
        data-iori-view="workspace"
      >
        <SidebarProvider
          className={cn(
            "workspace relative isolate h-0 min-h-0 flex-1 overflow-clip bg-sidebar",
            "[&_[data-slot=sidebar]]:relative [&_[data-slot=sidebar]]:h-full [&_[data-slot=sidebar]]:shrink-0",
            "[&_[data-slot=sidebar-gap]]:h-full [&_[data-slot=sidebar-gap]]:[transition:width_150ms]",
            "[&_[data-slot=sidebar-container]]:absolute [&_[data-slot=sidebar-container]]:inset-y-0 [&_[data-slot=sidebar-container]]:right-auto [&_[data-slot=sidebar-container]]:left-0 [&_[data-slot=sidebar-container]]:h-full [&_[data-slot=sidebar-container]]:[transition:transform_150ms]",
            "[&_[data-slot=sidebar][data-state=collapsed]_[data-slot=sidebar-container]]:-translate-x-full",
            "[&_[data-slot=sidebar-content]]:gap-0 [&_[data-slot=sidebar-menu]]:gap-0",
            "data-[sidebar-resizing]:[&_[data-slot=sidebar-gap]]:transition-none data-[sidebar-resizing]:[&_[data-slot=sidebar-container]]:transition-none",
          )}
          style={
            {
              "--sidebar-preferred-width": `${props.sidebarWidth / 16}rem`,
              "--sidebar-width":
                "clamp(15rem, var(--sidebar-preferred-width), 50vw)",
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
