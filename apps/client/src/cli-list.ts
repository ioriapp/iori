import { useCallback, useEffect, useMemo, useState, useRef } from "react";
import type { CliListResult, CliSummary } from "@iori/protocol";
import { updateCliIconDefinitions } from "./cli-icon-images.ts";
import { connection } from "./connection.ts";

/** New selections exclude hidden and unavailable CLIs; saved values keep using all. */
export function pickerClis<T extends CliSummary>(clis: T[]): T[] {
  return clis.filter((cli) => !cli.hidden && !cli.missing);
}

/** The Host's CLIs. `list` has the CLIs that can be launched; `all` also
 * has the user's definitions whose command the Host does not find, for the
 * AI agents screen. */
export function useCliList(hostKey: string, revision?: unknown) {
  const [value, setValue] = useState<{
    hostKey: string;
    list: CliListResult;
    error: boolean;
  }>({ hostKey, list: { clis: [] }, error: false });
  const request = useRef(0);
  const versions = useRef(
    new Map<string, { version: string; launchEffort?: boolean }>(),
  );
  const reload = useCallback(
    async (refreshUsage = false) => {
      const currentRequest = ++request.current;
      lastUsed.current = { hostKey: "", id: "" };
      if (!hostKey) return;
      try {
        const response = await connection.requestHost(
          hostKey,
          "cli.list",
          refreshUsage ? { refreshUsage: true } : {},
        );
        if (currentRequest !== request.current) return;
        if (response?.ok) {
          updateCliIconDefinitions(hostKey, response.result.clis);
          setValue({
            hostKey,
            list: {
              ...response.result,
              clis: response.result.clis.map((cli) => {
                const version = versions.current.get(
                  `${hostKey}:${response.result.shell}:${cli.id}`,
                );
                return version ? { ...cli, ...version } : cli;
              }),
              ...(lastUsed.current?.hostKey === hostKey
                ? { lastUsedId: lastUsed.current.id }
                : {}),
            },
            error: false,
          });
        } else
          setValue((current) => ({
            hostKey,
            list: current.hostKey === hostKey ? current.list : { clis: [] },
            error: true,
          }));
      } catch {
        if (currentRequest !== request.current) return;
        setValue((current) => ({
          hostKey,
          list: current.hostKey === hostKey ? current.list : { clis: [] },
          error: true,
        }));
      }
    },
    [hostKey],
  );
  const lastUsed = useRef<{ hostKey: string; id: string }>({
    hostKey: "",
    id: "",
  });
  useEffect(() => {
    const unsubscribe = connection.subscribeHostEvents((eventHost, event) => {
      if (eventHost === hostKey && event.type === "cli.order.changed") {
        const positions = new Map(event.order.map((id, index) => [id, index]));
        setValue((current) =>
          current.hostKey === hostKey
            ? {
                ...current,
                list: {
                  ...current.list,
                  clis: [...current.list.clis].sort(
                    (a, b) =>
                      (positions.get(a.id) ?? event.order.length) -
                      (positions.get(b.id) ?? event.order.length),
                  ),
                },
              }
            : current,
        );
        return;
      }
      if (eventHost === hostKey && event.type === "cli.usage") {
        setValue((current) =>
          current.hostKey === hostKey
            ? {
                ...current,
                list: {
                  ...current.list,
                  clis: current.list.clis.map((cli) =>
                    cli.id === event.cliId
                      ? { ...cli, usage: event.usage }
                      : cli,
                  ),
                },
              }
            : current,
        );
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
      if (
        eventHost !== hostKey ||
        event.type !== "terminal.created" ||
        !event.terminal.cli
      )
        return;
      lastUsed.current = { hostKey, id: event.terminal.cli.id };
      setValue((current) =>
        current.hostKey === hostKey
          ? {
              ...current,
              list: { ...current.list, lastUsedId: event.terminal.cli!.id },
            }
          : current,
      );
    });
    return () => {
      unsubscribe();
    };
  }, [hostKey]);
  useEffect(() => {
    void reload();
    return () => {
      request.current++;
    };
  }, [reload, revision]);
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
  };
}
const empty: CliListResult = { clis: [] };
