import { useEffect, useState } from "react";
import {
  childWorkState,
  type ChildSummary,
  type CliStatus,
  type TerminalListResult,
} from "@iori/protocol";
import { connection } from "../connection.ts";

// The visible list merges the snapshot with events that arrived while it was
// loading. Keep their identities separately for the initial notification seed.
const liveUpdates = new WeakMap<ChildSummary[], Set<string>>();
export function isLiveChildUpdate(children: ChildSummary[], id: string) {
  return liveUpdates.get(children)?.has(id) ?? false;
}

export function useTeamChildren(
  connectedHosts: string[],
  terminals: Record<string, TerminalListResult>,
) {
  const [lists, setLists] = useState<Record<string, ChildSummary[]>>({});
  const scopes = connectedHosts.map((host) => ({
    host,
    conversations: [
      ...new Set(
        (terminals[host]?.terminals ?? []).flatMap((terminal) =>
          terminal.teamConversation && !terminal.teamChild
            ? [terminal.teamConversation]
            : [],
        ),
      ),
    ],
    known: terminals[host] !== undefined,
  }));
  const scopeKey = JSON.stringify(
    scopes.map(({ host, conversations, known }) => [
      host,
      conversations,
      known,
    ]),
  );
  useEffect(() => {
    let active = true;
    const updates = new Map<string, Map<string, ChildSummary>>();
    const snapshots = new Map<string, Map<string, ChildSummary[]>>();
    const pending = new Set<string>();
    const show = (host: string) => {
      const scope = scopes.find((scope) => scope.host === host)!;
      const stored = snapshots.get(host);
      if (!scope.known || scope.conversations.some((id) => !stored?.has(id)))
        return;
      const children = new Map(
        (stored ? [...stored.values()].flat() : []).map((child) => [
          child.id,
          child,
        ]),
      );
      for (const child of updates.get(host)?.values() ?? [])
        children.set(child.id, child);
      setLists((current) => {
        // Keep closed-conversation identities, so retained child terminals do
        // not become ordinary parent rows or trigger fresh list requests.
        const merged = new Map(
          (current[host] ?? []).map((child) => [child.id, child]),
        );
        for (const child of children.values()) merged.set(child.id, child);
        const list = [...merged.values()];
        liveUpdates.set(
          list,
          new Set([
            ...(liveUpdates.get(current[host]) ?? []),
            ...(updates.get(host)?.keys() ?? []),
          ]),
        );
        return { ...current, [host]: list };
      });
    };
    const fetchMissing = (host: string) => {
      const scope = scopes.find((scope) => scope.host === host);
      if (!scope?.known) return;
      if (!snapshots.has(host)) snapshots.set(host, new Map());
      for (const conversation of scope.conversations) {
        const key = JSON.stringify([host, conversation]);
        if (pending.has(key) || snapshots.get(host)!.has(conversation))
          continue;
        pending.add(key);
        void connection
          .requestHost(host, "teams.children", { conversation })
          .then((result) => {
            if (!active || !result?.ok) return;
            snapshots.get(host)!.set(conversation, result.result.children);
            // Events received while fetching win over the older snapshot.
            show(host);
          })
          .catch(() => {})
          .finally(() => pending.delete(key));
      }
    };
    const stop = connection.subscribeHostEvents((host, event) => {
      if (!scopes.some((scope) => scope.host === host)) return;
      if (event.type === "teams.children.removed") {
        const removed = new Set(event.ids);
        for (const id of removed) updates.get(host)?.delete(id);
        for (const [conversation, children] of snapshots.get(host) ?? [])
          snapshots.get(host)!.set(
            conversation,
            children.filter((child) => !removed.has(child.id)),
          );
        setLists((current) => {
          const list = (current[host] ?? []).filter(
            (child) => !removed.has(child.id),
          );
          liveUpdates.set(
            list,
            new Set(
              [...(liveUpdates.get(current[host]) ?? [])].filter(
                (id) => !removed.has(id),
              ),
            ),
          );
          return { ...current, [host]: list };
        });
      }
      if (
        event.type === "teams.child.updated" ||
        event.type === "teams.children"
      ) {
        if (!updates.has(host)) updates.set(host, new Map());
        for (const child of event.type === "teams.child.updated"
          ? [event.child]
          : event.children)
          updates.get(host)!.set(child.id, child);
        show(host);
      }
      // A failed request is retried on a later event, never on a timer.
      fetchMissing(host);
    });
    for (const { host, conversations } of scopes) {
      fetchMissing(host);
      if (!conversations.length) show(host);
    }
    return () => {
      active = false;
      stop();
    };
  }, [scopeKey]);
  return lists;
}
export function childStatus(
  child: Pick<ChildSummary, "state" | "cliStatus" | "waiting" | "stoppedBy">,
): {
  label: string;
  description?: string;
  state: "active" | "waiting" | "stopped" | "done" | "failed";
} {
  if (child.state === "finished")
    return {
      state: "done",
      label: "Finished",
    };
  if (child.state === "stopped")
    return {
      state: "stopped",
      label: "Stopped",
      description: child.stoppedBy
        ? (
            {
              user: "User action",
              parent: "Parent action",
              host_restart: "Host restart",
              parent_exit: "Parent exited",
            } as const
          )[child.stoppedBy]
        : undefined,
    };
  if (child.state === "failed") return { state: "failed", label: "Failed" };
  if (child.state === "starting") return { state: "active", label: "Starting" };
  if (child.state === "waiting")
    return {
      state: "stopped",
      label: "Waiting",
      description:
        child.waiting === "capacity"
          ? "No free slot"
          : "No available candidate",
    };
  const work = childWorkState(child);
  if (work === "approval" || work === "question")
    return {
      state: "waiting",
      label: work === "question" ? "Question" : "Approval",
    };
  if (child.state === "reported" && work !== "running")
    return { state: "done", label: "Reported" };
  if (work === "running")
    return {
      state: "active",
      label: "Running",
      description:
        child.state === "reported" || child.state === "question"
          ? child.state === "reported"
            ? "Reported"
            : "Question"
          : undefined,
    };
  return { state: "active", label: "Running" };
}
export function childCliStatus(child: ChildSummary): CliStatus {
  const status = childStatus(child);
  return {
    state: status.state === "failed" ? "done" : status.state,
    since: child.startedAt ?? 0,
    ...(status.state === "failed" ? { outcome: "failure" } : {}),
  };
}

export function childRank(
  child: Pick<ChildSummary, "state" | "decision">,
): number {
  return (child.state === "reported" && !child.decision) ||
    child.state === "question" ||
    child.state === "failed"
    ? 0
    : child.state === "waiting"
      ? 2
      : 1;
}
