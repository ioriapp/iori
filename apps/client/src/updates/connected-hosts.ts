import { compareVersions, type HostInfo } from "@iori/protocol";
import { connection } from "../connection.ts";
import { native } from "../native.ts";

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

// Consume once per launch. A cancelled/failed Client install cannot carry the
// request into another, unrelated update.
type ConnectedHostUpdate = { host: HostInfo; error?: string };
let resuming: Promise<Promise<ConnectedHostUpdate | undefined>[]> | undefined;
export function resumeConnectedHostUpdate() {
  resuming ??= (async () => {
    const intent = await native.loadView<Intent>(scope);
    if (!intent) return [];
    await clearConnectedHostUpdate().catch(() => {});
    const options = await native.updateOptions();
    if (options?.version !== intent.version) return [];
    await connection.initialize();
    const hosts = connection.getSnapshot().initial?.hosts ?? [];
    // Start each authenticated read without waiting for another Host. Cache
    // the reads for this launch so remounting does not consume/resend them.
    return intent.hostKeys.flatMap((key) => {
      const known = hosts.find((host) => host.publicKey === key);
      if (!known) return [];
      return [
        (async (): Promise<ConnectedHostUpdate | undefined> => {
          try {
            const reply = await connection.requestHost(key, "host.info", {});
            if (!reply?.ok) return { host: known, error: "request" };
            // The authenticated connection, rather than the remote's claimed
            // publicKey, owns the destination of the later update request.
            const host = { ...reply.result, publicKey: key };
            return host.version &&
              compareVersions(host.version, intent.version) < 0
              ? { host }
              : undefined;
          } catch {
            return { host: known, error: "request" };
          }
        })(),
      ];
    });
  })();
  return resuming;
}
