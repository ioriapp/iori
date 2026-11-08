import { hasWindowChrome } from "./native.ts";
import { CliStateDot, CliElapsed } from "./CliStatus.tsx";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import type { DragEvent as ReactDragEvent } from "react";
import { createPortal } from "react-dom";
import {
  ChevronDown,
  Columns2,
  Expand,
  Maximize2,
  Minimize2,
  Plus,
  Rows2,
  X,
  LayoutTemplate,
} from "lucide-react";
import {
  DockviewReact,
  themeDark,
  type DockviewApi,
  type DockviewReadyEvent,
  type IDockviewHeaderActionsProps,
  type IDockviewPanelHeaderProps,
  type IDockviewPanelProps,
} from "dockview-react";
import type { TerminalShell, CliSummary, Team } from "@iori/protocol";
import { Button } from "./components/ui/button.tsx";
import { Tabs, TabsList, TabsTrigger } from "./components/ui/tabs.tsx";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "./components/ui/popover.tsx";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from "./components/ui/context-menu.tsx";
import { SidebarTrigger } from "./components/ui/sidebar.tsx";
import { CliLauncher, type ShellStatus } from "./CliLauncher.tsx";
import {
  focusAfterDockLayout,
  PanelView,
  tabTitle,
  viewIcons,
  type WorkspacePanelRenderer,
  type WorkspaceTab,
  type WorkspaceViewKind,
} from "./workspace-panel.tsx";
import { carriesPath, readPathDrag, type PathDrag } from "./path-drag.ts";
import "./dock.css";
import { CliIcon, CliIconHost } from "./CliIcon.tsx";

export type DockGroup = IDockviewHeaderActionsProps["group"];
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
  readingViews: ("files" | "git" | "board")[];
  openReadingView: (kind: "files" | "git" | "board", groupId: string) => void;
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

// Tab titles keep the first 12 characters; the full title is in the tooltip.
const shortTitle = (title: string) =>
  title.length > 12 ? `${title.slice(0, 12)}…` : title;

function useMaximizedOverlay(panel: IDockviewPanelProps) {
  const { maximizedGroup } = useDock();
  const content = useRef<HTMLDivElement>(null);
  // Panel content lives in Dockview's render overlay; lift it with its group.
  useEffect(() => {
    content.current
      ?.closest(".dv-render-overlay")
      ?.classList.toggle(
        "iori-dock-maximized-overlay",
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
      className="dock-content"
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
  const selected = useSyncExternalStore(
    subscribe,
    () => panel.api.group.activePanel?.id === panel.api.id,
  );
  // The selected tab, with its ×, stays in view in its tab strip, also after
  // the group is resized or tabs grow, are added or removed (fonts load after
  // the first layout). A tab wider than its strip shows its × end.
  // Only the strip scrolls; the work surface never moves.
  useEffect(() => {
    const element = header.current;
    const strip = element?.closest<HTMLElement>(".dv-tabs-container");
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
      for (const tab of strip.children) resized.observe(tab);
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
  return (
    <ContextMenu onOpenChange={setMenuOpen}>
      <ContextMenuTrigger asChild>
        <div
          ref={header}
          className="dock-tab-header"
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
          <Tabs className="dock-tab" value={selected ? panel.api.id : ""}>
            <TabsList variant="line">
              <TabsTrigger
                asChild
                value={panel.api.id}
                data-state={selected ? "active" : "inactive"}
                data-iori-tab-id={tab.id}
                data-iori-tab-kind={tab.kind}
                data-iori-tab-cli={tab.cli?.id}
              >
                <button
                  type="button"
                  title={tab.file?.absolutePath ?? title}
                  aria-label={title}
                  onClick={() => panel.api.setActive()}
                  onDoubleClick={() =>
                    doubleClickMaximize && maximize(panel.api.group)
                  }
                >
                  <span className="dock-tab-leading">
                    <span className="tab-status-slot">
                      <CliStateDot status={tab.cliStatus} t={t} />
                    </span>
                    {tab.cli ? (
                      <CliIcon cli={tab.cli} size={14} />
                    ) : (
                      <Icon size={14} aria-hidden="true" />
                    )}
                  </span>
                  <span className="data-tab-label">{shortTitle(title)}</span>
                  {!tab.childId && <CliElapsed status={tab.cliStatus} />}
                </button>
              </TabsTrigger>
            </TabsList>
          </Tabs>
          <Button
            variant="ghost"
            size="icon-sm"
            className="dock-tab-close"
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
    if (group.group.model.activePanel) dock.split(group.group, direction);
  };
  const maximize = () => {
    setListOpen(false);
    dock.maximize(group.group);
  };
  const maximized = dock.maximizedGroup === group.group.id;
  return (
    <div
      className="dock-actions"
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
          className="new-items-popover"
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
        <PopoverContent className="dock-tab-list" side="bottom" align="end">
          {group.group.panels.map((panel) => {
            const id = panel.params?.tabId as string | undefined;
            const tab = dock.tabs.find((item) => item.id === id);
            if (!tab) return null;
            const Icon = viewIcons[tab.kind];
            return (
              <Button
                key={panel.id}
                variant="ghost"
                className="dock-tab-list-item"
                data-active={group.group.activePanel?.id === panel.id}
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
          <div className="dock-tab-list-actions">
            <Button
              variant="ghost"
              className="dock-tab-list-item"
              data-iori-action="workspace-split-right-list"
              onClick={() => split("right")}
            >
              <Columns2 size={14} />
              {t("Split right")}
            </Button>
            <Button
              variant="ghost"
              className="dock-tab-list-item"
              data-iori-action="workspace-split-below-list"
              onClick={() => split("below")}
            >
              <Rows2 size={14} />
              {t("Split below")}
            </Button>
            {!maximized && (
              <Button
                variant="ghost"
                className="dock-tab-list-item"
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
    () => panel.containerApi.groups.length > 1,
  );
  return (
    <div
      className="dock-empty-pane"
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

  // The sidebar toggle sits at the left end of the top-left tab bar.
  useEffect(() => {
    if (!readyApi) return;
    const update = () => {
      const bars = Array.from(
        dockNode.current?.querySelectorAll(".dv-tabs-and-actions-container") ??
          [],
      ).filter((element) => element.getBoundingClientRect().width > 0);
      bars.sort((a, b) => {
        const x = a.getBoundingClientRect();
        const y = b.getBoundingClientRect();
        return x.top - y.top || x.left - y.left;
      });
      setToggleTarget(bars[0] ?? null);
      if (hasWindowChrome) {
        const topBars = bars.filter(
          (bar) => bar.getBoundingClientRect().top === 0,
        );
        const right = topBars.at(-1);
        for (const bar of bars) {
          bar.classList.toggle("window-caption-right", bar === right);
          const regions = [bar, ...bar.querySelectorAll(".dv-void-container")];
          for (const region of regions) {
            if (topBars.includes(bar))
              region.setAttribute("data-tauri-drag-region", "");
            else region.removeAttribute("data-tauri-drag-region");
          }
        }
      }
    };
    // Windows owns this gesture. Do not let Dockview arm a group drag whose
    // pointerup will be consumed by the OS window-move loop.
    const node = dockNode.current;
    const captionPointerDown = (event: PointerEvent) => {
      if (
        event.target instanceof Element &&
        event.target.hasAttribute("data-tauri-drag-region")
      )
        event.stopPropagation();
    };
    if (hasWindowChrome)
      node?.addEventListener("pointerdown", captionPointerDown, true);
    const listener = readyApi.onDidLayoutChange(update);
    update();
    return () => {
      listener.dispose();
      node?.removeEventListener("pointerdown", captionPointerDown, true);
    };
  }, [readyApi, maximizedCaptionGroup]);

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
              <div className="dock-sidebar-toggle">
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
