import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type RefObject,
} from "react";
import type { DockviewApi, SerializedDockview } from "dockview-react";
import type { HostInfo, TerminalEvent } from "@iori/protocol";
import { connection } from "../connection.ts";
import { samePath } from "../host-path.ts";
import { issueRepositoryKey } from "../issues/issue-repositories.ts";
import { native } from "../native.ts";
import {
  pruneLayout,
  type LayoutSlot,
  type LayoutSlotKind,
  type WorktreeLayoutTemplate,
} from "../new-worktree-layout.ts";
import { worktreeLayoutDefault } from "../new-worktree-layout-store.ts";
import type { createWorkspaceDockAdapter } from "../workspace-dock-adapter.ts";
import {
  initialTabTitle,
  type WorkspaceTab,
  type WorkspaceTarget,
} from "../workspace-panel.tsx";
import {
  readWorkspaceState,
  writeSavedLayout,
  type createWorkspaceStore,
  type SavedLayout,
} from "../workspace-state.ts";
import { activeDockPanelId } from "./dock-adapter.ts";
import {
  defaultTabsForTarget,
  terminalTabId,
  type AttentionRequest,
} from "./types.ts";

export function useWorkspaceLayout({
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
  onScopeChange,
  onRemoveGroup,
}: {
  workspace: ReturnType<typeof createWorkspaceStore>;
  dock: ReturnType<typeof createWorkspaceDockAdapter>;
  scope: string;
  selectedTarget?: WorkspaceTarget;
  displayTabsRef: RefObject<WorkspaceTab[]>;
  tabs: WorkspaceTab[];
  activeTabId: string;
  isMobile: boolean;
  nativeMobile: boolean;
  teamsHost?: HostInfo;
  issueRepositories: Record<string, unknown>;
  startingAttentionRef: RefObject<AttentionRequest | undefined>;
  applyTerminalEventFor: (hostKey: string, event: TerminalEvent) => void;
  activateTab: (id: string) => void;
  onScopeChange: () => void;
  onRemoveGroup: (id: string) => void;
}) {
  const [layoutLoading, setLayoutLoading] = useState(false);
  const [loadedLayoutScope, setLoadedLayoutScope] = useState("");
  const [layoutErrors, setLayoutErrors] = useState<
    Record<string, "load" | "save">
  >({});

  const layoutScope = useRef("");
  const layoutSaved = useRef(false);
  const saveQueue = useRef<Promise<void>>(Promise.resolve());
  const pendingLayoutSaves = useRef<Record<string, SavedLayout>>({});
  // Worktrees whose most recent save failed; only they show the save failure.
  const failedLayoutSaves = useRef(new Set<string>());
  // Panels closed by the user; the save a closing View sends is not kept.
  const closedPanels = useRef(new Set<string>());
  const nativeMobileRef = useRef(nativeMobile);
  nativeMobileRef.current = nativeMobile;
  const templateApplied = useRef(false);
  const templateAgentPanel = useRef<string>(undefined);
  const issueRepositoriesRef = useRef(issueRepositories);
  issueRepositoriesRef.current = issueRepositories;
  const onScopeChangeRef = useRef(onScopeChange);
  onScopeChangeRef.current = onScopeChange;

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
          !saved && target ? defaultTabsForTarget(target, mobile) : [];
        let templateLayout: SerializedDockview | undefined;
        let templateActive: string | undefined;
        if (!saved && target && !mobile && !nativeMobileRef.current) {
          const template = await worktreeLayoutDefault.load();
          if (layoutScope.current !== targetScope) return;
          if (template) {
            const attention = startingAttentionRef.current;
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
                  applyTerminalEventFor(target.host.publicKey, {
                    type: "terminal.created",
                    terminal,
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
    [applyTerminalEventFor, startingAttentionRef, workspace],
  );

  useEffect(() => {
    layoutScope.current = scope;
    layoutSaved.current = false;
    onScopeChangeRef.current();
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
        const restored = defaultTabsForTarget(selectedTarget, false);
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
      onRemoveGroup,
    });
  };

  useEffect(() => {
    if (!dock.api || isMobile || layoutLoading || loadedLayoutScope !== scope)
      return;
    dock.sync();
  }, [
    tabs,
    activeTabId,
    dock,
    layoutLoading,
    isMobile,
    loadedLayoutScope,
    scope,
  ]);

  const saveTemplateRef =
    useRef<() => WorktreeLayoutTemplate | undefined>(undefined);
  saveTemplateRef.current = () => {
    const layout = dock.api?.toJSON();
    if (!layout) return;
    const displayTabs = displayTabsRef.current;
    const candidates = displayTabs.filter(
      (tab) => tab.kind === "terminal" && tab.cli && !tab.childId,
    );
    const agent =
      candidates[0] ?? displayTabs.find((tab) => tab.kind === "start");
    const slots: LayoutSlot[] = [];
    const mapped = new Map<string, string>();
    const seen = new Set<string>();
    for (const panel of Object.values(layout.panels)) {
      const tab = displayTabs.find((item) => item.id === panel.params?.tabId);
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
    const activePanel = activeDockPanelId(dock.api);
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
          !nativeMobile &&
          !teamsHost &&
          !layoutLoading &&
          loadedLayoutScope === scope
          ? () => saveTemplateRef.current?.()
          : undefined,
      ),
    [
      selectedTarget,
      isMobile,
      nativeMobile,
      teamsHost,
      layoutLoading,
      loadedLayoutScope,
      scope,
    ],
  );

  return {
    layoutScope,
    layoutLoading,
    loadedLayoutScope,
    layoutErrors,
    closedPanels,
    loadTargetLayout,
    retryLayoutSave,
    discardLayout,
    onDockReady,
  };
}
