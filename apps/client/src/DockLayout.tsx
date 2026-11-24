import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  useSyncExternalStore,
  type DragEvent as ReactDragEvent,
} from "react";
import { createPortal } from "react-dom";
import {
  ChevronDown,
  Columns2,
  Expand,
  LayoutTemplate,
  Maximize2,
  Minimize2,
  Plus,
  Rows2,
  Square,
  X,
} from "lucide-react";
import { cn } from "cn";
import {
  DockviewReact,
  themeDark,
  type DockviewApi,
  type DockviewReadyEvent,
  type IDockviewHeaderActionsProps,
  type IDockviewPanelHeaderProps,
  type IDockviewPanelProps,
} from "dockview-react";
import type { CliSummary, Team, TerminalShell } from "@iori/protocol";
import { CliIcon, CliIconHost } from "./CliIcon.tsx";
import { CliLauncher, type ShellStatus } from "./CliLauncher.tsx";
import {
  CliElapsed,
  CliStateDot,
  isStalledCliStatus,
  useTick,
  withStalledDescription,
} from "./CliStatus.tsx";
import { Button } from "./components/ui/button.tsx";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from "./components/ui/context-menu.tsx";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "./components/ui/popover.tsx";
import { SidebarTrigger } from "./components/ui/sidebar.tsx";
import { hasWindowChrome } from "./native.ts";
import { carriesPath, readPathDrag, type PathDrag } from "./path-drag.ts";
import {
  focusAfterDockLayout,
  PanelView,
  tabTitle,
  viewIcons,
  type WorkspacePanelRenderer,
  type WorkspaceTab,
  type WorkspaceViewKind,
} from "./workspace-panel.tsx";
import {
  dockGroupActivePanelId,
  dockGroupCount,
  dockGroupPanels,
  dockPanelTabId,
  findDockTabsStrip,
  hasDockGroupActivePanel,
  isDockPanelActiveInGroup,
  moveDockTabFocus,
  syncDockHeaders,
  syncDockTablistSemantics,
  syncMaximizedPanelOverlay,
  type DockGroup,
} from "./workspace/dock-adapter.ts";
import "./dock.css";

export type { DockGroup };
export type DropDirection = "within" | "left" | "right" | "above" | "below";

export const sidebarViewTransferType = "application/x-iori-workspace-view";

export type SidebarViewPayload = {
  kind: WorkspaceViewKind;
  terminalId?: string;
  hostKey?: string;
  workspacePath?: string;
  worktreePath?: string;
};

function readSidebarView(event: ReactDragEvent<HTMLElement>) {
  const value = event.dataTransfer.getData(sidebarViewTransferType);
  if (!value) return undefined;
  try {
    const payload = JSON.parse(value) as Partial<SidebarViewPayload>;
    if (
      payload.kind !== "files" &&
      payload.kind !== "git" &&
      payload.kind !== "ci" &&
      payload.kind !== "terminal"
    )
      return undefined;
    return {
      ...payload,
      kind: payload.kind,
      terminalId:
        typeof payload.terminalId === "string" ? payload.terminalId : undefined,
    } as SidebarViewPayload;
  } catch {
    return undefined;
  }
}

function allowSidebarViewDrop(event: ReactDragEvent<HTMLElement>) {
  if (!event.dataTransfer.types.includes(sidebarViewTransferType)) return;
  event.preventDefault();
  event.dataTransfer.dropEffect = "move";
}

// A path from Files or Git is typed into a Terminal; other Views do not take it.
function allowPathDrop(event: ReactDragEvent<HTMLElement>, tab: WorkspaceTab) {
  if (tab.kind !== "terminal" || !carriesPath(event.dataTransfer)) return false;
  event.preventDefault();
  event.dataTransfer.dropEffect = "copy";
  return true;
}

function dropDirection(event: ReactDragEvent<HTMLElement>): DropDirection {
  const bounds = event.currentTarget.getBoundingClientRect();
  const x = (event.clientX - bounds.left) / bounds.width;
  const y = (event.clientY - bounds.top) / bounds.height;
  return x < 0.22
    ? "left"
    : x > 0.78
      ? "right"
      : y < 0.22
        ? "above"
        : y > 0.78
          ? "below"
          : "within";
}

export type DockContextValue = {
  tabs: WorkspaceTab[];
  saveNewWorktreeLayout?: () => void;
  readingViews: ("files" | "git" | "ci" | "board")[];
  openReadingView: (
    kind: "files" | "git" | "ci" | "board",
    groupId: string,
  ) => void;
  t: (key: string) => string;
  renderPanel?: WorkspacePanelRenderer;
  shells: TerminalShell[];
  clis: CliSummary[];
  hostKey: string;
  addTeam: (team: Team, groupId?: string) => void;
  cliError?: boolean;
  addCli: (cli: CliSummary, groupId?: string) => void;
  openCliSettings: () => void;
  openTeams: (teamId?: string) => void;
  launcherActive: boolean;
  /** The launcher item whose start waits for the Host. */
  launching?: string;
  defaultShellId?: string;
  shellStatus: ShellStatus;
  reloadClis: () => void;
  retryShells: () => void;
  doubleClickMaximize: boolean;
  maximizedGroup?: string;
  maximizedFullWidth: boolean;
  toggleMaximizedFullWidth: (group: DockGroup) => void;
  maximize: (group: DockGroup) => void;
  closeTab: (id: string, panelId?: string) => void;
  addTerminal: (shell: TerminalShell, groupId?: string) => void;
  /** Ends the Terminal's process and removes it; the tab × only hides it. */
  closeTerminal: (terminalId: string) => void;
  stopChild: (childId: string) => void;
  dropSidebarView: (
    payload: SidebarViewPayload,
    group: DockGroup,
    direction: DropDirection,
  ) => void;
  split: (group: DockGroup, direction: "right" | "below") => void;
  setActiveTab: (id: string) => void;
  /** Types a dropped path into the tab's Terminal. */
  dropPath: (tab: WorkspaceTab, drag: PathDrag) => void;
  /** The tab the user just opened or created; focus moves into it (PC). */
  focusRequest?: { tabId: string; nonce: number };
  focusConsumed: (nonce: number) => void;
};

const DockContext = createContext<DockContextValue | null>(null);
function useDock() {
  const value = useContext(DockContext);
  if (!value) throw new Error("Workspace Dock context is missing");
  return value;
}

function useMaximizedOverlay(panel: IDockviewPanelProps) {
  const { maximizedGroup } = useDock();
  const content = useRef<HTMLDivElement>(null);
  // Panel content lives in Dockview's render overlay; lift it with its group.
  useEffect(() => {
    syncMaximizedPanelOverlay(
      content.current,
      maximizedGroup === panel.api.group.id,
    );
  });
  return content;
}

function DockPanel(panel: IDockviewPanelProps<{ tabId: string }>) {
  const {
    tabs,
    t,
    renderPanel,
    dropSidebarView,
    dropPath,
    focusRequest,
    focusConsumed,
  } = useDock();
  const content = useMaximizedOverlay(panel);
  const [visible, setVisible] = useState(panel.api.isVisible);
  useEffect(() => {
    setVisible(panel.api.isVisible);
    const listener = panel.api.onDidVisibilityChange((event) =>
      setVisible(event.isVisible),
    );
    return () => listener.dispose();
  }, [panel.api]);
  // A view that takes focus itself (a Terminal) has already; the rest focus
  // the panel so keys go to what the user opened.
  const focusNonce =
    focusRequest?.tabId === panel.params.tabId ? focusRequest.nonce : undefined;
  useEffect(() => {
    const element = content.current;
    if (focusNonce === undefined || !visible || !element) return;
    return focusAfterDockLayout(element, (takeFocus) => {
      if (takeFocus && !element.contains(document.activeElement))
        element.focus({ preventScroll: true });
      // Terminals consume their request after xterm is mounted and focused.
      if (
        tabs.find((tab) => tab.id === panel.params.tabId)?.kind !== "terminal"
      )
        focusConsumed(focusNonce);
    });
  }, [focusNonce, visible, focusConsumed, tabs, panel.params.tabId]);
  const tab = tabs.find((item) => item.id === panel.params.tabId);
  if (!tab) return null;
  return (
    <div
      ref={content}
      tabIndex={-1}
      className="dock-content flex h-full min-h-0 w-full min-w-0 flex-col overflow-clip bg-background focus-visible:outline-none"
      data-iori-workspace-panel={tab.id}
      onDragOver={(event) => {
        if (!allowPathDrop(event, tab)) allowSidebarViewDrop(event);
      }}
      onDrop={(event) => {
        const drag =
          tab.kind === "terminal"
            ? readPathDrag(event.dataTransfer)
            : undefined;
        if (drag) {
          event.preventDefault();
          dropPath(tab, drag);
          return;
        }
        const payload = readSidebarView(event);
        if (!payload) return;
        event.preventDefault();
        dropSidebarView(payload, panel.api.group, dropDirection(event));
      }}
    >
      <PanelView
        tab={tab}
        panelId={panel.api.id}
        renderPanel={renderPanel}
        visible={visible}
        t={t}
      />
    </div>
  );
}

function DockTabHeader(panel: IDockviewPanelHeaderProps<{ tabId: string }>) {
  const {
    tabs,
    t,
    doubleClickMaximize,
    saveNewWorktreeLayout,
    maximize,
    closeTab,
    closeTerminal,
    stopChild,
    split,
    dropSidebarView,
    dropPath,
  } = useDock();
  const tab = tabs.find((item) => item.id === panel.params.tabId);
  const header = useRef<HTMLDivElement>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const now = useTick(
    isStalledCliStatus(tab?.cliStatus),
    tab?.cliStatus?.stalledSince,
  );
  // The selected tab of every group shows its ×, also in a group not in focus.
  // The state is read again after subscribing, so a change Dockview makes while
  // it builds a restored layout is not missed.
  const group = panel.api.group;
  const subscribe = useCallback(
    (notify: () => void) => {
      const listeners = [
        panel.api.onDidActiveChange(notify),
        panel.api.onDidGroupChange(notify),
        group.api.onDidActivePanelChange(notify),
      ];
      return () => listeners.forEach((listener) => listener.dispose());
    },
    [panel.api, group],
  );
  const selected = useSyncExternalStore(subscribe, () =>
    isDockPanelActiveInGroup(panel),
  );
  // The selected tab, with its ×, stays in view in its tab strip, also after
  // the group is resized or tabs grow, are added or removed (fonts load after
  // the first layout). A tab wider than its strip shows its × end.
  // Only the strip scrolls; the work surface never moves.
  useEffect(() => {
    const element = header.current;
    const strip = findDockTabsStrip(element);
    if (!selected || !element || !strip) return;
    const reveal = () => {
      const bounds = strip.getBoundingClientRect();
      const tabBounds = element.getBoundingClientRect();
      if (tabBounds.right > bounds.right || tabBounds.width > bounds.width)
        strip.scrollLeft += tabBounds.right - bounds.right;
      else if (tabBounds.left < bounds.left)
        strip.scrollLeft -= bounds.left - tabBounds.left;
    };
    const resized = new ResizeObserver(reveal);
    const observeTabs = () => {
      resized.observe(strip);
      for (const tabNode of strip.children) resized.observe(tabNode);
    };
    observeTabs();
    const changed = new MutationObserver(() => {
      observeTabs();
      reveal();
    });
    changed.observe(strip, { childList: true });
    reveal();
    return () => {
      resized.disconnect();
      changed.disconnect();
    };
  }, [selected]);
  if (!tab) return null;
  const Icon = viewIcons[tab.kind];
  const title = tabTitle(tab, t);
  const accessibleTitle = withStalledDescription(title, tab.cliStatus, t, now);
  return (
    <ContextMenu onOpenChange={setMenuOpen}>
      <ContextMenuTrigger asChild>
        <div
          ref={header}
          className={cn(
            "dock-tab-header group/tab relative flex h-[2.125rem] min-w-0 max-w-full items-center gap-1 border-r border-border bg-sidebar pr-1",
            "data-[active=true]:bg-background",
            "data-[active=true]:before:absolute data-[active=true]:before:inset-x-0 data-[active=true]:before:bottom-0 data-[active=true]:before:z-[1] data-[active=true]:before:h-0.5 data-[active=true]:before:bg-primary data-[active=true]:before:content-['']",
            "has-[[role=tab]:focus-visible]:after:pointer-events-none has-[[role=tab]:focus-visible]:after:absolute has-[[role=tab]:focus-visible]:after:inset-0.5 has-[[role=tab]:focus-visible]:after:border has-[[role=tab]:focus-visible]:after:border-ring has-[[role=tab]:focus-visible]:after:content-['']",
          )}
          data-tab-kind={tab.kind}
          data-active={selected}
          data-iori-group-id={panel.api.group.id}
          onDragOver={(event) => {
            if (!allowPathDrop(event, tab)) allowSidebarViewDrop(event);
          }}
          onDrop={(event) => {
            const drag =
              tab.kind === "terminal"
                ? readPathDrag(event.dataTransfer)
                : undefined;
            if (drag) {
              event.preventDefault();
              dropPath(tab, drag);
              return;
            }
            const payload = readSidebarView(event);
            if (!payload) return;
            event.preventDefault();
            dropSidebarView(payload, panel.api.group, "within");
          }}
        >
          <button
            type="button"
            role="tab"
            aria-selected={selected}
            tabIndex={selected ? 0 : -1}
            data-state={selected ? "active" : "inactive"}
            data-iori-tab-id={tab.id}
            data-iori-tab-kind={tab.kind}
            data-iori-tab-cli={tab.cli?.id}
            title={tab.file?.absolutePath ?? accessibleTitle}
            aria-label={accessibleTitle}
            className={cn(
              "flex h-full min-w-0 max-w-[13.75rem] flex-initial cursor-pointer items-center gap-1.5 overflow-hidden border-0 bg-transparent py-0 pr-2 pl-3 text-left text-xs font-medium whitespace-nowrap outline-none focus-visible:outline-none",
              "data-[state=active]:text-foreground",
              "data-[state=inactive]:text-muted-foreground hover:text-foreground",
              "[&_.cli-elapsed]:ml-1 [&_.cli-elapsed]:shrink-0 [&_.cli-elapsed]:whitespace-nowrap [&_.cli-elapsed]:text-2xs [&_.cli-elapsed]:tabular-nums [&_.cli-elapsed]:text-muted-foreground",
            )}
            onClick={() => panel.api.setActive()}
            onKeyDown={(event) => {
              if (moveDockTabFocus(event.currentTarget, event.key)) {
                event.preventDefault();
              }
            }}
            onDoubleClick={() =>
              doubleClickMaximize && maximize(panel.api.group)
            }
          >
            <span className="inline-flex shrink-0 items-center gap-1">
              <span className="inline-flex size-3.5 shrink-0 items-center justify-center empty:w-0 empty:basis-0">
                <CliStateDot status={tab.cliStatus} t={t} />
              </span>
              {tab.cli ? (
                <CliIcon cli={tab.cli} size={14} />
              ) : (
                <Icon size={14} aria-hidden="true" />
              )}
            </span>
            <span className="min-w-0 truncate text-xs">{title}</span>
            {!tab.childId && <CliElapsed status={tab.cliStatus} />}
          </button>
          <Button
            variant="ghost"
            size="icon-sm"
            className="size-5 shrink-0 p-0 text-muted-foreground opacity-0 hover:text-foreground focus-visible:opacity-100 group-hover/tab:opacity-100 group-data-[active=true]/tab:opacity-100"
            aria-label={`${title} ${t("Close")}`}
            title={t("Close")}
            data-iori-action="workspace-close-tab"
            onClick={() => closeTab(tab.id, panel.api.id)}
          >
            <X size={13} aria-hidden="true" />
          </Button>
        </div>
      </ContextMenuTrigger>
      <ContextMenuContent
        sticky="always"
        collisionPadding={{
          top: menuOpen
            ? (header.current?.getBoundingClientRect().bottom ?? 0)
            : 0,
        }}
      >
        <ContextMenuItem onSelect={() => split(panel.api.group, "right")}>
          <Columns2 aria-hidden="true" />
          {t("Split right")}
        </ContextMenuItem>
        <ContextMenuItem onSelect={() => split(panel.api.group, "below")}>
          <Rows2 aria-hidden="true" />
          {t("Split below")}
        </ContextMenuItem>
        <ContextMenuItem onSelect={() => maximize(panel.api.group)}>
          <Maximize2 aria-hidden="true" />
          {t("Maximize")}
        </ContextMenuItem>
        {saveNewWorktreeLayout && (
          <ContextMenuItem
            data-iori-action="save-worktree-layout-menu"
            onSelect={saveNewWorktreeLayout}
          >
            <LayoutTemplate aria-hidden="true" />
            {t("Use this layout for new worktrees")}
          </ContextMenuItem>
        )}
        <ContextMenuSeparator />
        <ContextMenuItem onSelect={() => closeTab(tab.id, panel.api.id)}>
          <X aria-hidden="true" />
          {t("Close tab")}
        </ContextMenuItem>
        {tab.canStopChild && tab.childId && (
          <ContextMenuItem
            data-iori-action="child-tab-stop"
            onSelect={() => stopChild(tab.childId!)}
          >
            <Square aria-hidden="true" />
            {t("Stop child")}
          </ContextMenuItem>
        )}
        {tab.terminalId && !tab.childId && (
          <ContextMenuItem
            variant="destructive"
            data-iori-action="terminal-close"
            onSelect={() => closeTerminal(tab.terminalId!)}
          >
            <X aria-hidden="true" />
            {t("Close terminal")}
          </ContextMenuItem>
        )}
      </ContextMenuContent>
    </ContextMenu>
  );
}

function DockActions(group: IDockviewHeaderActionsProps) {
  const dock = useDock();
  const { t } = dock;
  const [newOpen, setNewOpen] = useState(false);
  const [listOpen, setListOpen] = useState(false);
  // Closing the popover returns focus to "+"; a chosen shell opens a Terminal
  // that takes focus instead.
  const chosenShell = useRef(false);
  const [, refresh] = useState(0);
  useEffect(() => {
    const listener = group.group.api.onDidActivePanelChange(() =>
      refresh((n) => n + 1),
    );
    return () => listener.dispose();
  }, [group.group]);
  const split = (direction: "right" | "below") => {
    setListOpen(false);
    if (hasDockGroupActivePanel(group.group))
      dock.split(group.group, direction);
  };
  const maximize = () => {
    setListOpen(false);
    dock.maximize(group.group);
  };
  const maximized = dock.maximizedGroup === group.group.id;
  const activePanelId = dockGroupActivePanelId(group.group);
  return (
    <div
      className="flex h-[2.125rem] items-center gap-px px-1 [&_[data-slot=button]]:size-[1.6875rem] [&_[data-slot=button]]:shrink-0 [&_[data-slot=button]]:p-0"
      data-iori-group-id={group.group.id}
      onDragOver={allowSidebarViewDrop}
      onDrop={(event) => {
        const payload = readSidebarView(event);
        if (!payload) return;
        event.preventDefault();
        dock.dropSidebarView(payload, group.group, "within");
      }}
    >
      <Popover open={newOpen} onOpenChange={setNewOpen}>
        <PopoverTrigger asChild>
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label={t("New tab")}
            title={t("New tab")}
            data-iori-action="workspace-add-tab"
          >
            <Plus size={15} />
          </Button>
        </PopoverTrigger>
        <PopoverContent
          className="new-items-popover w-[18.75rem] p-1.5"
          side="bottom"
          align="end"
          onCloseAutoFocus={(event) => {
            if (!chosenShell.current) return;
            chosenShell.current = false;
            event.preventDefault();
          }}
        >
          <CliLauncher
            readingViews={dock.readingViews}
            onView={(kind) => {
              chosenShell.current = true;
              setNewOpen(false);
              dock.openReadingView(kind, group.group.id);
            }}
            onOpenTeams={(teamId) => {
              setNewOpen(false);
              dock.openTeams(teamId);
            }}
            active={dock.launcherActive}
            onOpen={dock.reloadClis}
            hostKey={dock.hostKey}
            onTeam={(team) => {
              chosenShell.current = true;
              setNewOpen(false);
              dock.addTeam(team, group.group.id);
            }}
            t={t}
            shells={dock.shells}
            clis={dock.clis}
            cliError={dock.cliError}
            onCli={(cli) => {
              chosenShell.current = true;
              setNewOpen(false);
              dock.addCli(cli, group.group.id);
            }}
            onAddCli={() => {
              setNewOpen(false);
              dock.openCliSettings();
            }}
            defaultShellId={dock.defaultShellId}
            status={dock.shellStatus}
            onRetry={dock.retryShells}
            onShell={(shell) => {
              chosenShell.current = true;
              setNewOpen(false);
              dock.addTerminal(shell, group.group.id);
            }}
          />
        </PopoverContent>
      </Popover>
      <Button
        variant="ghost"
        size="icon-sm"
        aria-label={t("Split right")}
        title={t("Split right")}
        data-iori-action="workspace-split-right"
        onClick={() => split("right")}
      >
        <Columns2 size={15} />
      </Button>
      <Button
        variant="ghost"
        size="icon-sm"
        aria-label={t("Split below")}
        title={t("Split below")}
        data-iori-action="workspace-split-below"
        onClick={() => split("below")}
      >
        <Rows2 size={15} />
      </Button>
      {maximized ? (
        <Button
          variant="ghost"
          size="icon-sm"
          aria-pressed={dock.maximizedFullWidth}
          aria-label={t(
            dock.maximizedFullWidth ? "Use saved width" : "Full width",
          )}
          title={t(dock.maximizedFullWidth ? "Use saved width" : "Full width")}
          data-iori-action="workspace-toggle-full-width"
          onClick={() => dock.toggleMaximizedFullWidth(group.group)}
        >
          {dock.maximizedFullWidth ? (
            <Minimize2 size={15} />
          ) : (
            <Expand size={15} />
          )}
        </Button>
      ) : (
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label={t("Maximize")}
          title={t("Maximize")}
          data-iori-action="workspace-maximize"
          onClick={maximize}
        >
          <Maximize2 size={15} />
        </Button>
      )}
      <Popover open={listOpen} onOpenChange={setListOpen}>
        <PopoverTrigger asChild>
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label={t("Open tabs")}
            title={t("Open tabs")}
            data-iori-action="workspace-tab-list"
          >
            <ChevronDown size={15} />
          </Button>
        </PopoverTrigger>
        <PopoverContent
          className="grid w-[16.25rem] gap-0.5 p-1.5"
          side="bottom"
          align="end"
        >
          {dockGroupPanels(group.group).map((panel) => {
            const id = dockPanelTabId(panel);
            const tab = dock.tabs.find((item) => item.id === id);
            if (!tab) return null;
            const Icon = viewIcons[tab.kind];
            return (
              <Button
                key={panel.id}
                variant="ghost"
                className="h-[1.875rem] w-full justify-start gap-2 px-2 text-xs font-normal data-[active=true]:bg-accent data-[active=true]:font-medium [&>span]:min-w-0 [&>span]:truncate"
                data-active={activePanelId === panel.id}
                onClick={() => {
                  panel.api.setActive();
                  dock.setActiveTab(tab.id);
                  setListOpen(false);
                }}
              >
                {tab.cli ? (
                  <CliIcon cli={tab.cli} size={14} />
                ) : (
                  <Icon size={14} />
                )}
                <span>{tabTitle(tab, t)}</span>
              </Button>
            );
          })}
          <div className="mt-1 grid gap-0.5 border-t border-border pt-1">
            <Button
              variant="ghost"
              className="h-[1.875rem] w-full justify-start gap-2 px-2 text-xs font-normal"
              data-iori-action="workspace-split-right-list"
              onClick={() => split("right")}
            >
              <Columns2 size={14} />
              {t("Split right")}
            </Button>
            <Button
              variant="ghost"
              className="h-[1.875rem] w-full justify-start gap-2 px-2 text-xs font-normal"
              data-iori-action="workspace-split-below-list"
              onClick={() => split("below")}
            >
              <Rows2 size={14} />
              {t("Split below")}
            </Button>
            {!maximized && (
              <Button
                variant="ghost"
                className="h-[1.875rem] w-full justify-start gap-2 px-2 text-xs font-normal"
                data-iori-action="workspace-maximize-list"
                onClick={maximize}
              >
                <Maximize2 size={14} />
                {t("Maximize")}
              </Button>
            )}
          </div>
        </PopoverContent>
      </Popover>
    </div>
  );
}

function EmptyPane(panel: IDockviewPanelProps) {
  const dock = useDock();
  const content = useMaximizedOverlay(panel);
  const subscribe = useCallback(
    (notify: () => void) => {
      const listener = panel.containerApi.onDidLayoutChange(notify);
      return () => listener.dispose();
    },
    [panel.containerApi],
  );
  const canClose = useSyncExternalStore(
    subscribe,
    () => dockGroupCount(panel.containerApi) > 1,
  );
  return (
    <div
      className="grid h-full place-items-center overflow-auto p-6"
      ref={content}
      data-iori-view="empty-pane"
      data-iori-empty-group={panel.api.group.id}
    >
      <CliLauncher
        hostKey={dock.hostKey}
        onTeam={(team) => dock.addTeam(team, panel.api.group.id)}
        t={dock.t}
        shells={dock.shells}
        clis={dock.clis}
        cliError={dock.cliError}
        defaultShellId={dock.defaultShellId}
        status={dock.shellStatus}
        onRetry={dock.retryShells}
        onCli={(cli) => dock.addCli(cli, panel.api.group.id)}
        onShell={(shell) => dock.addTerminal(shell, panel.api.group.id)}
        onAddCli={dock.openCliSettings}
        onOpenTeams={dock.openTeams}
        active={dock.launcherActive}
        onOpen={dock.reloadClis}
        pending={dock.launching}
        onClosePane={canClose ? () => panel.api.close() : undefined}
      />
    </div>
  );
}

function EmptyTab() {
  return <span className="dock-empty-tab" />;
}

// Dockview reapplies layout proportions when an option changes. Keep the
// theme and component maps stable so Host updates cannot rewind a drag.
const dockComponents = { workspace: DockPanel, empty: EmptyPane };
const dockTabComponents = { empty: EmptyTab };
const dockTheme = {
  ...themeDark,
  name: "iori-dock",
  className: "dockview-theme-dark iori-dock",
  dndOverlayBorder: "1px solid var(--border)",
  dndPanelOverlay: "group" as const,
  dndTabIndicator: "line" as const,
};

export function DockLayout({
  context,
  onReady,
}: {
  context: DockContextValue;
  onReady: (api: DockviewApi) => () => void;
}) {
  const dockNode = useRef<HTMLDivElement>(null);
  const disposeReady = useRef<(() => void) | undefined>(undefined);
  // The owning workspace must release this API before Dockview is disposed,
  // including worktree switches, Mobile transitions and StrictMode remounts.
  useLayoutEffect(() => () => disposeReady.current?.(), []);
  const [readyApi, setReadyApi] = useState<DockviewApi | null>(null);
  const [toggleTarget, setToggleTarget] = useState<Element | null>(null);

  const maximizedCaptionGroup = hasWindowChrome
    ? context.maximizedGroup
    : undefined;
  const tablistLabel = context.t("Open tabs");

  // Sync the sidebar toggle, Windows caption regions, and pane ARIA tablists.
  useEffect(() => {
    if (!readyApi) return;
    const node = dockNode.current;
    const update = () => {
      setToggleTarget(syncDockHeaders(node, hasWindowChrome, tablistLabel));
    };
    // Windows owns this gesture. Do not let Dockview arm a group drag whose
    // pointerup will be consumed by the OS window-move loop.
    const captionPointerDown = (event: PointerEvent) => {
      if (
        event.target instanceof Element &&
        event.target.hasAttribute("data-tauri-drag-region")
      )
        event.stopPropagation();
    };
    if (hasWindowChrome)
      node?.addEventListener("pointerdown", captionPointerDown, true);
    const syncTabs = () => syncDockTablistSemantics(node, tablistLabel);
    const layoutListener = readyApi.onDidLayoutChange(update);
    const addGroupListener = readyApi.onDidAddGroup(syncTabs);
    const removeGroupListener = readyApi.onDidRemoveGroup(syncTabs);
    const addPanelListener = readyApi.onDidAddPanel(syncTabs);
    const removePanelListener = readyApi.onDidRemovePanel(syncTabs);
    const activePanelListener = readyApi.onDidActivePanelChange(syncTabs);
    // Observe only tab strip containers (never terminal/file bodies) so Dockview
    // attribute re-writes stay in sync without reacting to pane content updates.
    const tabObserver = new MutationObserver(syncTabs);
    const observeTabStrips = () => {
      tabObserver.disconnect();
      if (!node) return;
      for (const strip of node.querySelectorAll(".dv-tabs-container")) {
        tabObserver.observe(strip, {
          childList: true,
          subtree: true,
          attributes: true,
          attributeFilter: ["role", "aria-selected", "tabindex"],
        });
      }
    };
    const updateAll = () => {
      update();
      observeTabStrips();
    };
    const layoutObserverListener = readyApi.onDidLayoutChange(observeTabStrips);
    const addGroupObserverListener = readyApi.onDidAddGroup(observeTabStrips);
    updateAll();
    return () => {
      layoutListener.dispose();
      addGroupListener.dispose();
      removeGroupListener.dispose();
      addPanelListener.dispose();
      removePanelListener.dispose();
      activePanelListener.dispose();
      layoutObserverListener.dispose();
      addGroupObserverListener.dispose();
      tabObserver.disconnect();
      node?.removeEventListener("pointerdown", captionPointerDown, true);
    };
  }, [readyApi, maximizedCaptionGroup, tablistLabel]);

  const ready = ({ api }: DockviewReadyEvent) => {
    disposeReady.current?.();
    disposeReady.current = onReady(api);
    setReadyApi(api);
  };

  return (
    <DockContext.Provider value={context}>
      <CliIconHost.Provider value={context.hostKey}>
        <div ref={dockNode} className="iori-dock">
          <DockviewReact
            components={dockComponents}
            tabComponents={dockTabComponents}
            defaultTabComponent={DockTabHeader}
            rightHeaderActionsComponent={DockActions}
            defaultRenderer="always"
            dndStrategy="pointer"
            disableFloatingGroups
            disableTabsOverflowList
            theme={dockTheme}
            onReady={ready}
          />
          {toggleTarget &&
            createPortal(
              <div className="order-[-1] flex h-[2.125rem] shrink-0 items-center gap-1 pr-1">
                <SidebarTrigger
                  data-iori-action="sidebar-toggle"
                  aria-label={context.t("Toggle sidebar")}
                />
              </div>,
              toggleTarget,
            )}
        </div>
      </CliIconHost.Provider>
    </DockContext.Provider>
  );
}
