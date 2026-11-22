import { useCallback, useEffect, useRef, useState } from "react";
import type {
  BoardSummary,
  CliStatus,
  TerminalListResult,
} from "@iori/protocol";
import { connection } from "../connection.ts";

export type MobileBoardsState = {
  boards: Record<string, BoardSummary[]>;
  loading: Record<string, boolean>;
  errors: Record<string, string | undefined>;
  retry: (host?: string) => void;
};

export function useMobileBoards(
  connectedHosts: string[],
  terminalLists: Record<string, TerminalListResult>,
  visible: boolean,
): MobileBoardsState {
  const [boards, setBoards] = useState<Record<string, BoardSummary[]>>({});
  const [loading, setLoading] = useState<Record<string, boolean>>({});
  const [errors, setErrors] = useState<Record<string, string | undefined>>({});
  const [retryTick, setRetryTick] = useState(0);
  const loadedHosts = useRef(new Set<string>());
  const sessions = useRef(new Map<string, { unsupported: boolean }>());
  const terminalStates = useRef(
    new Map<string, Map<string, CliStatus["state"] | undefined>>(),
  );
  const hostsKey = JSON.stringify(connectedHosts);

  // Keep connection-scoped knowledge while Home is unmounted.
  useEffect(() => {
    for (const host of sessions.current.keys()) {
      if (!connectedHosts.includes(host)) {
        sessions.current.delete(host);
        loadedHosts.current.delete(host);
      }
    }
    for (const host of connectedHosts)
      if (!sessions.current.has(host))
        sessions.current.set(host, { unsupported: false });
    setBoards((current) =>
      Object.fromEntries(
        Object.entries(current).filter(([host]) =>
          connectedHosts.includes(host),
        ),
      ),
    );
    setLoading((current) =>
      Object.fromEntries(
        Object.entries(current).filter(([host]) =>
          connectedHosts.includes(host),
        ),
      ),
    );
    setErrors((current) =>
      Object.fromEntries(
        Object.entries(current).filter(([host]) =>
          connectedHosts.includes(host),
        ),
      ),
    );
  }, [hostsKey]);

  // Seed from the existing terminal snapshot, including when Home is hidden.
  // Events update this map immediately, before React renders the new list.
  useEffect(() => {
    for (const [host, list] of Object.entries(terminalLists))
      terminalStates.current.set(
        host,
        new Map(
          list.terminals.map((terminal) => [
            terminal.id,
            terminal.cliStatus?.state,
          ]),
        ),
      );
  }, [terminalLists]);

  useEffect(() => {
    if (!visible) return;
    let active = true;
    const fetching = new Set<string>();
    const changed = new Set<string>();
    const load = async (host: string) => {
      const session = sessions.current.get(host);
      if (!session || session.unsupported) return;
      if (fetching.has(host)) {
        changed.add(host);
        return;
      }
      fetching.add(host);
      if (!loadedHosts.current.has(host)) {
        setLoading((current) =>
          current[host] ? current : { ...current, [host]: true },
        );
      }
      try {
        const result = await connection.requestHost(host, "teams.boards", {});
        if (sessions.current.get(host) !== session) return;
        if (result?.ok) {
          loadedHosts.current.add(host);
          if (active) {
            setBoards((current) => ({
              ...current,
              [host]: result.result.boards,
            }));
            setErrors((current) =>
              current[host] === undefined
                ? current
                : { ...current, [host]: undefined },
            );
          }
        } else if (result?.error.code === "invalid_request") {
          session.unsupported = true;
          loadedHosts.current.delete(host);
          if (active) {
            setBoards((current) =>
              Object.fromEntries(
                Object.entries(current).filter(([key]) => key !== host),
              ),
            );
            setErrors((current) =>
              current[host] === undefined
                ? current
                : { ...current, [host]: undefined },
            );
          }
        } else if (active && !loadedHosts.current.has(host)) {
          setErrors((current) => ({
            ...current,
            [host]: result?.error.code ?? "internal_error",
          }));
        }
      } catch {
        if (active && !loadedHosts.current.has(host)) {
          setErrors((current) => ({
            ...current,
            [host]: "Could not connect to the Host.",
          }));
        }
      } finally {
        fetching.delete(host);
        if (active) {
          setLoading((current) =>
            current[host] ? { ...current, [host]: false } : current,
          );
          if (changed.delete(host)) void load(host);
        }
      }
    };
    const stop = connection.subscribeHostEvents((host, event) => {
      if (!connectedHosts.includes(host)) return;
      if (
        event.type === "terminal.updated" ||
        event.type === "terminal.created"
      ) {
        let states = terminalStates.current.get(host);
        if (!states) terminalStates.current.set(host, (states = new Map()));
        const previous = states.get(event.terminal.id);
        states.set(event.terminal.id, event.terminal.cliStatus?.state);
        if (
          event.type === "terminal.updated" &&
          previous === event.terminal.cliStatus?.state
        )
          return;
      } else if (event.type === "terminal.closed") {
        terminalStates.current.get(host)?.delete(event.terminalId);
      } else if (!event.type.startsWith("teams.")) return;
      void load(host);
    });
    for (const host of connectedHosts) void load(host);
    return () => {
      active = false;
      stop();
    };
  }, [hostsKey, visible, retryTick]);

  const retry = useCallback((host?: string) => {
    setErrors((current) => {
      if (!host) return {};
      if (current[host] === undefined) return current;
      return { ...current, [host]: undefined };
    });
    setRetryTick((count) => count + 1);
  }, []);

  return { boards, loading, errors, retry };
}
