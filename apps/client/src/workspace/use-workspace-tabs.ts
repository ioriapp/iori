import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type Dispatch,
  type MutableRefObject,
  type SetStateAction,
} from "react";
import type {
  ChildSummary,
  CliSummary,
  HostInfo,
  Team,
  TerminalEvent,
  TerminalListResult,
  TerminalShell,
  TerminalSummary,
} from "@iori/protocol";
import type { ShellStatus } from "../CliLauncher.tsx";
import { connection } from "../connection.ts";
import type { DockContextValue, DropDirection } from "../DockLayout.tsx";
import { samePath } from "../host-path.ts";
import { childCliStatus } from "../teams/children.ts";
import { useTerminalClose } from "../terminal/terminal-close.tsx";
import { terminalDropText } from "../terminal/terminal-drop-path.ts";
import { queueTerminalInput } from "../terminal/terminal-input.ts";
import type { createWorkspaceDockAdapter } from "../workspace-dock-adapter.ts";
import {
  initialTabTitle,
  terminalTitle,
  type WorkspaceTab,
  type WorkspaceTarget,
  type WorkspaceViewKind,
} from "../workspace-panel.tsx";
import {
  addWorkspaceTab,
  closeMobileWorkspaceTab,
  closeWorkspaceTab,
  forgetWorkspacePanelState,
  missingWorkspaceTerminals,
  rememberWorkspaceTerminal,
  replaceWorkspaceStartTab,
  terminalWorkspaceTab,
  type createWorkspaceStore,
} from "../workspace-state.ts";
import type { DockGroup } from "./dock-adapter.ts";
import {
  terminalTabId,
  type AttentionRequest,
  type PendingFocusRequest,
} from "./types.ts";

export function useWorkspaceTabs({
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
  connectedHosts,
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
}: {
  workspace: ReturnType<typeof createWorkspaceStore>;
  dock: ReturnType<typeof createWorkspaceDockAdapter>;
  scope: string;
  layoutScope: MutableRefObject<string>;
  layoutLoading: boolean;
  loadedLayoutScope: string;
  closedPanels: MutableRefObject<Set<string>>;
  selectedTarget?: WorkspaceTarget;
  tabs: WorkspaceTab[];
  hosts: HostInfo[];
  connectedHosts: string[];
  terminalLists: Record<string, TerminalListResult>;
  terminalStatus: Record<string, ShellStatus>;
  childrenByHost: Record<string, ChildSummary[]>;
  childrenFor: (hostKey: string) => ChildSummary[];
  currentHostKey: string;
  isMobile: boolean;
  nativeMobile: boolean;
  t: (key: string) => string;
  applyTerminalEventFor: (hostKey: string, event: TerminalEvent) => void;
  loadTerminals: (hostKey: string) => Promise<void>;
  activateTab: (id: string) => void;
  setTabVisitHistory: (
    update: string[] | ((current: string[]) => string[]),
  ) => void;
  setShellPickerOpen: (open: boolean) => void;
  setClosedParents: Dispatch<SetStateAction<Record<string, Set<string>>>>;
  removeTerminalRef: MutableRefObject<
    (hostKey: string, id: string, processExited?: boolean) => void
  >;
  openAttentionRef: MutableRefObject<
    (item?: AttentionRequest) => Promise<void>
  >;
}) {
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

  const terminalList = terminalLists[currentHostKey];
  const shells = terminalList?.shells ?? [];
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
  const shellLabel = useCallback(
    (id: string) => shells.find((shell) => shell.id === id)?.label ?? id,
    [shells],
  );

  // Opening a view on PC moves focus into it, as in VS Code. Mobile does not,
  // so the keyboard does not open by itself.
  const [focusRequest, setFocusRequest] = useState<PendingFocusRequest>();
  const focusNonceRef = useRef(0);
  const focusConsumed = useCallback((nonce: number) => {
    setFocusRequest((current) =>
      current?.nonce === nonce ? undefined : current,
    );
  }, []);
  const requestFocus = useCallback(
    (tabId: string) => {
      if (nativeMobile) return;
      setFocusRequest({ tabId, nonce: ++focusNonceRef.current });
    },
    [nativeMobile],
  );

  const showPanel = useCallback(
    (id: string) => {
      activateTab(id);
      dock.select(id);
    },
    [activateTab, dock],
  );

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
    [activateTab, dock, requestFocus, setShellPickerOpen, workspace],
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
    [activateTab, addTab, dock, requestFocus, selectedTarget, workspace],
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
    [
      addTab,
      dock,
      isMobile,
      requestFocus,
      scope,
      selectedTarget,
      showPanel,
      workspace,
    ],
  );

  // A new Terminal starts in the selected worktree (or an explicit subfolder).
  // The result is applied once; a failed request is reported and never sent again automatically.
  const createTerminal = useCallback(
    async (
      shellId?: string,
      groupId?: string,
      direction?: DropDirection,
      cli?: CliSummary,
      team?: Team,
      startTabId?: string,
      cwdOverride?: string,
    ) => {
      if (!selectedTarget) return;
      const target = selectedTarget;
      const cwd = cwdOverride ?? target.cwd;
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
              cwd,
              teamId: team.id,
            })
          : cli
            ? await connection.requestHost(hostKey, "cli.launch", {
                cwd,
                cliId: cli.id,
              })
            : await connection.requestHost(hostKey, "terminal.create", {
                cwd,
                ...(shellId ? { shell: shellId } : {}),
              });
        if (!result?.ok) {
          setTerminalError(
            team
              ? "Could not start the team. Check its orchestrator CLI settings and try again."
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
            ? "Could not start the team. Check its orchestrator CLI settings and try again."
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
    [
      applyTerminalEventFor,
      layoutScope,
      openTerminal,
      selectedTarget,
      setShellPickerOpen,
    ],
  );

  const chooseShell = useCallback(
    (shell: TerminalShell) => {
      const pending = dock.pendingPosition;
      dock.pendingPosition = undefined;
      void createTerminal(shell.id, pending?.groupId, pending?.direction);
    },
    [createTerminal, dock],
  );

  const closeTab = useCallback(
    (id: string, panelId?: string, preservePane = false) => {
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
    },
    [addTab, closedPanels, dock, selectedTarget, setTabVisitHistory, workspace],
  );

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
    [applyTerminalEventFor, closeTab, workspace],
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
    [workspace],
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
        const host = hosts.find((item) => item.publicKey === payload.hostKey);
        const terminal = terminalLists[
          payload.hostKey ?? currentHostKey
        ]?.terminals.find((item) => item.id === payload.terminalId);
        if (host && terminal) void openAttentionRef.current({ host, terminal });
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

  const dropPath: DockContextValue["dropPath"] = (tab, drag) => {
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
    queueTerminalInput(summary.id, text);
    showPanel(tab.id);
    requestFocus(tab.id);
  };

  const sendPathToTerminal = useCallback(
    (absolutePath: string, worktreePath: string) => {
      if (!selectedTarget) return;
      const hostKey = selectedTarget.host.publicKey;
      const allTerminals = terminalLists[hostKey]?.terminals ?? [];
      const matching = allTerminals.filter(
        (terminal) =>
          !terminal.teamChild &&
          samePath(terminal.worktreePath ?? terminal.cwd, worktreePath),
      );
      const lastId = workspace.getSnapshot().lastTerminalId;
      const summary =
        matching.find((terminal) => terminal.id === lastId) ??
        matching.at(-1) ??
        recentTerminal();
      if (!summary) return;
      const text = terminalDropText(
        absolutePath,
        summary.cwdFromShell ? summary.cwd : undefined,
        summary.shell,
      );
      if (text === undefined) return;
      queueTerminalInput(summary.id, text);
      openTerminal(summary);
    },
    [openTerminal, recentTerminal, selectedTarget, terminalLists, workspace],
  );

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
  }, [
    childrenByHost,
    closeTab,
    selectedTarget,
    layoutLoading,
    loadedLayoutScope,
    scope,
    workspace,
  ]);

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
    closeTab,
    terminalList,
    terminalStatus,
    currentHostKey,
    loadedLayoutScope,
    scope,
    tabs,
  ]);

  // Terminal tabs carry the title the shell reports.
  const displayTabs = tabs.map((tab) => {
    if (tab.kind !== "terminal") return tab;
    const summary = terminalList?.terminals.find(
      (terminal) => terminal.id === tab.terminalId,
    );
    const child = childrenFor(currentHostKey).find(
      (item) => item.terminalId === tab.terminalId,
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
          cliStatus: connectedHosts.includes(currentHostKey)
            ? child
              ? childCliStatus(child)
              : summary.cliStatus
            : undefined,
        }
      : tab;
  });

  const launchingItem = launching?.scope === scope ? launching.item : undefined;

  return {
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
    showPanel,
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
    sendPathToTerminal,
    displayTabs,
  };
}
