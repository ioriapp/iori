import { writeFileAtomic } from "../fs/atomic-write.ts";
import { createHash, randomUUID } from "node:crypto";
import { cp, mkdir, mkdtemp, readFile, writeFile, rm } from "node:fs/promises";
import { watch, type FSWatcher } from "node:fs";
import { join, dirname } from "node:path";
import {
  compareVersions,
  cliWorkState,
  type ChildSummary,
  type ChildWorkState,
  type MaintenanceKind,
  type MaintenancePlan,
  type MaintenanceStatus,
  type TerminalSummary,
} from "@iori/protocol";
import { terminalDaemonCanContinue } from "../terminal/daemon/launch.ts";
import { DAEMON_PROTOCOL } from "../terminal/daemon/protocol.ts";
import { ReleaseSource, ReleaseFailure, type HostRelease } from "./release.ts";

import { removalRequest } from "./uninstall.ts";

export interface MaintenanceService {
  bundle: string;
  unit?: string;
  restart(): Promise<void>;
  prepareUnregister?(
    unit: string | undefined,
    bundle: string,
  ): Promise<{ remove(): Promise<void>; restore(): Promise<void> }>;
  launchRemoval(
    request: Awaited<ReturnType<typeof removalRequest>>,
  ): Promise<void>;
  launchUpdate(
    request: Record<string, unknown>,
    work: string,
  ): Promise<{ exited: Promise<unknown> }>;
}
interface WorkActivity {
  shellActivity(id: string): Promise<{ busy: boolean; command?: string }>;
  child(
    id: string,
  ): Pick<ChildSummary, "state" | "title" | "createdAt"> | undefined;
}
const workOrder: Record<ChildWorkState, number> = {
  running: 0,
  approval: 1,
  question: 2,
};
export class MaintenanceManager {
  readonly instanceId = randomUUID();
  readonly directory: string;
  #watcher?: FSWatcher;
  #active?: MaintenanceStatus;
  #admission: Promise<void> = Promise.resolve();
  #operations = new Map<string, Promise<MaintenanceStatus>>();
  #releases = new Map<string, HostRelease>();
  #ready = Promise.withResolvers<void>();
  waitReady() {
    return this.#ready.promise;
  }
  readonly uninstall?: {
    hostKey: string;
    stopTerminals(): Promise<void>;
    restoreTerminals(): Promise<void>;
    removeHooks(
      registerRestore: (restore: () => Promise<void>) => void,
    ): Promise<void>;
    /** Forge tokens kept in the OS credential store, outside the data folder. */
    removeForgeTokens(): Promise<{ removed: number; remaining: string[] }>;
    cancel(): void;
  };
  readonly storage: string;
  readonly version: string;
  readonly service: MaintenanceService | undefined;
  readonly terminals: () => TerminalSummary[];
  readonly activity: WorkActivity;
  readonly publish: (status: MaintenanceStatus) => void;
  constructor(
    storage: string,
    version: string,
    service: MaintenanceService | undefined,
    terminals: () => TerminalSummary[],
    publish: (status: MaintenanceStatus) => void,
    activity: WorkActivity,
    uninstall?: {
      hostKey: string;
      stopTerminals(): Promise<void>;
      restoreTerminals(): Promise<void>;
      removeHooks(
        registerRestore: (restore: () => Promise<void>) => void,
      ): Promise<void>;
      removeForgeTokens(): Promise<{ removed: number; remaining: string[] }>;
      cancel(): void;
    },
  ) {
    this.activity = activity;
    this.uninstall = uninstall;
    this.storage = storage;
    this.version = version;
    this.service = service;
    if (!service) this.#ready.resolve();
    this.terminals = terminals;
    this.publish = publish;
    this.directory = join(storage, "maintenance");
  }
  async initialize() {
    await mkdir(this.directory, { recursive: true, mode: 0o700 });
    this.#watcher = watch(this.directory, (_, file) => {
      if (!file?.endsWith(".json") || file === "restart.json") return;
      void readFile(join(this.directory, file), "utf8")
        .then(async (text) => {
          const status = JSON.parse(text) as MaintenanceStatus;
          if (
            status.operationId === this.#active?.operationId &&
            (status.phase === "failed" || status.phase === "succeeded")
          ) {
            if (
              status.kind === "uninstall" &&
              status.phase === "failed" &&
              status.stage === "stop"
            ) {
              const restored = await this.#restoreRemoval(status);
              await this.#save(join(this.directory, file), restored);
              return;
            }
            this.#active = undefined;
          }
          this.publish(status);
        })
        .catch(() => {});
    });
  }
  async ready() {
    const pending = (await readFile(
      join(this.directory, "restart.json"),
      "utf8",
    )
      .then(JSON.parse)
      .catch(() => undefined)) as
      | { file: string; status: MaintenanceStatus; instanceId: string }
      | undefined;
    if (pending && pending.instanceId !== this.instanceId) {
      await this.#save(pending.file, { ...pending.status, phase: "succeeded" });
      await rm(join(this.directory, "restart.json"), { force: true });
    }
    this.#ready.resolve();
  }
  close() {
    this.#closed = true;
    this.#watcher?.close();
  }
  #closed = false;
  async #updateExited(file: string, status: MaintenanceStatus) {
    if (this.#closed) return;
    try {
      const result = (await readFile(file, "utf8")
        .then(JSON.parse)
        .catch(() => undefined)) as MaintenanceStatus | undefined;
      if (result?.phase === "failed" || result?.phase === "succeeded") return;
      const failed: MaintenanceStatus = {
        ...status,
        phase: "failed",
        reason: "updater",
      };
      await this.#save(file, failed).catch(() => this.publish(failed));
    } finally {
      if (this.#active?.operationId === status.operationId)
        this.#active = undefined;
    }
  }
  #file(client: string, operationId: string) {
    return join(
      this.directory,
      createHash("sha256")
        .update(JSON.stringify([client, operationId]))
        .digest("hex") + ".json",
    );
  }
  async lookup(
    client: string,
    operationId: string,
  ): Promise<{ status?: MaintenanceStatus }> {
    const status = await readFile(this.#file(client, operationId), "utf8")
      .then((text) => JSON.parse(text) as MaintenanceStatus)
      .catch(() => undefined);
    return status ? { status } : {};
  }
  async #save(file: string, status: MaintenanceStatus) {
    await writeFileAtomic(file, JSON.stringify(status));
    this.publish(status);
    return status;
  }
  async plan(
    kind: MaintenanceKind,
    version?: string,
  ): Promise<MaintenancePlan> {
    let canContinue =
      kind !== "uninstall" && (await terminalDaemonCanContinue(this.storage));
    let error: string | undefined;
    if (!this.service) error = "service";
    if (kind === "update" && this.service && version) {
      try {
        const release = await new ReleaseSource(this.service.bundle).manifest(
          version,
        );
        this.#releases.set(version, release);
        canContinue &&= release.terminalDaemonProtocol === DAEMON_PROTOCOL;
      } catch (failure) {
        error = failure instanceof ReleaseFailure ? failure.reason : "source";
      }
    }
    const open = this.terminals().filter(
      (terminal) => terminal.state === "running",
    );
    const work = canContinue
      ? []
      : await Promise.all(
          open.map(async (terminal) => {
            const child = terminal.teamChild
              ? this.activity.child(terminal.teamChild)
              : undefined;
            const activity = !terminal.cli
              ? await this.activity.shellActivity(terminal.id)
              : undefined;
            const state =
              terminal.setup?.state === "running"
                ? "running"
                : terminal.cli
                  ? cliWorkState(terminal.cliStatus, child)
                  : activity?.busy
                    ? "running"
                    : undefined;
            return state
              ? {
                  id: terminal.id,
                  title: child?.title ?? (terminal.title || terminal.shell),
                  state,
                  ...(activity?.command ? { command: activity.command } : {}),
                  at: child?.createdAt ?? terminal.createdAt,
                }
              : undefined;
          }),
        );
    return {
      ...(version ? { version } : {}),
      canContinue,
      hasOpenTerminals: open.length > 0,
      targets: work
        .filter((item) => item !== undefined)
        .sort((a, b) => workOrder[a.state] - workOrder[b.state] || a.at - b.at)
        .map(({ id, title, state, command }) => ({
          id,
          title,
          state,
          ...(command ? { command } : {}),
        })),
      ...(error ? { error } : {}),
    };
  }

  execute(
    client: string,
    operationId: string,
    kind: MaintenanceKind,
    input: {
      version?: string;
      canContinue: boolean;
      targets: string[];
      deleteData?: boolean;
    },
  ): Promise<MaintenanceStatus> {
    const file = this.#file(client, operationId);
    const pending = this.#operations.get(file);
    if (pending) return pending;
    const operation = this.#admission.then(() =>
      this.#execute(client, operationId, kind, input, file),
    );
    this.#admission = operation.then(
      () => {},
      () => {},
    );
    this.#operations.set(file, operation);
    return operation;
  }
  async #execute(
    client: string,
    operationId: string,
    kind: MaintenanceKind,
    input: {
      version?: string;
      canContinue: boolean;
      targets: string[];
      deleteData?: boolean;
    },
    file: string,
  ): Promise<MaintenanceStatus> {
    const previous = await this.lookup(client, operationId);
    if (previous.status) return previous.status;
    // Only an actual operation running in this process serializes another one.
    // A persisted "installing" record never prevents a new explicit operation.
    if (this.#active) return this.#active;
    const base: MaintenanceStatus = {
      operationId,
      kind,
      phase:
        kind === "uninstall"
          ? "uninstalling"
          : kind === "update"
            ? "downloading"
            : "restarting",
      ...(kind === "uninstall"
        ? { deleteData: input.deleteData!, completed: [] }
        : {}),
      ...(input.version ? { version: input.version } : {}),
    };
    const plan = await this.plan(kind, input.version);
    const release = input.version
      ? this.#releases.get(input.version)
      : undefined;
    if (plan.error)
      return this.#save(file, { ...base, phase: "failed", reason: plan.error });
    if (
      kind === "update" &&
      input.version &&
      compareVersions(input.version, this.version) <= 0
    )
      return this.#save(file, { ...base, phase: "succeeded" });
    const confirmed = new Set(input.targets);
    if (plan.targets.some((target) => !confirmed.has(target.id)))
      return { ...base, phase: "failed", plan };
    this.#active = await this.#save(file, base);
    if (kind === "uninstall") {
      let stage = "prepare-removal";
      this.#removalRollback = [];
      const rollback = this.#removalRollback;
      try {
        const request = await removalRequest(
          this.service!,
          this.storage,
          this.uninstall!.hostKey,
          base,
          file,
        );
        base.receiptPath = request.receipt;
        stage = "hooks";
        await this.uninstall!.removeHooks((restore) =>
          rollback.push({ stage: "hooks", restore }),
        );
        base.completed!.push(stage);
        stage = "registration";
        await this.#save(file, { ...base, stage });
        const registration = await this.service!.prepareUnregister!(
          this.service!.unit,
          this.service!.bundle,
        );
        rollback.push({ stage, restore: registration.restore });
        await registration.remove();
        base.completed!.push(stage);
        stage = "terminals";
        await this.#save(file, { ...base, stage });
        rollback.unshift({
          stage,
          restore: () => this.uninstall!.restoreTerminals(),
        });
        await this.uninstall!.stopTerminals();
        base.completed!.push(stage);
        if (input.deleteData) {
          // A token left behind is shown in the result; the uninstall goes on.
          const tokens = await this.uninstall!.removeForgeTokens();
          if (tokens.removed) base.completed!.push("forge-tokens");
          if (tokens.remaining.length)
            base.forgeTokensRemaining = tokens.remaining;
        }
        stage = "save-removal";
        const status: MaintenanceStatus = { ...base, phase: "removing" };
        this.#removalFile = file;
        this.#removal = { ...request, status };
        this.#active = await this.#save(file, status);
        return this.#active;
      } catch (error) {
        return this.#save(
          file,
          await this.#restoreRemoval({
            ...base,
            phase: "failed",
            reason: "uninstall",
            stage,
            osError: String(
              (error as NodeJS.ErrnoException).code ??
                (error instanceof Error ? error.name : "unknown"),
            ),
          }),
        );
      }
    }
    if (kind === "restart") {
      this.#restartFile = file;
      await writeFile(
        join(this.directory, "restart.json"),
        JSON.stringify({ file, status: base, instanceId: this.instanceId }),
        { mode: 0o600 },
      );
      // The caller sends its response before invoking the deferred service action.
      return base;
    }
    void this.#download(file, base, release!).catch(async () => {
      await this.#save(file, { ...base, phase: "failed", reason: "install" });
      this.#active = undefined;
    });
    return base;
  }
  #removalRollback: { stage: string; restore: () => Promise<void> }[] = [];
  #restoringRemoval?: Promise<MaintenanceStatus>;
  #restoreRemoval(status: MaintenanceStatus): Promise<MaintenanceStatus> {
    if (this.#restoringRemoval) return this.#restoringRemoval;
    const rollback = this.#removalRollback.splice(0).reverse();
    const restoring = (async () => {
      const rollbackFailed: string[] = [];
      for (const entry of rollback) {
        try {
          await entry.restore();
        } catch {
          rollbackFailed.push(entry.stage);
        }
      }
      this.uninstall!.cancel();
      this.#active = undefined;
      this.#removal = undefined;
      return {
        ...status,
        completed: status.completed?.filter(
          (entry) =>
            !rollback.some((item) => item.stage === entry) ||
            rollbackFailed.includes(entry),
        ),
        ...(rollbackFailed.length ? { rollbackFailed } : {}),
      };
    })();
    this.#restoringRemoval = restoring;
    void restoring.finally(() => {
      this.#restoringRemoval = undefined;
    });
    return restoring;
  }
  #removalFile?: string;
  #removal?: Awaited<ReturnType<typeof removalRequest>>;
  async afterResponse(status: MaintenanceStatus) {
    if (
      status.kind === "uninstall" &&
      status === this.#active &&
      this.#removal
    ) {
      const request = this.#removal;
      this.#removal = undefined;
      try {
        await this.service!.launchRemoval(request);
      } catch (error) {
        const failure: MaintenanceStatus = {
          ...status,
          phase: "failed",
          reason: "uninstall",
          stage: "stop",
          osError: String(
            (error as NodeJS.ErrnoException).code ??
              (error instanceof Error ? error.name : "unknown"),
          ),
        };
        await this.#save(
          this.#removalFile!,
          await this.#restoreRemoval(failure),
        );
      }
      return;
    }
    if (
      status.kind !== "restart" ||
      status !== this.#active ||
      status.phase !== "restarting"
    )
      return;
    try {
      await this.service!.restart();
    } catch {
      await this.#save(this.#restartFile!, {
        ...status,
        phase: "failed",
        reason: "restart",
      });
      this.#active = undefined;
    }
  }
  #restartFile?: string;
  async #download(
    file: string,
    status: MaintenanceStatus,
    release: HostRelease,
  ) {
    const service = this.service!;
    const previousFile = join(this.directory, "previous-update.txt");
    const previous = await readFile(previousFile, "utf8").catch((error) => {
      if (error.code !== "ENOENT") throw error;
      return undefined;
    });
    const pendingFile = join(this.directory, "pending-cleanup.txt");
    const pending = (await readFile(pendingFile, "utf8")
      .then(JSON.parse)
      .catch(() => [])) as string[];
    const remaining: string[] = [];
    for (const folder of new Set([
      ...pending,
      ...(previous ? [previous] : []),
    ])) {
      await rm(folder, { recursive: true, force: true }).catch(() => {
        remaining.push(folder);
      });
    }
    await writeFile(pendingFile, JSON.stringify(remaining), { mode: 0o600 });
    const work = await mkdtemp(
      join(dirname(service.bundle), ".iori-host-update-"),
    );
    let stage = "download";
    try {
      let lastPercent = -1;
      const archive = await new ReleaseSource(service.bundle).download(
        release,
        work,
        (received, total) => {
          const percent = Math.floor((received * 100) / total);
          if (percent === lastPercent) return;
          lastPercent = percent;
          this.publish({ ...status, received, total });
        },
      );
      for (const name of [
        "update.mjs",
        "update-linux.mjs",
        "update-windows.mjs",
        "stop-windows.mjs",
        "move-bundle.mjs",
      ])
        await cp(join(service.bundle, name), join(work, name));
      stage = "prepare";
      await cp(
        process.execPath,
        join(work, process.platform === "win32" ? "node.exe" : "node"),
      );
      const installing = await this.#save(file, {
        ...status,
        phase: "installing",
      });
      const request = {
        id: randomUUID(),
        bundle: service.bundle,
        storage: this.storage,
        unit: service.unit,
        archive,
        statusFile: file,
        status: installing,
      };
      await writeFile(join(work, "request.json"), JSON.stringify(request), {
        mode: 0o600,
      });
      const update = await service.launchUpdate(request, work);
      void update.exited.then(() => this.#updateExited(file, installing));
    } catch (error) {
      await writeFile(previousFile, work, { mode: 0o600 });
      await this.#save(file, {
        ...status,
        phase: "failed",
        reason: error instanceof ReleaseFailure ? error.reason : "install",
        stage,
        osError: String((error as NodeJS.ErrnoException).code ?? "unknown"),
      });
      this.#active = undefined;
    }
  }
}
