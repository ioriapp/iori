import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type MutableRefObject,
} from "react";
import type {
  ChildSummary,
  CliSummary,
  Event as HostEvent,
  FolderHistoryItem,
  HostInfo,
  TerminalEvent,
  TerminalListResult,
} from "@iori/protocol";
import type { ShellStatus } from "../CliLauncher.tsx";
import { connection } from "../connection.ts";
import { hostPathKey, samePath } from "../host-path.ts";
import { useTeamChildren } from "../teams/children.ts";
import type {
  TerminalInputPreferences,
  UpdateTerminalInputPreferences,
} from "../terminal/TerminalPane.tsx";
import {
  applyTerminalEvent,
  type ChildDisplayEntry,
  type WorkspaceFrameProps,
} from "./types.ts";

export function useHostData({
  hosts,
  connectedHosts,
  selectedHostKey,
  defaultShellChange,
  inputPreferences,
  onInputPreferences,
  onMaintenanceClisReader,
  removeTerminalRef,
  onFolderOpened,
}: {
  hosts: HostInfo[];
  connectedHosts: string[];
  selectedHostKey: string;
  defaultShellChange?: { hostKey: string; revision: number };
  inputPreferences?: TerminalInputPreferences;
  onInputPreferences: UpdateTerminalInputPreferences;
  onMaintenanceClisReader: WorkspaceFrameProps["onMaintenanceClisReader"];
  removeTerminalRef: MutableRefObject<
    (hostKey: string, id: string, processExited?: boolean) => void
  >;
  onFolderOpened: (host: HostInfo, folder: FolderHistoryItem) => void;
}) {
  const [terminalLists, setTerminalLists] = useState<
    Record<string, TerminalListResult>
  >({});
  const [terminalStatus, setTerminalStatus] = useState<
    Record<string, ShellStatus>
  >({});
  const [histories, setHistories] = useState<
    Record<string, FolderHistoryItem[]>
  >({});
  const historiesRef = useRef(histories);
  historiesRef.current = histories;
  const [loadedHistoryHosts, setLoadedHistoryHosts] = useState<string[]>([]);
  const [historyError, setHistoryError] = useState<Record<string, string>>({});
  const [removeError, setRemoveError] = useState("");
  const [childErrors, setChildErrors] = useState<Record<string, string>>({});
  const [closedParents, setClosedParents] = useState<
    Record<string, Set<string>>
  >({});

  const pendingSidebarOrders = useRef<Record<string, string[] | undefined>>({});
  const historyRevision = useRef<Record<string, number>>({});
  const historyOverrides = useRef<
    Record<
      string,
      Record<string, { revision: number; folders: FolderHistoryItem[] }>
    >
  >({});
  const terminalRequests = useRef(new Set<string>());
  const terminalEventsDuringLoad = useRef(new Map<string, TerminalEvent[]>());
  const connectedHostsRef = useRef<string[]>([]);

  // Only received Host lists prune saved input; a disconnected Host retains it.
  useEffect(() => {
    onInputPreferences((current) => {
      if (!current.terminals) return current;
      let changed = false;
      const terminals = { ...current.terminals };
      for (const [hostKey, list] of Object.entries(terminalLists)) {
        const saved = terminals[hostKey];
        if (!saved) continue;
        const ids = new Set(list.terminals.map((terminal) => terminal.id));
        const retained = Object.fromEntries(
          Object.entries(saved).filter(([id]) => ids.has(id)),
        );
        if (Object.keys(retained).length === Object.keys(saved).length)
          continue;
        changed = true;
        if (Object.keys(retained).length) terminals[hostKey] = retained;
        else delete terminals[hostKey];
      }
      return changed ? { ...current, terminals } : current;
    });
  }, [terminalLists, inputPreferences, onInputPreferences]);

  const childrenByHost = useTeamChildren(connectedHosts, terminalLists);
  const maintenanceSources = useRef({ terminalLists, childrenByHost });
  maintenanceSources.current = { terminalLists, childrenByHost };
  useEffect(() => {
    onMaintenanceClisReader(() => {
      const { terminalLists, childrenByHost } = maintenanceSources.current;
      const clis: Record<string, Record<string, CliSummary>> = {};
      for (const [host, list] of Object.entries(terminalLists)) {
        clis[host] = Object.fromEntries(
          list.terminals.flatMap((terminal) =>
            terminal.cli ? [[terminal.id, terminal.cli]] : [],
          ),
        );
      }
      for (const [host, children] of Object.entries(childrenByHost)) {
        clis[host] ??= {};
        for (const child of children)
          if (child.terminalId && child.cli)
            clis[host][child.terminalId] = child.cli;
      }
      return clis;
    });
    return () => onMaintenanceClisReader(() => ({}));
  }, [onMaintenanceClisReader]);

  const childTerminalStatuses = useMemo(
    () =>
      Object.fromEntries(
        Object.entries(terminalLists).map(([host, list]) => [
          host,
          new Map(
            list.terminals.map((terminal) => [terminal.id, terminal.cliStatus]),
          ),
        ]),
      ),
    [terminalLists],
  );

  const childDisplay = useMemo<Record<string, ChildDisplayEntry>>(
    () =>
      Object.fromEntries(
        Object.entries(childrenByHost).map(([host, children]) => {
          const byWorktree = new Map<string, ChildSummary[]>();
          const terminalIds = new Set<string>();
          const parentCwds = new Set<string>();
          const childCwds = new Set<string>();
          const displayed = children.map((child) => ({
            ...child,
            cliStatus: childTerminalStatuses[host]?.get(child.terminalId ?? ""),
          }));
          const parents = new Set(
            (terminalLists[host]?.terminals ?? []).map(
              (terminal) => terminal.id,
            ),
          );
          for (const child of displayed) {
            if (child.terminalId) terminalIds.add(child.terminalId);
            if (!parents.has(child.parentTerminalId)) continue;
            parentCwds.add(hostPathKey(child.parentCwd));
            const closed = closedParents[host]?.has(child.parentTerminalId);
            if (
              !closed &&
              !child.worktreeRemoved &&
              child.createdWorktree !== false &&
              child.cwd &&
              !child.repositoryName &&
              !samePath(child.cwd, child.parentCwd)
            )
              childCwds.add(hostPathKey(child.cwd));
            let list = byWorktree.get(hostPathKey(child.parentCwd));
            if (!list)
              byWorktree.set(hostPathKey(child.parentCwd), (list = []));
            list.push(child);
          }
          return [
            host,
            { displayed, byWorktree, terminalIds, parentCwds, childCwds },
          ];
        }),
      ),
    [childrenByHost, childTerminalStatuses, terminalLists, closedParents],
  );

  const childrenFor = (hostKey: string) =>
    childDisplay[hostKey]?.displayed ?? [];

  const stopChild = async (hostKey: string, child: ChildSummary) => {
    try {
      const result = await connection.requestHost(hostKey, "teams.child.stop", {
        childId: child.id,
      });
      setChildErrors((current) => ({
        ...current,
        [child.id]: result?.ok
          ? ""
          : "Could not stop child. Reconnect and retry.",
      }));
    } catch {
      setChildErrors((current) => ({
        ...current,
        [child.id]: "Could not stop child. Reconnect and retry.",
      }));
    }
  };

  const applyTerminalEventFor = useCallback(
    (hostKey: string, event: TerminalEvent) => {
      setTerminalLists((current) => {
        const list = current[hostKey];
        return list
          ? { ...current, [hostKey]: applyTerminalEvent(list, event) }
          : current;
      });
    },
    [],
  );

  const loadTerminals = useCallback(async (hostKey: string) => {
    if (terminalRequests.current.has(hostKey)) return;
    terminalRequests.current.add(hostKey);
    terminalEventsDuringLoad.current.set(hostKey, []);
    setTerminalStatus((current) => ({
      ...current,
      [hostKey]: current[hostKey] === "loaded" ? "loaded" : "loading",
    }));
    try {
      const result = await connection.requestHost(hostKey, "terminal.list", {});
      if (!result?.ok) {
        setTerminalStatus((current) => ({ ...current, [hostKey]: "error" }));
        return;
      }
      const list = (terminalEventsDuringLoad.current.get(hostKey) ?? []).reduce(
        applyTerminalEvent,
        result.result,
      );
      setTerminalLists((current) => ({ ...current, [hostKey]: list }));
      setTerminalStatus((current) => ({ ...current, [hostKey]: "loaded" }));
    } catch {
      setTerminalStatus((current) => ({ ...current, [hostKey]: "error" }));
    } finally {
      terminalRequests.current.delete(hostKey);
      terminalEventsDuringLoad.current.delete(hostKey);
    }
  }, []);

  const refreshHistory = useCallback(async (hostKey: string) => {
    const requestedRevision = historyRevision.current[hostKey] ?? 0;
    try {
      const result = await connection.requestHost(
        hostKey,
        "folders.history",
        {},
      );
      if (!result?.ok) {
        setHistoryError((current) => ({
          ...current,
          [hostKey]: result?.error.code ?? "Could not load folders. Retry.",
        }));
        return;
      }
      setHistoryError((current) => {
        const next = { ...current };
        delete next[hostKey];
        return next;
      });
      let folders = [...result.result.folders];
      for (const [workspacePath, override] of Object.entries(
        historyOverrides.current[hostKey] ?? {},
      )) {
        if (override.revision <= requestedRevision) continue;
        folders = [
          ...override.folders,
          ...folders.filter((folder) => folder.workspacePath !== workspacePath),
        ];
      }
      const pendingOrder = pendingSidebarOrders.current[hostKey];
      if (pendingOrder)
        folders = folders.map((folder) => ({
          ...folder,
          sidebarPosition: pendingOrder.includes(folder.workspacePath)
            ? pendingOrder.indexOf(folder.workspacePath) + 1
            : folder.sidebarPosition,
        }));
      historiesRef.current = { ...historiesRef.current, [hostKey]: folders };
      setHistories((current) => ({ ...current, [hostKey]: folders }));
      setLoadedHistoryHosts((current) =>
        current.includes(hostKey) ? current : [...current, hostKey],
      );
    } catch {
      setHistoryError((current) => ({
        ...current,
        [hostKey]: "Could not load folders. Retry.",
      }));
    }
  }, []);

  const translateEvent = useCallback(
    (hostKey: string, event: HostEvent) => {
      if (
        event.type === "terminal.created" ||
        event.type === "terminal.updated" ||
        event.type === "terminal.closed"
      )
        terminalEventsDuringLoad.current.get(hostKey)?.push(event);
      if (event.type === "folders.changed") {
        void refreshHistory(hostKey);
      } else if (event.type === "worktrees.changed") {
        setHistories((current) => ({
          ...current,
          [hostKey]: (current[hostKey] ?? []).map((folder) =>
            folder.workspacePath === event.repositoryPath
              ? { ...folder, worktrees: event.worktrees }
              : folder,
          ),
        }));
      } else if (event.type === "terminal.closed") {
        removeTerminalRef.current(
          hostKey,
          event.terminalId,
          event.processExited,
        );
      } else if (
        event.type === "terminal.created" ||
        event.type === "terminal.updated"
      ) {
        applyTerminalEventFor(hostKey, event);
      }
    },
    [refreshHistory, applyTerminalEventFor, removeTerminalRef],
  );

  useEffect(() => {
    const unsubscribe = connection.subscribeHostEvents(translateEvent);
    return () => {
      unsubscribe();
    };
  }, [translateEvent]);

  // The folder history is read when a Host connects, and again after a
  // reconnect so changes made while disconnected appear.
  useEffect(() => {
    const before = new Set(connectedHostsRef.current);
    connectedHostsRef.current = connectedHosts;
    for (const hostKey of connectedHosts)
      if (!before.has(hostKey)) {
        void refreshHistory(hostKey);
        void loadTerminals(hostKey);
      }
  }, [connectedHosts, refreshHistory, loadTerminals]);

  // Terminals are read when the Host connects, and again after a reconnect so
  // changes made while disconnected appear.
  const terminalHostConnected = connectedHosts.includes(selectedHostKey);
  useEffect(() => {
    if (selectedHostKey && terminalHostConnected)
      void loadTerminals(selectedHostKey);
  }, [selectedHostKey, terminalHostConnected, loadTerminals]);

  // A new default shell changes the default mark and order of the shells.
  useEffect(() => {
    if (defaultShellChange) void loadTerminals(defaultShellChange.hostKey);
  }, [defaultShellChange, loadTerminals]);

  const allFolders = useMemo(
    () =>
      hosts.flatMap((host) =>
        (histories[host.publicKey] ?? []).map((folder) => ({ host, folder })),
      ),
    [hosts, histories],
  );
  const sidebarFolders = useMemo(
    () => allFolders.filter(({ folder }) => folder.inSidebar),
    [allFolders],
  );

  const openFolder = async (hostKey: string, path: string) => {
    try {
      const result = await connection.requestHost(hostKey, "folders.open", {
        path,
      });
      if (!result?.ok)
        return result?.error.code ?? "Could not open this folder. Retry.";
      const host = hosts.find((item) => item.publicKey === hostKey);
      if (!host) return undefined;
      const folder = result.result.folder;
      const revision = (historyRevision.current[hostKey] ?? 0) + 1;
      historyRevision.current[hostKey] = revision;
      const folders = [
        folder,
        ...(historiesRef.current[hostKey] ?? [])
          .filter((item) => item.path !== folder.path)
          .map((item) =>
            item.workspacePath === folder.workspacePath
              ? { ...item, inSidebar: false }
              : item,
          ),
      ];
      historiesRef.current = { ...historiesRef.current, [hostKey]: folders };
      historyOverrides.current[hostKey] = {
        ...historyOverrides.current[hostKey],
        [folder.workspacePath]: {
          revision,
          folders: folders.filter(
            (item) => item.workspacePath === folder.workspacePath,
          ),
        },
      };
      setHistories((current) => ({ ...current, [hostKey]: folders }));
      onFolderOpened(host, folder);
      return undefined;
    } catch {
      return "Could not open this folder. Retry.";
    }
  };

  const reorderFolders = async (hostKey: string, paths: string[]) => {
    setRemoveError("");
    pendingSidebarOrders.current[hostKey] = paths;
    const folders = (historiesRef.current[hostKey] ?? []).map((folder) => ({
      ...folder,
      sidebarPosition: paths.includes(folder.workspacePath)
        ? paths.indexOf(folder.workspacePath) + 1
        : folder.sidebarPosition,
    }));
    historiesRef.current = { ...historiesRef.current, [hostKey]: folders };
    setHistories((current) => ({ ...current, [hostKey]: folders }));
    try {
      const result = await connection.requestHost(
        hostKey,
        "folders.sidebar.reorder",
        { paths },
      );
      if (!result?.ok) setRemoveError("Could not reorder folders. Retry.");
    } catch {
      setRemoveError("Could not reorder folders. Retry.");
    } finally {
      if (pendingSidebarOrders.current[hostKey] === paths)
        delete pendingSidebarOrders.current[hostKey];
      await refreshHistory(hostKey);
    }
  };

  const removeFromSidebar = async (
    hostKey: string,
    folder: FolderHistoryItem,
  ) => {
    setRemoveError("");
    try {
      const result = await connection.requestHost(
        hostKey,
        "folders.sidebar.remove",
        { path: folder.workspacePath },
      );
      if (!result?.ok) {
        setRemoveError(
          result?.error.code ??
            "Could not remove this folder from the sidebar. Retry.",
        );
        return;
      }
      const revision = (historyRevision.current[hostKey] ?? 0) + 1;
      historyRevision.current[hostKey] = revision;
      const folders = (historiesRef.current[hostKey] ?? []).map((item) =>
        item.workspacePath === folder.workspacePath
          ? { ...item, inSidebar: false }
          : item,
      );
      historiesRef.current = { ...historiesRef.current, [hostKey]: folders };
      historyOverrides.current[hostKey] = {
        ...historyOverrides.current[hostKey],
        [folder.workspacePath]: {
          revision,
          folders: folders.filter(
            (item) => item.workspacePath === folder.workspacePath,
          ),
        },
      };
      setHistories((current) => ({ ...current, [hostKey]: folders }));
    } catch {
      setRemoveError("Could not remove this folder from the sidebar. Retry.");
    }
  };

  return {
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
    closedParents,
    setClosedParents,
  };
}
