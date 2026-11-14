import { replaceStartTab } from "./workspace-launch-tabs.ts";
import type { SerializedDockview } from "dockview-react";
import type { WorkspaceTab, WorkspaceViewKind } from "./workspace-panel.tsx";

export type SavedLayout = {
  layout?: SerializedDockview;
  tabs: WorkspaceTab[];
  activeTabId?: string;
  lastTerminalId?: string;
  mobileClosedTabs?: { id: string; preservePane: boolean }[];
  /** Each View's own state (Files' open files, Git's selection, list widths). */
  views?: Record<string, unknown>;
};

/** Logical workspace state; Dockview still owns the live panel placement. */
export type WorkspaceState = SavedLayout & { activeTabId: string };

const viewKinds: WorkspaceViewKind[] = [
  "start",
  "file",
  "files",
  "git",
  "terminal",
  "board",
  "issues",
  "ci",
];

function isObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

// A saved layout is read leniently: entries in an unknown shape are dropped,
// so an old or damaged layout still opens the worktree.
export function readWorkspaceState(value: unknown): WorkspaceState | undefined {
  if (!isObject(value)) return undefined;
  const tabs = Array.isArray(value.tabs)
    ? value.tabs.filter(
        (tab): tab is WorkspaceTab =>
          isObject(tab) &&
          typeof tab.id === "string" &&
          typeof tab.title === "string" &&
          viewKinds.includes(tab.kind as WorkspaceViewKind) &&
          isObject(tab.target) &&
          isObject(tab.target.host) &&
          isObject(tab.target.folder) &&
          isObject(tab.target.worktree),
      )
    : [];
  return {
    // Dockview checks the layout itself; a failure there is caught on load.
    layout: isObject(value.layout)
      ? (value.layout as unknown as SerializedDockview)
      : undefined,
    tabs,
    activeTabId: typeof value.activeTabId === "string" ? value.activeTabId : "",
    lastTerminalId:
      typeof value.lastTerminalId === "string"
        ? value.lastTerminalId
        : undefined,
    mobileClosedTabs: Array.isArray(value.mobileClosedTabs)
      ? value.mobileClosedTabs.filter(
          (entry): entry is { id: string; preservePane: boolean } =>
            isObject(entry) &&
            typeof entry.id === "string" &&
            typeof entry.preservePane === "boolean",
        )
      : undefined,
    views: isObject(value.views) ? value.views : undefined,
  };
}

// A View's state is kept while its tab is open: the tab's first panel, or a
// split panel of the tab.
function openViews(views: Record<string, unknown>, tabs: WorkspaceTab[]) {
  return Object.fromEntries(
    Object.entries(views).filter(([key]) =>
      tabs.some(
        (tab) =>
          key === tab.id ||
          key.startsWith(`${tab.id}:split:`) ||
          key.startsWith(`${tab.id}:reading:`),
      ),
    ),
  );
}

/** Keep the existing workspace:{scopeKey} envelope and only open View states. */
export function writeSavedLayout(state: WorkspaceState): SavedLayout {
  return {
    layout: state.layout,
    mobileClosedTabs: state.mobileClosedTabs,
    tabs: state.tabs,
    activeTabId: state.activeTabId,
    lastTerminalId: state.lastTerminalId,
    views: openViews(state.views ?? {}, state.tabs),
  };
}

/** Opening from another entry point reuses the same logical Terminal tab. */
export function terminalWorkspaceTab(
  state: WorkspaceState,
  hostKey: string,
  terminalId: string,
) {
  return state.tabs.find(
    (tab) =>
      tab.target.host.publicKey === hostKey && tab.terminalId === terminalId,
  );
}

export function addWorkspaceTab(
  state: WorkspaceState,
  tab: WorkspaceTab,
): WorkspaceState {
  if (
    state.tabs.some((existing) => existing.id === tab.id) ||
    (tab.terminalId &&
      terminalWorkspaceTab(state, tab.target.host.publicKey, tab.terminalId))
  )
    return state;
  return { ...state, tabs: [...state.tabs, tab] };
}

export function selectWorkspaceTab(
  state: WorkspaceState,
  id: string,
): WorkspaceState {
  return state.activeTabId === id ? state : { ...state, activeTabId: id };
}

// Dockview selection events still decide which remaining panel becomes active.
export function removeWorkspaceTab(
  state: WorkspaceState,
  id: string,
): WorkspaceState {
  const tabs = state.tabs.filter((tab) => tab.id !== id);
  return tabs.length === state.tabs.length ? state : { ...state, tabs };
}

export function closeWorkspaceTab(
  state: WorkspaceState,
  id: string,
): WorkspaceState {
  const next = removeWorkspaceTab(state, id);
  return next.activeTabId === id ? selectWorkspaceTab(next, "") : next;
}

/** Mobile closes retain the desktop pane's disposition until Dockview returns. */
export function closeMobileWorkspaceTab(
  state: WorkspaceState,
  id: string,
  preservePane: boolean,
): WorkspaceState {
  return closeWorkspaceTab(
    state.layout
      ? {
          ...state,
          mobileClosedTabs: [
            ...(state.mobileClosedTabs ?? []),
            { id, preservePane },
          ],
        }
      : state,
    id,
  );
}

export function setWorkspaceViewState(
  state: WorkspaceState,
  key: string,
  value: unknown,
): WorkspaceState {
  return { ...state, views: { ...state.views, [key]: value } };
}

export function forgetWorkspacePanelState(
  state: WorkspaceState,
  panelId: string,
): WorkspaceState {
  return {
    ...state,
    views: Object.fromEntries(
      Object.entries(state.views ?? {}).filter(
        ([key]) => key !== panelId && !key.startsWith(`${panelId}:reading:`),
      ),
    ),
  };
}

export function rememberWorkspaceTerminal(
  state: WorkspaceState,
  id: string,
): WorkspaceState {
  return state.lastTerminalId === id ? state : { ...state, lastTerminalId: id };
}

export function replaceWorkspaceStartTab(
  state: WorkspaceState,
  startTabId: string,
  tab: WorkspaceTab,
): WorkspaceState {
  const existing = tab.terminalId
    ? terminalWorkspaceTab(state, tab.target.host.publicKey, tab.terminalId)
    : undefined;
  return {
    ...state,
    tabs: replaceStartTab(state.tabs, startTabId, existing ?? tab),
  };
}

export function selectWorkspaceReadingWorktree(
  state: WorkspaceState,
  tabId: string,
  path: string,
): WorkspaceState {
  return {
    ...state,
    tabs: state.tabs.map((tab) =>
      tab.id === tabId
        ? tab.kind === "git"
          ? { ...tab, gitWorktreePath: path }
          : tab.kind === "ci"
            ? { ...tab, ciWorktreePath: path }
            : { ...tab, filesWorktreePath: path }
        : tab,
    ),
  };
}

/** The Host list and tabs must come from the same render's snapshot. */
export function missingWorkspaceTerminals(
  state: Pick<WorkspaceState, "tabs">,
  ids: ReadonlySet<string>,
) {
  return state.tabs.filter(
    (tab) => tab.kind === "terminal" && !ids.has(tab.terminalId ?? ""),
  );
}

/** One synchronous owner, subscribed to by React rather than mirrored in state. */
export function createWorkspaceStore() {
  let state: WorkspaceState = { tabs: [], activeTabId: "" };
  const listeners = new Set<() => void>();
  let onChange: (() => void) | undefined;
  return {
    // This handler belongs to the model, including final View updates while
    // React unmounts it. Replacing it does not add duplicate subscriptions.
    onChange: (handler: () => void) => {
      onChange = handler;
    },
    getSnapshot: () => state,
    subscribe: (listener: () => void) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    update: (change: (current: WorkspaceState) => WorkspaceState) => {
      const next = change(state);
      if (next !== state) {
        state = next;
        for (const listener of listeners) listener();
        onChange?.();
      }
      return state;
    },
  };
}
