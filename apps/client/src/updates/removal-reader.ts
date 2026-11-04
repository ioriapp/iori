import { parseMaintenanceStatus } from "@iori/protocol";
import { native } from "../native.ts";
import type { ConnectionController } from "../connection.ts";

type ReadState = {
  busy?: boolean;
  error?: string;
  missing?: boolean;
  cleanupFailed?: boolean;
};
type Prompt = {
  id: string;
  session: string;
  text: string;
  notification?: boolean;
};
let state: { hosts: Record<string, ReadState>; prompt?: Prompt } = {
  hosts: {},
};
const listeners = new Set<() => void>();
const attempted = new Set<string>();
const localAttempts = new Map<string, string>();
const timers = new Map<string, ReturnType<typeof setTimeout>>();
let session = "";
export const removalReader = {
  subscribe(listener: () => void) {
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  },
  getSnapshot: () => state,
  dismissCleanupWarnings() {
    state = {
      ...state,
      hosts: Object.fromEntries(
        Object.entries(state.hosts).map(([key, value]) => [
          key,
          { ...value, cleanupFailed: false },
        ]),
      ),
    };
    for (const listener of listeners) listener();
  },
};
function publish(key: string, value: ReadState) {
  state = { ...state, hosts: { ...state.hosts, [key]: value } };
  for (const listener of listeners) listener();
}
function prompt(value?: Prompt) {
  state = { ...state, prompt: value };
  for (const listener of listeners) listener();
}
export async function readRemovalResult(
  connection: ConnectionController,
  key: string,
) {
  const removal = connection.getSnapshot().removals[key];
  if (
    !removal ||
    removal.hidden ||
    removal.status?.phase !== "removing" ||
    state.hosts[key]?.busy
  )
    return;
  if (
    !removal.local &&
    (!removal.sshDestination || !removal.status.receiptPath || session)
  )
    return;
  clearTimeout(timers.get(key));
  timers.delete(key);
  publish(key, { busy: true });
  let sshSession = "";
  try {
    if (!removal.local) {
      sshSession = session = crypto.randomUUID();
      await native.sshConnect(removal.sshDestination!, session);
    }
    const removalStatus = removal.status;
    const read = (remove = false) =>
      removal.local
        ? native.hostUninstallResult(key, removalStatus.operationId, remove)
        : native.sshUninstallResult(
            sshSession,
            removalStatus.receiptPath!,
            remove,
          );
    const value = await read();
    if (value) {
      const status = parseMaintenanceStatus(value);
      await connection.setRemoval(key, { ...removal, status });
      try {
        await read(true);
      } catch {
        publish(key, { busy: true, cleanupFailed: true });
      }
      if (status.phase === "succeeded" && status.deleteData) {
        try {
          await connection.forgetHost(key);
        } catch {
          publish(key, {
            ...state.hosts[key],
            error: "Could not remove this Host from the list. Retry.",
          });
        }
      }
    } else if (!removal.local) publish(key, { busy: true, missing: true });
  } catch {
    publish(key, { error: "Could not read the uninstall result. Retry." });
  } finally {
    if (sshSession) {
      await native.sshCancel(sshSession).catch(() => {});
      session = "";
      prompt();
    }
    publish(key, { ...state.hosts[key], busy: false });
    const current = connection.getSnapshot().removals[key];
    if (
      current?.local &&
      !current.hidden &&
      current.status?.phase === "removing" &&
      !state.hosts[key]?.error
    ) {
      timers.set(
        key,
        setTimeout(() => {
          timers.delete(key);
          void readRemovalResult(connection, key);
        }, 1000),
      );
    }
  }
}
export function startRemovalReader(connection: ConnectionController) {
  void native.onSshSetup(({ session: id, value }) => {
    if (id !== session) return;
    if (value.type === "prompt" && value.id && value.prompt)
      prompt({
        id: value.id,
        session: id,
        text: value.prompt,
        notification: value.notification,
      });
    if (value.type === "promptClosed" && state.prompt?.id === value.id)
      prompt();
  });
  const update = () => {
    const snapshot = connection.getSnapshot();
    for (const key of localAttempts.keys()) {
      const removal = snapshot.removals[key];
      if (!removal || removal.hidden || removal.status?.phase !== "removing") {
        localAttempts.delete(key);
        clearTimeout(timers.get(key));
        timers.delete(key);
      }
    }
    for (const [key, removal] of Object.entries(snapshot.removals)) {
      if (
        removal.hidden ||
        removal.status?.phase !== "removing" ||
        snapshot.connectedHosts.includes(key)
      )
        continue;
      const operation = removal.status.operationId;
      if (removal.local) {
        if (localAttempts.get(key) === operation) continue;
        localAttempts.set(key, operation);
      } else {
        if (attempted.has(operation)) continue;
        attempted.add(operation);
      }
      void readRemovalResult(connection, key);
    }
  };
  connection.subscribe(update);
  update();
}
