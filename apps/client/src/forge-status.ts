import {
  useCallback,
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import type { ForgeStatus } from "@iori/protocol";
import { connection } from "./connection.ts";
import { hostPathKey } from "./host-path.ts";

export const forgeKey = (host: string, path: string) =>
  JSON.stringify([host, path]);

// The last marks the sidebar received, for a View that follows a worktree's marks.
const marks = new Map<string, ForgeStatus>();
export const forgeMark = (host: string, path: string) =>
  marks.get(JSON.stringify([host, hostPathKey(path)]));

export function useForgeStatus(
  targets: { host: string; paths: string[] }[],
  selected: string | undefined,
  selectedHost: string | undefined,
  visible: boolean,
) {
  const state = useSyncExternalStore(
    connection.subscribe,
    connection.getSnapshot,
  );
  const [statuses, setStatuses] = useState<Record<string, ForgeStatus>>({});
  const queues = useRef(new Map<string, Promise<unknown>>());
  const selection = JSON.stringify(
    targets.map((target) => ({
      ...target,
      paths: visible && state.foreground ? target.paths : [],
    })),
  );
  const hosts = JSON.stringify(state.connectedHosts);
  useEffect(() => {
    const stop = connection.subscribeHostEvents((host, event) => {
      if (event.type !== "forge.changed") return;
      marks.set(JSON.stringify([host, hostPathKey(event.path)]), event.status);
      setStatuses((previous) => ({
        ...previous,
        [forgeKey(host, event.path)]: event.status,
      }));
    });
    return () => {
      stop();
    };
  }, []);
  const send = useCallback(
    (host: string, paths: string[], selection?: string) => {
      const next = (queues.current.get(host) ?? Promise.resolve())
        .then(() => {
          if (!connection.getSnapshot().connectedHosts.includes(host)) return;
          return connection.requestHost(host, "forge.watch", {
            paths,
            ...(selection ? { selected: selection } : {}),
          });
        })
        .catch(() => undefined);
      queues.current.set(host, next);
    },
    [],
  );
  useEffect(() => {
    const connected = JSON.parse(hosts) as string[];
    const values = JSON.parse(selection) as typeof targets;
    for (const host of connected)
      send(
        host,
        values.find((value) => value.host === host)?.paths ?? [],
        host === selectedHost ? selected : undefined,
      );
  }, [selection, hosts, selected, selectedHost, send]);
  useEffect(
    () => () => {
      for (const host of connection.getSnapshot().connectedHosts)
        send(host, []);
    },
    [send],
  );
  return statuses;
}
