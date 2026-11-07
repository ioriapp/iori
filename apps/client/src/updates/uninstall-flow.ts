import { useMemo, useSyncExternalStore } from "react";
import {
  parseMaintenanceStatus,
  type MaintenancePlan,
  type MaintenanceStatus,
} from "@iori/protocol";
import { connection } from "../connection.ts";
import { native } from "../native.ts";
import type { SshEvent, SshFailure } from "../host-setup/ssh-events.ts";
import type { HostRemoval } from "./host-lifecycle.ts";
import type {
  UninstallFlow,
  UninstallLog,
  UninstallPhase,
  UninstallStep,
} from "./uninstall-flow-types.ts";

type Runtime = {
  plan?: MaintenancePlan;
  destination?: string;
  session?: string;
  status?: MaintenanceStatus;
  reading?: boolean;
  connecting?: boolean;
  forgetting?: boolean;
  timer?: ReturnType<typeof setTimeout>;
};
let flows: Record<string, UninstallFlow> = {};
const runtimes = new Map<string, Runtime>();
const dismissing = new Set<string>();
const listeners = new Set<() => void>();
function publish(key: string, patch: Partial<UninstallFlow>) {
  const flow = flows[key];
  if (!flow) return;
  flows = { ...flows, [key]: { ...flow, ...patch } };
  for (const listener of listeners) listener();
}
function append(key: string, ...log: UninstallLog[]) {
  if (log.length) publish(key, { log: [...flows[key].log, ...log] });
}
function runtime(key: string) {
  return runtimes.get(key);
}
function stopped(status: MaintenanceStatus) {
  return (
    status.phase === "succeeded" ||
    (status.phase === "failed" &&
      ["program", "data"].includes(status.stage ?? ""))
  );
}
function forget(key: string) {
  const run = runtime(key);
  if (!run || run.forgetting) return;
  run.forgetting = true;
  void connection.forgetHost(key).catch(() => {
    run.forgetting = false;
  });
}
async function releaseSession(key: string) {
  const run = runtime(key);
  const session = run?.session;
  if (run) run.session = undefined;
  if (session) await native.sshCancel(session).catch(() => {});
}
function stepFor(stage: string | undefined): UninstallStep {
  return stage === "terminals" || stage === "forge-tokens"
    ? "work"
    : stage === "stop"
      ? "remove"
      : "settings";
}
function applyStatus(key: string, status: MaintenanceStatus) {
  const flow = flows[key];
  const run = runtime(key);
  if (!flow || !run || flow.operationId !== status.operationId) return;
  const previous = run.status;
  if (
    previous &&
    (previous.phase === "succeeded" || previous.phase === "failed") &&
    status.phase !== previous.phase
  )
    return;
  run.status = status;
  const log: UninstallLog[] = [];
  for (const stage of status.completed ?? []) {
    if (!previous?.completed?.includes(stage)) {
      if (stage === "terminals" && run.plan)
        log.push({ kind: "terminalsStopped", count: run.plan.targets.length });
      else log.push({ kind: "stage", stage, done: true });
    }
  }
  if (
    status.stage &&
    status.stage !== previous?.stage &&
    status.phase !== "failed"
  )
    log.push({ kind: "stage", stage: status.stage, done: false });
  let phase: UninstallPhase;
  if (status.phase === "succeeded") {
    phase = {
      type: "done",
      outcome: status.forgeTokensRemaining?.length
        ? {
            type: "tokensRemaining",
            sites: status.forgeTokensRemaining,
            deleteData: !!status.deleteData,
          }
        : { type: status.deleteData ? "uninstalledWithData" : "uninstalled" },
    };
  } else if (stopped(status)) {
    phase = {
      type: "done",
      outcome: {
        type: "filesRemaining",
        paths: status.failedPaths ?? [],
        processes: status.processErrors ?? [],
      },
    };
  } else if (status.phase === "failed") {
    const stage = status.stage ?? "request";
    phase = {
      type: "failed",
      failure: {
        step: stepFor(stage),
        stage,
        osError: status.osError,
        autostartRestored: !status.rollbackFailed?.includes("registration"),
        hooksRestored: !status.rollbackFailed?.includes("hooks"),
        terminalsRestored: !status.rollbackFailed?.includes("terminals"),
      },
    };
    if (previous?.phase !== "failed") {
      log.push({ kind: "error", stage, osError: status.osError });
      for (const rollback of status.rollbackFailed ?? [])
        log.push({ kind: "error", stage: rollback });
    }
  } else if (status.phase === "removing" && flow.route === "remote") {
    phase = { type: "done", outcome: { type: "started" } };
  } else if (flow.phase.type === "sshLost" || flow.phase.type === "sshPrompt") {
    phase = flow.phase;
  } else if (status.phase === "removing") {
    phase = connection.getSnapshot().connectedHosts.includes(key)
      ? { type: "running", step: "remove", completed: ["settings", "work"] }
      : {
          type: "running",
          step: "result",
          completed: ["settings", "work", "remove"],
        };
  } else {
    const step = stepFor(status.stage);
    phase = {
      type: "running",
      step,
      completed: step === "work" ? ["settings"] : [],
    };
  }
  publish(key, { phase, log: [...flow.log, ...log] });
  if (phase.type === "done") forget(key);
  if (phase.type === "done" || phase.type === "failed") {
    clearTimeout(run.timer);
    run.timer = undefined;
    // A receipt is cleaned up before its SSH session is closed by readResult.
    if (!run.reading) void releaseSession(key);
  }
  if (status.phase === "removing") resumeResult(key);
}
async function saveStatus(
  key: string,
  status: MaintenanceStatus,
  apply = true,
) {
  const flow = flows[key];
  const run = runtime(key);
  if (!flow || !run || flow.operationId !== status.operationId) return;
  if (
    run.status &&
    (run.status.phase === "succeeded" || run.status.phase === "failed") &&
    status.phase !== run.status.phase
  )
    return;
  await connection.setRemoval(key, {
    local: flow.route === "local",
    sshDestination: flow.route === "ssh" ? run.destination : undefined,
    hostName: flow.hostName,
    status,
  });
  if (apply && runtime(key) === run) applyStatus(key, status);
}
function sshFailure(error: unknown): SshFailure {
  // native rejects with the same structured failure used by its closed event.
  if (
    error &&
    typeof error === "object" &&
    "kind" in error &&
    "detail" in error
  )
    return error as SshFailure;
  return {
    kind: "disconnected",
    detail: error instanceof Error ? error.message : String(error),
  };
}
async function connectSsh(key: string) {
  const run = runtime(key);
  if (!run?.destination) return false;
  run.connecting = true;
  const session = crypto.randomUUID();
  run.session = session;
  publish(key, { phase: { type: "sshConnecting" } });
  try {
    await native.sshConnect(run.destination, session, "uninstall");
    return runtime(key) === run && run.session === session;
  } catch (error) {
    if (runtime(key) === run && run.session === session) {
      publish(key, {
        phase: {
          type: flows[key].operationId ? "sshLost" : "sshFailed",
          failure: sshFailure(error),
        },
      });
      await releaseSession(key);
    }
    return false;
  } finally {
    run.connecting = false;
  }
}
function resumeResult(key: string) {
  const flow = flows[key];
  const run = runtime(key);
  if (
    !flow ||
    !run ||
    run.status?.phase !== "removing" ||
    flow.route === "remote" ||
    connection.getSnapshot().connectedHosts.includes(key)
  )
    return;
  forget(key);
  if (
    flow.phase.type === "sshLost" ||
    run.connecting ||
    flow.phase.type === "sshPrompt"
  )
    return;
  if (flow.phase.type !== "running" || flow.phase.step !== "result")
    publish(key, {
      phase: {
        type: "running",
        step: "result",
        completed: ["settings", "work", "remove"],
      },
    });
  if (!run.reading && !run.timer) void readResult(key);
}
async function readResult(key: string) {
  const run = runtime(key);
  const flow = flows[key];
  if (!run || !flow || run.reading || !run.status || flow.route === "remote")
    return;
  if (flow.route === "ssh" && (!run.session || !run.status.receiptPath)) return;
  run.reading = true;
  const status = run.status;
  const read = (remove = false) =>
    flow.route === "local"
      ? native.hostUninstallResult(key, status.operationId, remove)
      : native.sshUninstallResult(run.session!, status.receiptPath!, remove);
  try {
    const value = await read();
    if (runtime(key) !== run) return;
    if (value) {
      const result = parseMaintenanceStatus(value);
      await saveStatus(key, result, false);
      if (runtime(key) !== run) return;
      const receiptLog: UninstallLog[] = [];
      if (result.phase === "succeeded" || result.phase === "failed") {
        receiptLog.push({ kind: "stage", stage: "receipt", done: true });
        try {
          await read(true);
        } catch {
          receiptLog.push({ kind: "error", stage: "receipt" });
        }
      }
      if (runtime(key) === run) {
        applyStatus(key, result);
        append(key, ...receiptLog);
      }
    } else if (flows[key].log.at(-1)?.kind !== "receiptMissing")
      append(key, { kind: "receiptMissing" });
  } catch (error) {
    if (runtime(key) !== run) return;
    if (flow.route === "ssh") {
      publish(key, { phase: { type: "sshLost", failure: sshFailure(error) } });
      await releaseSession(key);
    } else {
      // A temporarily unreadable local receipt does not prove uninstall failed.
      if (flows[key].log.at(-1)?.kind !== "receiptMissing")
        append(key, { kind: "receiptMissing" });
    }
  } finally {
    run.reading = false;
    if (runtime(key) === run) {
      const phase = flows[key].phase.type;
      if (phase === "done" || phase === "failed") await releaseSession(key);
      else if (phase === "running" && run.status?.phase === "removing") {
        run.timer = setTimeout(() => {
          run.timer = undefined;
          void readResult(key);
        }, 1000);
      }
    }
  }
}
async function send(key: string) {
  const run = runtime(key);
  const flow = flows[key];
  if (!run?.plan || !flow || flow.operationId) return;
  const operationId = crypto.randomUUID();
  const status: MaintenanceStatus = {
    operationId,
    kind: "uninstall",
    phase: "uninstalling",
    deleteData: flow.deleteData,
    completed: [],
  };
  publish(key, {
    operationId,
    phase: { type: "running", step: "settings", completed: [] },
  });
  try {
    await saveStatus(key, status);
  } catch {
    applyStatus(key, { ...status, phase: "failed", stage: "request" });
    return;
  }
  try {
    const result = await connection.requestHost(
      key,
      "host.uninstall",
      {
        canContinue: run.plan.canContinue,
        targets: run.plan.targets.map((target) => target.id),
        deleteData: flow.deleteData,
      },
      operationId,
    );
    if (runtime(key) !== run) return;
    if (result?.ok) await saveStatus(key, result.result);
    else if (result)
      await saveStatus(key, { ...status, phase: "failed", stage: "request" });
  } catch {
    // A lost reply leaves the operation pending. Reconnection queries it;
    // neither receipt polling nor retry resends the uninstall request.
  }
}
async function loadPlan(key: string) {
  const run = runtime(key);
  if (!run) return;
  publish(key, { phase: { type: "confirming" } });
  try {
    const result = await connection.requestHost(
      key,
      "host.uninstall.prepare",
      {},
    );
    if (runtime(key) !== run) return;
    if (!result?.ok || result.result.error) {
      publish(key, { phase: { type: "confirming", planError: true } });
      return;
    }
    run.plan = result.result;
    publish(key, { phase: { type: "confirming", plan: run.plan } });
  } catch {
    if (runtime(key) === run)
      publish(key, { phase: { type: "confirming", planError: true } });
  }
}
async function discard(key: string) {
  const run = runtime(key);
  if (!run) return;
  clearTimeout(run.timer);
  const session = run.session;
  run.session = undefined;
  dismissing.add(key);
  runtimes.delete(key);
  flows = { ...flows };
  delete flows[key];
  for (const listener of listeners) listener();
  try {
    if (session) await native.sshCancel(session).catch(() => {});
    await connection.clearRemoval(key);
  } finally {
    dismissing.delete(key);
  }
}
export const uninstallFlow = {
  subscribe(listener: () => void) {
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  },
  getSnapshot: () => flows,
  async open(key: string) {
    if (flows[key]) {
      publish(key, { closed: false });
      return;
    }
    const host = connection
      .getSnapshot()
      .initial?.hosts.find((item) => item.publicKey === key);
    if (!host) return;
    const run: Runtime = { destination: host.sshDestination };
    runtimes.set(key, run);
    flows = {
      ...flows,
      [key]: {
        hostKey: key,
        hostName: host.hostName,
        route: host.sshDestination ? "ssh" : "remote",
        deleteData: false,
        phase: { type: "confirming" },
        log: [],
        closed: false,
      },
    };
    publish(key, {});
    const local = await native.hostSetupStatus().catch(() => null);
    if (runtime(key) !== run) return;
    if (local?.host?.publicKey === key) publish(key, { route: "local" });
    await loadPlan(key);
  },
  retryPlan: loadPlan,
  async start(key: string, options: { deleteData: boolean }) {
    const flow = flows[key];
    if (
      !flow ||
      flow.operationId ||
      !runtime(key)?.plan ||
      !["confirming", "sshFailed"].includes(flow.phase.type)
    )
      return;
    publish(key, { deleteData: options.deleteData });
    if (flow.route === "ssh" && !(await connectSsh(key))) return;
    await send(key);
  },
  answerPrompt(key: string, answer: string) {
    const phase = flows[key]?.phase;
    if (phase?.type !== "sshPrompt") return;
    void native.sshAnswer(phase.prompt.id, answer).catch((error) => {
      if (flows[key])
        publish(key, {
          phase: {
            type: flows[key].operationId ? "sshLost" : "sshFailed",
            failure: sshFailure(error),
          },
        });
      void releaseSession(key);
    });
  },
  async startWithoutResult(key: string) {
    const flow = flows[key];
    if (
      !flow ||
      flow.operationId ||
      !(
        flow.phase.type === "sshFailed" ||
        (flow.phase.type === "sshPrompt" && flow.phase.prompt.attempt > 1)
      )
    )
      return;
    await releaseSession(key);
    publish(key, { route: "remote" });
    await send(key);
  },
  async cancel(key: string) {
    const flow = flows[key];
    if (!flow || flow.operationId) return;
    await discard(key);
  },
  async retry(key: string) {
    const flow = flows[key];
    const run = runtime(key);
    if (!flow || !run) return;
    if (flow.phase.type === "failed") {
      await discard(key);
      await uninstallFlow.open(key);
    } else if (flow.phase.type === "sshFailed") {
      await uninstallFlow.start(key, { deleteData: flow.deleteData });
    } else if (flow.phase.type === "sshLost") {
      if (await connectSsh(key)) {
        if (run.status) applyStatus(key, run.status);
        resumeResult(key);
      }
    }
  },
  close(key: string) {
    const phase = flows[key]?.phase.type;
    if (phase === "done" || phase === "failed") void uninstallFlow.dismiss(key);
    else publish(key, { closed: true });
  },
  dismiss(key: string): void {
    void discard(key).catch(() => {});
  },
};
export function useUninstallFlow(key: string) {
  return useSyncExternalStore(uninstallFlow.subscribe, () => flows[key]);
}
export function useUninstallFlows() {
  const snapshot = useSyncExternalStore(
    uninstallFlow.subscribe,
    uninstallFlow.getSnapshot,
  );
  return useMemo(() => Object.values(snapshot), [snapshot]);
}
function restore(key: string, removal: HostRemoval) {
  if (!removal.status || flows[key] || dismissing.has(key)) return;
  const host = connection
    .getSnapshot()
    .initial?.hosts.find((item) => item.publicKey === key);
  runtimes.set(key, { destination: removal.sshDestination });
  flows = {
    ...flows,
    [key]: {
      hostKey: key,
      hostName: removal.hostName ?? host?.hostName ?? key,
      route: removal.local
        ? "local"
        : removal.sshDestination
          ? "ssh"
          : "remote",
      deleteData: !!removal.status.deleteData,
      phase: { type: "running", step: "settings", completed: [] },
      log: [],
      operationId: removal.status.operationId,
      closed: true,
    },
  };
  applyStatus(key, removal.status);
  if (removal.sshDestination && removal.status.phase === "removing") {
    void connectSsh(key).then((connected) => {
      if (connected && runtime(key)?.status)
        applyStatus(key, runtime(key)!.status!);
    });
  }
}
function sshEvent(event: SshEvent) {
  const entry = [...runtimes].find(([, run]) => run.session === event.session);
  if (!entry) return;
  const [key, run] = entry;
  const value = event.value;
  if (value.type === "prompt")
    publish(key, { phase: { type: "sshPrompt", prompt: value.prompt } });
  else if (
    value.type === "promptClosed" &&
    flows[key]?.phase.type === "sshPrompt" &&
    flows[key].phase.prompt.id === value.id
  ) {
    if (run.connecting) publish(key, { phase: { type: "sshConnecting" } });
    else if (run.status) applyStatus(key, run.status);
  } else if (value.type === "output")
    append(key, { kind: "sshOutput", line: value.line });
  else if (value.type === "closed") {
    run.session = undefined;
    const flow = flows[key];
    if (!flow || flow.phase.type === "done" || flow.phase.type === "failed")
      return;
    publish(key, {
      phase: {
        type: flow.operationId ? "sshLost" : "sshFailed",
        failure: value.failure ?? { kind: "disconnected", detail: "" },
      },
    });
    clearTimeout(run.timer);
    run.timer = undefined;
  }
}
export function startUninstallFlows() {
  let disposed = false;
  let stopSsh: (() => void) | undefined;
  void native.onSshSetup(sshEvent).then((stop) => {
    if (disposed) stop();
    else stopSsh = stop;
  });
  const stopEvents = connection.subscribeHostEvents((key, event) => {
    const flow = flows[key];
    if (!flow?.operationId) return;
    if (
      event.type === "host.maintenance.changed" &&
      event.status.kind === "uninstall" &&
      event.status.operationId === flow.operationId
    )
      void saveStatus(key, event.status).catch(() => {});
    else if (event.type === "snapshot" && flow.phase.type !== "done") {
      void connection
        .requestHost(key, "host.maintenance.status", {
          operationId: flow.operationId,
        })
        .then((result) => {
          if (result?.ok && result.result.status)
            return saveStatus(key, result.result.status);
        })
        .catch(() => {});
    }
  });
  const update = () => {
    for (const [key, removal] of Object.entries(
      connection.getSnapshot().removals,
    ))
      restore(key, removal);
    for (const key of runtimes.keys()) resumeResult(key);
  };
  const stopConnection = connection.subscribe(update);
  update();
  return () => {
    disposed = true;
    stopSsh?.();
    stopEvents();
    stopConnection();
    for (const run of runtimes.values()) {
      clearTimeout(run.timer);
      run.timer = undefined;
    }
  };
}
