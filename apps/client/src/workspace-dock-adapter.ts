import type { DockviewApi, SerializedDockview } from "dockview-react";
import type { DockGroup, DropDirection } from "./DockLayout.tsx";
import type { WorkspaceTab } from "./workspace-panel.tsx";
import {
  removeWorkspaceTab,
  type createWorkspaceStore,
} from "./workspace-state.ts";

type Position = { groupId: string; direction: DropDirection };
type Binding = {
  api: DockviewApi;
  scope: string;
  currentScope: () => string;
  dispose?: () => void;
};

/** Only the settled layout can distinguish a closed panel from a relocation. */
export function removedDockTabs(
  candidates: Iterable<string>,
  panelTabIds: ReadonlySet<string>,
) {
  return [...candidates].filter((id) => !panelTabIds.has(id));
}

/** Retarget a Start panel without changing its ID, group, or split geometry. */
export function replaceDockTab(
  layout: SerializedDockview | undefined,
  startId: string,
  tab: WorkspaceTab,
) {
  if (!layout) return layout;
  return {
    ...layout,
    panels: Object.fromEntries(
      Object.entries(layout.panels).map(([id, panel]) => [
        id,
        panel.params?.tabId === startId
          ? {
              ...panel,
              title: tab.title,
              params: { ...panel.params, tabId: tab.id },
            }
          : panel,
      ]),
    ),
  };
}

export function createWorkspaceDockAdapter(
  workspace: ReturnType<typeof createWorkspaceStore>,
) {
  let binding: Binding | undefined;
  let pendingPosition: Position | undefined;
  const tabPanels = (id: string) =>
    binding?.api.panels.filter((panel) => panel.params?.tabId === id) ?? [];
  const select = (id: string) => tabPanels(id)[0]?.api.setActive();
  const sync = () => {
    const api = binding?.api;
    if (!api) return;
    for (const tab of workspace.getSnapshot().tabs) {
      if (tabPanels(tab.id).length) continue;
      const pending = pendingPosition;
      api.addPanel({
        id: tab.id,
        component: "workspace",
        inactive: tab.id !== workspace.getSnapshot().activeTabId,
        title: tab.title,
        params: { tabId: tab.id },
        ...(pending && api.getGroup(pending.groupId)
          ? {
              position: {
                referenceGroup: pending.groupId,
                direction: pending.direction,
              },
            }
          : api.activeGroup
            ? {
                position: {
                  referenceGroup: api.activeGroup.id,
                  direction: "within" as const,
                },
              }
            : {}),
      });
      const panel = api.getPanel(tab.id);
      if (panel)
        for (const empty of [...panel.group.panels])
          if (empty.params?.emptyPane) empty.api.close();
      if (tab.id === workspace.getSnapshot().activeTabId)
        pendingPosition = undefined;
    }
    const active = tabPanels(workspace.getSnapshot().activeTabId)[0];
    if (active && !active.api.isActive) active.api.setActive();
  };
  return {
    get api() {
      return binding?.api ?? null;
    },
    get pendingPosition() {
      return pendingPosition;
    },
    set pendingPosition(position: Position | undefined) {
      pendingPosition = position;
    },
    select,
    sync,
    kindOfGroup: (group: DockGroup) =>
      workspace
        .getSnapshot()
        .tabs.find((tab) => tab.id === group.activePanel?.params?.tabId)
        ?.kind ?? "files",
    restore: (api: DockviewApi, scope: string, currentScope: () => string) => {
      binding?.dispose?.();
      binding = { api, scope, currentScope };
      const layout = workspace.getSnapshot().layout;
      try {
        if (layout) api.fromJSON(layout);
        return true;
      } catch {
        return false;
      }
    },
    clear: () => binding?.api.clear(),
    replaceTab: (startId: string, tab: WorkspaceTab, alreadyOpen: boolean) => {
      for (const panel of tabPanels(startId)) {
        if (alreadyOpen) panel.api.close();
        else {
          panel.api.updateParameters({ tabId: tab.id });
          panel.api.setTitle(tab.title);
        }
      }
      // A Start panel can be replaced before the dock mounts. Its saved panel
      // keeps its place; an already-open Terminal keeps its existing panel.
      if (!alreadyOpen)
        workspace.update((current) => ({
          ...current,
          layout: replaceDockTab(current.layout, startId, tab),
        }));
    },
    move: (id: string, group: DockGroup, direction: DropDirection) => {
      const panel = tabPanels(id)[0];
      const position =
        direction === "within"
          ? "center"
          : direction === "above"
            ? "top"
            : direction === "below"
              ? "bottom"
              : direction;
      panel?.api.moveTo({ group, position });
      panel?.api.setActive();
    },
    close: (
      id: string,
      options: {
        panelId?: string;
        preservePane: boolean;
        onLastPanel?: (groupId: string) => void;
        onPanelClose: (panelId: string) => void;
      },
    ) => {
      const api = binding?.api;
      if (!api) return;
      const { panelId, preservePane } = options;
      const panel = panelId ? api.getPanel(panelId) : undefined;
      const closing = panelId ? (panel ? [panel] : []) : tabPanels(id);
      if (
        !preservePane &&
        options.onLastPanel &&
        closing.length &&
        closing.length === api.panels.length
      ) {
        options.onLastPanel(closing[0].group.id);
        sync();
      }
      if (panelId) {
        options.onPanelClose(panelId);
        api.getPanel(panelId)?.api.close();
        return;
      }
      if (preservePane)
        for (const panel of closing) {
          if (panel.group.panels.every((item) => closing.includes(item)))
            api.addPanel({
              id: `empty:${panel.group.id}`,
              component: "empty",
              tabComponent: "empty",
              params: { emptyPane: true },
              position: { referenceGroup: panel.group.id, direction: "within" },
              inactive: true,
            });
        }
      tabPanels(id).forEach((panel) => panel.api.close());
    },
    refreshOverlays: () => {
      const api = binding?.api;
      api?.layout(api.width, api.height, true);
      for (const panel of api?.panels ?? [])
        if (!panel.api.isVisible)
          panel.group.model.renderContainer.repositionPanelOverlay(panel.id);
    },
    observe: (options: {
      onActive: (id: string) => void;
      onRemoveGroup: (id: string) => void;
    }) => {
      const bound = binding;
      if (!bound) return () => undefined;
      const { api } = bound;
      const current = () =>
        binding === bound && bound.currentScope() === bound.scope;
      const { tabs, mobileClosedTabs: closedTabs = [] } =
        workspace.getSnapshot();
      // Preserve groups whose last tab exited while Dockview was unmounted.
      // A Mobile-only tab may have exited after every saved panel was closed.
      // Keep one place to start again even though that tab had no saved panel.
      const fallbackGroup =
        tabs.length === 0 &&
        closedTabs.some((closed) => closed.preservePane) &&
        !api.panels.some((panel) =>
          closedTabs.some(
            (closed) =>
              closed.preservePane && panel.params?.tabId === closed.id,
          ),
        ) &&
        !api.panels.some((panel) => panel.params?.emptyPane)
          ? (api.activeGroup ?? api.groups[0])
          : undefined;
      for (const group of api.groups) {
        const lastClosed = [...closedTabs]
          .reverse()
          .find((closed) =>
            group.panels.some((panel) => panel.params?.tabId === closed.id),
          );
        if (
          (lastClosed?.preservePane || group === fallbackGroup) &&
          group.panels.every(
            (panel) =>
              !panel.params?.emptyPane &&
              !workspace
                .getSnapshot()
                .tabs.some((tab) => tab.id === panel.params?.tabId),
          )
        )
          api.addPanel({
            id: `empty:${group.id}`,
            component: "empty",
            tabComponent: "empty",
            params: { emptyPane: true },
            position: { referenceGroup: group.id, direction: "within" },
            inactive: true,
          });
      }
      // Tabs closed while the Mobile view was shown leave no panel behind.
      for (const panel of [...api.panels])
        if (
          !panel.params?.emptyPane &&
          !workspace
            .getSnapshot()
            .tabs.some((tab) => tab.id === panel.params?.tabId)
        )
          panel.api.close();
      // Restore and select before subscribing: fromJSON emits the old selection.
      sync();
      const removed = new Set<string>();
      const publishLayout = () => {
        if (!current()) return;
        workspace.update((state) => ({
          ...state,
          layout: api.toJSON(),
          mobileClosedTabs: [],
        }));
      };
      const listeners = [
        api.onDidActivePanelChange(({ panel }) => {
          if (current() && panel?.params?.tabId)
            options.onActive(panel.params.tabId);
        }),
        api.onDidLayoutChange(publishLayout),
        api.onDidRemovePanel((panel) => {
          if (current() && panel.params?.tabId) removed.add(panel.params.tabId);
        }),
        // The public remove/move/group APIs are bracketed by this transaction.
        // Inspect the final panels, never the transient onDidRemovePanel list.
        api.onDidMutateLayout(() => {
          if (!current()) return;
          const ids = new Set(
            api.panels.flatMap((panel) =>
              panel.params?.tabId ? [panel.params.tabId as string] : [],
            ),
          );
          for (const id of removedDockTabs(removed, ids))
            workspace.update((state) => removeWorkspaceTab(state, id));
          removed.clear();
        }),
        api.onDidRemoveGroup((group) => {
          if (current()) options.onRemoveGroup(group.id);
        }),
      ];
      publishLayout();
      const dispose = () => {
        for (const listener of listeners) listener.dispose();
        if (binding === bound) binding = undefined;
      };
      bound.dispose = dispose;
      return dispose;
    },
  };
}
