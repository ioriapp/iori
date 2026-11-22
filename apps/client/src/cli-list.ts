import { useCallback, useEffect, useMemo, useState, useRef } from "react";
import type { CliListResult, CliSummary, Event } from "@iori/protocol";
import { updateCliIconDefinitions } from "./cli-icon-images.ts";
import { connection } from "./connection.ts";
import { refreshUsage as refreshCliUsage } from "./usage/refresh.ts";

/** New selections exclude hidden and unavailable CLIs; saved values keep using all. */
export function pickerClis<T extends CliSummary>(clis: T[]): T[] {
  return clis.filter((cli) => !cli.hidden && !cli.missing);
}

type CliListEvent = Extract<
  Event,
  {
    type:
      | "cli.order.changed"
      | "cli.usage"
      | "cli.hidden.changed"
      | "terminal.created";
  }
>;

function applyChange(list: CliListResult, event: CliListEvent): CliListResult {
  if (event.type === "terminal.created")
    return event.terminal.cli
      ? { ...list, lastUsedId: event.terminal.cli.id }
      : list;
  if (event.type === "cli.order.changed") {
    const positions = new Map(event.order.map((id, index) => [id, index]));
    return {
      ...list,
      clis: [...list.clis].sort(
        (a, b) =>
          (positions.get(a.id) ?? event.order.length) -
          (positions.get(b.id) ?? event.order.length),
      ),
    };
  }
  const fields =
    event.type === "cli.usage"
      ? { usage: event.usage }
      : { hidden: event.hidden };
  return {
    ...list,
    clis: list.clis.map((cli) =>
      cli.id === event.cliId ? { ...cli, ...fields } : cli,
    ),
  };
}

type ListState = {
  hostKey: string;
  list: CliListResult;
  error: boolean;
  pendingChanges?: CliListEvent[];
};
type ListUpdate =
  | { type: "reading" | "failed" }
  | { type: "received"; list: CliListResult }
  | { type: "changed"; event: CliListEvent };

/** Only events received during a scan take precedence over that snapshot. */
export function updateCliList(
  current: ListState,
  hostKey: string,
  update: ListUpdate,
): ListState {
  switch (update.type) {
    case "reading":
      return {
        ...(current.hostKey === hostKey
          ? current
          : { hostKey, list: empty, error: false }),
        pendingChanges: [],
      };
    case "received":
      return {
        hostKey,
        list: (current.pendingChanges ?? []).reduce(applyChange, update.list),
        error: false,
      };
    case "failed":
      return {
        hostKey,
        list: current.hostKey === hostKey ? current.list : empty,
        error: true,
      };
    case "changed":
      if (current.hostKey !== hostKey) return current;
      return {
        ...current,
        list: applyChange(current.list, update.event),
        pendingChanges: current.pendingChanges?.concat(update.event),
      };
  }
}

/** The Host's CLIs. `list` has the CLIs that can be launched; `all` also
 * has the user's definitions whose command the Host does not find, for the
 * AI agents screen. */
export function useCliList(hostKey: string, revision?: unknown) {
  const [value, setValue] = useState<ListState>({
    hostKey,
    list: empty,
    error: false,
  });
  const updateList = useCallback(
    (action: ListUpdate) =>
      setValue((current) => updateCliList(current, hostKey, action)),
    [hostKey],
  );
  // A different Host or revision needs a fresh snapshot. Ignore the old
  // response even if it arrives after the new list has been displayed.
  const request = useMemo<{
    active: boolean;
    refreshUsage?: boolean;
    pending?: Promise<void>;
  }>(() => ({ active: true }), [hostKey, revision]);
  const [loading, setLoading] = useState(false);
  const versions = useRef(
    new Map<string, { version: string; launchEffort?: boolean }>(),
  );
  const read = useCallback(
    async (refreshUsage: boolean) => {
      if (!hostKey) return;
      updateList({ type: "reading" });
      try {
        const response = await connection.requestHost(
          hostKey,
          "cli.list",
          refreshUsage ? { refreshUsage: true } : {},
        );
        if (!request.active) return;
        if (response?.ok) {
          updateCliIconDefinitions(hostKey, response.result.clis);
          updateList({
            type: "received",
            list: {
              ...response.result,
              clis: response.result.clis.map((cli) => ({
                ...cli,
                ...versions.current.get(
                  `${hostKey}:${response.result.shell}:${cli.id}`,
                ),
              })),
            },
          });
        } else updateList({ type: "failed" });
      } catch {
        if (request.active) updateList({ type: "failed" });
      }
    },
    [hostKey, request, updateList],
  );
  const reload = useCallback(
    (refreshUsage = false): Promise<void> => {
      if (!request.active) return Promise.resolve();
      if (!request.pending) {
        setLoading(Boolean(hostKey));
        request.refreshUsage = refreshUsage;
        request.pending = read(refreshUsage).finally(() => {
          request.pending = undefined;
          if (request.active) setLoading(false);
        });
      } else if (refreshUsage && !request.refreshUsage) {
        // The pending list already checks every command. Only usage is missing.
        request.refreshUsage = true;
        void refreshCliUsage(hostKey);
      }
      return request.pending;
    },
    [hostKey, read, request],
  );
  const reloadAfterChange = async () => {
    // A definition saved during a scan may be newer than its snapshot.
    await request.pending;
    await reload();
  };
  const applyHidden = useCallback(
    (cliId: string, hidden: boolean) =>
      updateList({
        type: "changed",
        event: { type: "cli.hidden.changed", cliId, hidden },
      }),
    [updateList],
  );
  useEffect(() => {
    const unsubscribe = connection.subscribeHostEvents((eventHost, event) => {
      if (
        eventHost === hostKey &&
        (event.type === "cli.hidden.changed" ||
          event.type === "cli.order.changed" ||
          event.type === "cli.usage" ||
          (event.type === "terminal.created" && event.terminal.cli))
      ) {
        updateList({ type: "changed", event });
        return;
      }
      if (eventHost === hostKey && event.type === "cli.version") {
        versions.current.set(`${hostKey}:${event.shell}:${event.cliId}`, {
          version: event.version,
          ...(event.launchEffort === undefined
            ? {}
            : { launchEffort: event.launchEffort }),
        });
        setValue((current) =>
          current.hostKey === hostKey && current.list.shell === event.shell
            ? {
                ...current,
                list: {
                  ...current.list,
                  clis: current.list.clis.map((cli) =>
                    cli.id === event.cliId
                      ? {
                          ...cli,
                          version: event.version,
                          ...(event.launchEffort === undefined
                            ? {}
                            : { launchEffort: event.launchEffort }),
                        }
                      : cli,
                  ),
                },
              }
            : current,
        );
        return;
      }
    });
    return () => {
      unsubscribe();
    };
  }, [hostKey, updateList]);
  useEffect(() => {
    request.active = true;
    void reload();
    return () => {
      request.active = false;
    };
  }, [request, reload]);
  const all = value.hostKey === hostKey ? value.list : empty;
  const list = useMemo(
    () =>
      all.clis.some((cli) => cli.missing)
        ? { ...all, clis: all.clis.filter((cli) => !cli.missing) }
        : all,
    [all],
  );
  return {
    list,
    pickers: useMemo(() => ({ ...all, clis: pickerClis(all.clis) }), [all]),
    all,
    error: value.hostKey === hostKey && value.error,
    reload,
    reloadAfterChange,
    loading,
    applyHidden,
  };
}
const empty: CliListResult = { clis: [] };
