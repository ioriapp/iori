import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type MutableRefObject,
  type RefObject,
} from "react";
import { creationOrder, issueWorktreeName } from "@iori/protocol";
import type {
  ChildSummary,
  FolderHistoryItem,
  HostInfo,
  TerminalListResult,
  TerminalSummary,
  Worktree,
} from "@iori/protocol";
import type { AttentionItem } from "../attention.ts";
import { connection } from "../connection.ts";
import type { DropDirection } from "../DockLayout.tsx";
import { hostPathKey, samePath } from "../host-path.ts";
import { worktreesOf } from "../Navigation.tsx";
import {
  useCliNotifications,
  type NotificationPreferences,
} from "../notifications.ts";
import {
  basename,
  type CiOpenRequest,
  type DiffOpenRequest,
  type FileHistoryRequest,
  type FileOpenRequest,
  type WorkspaceSearchRequest,
  type WorkspaceTab,
  type WorkspaceTarget,
  type WorkspaceViewKind,
  type WorkspaceViewServices,
} from "../workspace-panel.tsx";
import {
  selectWorkspaceReadingWorktree,
  setWorkspaceViewState,
  type createWorkspaceStore,
} from "../workspace-state.ts";
import { queueTerminalInput } from "../terminal/terminal-input.ts";
import { resolveAgentTargets } from "./agent-targets.ts";
import type {
  AttentionRequest,
  ChildDisplayEntry,
  CreationTarget,
  TeamToOpen,
} from "./types.ts";

export function useWorkspaceRouting({
  hosts,
  connectedHosts,
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
  openTerminalInFolder,
  sendPathToTerminal,
  recentTerminal,
  setTabVisitHistory,
  setTeamToOpen,
  setCreationTarget,
  setCreationOpen,
  openAttentionRef,
  startingAttentionRef,
}: {
  hosts: HostInfo[];
  connectedHosts: string[];
  allFolders: { host: HostInfo; folder: FolderHistoryItem }[];
  sidebarFolders: { host: HostInfo; folder: FolderHistoryItem }[];
  terminalLists: Record<string, TerminalListResult>;
  childrenByHost: Record<string, ChildSummary[]>;
  childDisplay: Record<string, ChildDisplayEntry>;
  notificationPreferences?: NotificationPreferences;
  terminalToOpen?: { hostKey: string; terminalId: string; nonce: number };
  selectedTarget?: WorkspaceTarget;
  scope: string;
  layoutLoading: boolean;
  loadedLayoutScope: string;
  teamsHostRef: RefObject<HostInfo | undefined>;
  workspace: ReturnType<typeof createWorkspaceStore>;
  closedPanels: RefObject<Set<string>>;
  backHandlers: RefObject<Map<string, () => boolean>>;
  t: (key: string) => string;
  leaveTeams: (action: () => void) => void;
  openTeams: (host: HostInfo, page?: "agents" | "teams") => void;
  openTarget: (
    host: HostInfo,
    folder: FolderHistoryItem,
    worktree?: Worktree,
    rememberPrevious?: boolean,
    closeDrawer?: boolean,
  ) => void;
  addTab: (
    tab: WorkspaceTab,
    groupId?: string,
    direction?: DropDirection,
  ) => void;
  addPanel: (
    kind: Exclude<WorkspaceViewKind, "terminal">,
    groupId?: string,
    direction?: DropDirection,
  ) => string | undefined;
  activateTab: (id: string) => void;
  openTerminal: (
    summary: TerminalSummary,
    groupId?: string,
    direction?: DropDirection,
    launch?: { startTabId?: string },
  ) => void;
  createTerminal: (shellId?: string) => Promise<void>;
  openTerminalInFolder: (cwd: string) => void;
  sendPathToTerminal?: (absolutePath: string, worktreePath: string) => void;
  recentTerminal: () => TerminalSummary | undefined;
  setTabVisitHistory: (
    update: string[] | ((current: string[]) => string[]),
  ) => void;
  setTeamToOpen: (value: TeamToOpen | undefined) => void;
  setCreationTarget: (target: CreationTarget | undefined) => void;
  setCreationOpen: (open: boolean) => void;
  openAttentionRef: MutableRefObject<
    (item?: AttentionRequest) => Promise<void>
  >;
  startingAttentionRef: MutableRefObject<AttentionRequest | undefined>;
}) {
  const [attentionToOpen, setAttentionToOpen] = useState<AttentionRequest>();
  startingAttentionRef.current = attentionToOpen;

  const [viewToOpen, setViewToOpen] = useState<{
    scope: string;
    kind: WorkspaceViewKind;
  }>();
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
  // A sidebar PR/CI mark: the PR / CI View of that worktree, in its own layout.
  const [ciToOpen, setCiToOpen] = useState<{
    hostKey: string;
    cwd: string;
    section?: "ci" | "pr";
  }>();
  const [ciOpenRequest, setCiOpenRequest] = useState<CiOpenRequest>();
  const [fileHistoryRequest, setFileHistoryRequest] =
    useState<FileHistoryRequest>();
  const [diffOpenRequest, setDiffOpenRequest] = useState<DiffOpenRequest>();
  const [fileOpenRequest, setFileOpenRequest] = useState<FileOpenRequest>();
  const [workspaceSearchRequest, setWorkspaceSearchRequest] =
    useState<WorkspaceSearchRequest>();

  const attentionItems: AttentionItem[] = hosts
    .flatMap((host) =>
      connectedHosts.includes(host.publicKey)
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

  const openAttention = async (item?: AttentionRequest) => {
    if (!item) return;
    if (teamsHostRef.current) {
      leaveTeams(() => {
        void openAttention(item);
      });
      return;
    }
    const child = childrenByHost[item.host.publicKey]?.find(
      (entry) => entry.terminalId === item.terminal.id,
    );
    const layoutCwd =
      child?.parentCwd ?? item.terminal.worktreePath ?? item.terminal.cwd;
    const entry = allFolders.find(
      (folderEntry) =>
        folderEntry.host.publicKey === item.host.publicKey &&
        worktreesOf(folderEntry.folder).some((worktree) =>
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
    const worktree = worktreesOf(folder).find((wt) =>
      samePath(wt.path, layoutCwd),
    );
    setAttentionToOpen(item);
    openTarget(item.host, folder, worktree);
  };
  openAttentionRef.current = openAttention;

  useEffect(() => {
    if (!terminalToOpen) return;
    const { hostKey, terminalId } = terminalToOpen;
    const host = connection
      .getSnapshot()
      .initial?.hosts.find((item) => item.publicKey === hostKey);
    if (!host) return;
    void connection
      .requestHost(hostKey, "terminal.list", {})
      .then((result) => {
        const terminal = result?.ok
          ? result.result.terminals.find((item) => item.id === terminalId)
          : undefined;
        if (terminal) void openAttentionRef.current({ host, terminal });
      })
      .catch(() => {});
  }, [openAttentionRef, terminalToOpen]);

  useCliNotifications(
    hosts,
    terminalLists,
    childrenByHost,
    connectedHosts,
    allFolders,
    notificationPreferences,
    t,
    (target) => {
      const host = hosts.find((item) => item.publicKey === target.hostKey);
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
                (item) => item.id === target.terminalId,
              )
            : undefined;
          if (terminal) void openAttention({ host, terminal });
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
    workspace,
  ]);

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

  const selectReadingWorktree = useCallback(
    (tabId: string, path: string) => {
      workspace.update((current) =>
        selectWorkspaceReadingWorktree(current, tabId, path),
      );
    },
    [workspace],
  );

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
        section: ciToOpen.section ?? "ci",
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
    setTabVisitHistory,
    workspace,
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

  const agentTargets = useMemo(() => {
    if (!selectedTarget) return [];
    const hostKey = selectedTarget.host.publicKey;
    const terminals = terminalLists[hostKey]?.terminals ?? [];
    const childTerminalIds =
      childDisplay[hostKey]?.terminalIds ?? new Set<string>();
    const repoWorktrees = targetFolder
      ? worktreesOf(targetFolder)
      : [selectedTarget.worktree];
    return resolveAgentTargets({
      selectedCwd: selectedTarget.cwd,
      workspacePath: selectedTarget.folder.workspacePath,
      terminals,
      childTerminalIds,
      repoWorktrees,
      lastTerminalId: workspace.getSnapshot().lastTerminalId,
    });
  }, [selectedTarget, terminalLists, childDisplay, targetFolder, workspace]);

  const sendTextToTerminal = useCallback(
    (text: string, terminalId?: string): boolean => {
      if (!selectedTarget || !text) return false;
      const hostKey = selectedTarget.host.publicKey;
      const chosen = terminalId
        ? agentTargets.find((item) => item.terminalId === terminalId)
        : agentTargets[0];
      if (!chosen) return false;
      const childTerminalIds =
        childDisplay[hostKey]?.terminalIds ?? new Set<string>();
      const summary = terminalLists[hostKey]?.terminals.find(
        (terminal) =>
          terminal.id === chosen.terminalId &&
          !terminal.teamChild &&
          !childTerminalIds.has(terminal.id),
      );
      if (!summary) return false;
      const sent = queueTerminalInput(summary.id, text, { paste: true });
      if (!sent) return false;
      if (samePath(summary.worktreePath ?? summary.cwd, selectedTarget.cwd)) {
        openTerminal(summary);
      } else {
        void openAttentionRef.current({
          host: selectedTarget.host,
          terminal: summary,
        });
      }
      return true;
    },
    [
      agentTargets,
      childDisplay,
      openAttentionRef,
      openTerminal,
      selectedTarget,
      terminalLists,
    ],
  );

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
      openDiff: (path, worktreePath, baseBranch) => {
        const tabId = addPanel("git");
        if (tabId) {
          selectReadingWorktree(tabId, worktreePath);
          setDiffOpenRequest((current) => ({
            tabId,
            path,
            ...(baseBranch ? { baseBranch } : {}),
            id: (current?.id ?? 0) + 1,
          }));
        }
      },
      diffOpenRequest,
      diffOpened: (id) =>
        setDiffOpenRequest((current) =>
          current?.id === id ? undefined : current,
        ),
      sendPathToTerminal,
      agentTargets,
      sendTextToTerminal:
        agentTargets.length > 0 ? sendTextToTerminal : undefined,
      openTerminalInFolder,
      worktrees: targetWorktrees,
      selectWorktree: selectReadingWorktree,
      ciOpenRequest,
      ciOpenShown: (id) =>
        setCiOpenRequest((current) =>
          current?.id === id ? undefined : current,
        ),
      workspaceSearchRequest,
      workspaceSearchShown: (id) =>
        setWorkspaceSearchRequest((current) =>
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
      backHandlers,
      closedPanels,
      selectedTarget,
      fileOpenRequest,
      fileHistoryRequest,
      diffOpenRequest,
      sendPathToTerminal,
      agentTargets,
      sendTextToTerminal,
      openTerminalInFolder,
      targetWorktrees,
      selectReadingWorktree,
      ciOpenRequest,
      workspaceSearchRequest,
      setCreationTarget,
      setCreationOpen,
      t,
      workspace,
    ],
  );

  const hasPendingTransition = Boolean(
    layoutLoading ||
    loadedLayoutScope !== scope ||
    viewToOpen ||
    attentionToOpen ||
    branchToOpen ||
    ciToOpen ||
    boardToOpen ||
    issuesToOpen,
  );

  return {
    attentionItems,
    attentionToOpen,
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
    setDiffOpenRequest,
    setWorkspaceSearchRequest,
    openWorkspaceSearch: useCallback(
      (folder?: string) => {
        const tabId = addPanel("files");
        if (tabId) {
          setWorkspaceSearchRequest((current) => ({
            tabId,
            folder,
            id: (current?.id ?? 0) + 1,
          }));
        }
      },
      [addPanel],
    ),
    targetFolder,
    selectReadingWorktree,
    viewServices,
    hasPendingTransition,
  };
}
