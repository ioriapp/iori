import type { TeamList } from "@iori/protocol";
import { connection } from "../connection.ts";

export type TeamsListResponse = Awaited<
  ReturnType<typeof connection.requestHost<"teams.list">>
>;

const inflight = new Map<string, Promise<TeamsListResponse>>();
const listeners = new Map<string, Set<(list: TeamList) => void>>();

/** Subscribe to fresh `teams.list` snapshots fetched for a Host. */
export function subscribeTeamsList(
  hostKey: string,
  listener: (list: TeamList) => void,
): () => void {
  let set = listeners.get(hostKey);
  if (!set) {
    set = new Set();
    listeners.set(hostKey, set);
  }
  set.add(listener);
  return () => {
    set.delete(listener);
    if (set.size === 0) listeners.delete(hostKey);
  };
}

/**
 * Fetch `teams.list` for a Host while deduplicating concurrent in-flight
 * requests to the same Host and broadcasting fresh results to active listeners.
 */
export function requestTeamsList(hostKey: string): Promise<TeamsListResponse> {
  const existing = inflight.get(hostKey);
  if (existing) return existing;
  const promise = connection
    .requestHost(hostKey, "teams.list", {})
    .then((response) => {
      if (response?.ok) {
        const set = listeners.get(hostKey);
        if (set) {
          for (const listener of set) listener(response.result);
        }
      }
      return response;
    })
    .finally(() => {
      if (inflight.get(hostKey) === promise) inflight.delete(hostKey);
    });
  inflight.set(hostKey, promise);
  return promise;
}
