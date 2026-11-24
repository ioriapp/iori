import type {
  Dispatch,
  PointerEvent as ReactPointerEvent,
  ReactNode,
  RefObject,
  SetStateAction,
} from "react";
import { createPortal } from "react-dom";
import { X } from "lucide-react";
import { cn } from "cn";
import type { DockviewApi } from "dockview-react";
import type {
  ChildSummary,
  HostInfo,
  TerminalListResult,
  TerminalSummary,
} from "@iori/protocol";
import { Button } from "../components/ui/button.tsx";
import { connection } from "../connection.ts";
import { DockLayout, type DockContextValue } from "../DockLayout.tsx";
import { samePath } from "../host-path.ts";
import { MobileHome, type OpenWorktree } from "../MobileHome.tsx";
import {
  MobileWorkspace,
  type MobileSessionItem,
  type MobileViewTab,
} from "../MobileWorkspace.tsx";
import { hasWindowChrome } from "../native.ts";
import { Board } from "../teams/Board.tsx";
import type { useMobileBoards } from "../teams/mobile-boards.ts";
import {
  TerminalPane,
  type TerminalInputPreferences,
  type UpdateTerminalInputPreferences,
} from "../terminal/TerminalPane.tsx";
import type { TerminalLinkOpen } from "../terminal/link-click.ts";
import type { TerminalAccessoryLayout } from "../terminal/terminal-accessory-layout.ts";
import {
  PanelView,
  terminalTitle,
  type WorkspacePanelProps,
  type WorkspacePanelRenderer,
  type WorkspaceTab,
  type WorkspaceTarget,
  type WorkspaceViewKind,
} from "../workspace-panel.tsx";
import { dockGroupElement, type DockGroup } from "./dock-adapter.ts";
import { TerminalWaiting } from "./TerminalWaiting.tsx";
import {
  terminalTabId,
  type AttentionRequest,
  type PendingFocusRequest,
  type TeamToOpen,
} from "./types.ts";
import {
  WorkspaceEmptySurface,
  WorkspaceInlineAlert,
} from "./WorkspaceStart.tsx";

export function createWorkspacePanelRenderer({
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
  onRequestCloseTerminal,
  connectedHosts,
  foreground,
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
}: {
  startScreen: (startTabId?: string) => ReactNode;
  teamsHost?: HostInfo;
  t: (key: string) => string;
  language: string;
  terminalLists: Record<string, TerminalListResult>;
  openAttention: (item?: AttentionRequest) => Promise<void>;
  addPanel: (
    kind: Exclude<WorkspaceViewKind, "terminal">,
  ) => string | undefined;
  selectReadingWorktree: (tabId: string, path: string) => void;
  openTeams: (host: HostInfo, page?: "agents" | "teams") => void;
  setTeamToOpen: (value: TeamToOpen | undefined) => void;
  renderPanel?: WorkspacePanelRenderer;
  terminalViewIds: RefObject<Map<string, string>>;
  childrenByHost: Record<string, ChildSummary[]>;
  stopChild: (hostKey: string, child: ChildSummary) => Promise<void>;
  onRequestCloseTerminal: (connectionId: string, terminalId: string) => void;
  connectedHosts: string[];
  foreground: boolean;
  nativeMobile: boolean;
  focusRequest?: PendingFocusRequest;
  focusConsumed: (nonce: number) => void;
  claimTerminals: Set<string>;
  setClaimTerminals: Dispatch<SetStateAction<Set<string>>>;
  closeTab: (id: string, panelId?: string, preservePane?: boolean) => void;
  loadTerminals: (hostKey: string) => Promise<void>;
  removeTerminal: (
    hostKey: string,
    terminalId: string,
    processExited?: boolean,
  ) => void;
  terminalFontSize: number;
  terminalFontFamily: string;
  onTerminalFontSize: (size: number, save: boolean) => void;
  terminalRightClick: "menu" | "copyPaste";
  terminalLinkOpen: TerminalLinkOpen;
  accessoryLayout: TerminalAccessoryLayout;
  inputPreferences?: TerminalInputPreferences;
  onInputPreferences: UpdateTerminalInputPreferences;
}): WorkspacePanelRenderer {
  return (props: WorkspacePanelProps) => {
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
    if (!list) return <TerminalWaiting t={t} />;
    if (!summary) return null;
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
                  (entry) => entry.terminalId === summary.id,
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
          if (connectionId) onRequestCloseTerminal(connectionId, summary.id);
        }}
        connectionId={connectionId ?? ""}
        connected={connectedHosts.includes(hostKey)}
        foreground={foreground}
        mobile={nativeMobile}
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
}

export function WorkspaceBody({
  target,
  targetName,
  scope,
  isMobile,
  sidebarHasFolders,
  layoutError,
  layoutLoading,
  layoutReady,
  pendingOpen,
  tabs,
  activeMobileTab,
  openWorktrees,
  connectedHosts,
  mobileBoards,
  terminalLists,
  sessionsFor,
  hosts,
  attentionItems,
  childrenByHost,
  currentHostKey,
  dockRoot,
  dockContext,
  maximizedGroup,
  maximizedDockGroup,
  kindOfGroup,
  t,
  startScreen,
  renderAll,
  onBoard,
  onAttention,
  onOpenWorktree,
  onSettings,
  onRetryLoadLayout,
  onDiscardLayout,
  onStopChild,
  onNewMobileTab,
  onSelectTab,
  onOpenView,
  onOpenTerminalSession,
  onCloseTab,
  onDockReady,
  onCloseMaximize,
  onBeginMaximizedResize,
}: {
  target?: WorkspaceTarget;
  targetName: string;
  scope: string;
  isMobile: boolean;
  sidebarHasFolders: boolean;
  layoutError?: "load" | "save";
  layoutLoading: boolean;
  layoutReady: boolean;
  pendingOpen: boolean;
  tabs: WorkspaceTab[];
  activeMobileTab?: WorkspaceTab;
  openWorktrees: OpenWorktree[];
  connectedHosts: string[];
  mobileBoards: ReturnType<typeof useMobileBoards>;
  terminalLists: Record<string, TerminalListResult>;
  sessionsFor: (hostKey: string, path: string) => TerminalSummary[];
  hosts: HostInfo[];
  attentionItems: AttentionRequest[];
  childrenByHost: Record<string, ChildSummary[]>;
  currentHostKey: string;
  dockRoot: RefObject<HTMLDivElement | null>;
  dockContext: DockContextValue;
  maximizedGroup?: string;
  maximizedDockGroup?: DockGroup;
  kindOfGroup: (group: DockGroup) => WorkspaceViewKind;
  t: (key: string) => string;
  startScreen: (startTabId?: string) => ReactNode;
  renderAll: WorkspacePanelRenderer;
  onBoard: (item: OpenWorktree, conversation: string) => void;
  onAttention: (item: AttentionRequest) => void;
  onOpenWorktree: (item: OpenWorktree) => void;
  onSettings: () => void;
  onRetryLoadLayout: () => void;
  onDiscardLayout: () => void;
  onStopChild: (child: ChildSummary) => void;
  onNewMobileTab: () => void;
  onSelectTab: (tabId: string) => void;
  onOpenView: (kind: Exclude<WorkspaceViewKind, "terminal">) => void;
  onOpenTerminalSession: (terminal: TerminalSummary) => void;
  onCloseTab: (tabId: string) => void;
  onDockReady: (api: DockviewApi) => () => void;
  onCloseMaximize: () => void;
  onBeginMaximizedResize: (
    kind: WorkspaceViewKind,
    side: "left" | "right",
  ) => (event: ReactPointerEvent<HTMLDivElement>) => void;
}) {
  if (!target) {
    return isMobile ? (
      <MobileHome
        t={t}
        worktrees={openWorktrees}
        connectedHosts={connectedHosts}
        summaries={mobileBoards}
        terminalLists={terminalLists}
        onBoard={onBoard}
        attention={attentionItems}
        running={hosts.flatMap((host) =>
          connectedHosts.includes(host.publicKey)
            ? (terminalLists[host.publicKey]?.terminals ?? [])
                .filter((terminal) => terminal.cliStatus?.state === "active")
                .map((terminal) => ({ host, terminal }))
            : [],
        )}
        onAttention={onAttention}
        onOpen={onOpenWorktree}
        onSettings={onSettings}
      />
    ) : (
      <WorkspaceEmptySurface
        toggleLabel={t("Toggle sidebar")}
        message={t(
          sidebarHasFolders
            ? "Select a worktree in the sidebar."
            : "Open a folder with Add folder in the sidebar.",
        )}
      />
    );
  }

  if (layoutError === "load" && !layoutLoading) {
    return (
      <WorkspaceInlineAlert>
        <p>{t("Could not restore this workspace layout.")}</p>
        <Button
          variant="outline"
          size="sm"
          onClick={onRetryLoadLayout}
          data-iori-action="workspace-layout-retry-load"
        >
          {t("Retry")}
        </Button>
        <Button
          variant="outline"
          size="sm"
          onClick={onDiscardLayout}
          data-iori-action="workspace-layout-discard"
        >
          {t("Discard the layout and open")}
        </Button>
      </WorkspaceInlineAlert>
    );
  }

  if (!layoutReady || pendingOpen) return null;

  if (isMobile) {
    const activeChild = childrenByHost[currentHostKey]?.find(
      (entry) =>
        entry.terminalId === activeMobileTab?.terminalId &&
        !["finished", "stopped", "failed"].includes(entry.state),
    );
    const worktreeTerminals = sessionsFor(currentHostKey, target.worktree.path);
    const sessionIds = new Set(worktreeTerminals.map((term) => term.id));
    const terminalTabs = tabs.filter(
      (tab) =>
        tab.kind === "terminal" &&
        (!tab.terminalId || sessionIds.has(tab.terminalId)),
    );
    const activeOrLatestTerminalTab =
      activeMobileTab?.kind === "terminal"
        ? activeMobileTab
        : terminalTabs[terminalTabs.length - 1];
    const activeOrLatestTerminal = activeOrLatestTerminalTab
      ? (worktreeTerminals.find(
          (term) => term.id === activeOrLatestTerminalTab.terminalId,
        ) ??
        terminalLists[currentHostKey]?.terminals.find(
          (term) => term.id === activeOrLatestTerminalTab.terminalId,
        ))
      : worktreeTerminals[0];
    const labelForTerminal = (terminal?: TerminalSummary) => {
      if (!terminal) return t("Terminal");
      const teamName =
        terminal.teamConversation && !terminal.teamChild
          ? terminal.teamName
          : undefined;
      return (
        teamName ||
        terminalTitle(terminal.title) ||
        terminal.cli?.name ||
        t("Terminal")
      );
    };
    const worktreeAttentionCount = attentionItems.filter(
      (item) =>
        item.host.publicKey === currentHostKey &&
        samePath(
          item.terminal.worktreePath ?? item.terminal.cwd,
          target.worktree.path,
        ),
    ).length;
    const hasBoard =
      tabs.some((tab) => tab.kind === "board") ||
      (mobileBoards.boards[currentHostKey] ?? []).some((board) =>
        samePath(board.cwd, target.worktree.path),
      ) ||
      worktreeTerminals.some((term) => Boolean(term.teamConversation));
    const isGitRepo = Boolean(
      target.folder.worktrees?.length ||
      target.worktree.branch ||
      target.worktree.detached ||
      tabs.some((tab) => tab.kind === "git"),
    );
    const terminalLabel = labelForTerminal(activeOrLatestTerminal);
    const viewTabs: MobileViewTab[] = [
      {
        id: "mobile-view-terminal",
        label: terminalLabel,
        kind: "terminal",
        active: activeMobileTab?.kind === "terminal",
        badge: worktreeAttentionCount > 0 ? worktreeAttentionCount : undefined,
        onSelect: () => {
          if (activeOrLatestTerminalTab) {
            onSelectTab(activeOrLatestTerminalTab.id);
          } else if (activeOrLatestTerminal) {
            onOpenTerminalSession(activeOrLatestTerminal);
          } else {
            onNewMobileTab();
          }
        },
      },
      ...(hasBoard
        ? [
            {
              id: "mobile-view-board",
              label: "Board",
              kind: "board" as const,
              active: activeMobileTab?.kind === "board",
              onSelect: () => onOpenView("board"),
            },
          ]
        : []),
      {
        id: "mobile-view-files",
        label: t("Files"),
        kind: "files",
        active: activeMobileTab?.kind === "files",
        onSelect: () => onOpenView("files"),
      },
      ...(isGitRepo
        ? [
            {
              id: "mobile-view-git",
              label: "Git",
              kind: "git" as const,
              active: activeMobileTab?.kind === "git",
              onSelect: () => onOpenView("git"),
            },
          ]
        : []),
      ...(tabs.some((tab) => tab.kind === "issues")
        ? [
            {
              id: "mobile-view-issues",
              label: "Issues",
              kind: "issues" as const,
              active: activeMobileTab?.kind === "issues",
              onSelect: () => onOpenView("issues"),
            },
          ]
        : []),
      ...(tabs.some((tab) => tab.kind === "ci")
        ? [
            {
              id: "mobile-view-ci",
              label: "PR / CI",
              kind: "ci" as const,
              active: activeMobileTab?.kind === "ci",
              onSelect: () => onOpenView("ci"),
            },
          ]
        : []),
    ];
    const sessions: MobileSessionItem[] = worktreeTerminals.map((terminal) => ({
      id: terminal.id,
      label: labelForTerminal(terminal),
      active:
        activeMobileTab?.kind === "terminal" &&
        activeMobileTab.terminalId === terminal.id,
      attention: attentionItems.some(
        (item) =>
          item.host.publicKey === currentHostKey &&
          item.terminal.id === terminal.id,
      ),
      onSelect: () => onOpenTerminalSession(terminal),
    }));
    return (
      <MobileWorkspace
        name={targetName}
        branch={target.worktree.branch}
        t={t}
        viewTabs={viewTabs}
        sessions={sessions}
        activeSessionLabel={
          activeMobileTab?.kind === "terminal" ? terminalLabel : undefined
        }
        onStopChild={activeChild ? () => onStopChild(activeChild) : undefined}
        onNew={onNewMobileTab}
        onCloseView={
          activeMobileTab ? () => onCloseTab(activeMobileTab.id) : undefined
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
    );
  }

  return (
    <div
      ref={dockRoot}
      className={cn(
        "workspace-dock-shell relative flex min-h-0 min-w-0 flex-1",
        maximizedGroup && "has-maximized",
      )}
    >
      {maximizedGroup && (
        <button
          type="button"
          className="fixed inset-0 z-[32] w-full border-0 bg-scrim"
          onClick={onCloseMaximize}
          aria-label={t("Restore pane")}
        />
      )}
      <DockLayout key={scope} context={dockContext} onReady={onDockReady} />
      {maximizedDockGroup &&
        createPortal(
          <>
            <div
              className="workspace-resize-handle absolute inset-y-0 left-0 z-[38] w-2 cursor-ew-resize touch-none"
              onPointerDown={onBeginMaximizedResize(
                kindOfGroup(maximizedDockGroup),
                "left",
              )}
            />
            <div
              className="workspace-resize-handle absolute inset-y-0 right-0 z-[38] w-2 cursor-ew-resize touch-none"
              onPointerDown={onBeginMaximizedResize(
                kindOfGroup(maximizedDockGroup),
                "right",
              )}
            />
          </>,
          dockGroupElement(maximizedDockGroup),
        )}
      {maximizedGroup && (
        <Button
          className={cn(
            "fixed right-2 z-[39] bg-background",
            hasWindowChrome
              ? "top-[calc(8px+var(--window-caption-height,35px))]"
              : "top-2",
          )}
          variant="ghost"
          size="icon-sm"
          onClick={onCloseMaximize}
          aria-label={t("Restore pane")}
          data-iori-action="workspace-restore"
        >
          <X size={16} />
        </Button>
      )}
    </div>
  );
}
