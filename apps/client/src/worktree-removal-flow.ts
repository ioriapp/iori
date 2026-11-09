import { useSyncExternalStore } from "react";
import type {
  HostInfo,
  WorktreeRemovalItem,
  WorktreeRemovalOutcome,
  WorktreeRemovalPreview,
} from "@iori/protocol";
import { connection } from "./connection.ts";
import { notices } from "./notices.ts";
import { worktreeLabel } from "./workspace-panel.tsx";

export type RemovalFailure = WorktreeRemovalOutcome & { name: string };
export type RemovalTarget = {
  host: HostInfo;
  path: string;
  cleanup: boolean;
  label?: string;
  failures?: RemovalFailure[];
};
type Pending = {
  id: string;
  hostKey: string;
  paths: string[];
  disconnected: boolean;
};
type State = { target?: RemovalTarget; pending: Pending[] };
let state: State = { pending: [] };
const listeners = new Set<() => void>();
function publish(next: State) {
  state = next;
  for (const listener of listeners) listener();
}
export function removalTree(
  items: WorktreeRemovalItem[],
): WorktreeRemovalItem[] {
  return items.flatMap((item) => [item, ...removalTree(item.worktrees)]);
}
export function removalReason(
  failure: WorktreeRemovalOutcome,
  t: (key: string) => string,
): string {
  if (failure.locked)
    return failure.locked.reason
      ? t(
          "Git has locked this worktree (reason: {reason}). Unlock it with git worktree unlock, then try again.",
        ).replace("{reason}", () => failure.locked!.reason!)
      : t(
          "Git has locked this worktree. Unlock it with git worktree unlock, then try again.",
        );
  return t(
    failure.gitOutput ||
      !failure.error ||
      failure.error ===
        "Git refused removal. Check whether the worktree is locked or files are open, then retry."
      ? "Check the Git state, then try again."
      : failure.error,
  );
}
function failedNotice(
  target: RemovalTarget,
  failures: RemovalFailure[],
  t: (key: string) => string,
) {
  if (!failures.length) return;
  const key = `worktree-removal:${crypto.randomUUID()}`;
  const retry = failures.filter((item) => !item.removed);
  const branchOnly = failures.length === 1 && failures[0].removed;
  const title = t(
    failures.length > 1
      ? "Could not delete {count} worktrees"
      : branchOnly
        ? "Could not delete the branch of {name}"
        : "Could not delete {name}",
  );
  notices.show({
    key,
    title: title
      .replace("{count}", String(failures.length))
      .replace("{name}", () => failures[0].name),
    titleName:
      failures.length === 1
        ? { text: failures[0].name, at: title.indexOf("{name}") }
        : undefined,
    text: "",
    items: failures.map((item) => ({
      name: failures.length > 1 ? item.name : undefined,
      reason: item.removed
        ? t("The worktree was deleted. The branch remains.")
        : removalReason(item, t),
      stopped: item.stopped
        ? t("The CLI and Terminal in this worktree were stopped.")
        : undefined,
      gitOutput: item.locked ? undefined : item.gitOutput,
    })),
    persistent: true,
    removalFailure: true,
    action: retry.length
      ? {
          label: t("Retry…"),
          run: () =>
            worktreeRemovalFlow.open({
              ...target,
              path: retry.length === 1 ? retry[0].path : target.path,
              label: retry.length === 1 ? retry[0].name : target.label,
              failures: retry,
            }),
        }
      : undefined,
  });
}

// A disconnect after sending leaves the outcome unknown. Only a fresh Host
// connection releases the local mark; the sidebar then follows Host.removing.
connection.subscribe(() => {
  const connected = connection.getSnapshot().connectedHosts;
  let changed = false;
  const pending = state.pending.flatMap((run) => {
    if (!connected.includes(run.hostKey)) {
      if (run.disconnected) return [run];
      changed = true;
      return [{ ...run, disconnected: true }];
    }
    if (run.disconnected) {
      changed = true;
      return [];
    }
    return [run];
  });
  if (changed) publish({ ...state, pending });
});

export const worktreeRemovalFlow = {
  open(target?: RemovalTarget) {
    publish({ ...state, target });
  },
  async remove({
    target,
    previews,
    paths,
    branches,
    t,
    onRemoved,
  }: {
    target: RemovalTarget;
    previews: WorktreeRemovalPreview[];
    paths: string[];
    branches: string[];
    t: (key: string) => string;
    onRemoved: (paths: string[]) => void;
  }) {
    const requests = previews.filter(
      (preview) =>
        !previews.some(
          (other) =>
            other !== preview &&
            other.items.some(
              (item) =>
                paths.includes(item.path) &&
                removalTree(item.worktrees).some((child) =>
                  preview.items.some((entry) => entry.path === child.path),
                ),
            ),
        ),
    );
    const items = requests.flatMap((preview) =>
      removalTree(preview.items.filter((item) => paths.includes(item.path))),
    );
    const pending: Pending = {
      id: crypto.randomUUID(),
      hostKey: target.host.publicKey,
      paths: items.map((item) => item.path),
      disconnected: false,
    };
    publish({ ...state, pending: [...state.pending, pending] });
    const failure = (error?: string) =>
      items.map((item) => ({
        path: item.path,
        removed: false,
        error,
        name: worktreeLabel(item.branch, item.path, target.path),
      }));
    if (
      !connection.getSnapshot().connectedHosts.includes(target.host.publicKey)
    ) {
      publish({
        ...state,
        pending: state.pending.filter((item) => item.id !== pending.id),
      });
      failedNotice(
        target,
        failure(
          "Could not connect to the Host. Check the connection, then try again.",
        ),
        t,
      );
      return;
    }
    const settle = (paths: string[]) =>
      publish({
        ...state,
        pending: state.pending.flatMap((run) => {
          if (run.id !== pending.id) return [run];
          const remaining = run.paths.filter((path) => !paths.includes(path));
          return remaining.length ? [{ ...run, paths: remaining }] : [];
        }),
      });
    const failures: RemovalFailure[] = [];
    // Each retry preview belongs to one selected row; preserve their order.
    for (const preview of requests) {
      const selected = preview.items.filter((item) =>
        paths.includes(item.path),
      );
      if (!selected.length) continue;
      const selectedItems = removalTree(selected);
      if (
        !connection.getSnapshot().connectedHosts.includes(target.host.publicKey)
      ) {
        const unsent = selectedItems.map((item) => ({
          path: item.path,
          removed: false,
          error:
            "Could not connect to the Host. Check the connection, then try again.",
          name: worktreeLabel(item.branch, item.path, target.path),
        }));
        failures.push(...unsent);
        settle(unsent.map((item) => item.path));
        continue;
      }
      // Reconnection releases marks for requests already sent. A later row in
      // this batch is a new request and needs its own local mark until answered.
      if (!state.pending.some((run) => run.id === pending.id))
        publish({
          ...state,
          pending: [
            ...state.pending,
            {
              ...pending,
              paths: selectedItems.map((item) => item.path),
              disconnected: false,
            },
          ],
        });
      try {
        const response = await connection.requestHost(
          target.host.publicKey,
          "worktrees.remove",
          {
            previewId: preview.id,
            paths: selected.map((item) => item.path),
            branches,
          },
        );
        if (!response) continue;
        if (!response.ok) {
          failures.push(
            ...removalTree(selected).map((item) => ({
              path: item.path,
              removed: false,
              name: worktreeLabel(item.branch, item.path, target.path),
            })),
          );
          settle(selectedItems.map((item) => item.path));
          continue;
        }
        onRemoved(
          response.result.outcomes
            .filter((item) => item.removed)
            .map((item) => item.path),
        );
        failures.push(
          ...response.result.outcomes
            .filter((item) => !item.removed || item.error || item.branchRemains)
            .map((item) => ({
              ...item,
              name: worktreeLabel(
                items.find((entry) => entry.path === item.path)?.branch,
                item.path,
                target.path,
              ),
            })),
        );
        settle(selectedItems.map((item) => item.path));
      } catch {
        // The request may already be executing on the Host. Do not retry or
        // turn an unknown result into a failure.
        continue;
      }
    }
    settle(failures.map((item) => item.path));
    failedNotice(target, failures, t);
  },
};
export function useWorktreeRemovalFlow() {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    () => state,
  );
}
export function locallyRemoving(
  snapshot: State,
  hostKey: string,
  path: string,
) {
  return snapshot.pending.some(
    (run) => run.hostKey === hostKey && run.paths.includes(path),
  );
}
