import { native } from "../native.ts";
import { hostRemoval } from "./host-lifecycle.ts";
import { useSyncExternalStore } from "react";
import {
  compareVersions,
  type HostInfo,
  type MaintenanceKind,
  type MaintenancePlan,
  type MaintenanceStatus,
} from "@iori/protocol";
import release from "../../../../release-version.json";
import source from "../../../../release-source.txt?raw";
import { connection } from "../connection.ts";

export const clientVersion = release.version;
export const hostReleaseNotes = `${source.trim()}/tag/v${clientVersion}`;
export function hostNeedsUpdate(host: HostInfo | undefined) {
  return Boolean(
    host?.version && compareVersions(host.version, clientVersion) < 0,
  );
}
type Operation = {
  status: MaintenanceStatus;
  instanceId?: string;
  sentOn?: string;
};
let operations: Record<string, Operation> = {};
const listeners = new Set<() => void>();
function change(hostKey: string, operation: Operation) {
  const current = operations[hostKey];
  // A ready, reconnected instance is stronger evidence than a late reply from
  // the previous instance. Keep that result when messages cross in flight.
  if (
    current?.status.operationId === operation.status.operationId &&
    current.status.phase === "succeeded"
  )
    return;
  operations = { ...operations, [hostKey]: operation };
  for (const listener of listeners) listener();
}
export function useHostMaintenance(hostKey: string) {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    () => operations[hostKey],
  );
}
export function startHostMaintenance() {
  const stop = connection.subscribeHostEvents((hostKey, event) => {
    const current = operations[hostKey];
    if (
      event.type === "host.maintenance.changed" &&
      event.status.kind === "uninstall"
    ) {
      // Other devices retain their ordinary disconnected state.
      const own = hostRemoval(hostKey);
      if (!own || own.status?.operationId !== event.status.operationId) return;
      void connection
        .setRemoval(hostKey, { ...own, status: event.status })
        .catch(() => {});
    }
    if (event.type === "host.maintenance.changed") {
      change(hostKey, {
        instanceId:
          current?.status.operationId === event.status.operationId
            ? current.instanceId
            : connection.getSnapshot().observedHosts[hostKey]?.instanceId,
        sentOn:
          current?.status.operationId === event.status.operationId
            ? current.sentOn
            : undefined,
        status: event.status,
      });
    } else if (event.type === "snapshot" && current) {
      if (current.status.kind === "uninstall") {
        operations = { ...operations };
        delete operations[hostKey];
        for (const listener of listeners) listener();
        return;
      }
      const { status } = current;
      if (status.phase === "succeeded") return;
      if (
        (status.kind === "update" && event.host.version === status.version) ||
        (status.kind === "restart" &&
          event.host.instanceId &&
          event.host.instanceId !== current.instanceId)
      ) {
        change(hostKey, {
          ...current,
          status: {
            operationId: status.operationId,
            kind: status.kind,
            phase: "succeeded",
            ...(status.version ? { version: status.version } : {}),
          },
        });
        return;
      }
      void connection
        .requestHost(hostKey, "host.maintenance.status", {
          operationId: status.operationId,
        })
        .then((result) => {
          if (
            operations[hostKey]?.status.operationId === status.operationId &&
            result?.ok &&
            result.result.status
          )
            change(hostKey, {
              ...operations[hostKey],
              status: result.result.status,
            });
        })
        .catch(() => {});
    }
  });
  const stopConnection = connection.subscribe(() => {
    for (const [key, removal] of Object.entries(
      connection.getSnapshot().removals,
    )) {
      if (
        removal.status &&
        operations[key]?.status !== removal.status &&
        (!operations[key] ||
          operations[key].status.operationId === removal.status.operationId)
      )
        change(key, { status: removal.status });
    }
    for (const [hostKey, operation] of Object.entries(operations)) {
      if (
        operation.sentOn &&
        (!connection.getSnapshot().connectedHosts.includes(hostKey) ||
          operation.sentOn !== connection.connectionIdOf(hostKey))
      )
        change(hostKey, { ...operation, sentOn: undefined });
    }
  });
  return () => {
    stopConnection();
    stop();
  };
}
export async function prepareHostMaintenance(
  hostKey: string,
  kind: MaintenanceKind,
): Promise<MaintenancePlan> {
  const result =
    kind === "update"
      ? await connection.requestHost(hostKey, "host.update.prepare", {
          version: clientVersion,
        })
      : kind === "uninstall"
        ? await connection.requestHost(hostKey, "host.uninstall.prepare", {})
        : await connection.requestHost(hostKey, "host.restart.prepare", {});
  if (!result?.ok) throw new Error("prepare");
  return result.result;
}
export async function performHostMaintenance(
  hostKey: string,
  kind: MaintenanceKind,
  plan: MaintenancePlan,
  deleteData = false,
) {
  const operationId = crypto.randomUUID();
  const status: MaintenanceStatus = {
    operationId,
    kind,
    phase:
      kind === "uninstall"
        ? "uninstalling"
        : kind === "update"
          ? "downloading"
          : "restarting",
    ...(kind === "uninstall" ? { deleteData, completed: [] } : {}),
    ...(kind === "update" ? { version: clientVersion } : {}),
  };
  const operation = {
    status,
    sentOn: connection.connectionIdOf(hostKey),
    instanceId: connection.getSnapshot().observedHosts[hostKey]?.instanceId,
  };
  if (kind === "uninstall") {
    const local = await native.hostSetupStatus().catch(() => null);
    const host = connection
      .getSnapshot()
      .initial?.hosts.find((item) => item.publicKey === hostKey);
    await connection.setRemoval(hostKey, {
      status,
      local: local?.host?.publicKey === hostKey,
      sshDestination: host?.sshDestination,
    });
  }
  change(hostKey, operation);
  try {
    const input = {
      canContinue: plan.canContinue,
      targets: plan.targets.map((target) => target.id),
    };
    const result =
      kind === "update"
        ? await connection.requestHost(
            hostKey,
            "host.update",
            { ...input, version: clientVersion },
            operationId,
          )
        : kind === "uninstall"
          ? await connection.requestHost(
              hostKey,
              "host.uninstall",
              { ...input, deleteData },
              operationId,
            )
          : await connection.requestHost(
              hostKey,
              "host.restart",
              input,
              operationId,
            );
    if (result?.ok) {
      if (kind === "uninstall") {
        const own = hostRemoval(hostKey)!;
        await connection.setRemoval(hostKey, { ...own, status: result.result });
      }
      change(hostKey, {
        ...operations[hostKey],
        sentOn:
          result.result.operationId === operationId
            ? operations[hostKey]?.sentOn
            : undefined,
        status: result.result,
      });
      return result.result.plan;
    }
    if (result && !result.ok) {
      const failed: MaintenanceStatus = {
        ...status,
        phase: "failed",
        reason: "request",
      };
      if (kind === "uninstall") {
        const own = hostRemoval(hostKey)!;
        await connection.setRemoval(hostKey, { ...own, status: failed });
      }
      change(hostKey, { ...operation, status: failed });
    }
  } catch {
    // A disconnected response is not an operation failure. Reconnection reads
    // the outcome; it never resends the update or restart.
  }
}
