import {
  compareVersions,
  type HostInfo,
  type MaintenancePlan,
} from "@iori/protocol";
import { connection } from "../connection.ts";
import { native } from "../native.ts";
import {
  prepareHostMaintenance,
  performHostMaintenance,
} from "./host-controller.ts";

type Intent = { version: string; hostKeys: string[] };
const scope = "client-update-hosts";

export function connectedHostsToUpdate(version: string): HostInfo[] {
  const state = connection.getSnapshot();
  return state.connectedHosts.flatMap((key) => {
    const host = state.observedHosts[key];
    return host?.version && compareVersions(host.version, version) < 0
      ? [host]
      : [];
  });
}

export function saveConnectedHostUpdate(version: string, hostKeys: string[]) {
  return native.saveView(scope, hostKeys.length ? { version, hostKeys } : null);
}
export const clearConnectedHostUpdate = () => native.saveView(scope, null);

export type ConnectedHostUpdate = {
  host: HostInfo;
  state:
    | "checking"
    | "disconnected"
    | "current"
    | "confirmation"
    | "submitted"
    | "failed";
  plan?: MaintenancePlan;
  error?: string;
};
let items: ConnectedHostUpdate[] = [];
const listeners = new Set<() => void>();
export const connectedHostUpdates = {
  getSnapshot: () => items,
  subscribe: (listener: () => void) => {
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  },
};
function change(key: string, patch: Partial<ConnectedHostUpdate>) {
  items = items.map((item) =>
    item.host.publicKey === key ? { ...item, ...patch } : item,
  );
  for (const listener of listeners) listener();
}
export async function confirmConnectedHostUpdate(key: string) {
  const item = items.find((item) => item.host.publicKey === key);
  if (!item?.plan || item.state !== "confirmation") return;
  change(key, { state: "submitted" });
  const plan = await performHostMaintenance(key, "update", item.plan);
  // The Host rechecks work immediately before submitting the update. A new
  // interruption requires confirmation on this row, never an automatic resend.
  if (plan) change(key, { state: "confirmation", plan });
}
async function checkHost(key: string, version: string) {
  change(key, { state: "checking", error: undefined });
  try {
    const reply = await connection.requestHost(key, "host.info", {});
    if (!reply?.ok) {
      change(key, { state: "disconnected" });
      return;
    }
    // Only the authenticated connection owns the destination key.
    const host = { ...reply.result, publicKey: key };
    change(key, { host });
    if (!host.version || compareVersions(host.version, version) >= 0) {
      change(key, { state: "current" });
      return;
    }
    const plan = await prepareHostMaintenance(key, "update");
    if (plan.error) {
      change(key, { state: "failed", error: plan.error });
      return;
    }
    change(key, { state: "confirmation", plan });
    // Open CLIs and Terminals stop when the Terminal service is replaced; the
    // Version screen warns about that too, so only a Host with nothing to stop
    // updates without a confirmation.
    if (!plan.targets.length && (plan.canContinue || !plan.hasOpenTerminals))
      await confirmConnectedHostUpdate(key);
  } catch {
    change(
      key,
      connection.getSnapshot().connectedHosts.includes(key)
        ? { state: "failed", error: "request" }
        : { state: "disconnected" },
    );
  }
}
let resuming: Promise<void> | undefined;
let targetVersion = "";
// Consume once per launch, including remounts. Closing the dialog does not
// cancel reads or updates already started.
export function resumeConnectedHostUpdate() {
  resuming ??= (async () => {
    const intent = await native.loadView<Intent>(scope);
    if (!intent) return;
    await clearConnectedHostUpdate().catch(() => {});
    const options = await native.updateOptions();
    if (options?.version !== intent.version) return;
    await connection.initialize();
    targetVersion = intent.version;
    const hosts = connection.getSnapshot().initial?.hosts ?? [];
    items = intent.hostKeys.flatMap((key) => {
      const host = hosts.find((host) => host.publicKey === key);
      return host ? [{ host, state: "checking" as const }] : [];
    });
    for (const listener of listeners) listener();
    for (const item of items)
      void checkHost(item.host.publicKey, targetVersion);
  })();
  return resuming;
}
export function watchConnectedHostUpdates() {
  let connected = connection.getSnapshot().connectedHosts;
  return connection.subscribe(() => {
    const previous = connected;
    connected = connection.getSnapshot().connectedHosts;
    for (const item of items) {
      if (
        item.state === "disconnected" &&
        !previous.includes(item.host.publicKey) &&
        connected.includes(item.host.publicKey)
      )
        void checkHost(item.host.publicKey, targetVersion);
    }
  });
}
