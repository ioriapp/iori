import { useSyncExternalStore } from "react";
import { uninstallFlow } from "./uninstall-flow.ts";
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
  /** This Client asked for it: only then can "unknown" mean the request was lost. */
  requestedHere?: boolean;
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
    )
      return;
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
        requestedHere:
          current?.status.operationId === event.status.operationId &&
          current.requestedHere,
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
            operations[hostKey]?.status.operationId !== status.operationId ||
            !result?.ok
          )
            return;
          if (result.result.status)
            change(hostKey, {
              ...operations[hostKey],
              status: result.result.status,
            });
          else if (
            operations[hostKey]?.status === status &&
            current.requestedHere &&
            status.phase !== "failed" &&
            event.host.instanceId &&
            event.host.instanceId === current.instanceId
          )
            // A received operation may briefly fail here before its status event arrives.
            change(hostKey, {
              ...operations[hostKey],
              status: { ...status, phase: "failed", reason: "request" },
            });
        })
        .catch(() => {});
    }
  });
  const stopConnection = connection.subscribe(() => {
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
  if (kind === "uninstall") {
    await uninstallFlow.open(hostKey);
    await uninstallFlow.start(hostKey, { deleteData });
    return;
  }
  const operationId = crypto.randomUUID();
  const status: MaintenanceStatus = {
    operationId,
    kind,
    phase: kind === "update" ? "downloading" : "restarting",
    ...(kind === "update" ? { version: clientVersion } : {}),
  };
  const operation = {
    status,
    requestedHere: true,
    sentOn: connection.connectionIdOf(hostKey),
    instanceId: connection.getSnapshot().observedHosts[hostKey]?.instanceId,
  };
  change(hostKey, operation);
  try {
    const input = {
      canContinue: plan.canContinue,
      targets: plan.targets.map((target) => target.id),
      hasOpenTerminals: plan.hasOpenTerminals,
      ...(plan.targets.every((target) => target.generation !== undefined)
        ? {
            generations: Object.fromEntries(
              plan.targets.map((target) => [target.id, target.generation!]),
            ),
          }
        : {}),
    };
    const result =
      kind === "update"
        ? await connection.requestHost(
            hostKey,
            "host.update",
            { ...input, version: clientVersion },
            operationId,
          )
        : await connection.requestHost(
            hostKey,
            "host.restart",
            input,
            operationId,
          );
    if (result?.ok) {
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
      change(hostKey, { ...operation, status: failed });
    }
  } catch {
    // A disconnected response is not an operation failure. Reconnection reads
    // the outcome; it never resends the update or restart.
  }
}
