import type { DaemonChannel } from "./daemon/channel.ts";
import type {
  DaemonRpc,
  PtyEvent,
  PtyScreen,
  SpawnPty,
  PtyOutput,
} from "./daemon/protocol.ts";
type HookPayload = Record<string, unknown>;

type PtyExit = { exitCode: number; signal?: number };
/** Output and an exit that came before the Host listened to the process. */
type PendingSpawn = { exit?: Extract<PtyEvent, { kind: "exit" }> };
type Early = { data: PtyOutput[]; exit?: PtyExit; listened: boolean };

export class RemotePty {
  readonly data = new Set<(data: PtyOutput) => unknown>();
  readonly exits = new Set<(event: PtyExit) => unknown>();
  readonly owner: RemotePtys;
  readonly id: string;
  readonly pid: number;
  readonly early: Early;
  constructor(
    owner: RemotePtys,
    id: string,
    pid: number,
    early: Early = { data: [], listened: false },
  ) {
    this.owner = owner;
    this.id = id;
    this.pid = pid;
    this.early = early;
  }
  onData(callback: (data: PtyOutput) => unknown) {
    this.data.add(callback);
    // The first listener gets what came before it, in order; queued listeners
    // keep that order for what comes next.
    if (!this.early.listened) {
      this.early.listened = true;
      for (const data of this.early.data.splice(0)) void callback(data);
    }
    return { dispose: () => this.data.delete(callback) };
  }
  onExit(callback: (event: PtyExit) => unknown) {
    this.exits.add(callback);
    const exit = this.early.exit;
    this.early.exit = undefined;
    if (exit) void callback(exit);
    return { dispose: () => this.exits.delete(callback) };
  }
  write(data: string) {
    return this.owner.channel.call("write", this.id, data);
  }
  resize(cols: number, rows: number) {
    this.owner.send("resize", this.id, cols, rows);
  }
  pause() {
    this.owner.send("pause", this.id);
  }
  resume() {
    this.owner.send("resume", this.id);
  }
}
export class RemotePtys {
  readonly processes = new Map<string, RemotePty>();
  readonly byPid = new Map<number, RemotePty>();
  readonly hooks = new Map<string, (payload: HookPayload) => unknown>();
  readonly locks = new Map<string, Promise<unknown>>();
  readonly channel: DaemonChannel;
  // A spawn's answer and its shell's first output can arrive in one read; the
  // channel hands both over before the answer's continuation attaches the pid.
  readonly #unattached = new Map<number, Early>();
  readonly #spawning = new Map<string, PendingSpawn>();
  constructor(channel: DaemonChannel) {
    this.channel = channel;
  }
  send<K extends keyof DaemonRpc>(
    method: K,
    ...args: Parameters<DaemonRpc[K]>
  ) {
    void this.channel.call(method, ...args).catch(() => {});
  }
  attach(screen: Pick<PtyScreen, "id" | "pid">) {
    const process = new RemotePty(
      this,
      screen.id,
      screen.pid,
      this.#unattached.get(screen.pid),
    );
    this.#unattached.delete(screen.pid);
    this.#forget(screen.id);
    this.processes.set(screen.id, process);
    this.byPid.set(screen.pid, process);
    return process;
  }
  async spawn(request: SpawnPty) {
    const pending: PendingSpawn = {};
    this.#spawning.set(request.id, pending);
    try {
      const { pid } = await this.channel.call("spawn", request);
      const child = this.attach({ id: request.id, pid });
      if (pending.exit?.pid === pid) await this.#exit(child, pending.exit);
      return child;
    } finally {
      this.#spawning.delete(request.id);
      if (!this.#spawning.size) this.#unattached.clear();
    }
  }
  #forget(id: string) {
    const child = this.processes.get(id);
    if (!child) return;
    this.processes.delete(id);
    if (this.byPid.get(child.pid) === child) this.byPid.delete(child.pid);
  }
  dispose() {
    this.processes.clear();
    this.byPid.clear();
    this.hooks.clear();
    this.#unattached.clear();
    this.#spawning.clear();
  }
  #early(pid: number): Early | undefined {
    const process = this.byPid.get(pid);
    if (process) return process.early.listened ? undefined : process.early;
    if (!this.#spawning.size) return undefined;
    let early = this.#unattached.get(pid);
    if (!early)
      this.#unattached.set(pid, (early = { data: [], listened: false }));
    return early;
  }
  async data(pid: number, data: PtyOutput) {
    const early = this.#early(pid);
    if (early) early.data.push(data);
    else
      for (const listener of this.byPid.get(pid)?.data ?? [])
        await listener(data);
  }
  async event(event: PtyEvent) {
    if (event.kind === "hook") {
      await this.hooks.get(event.id)?.(event.payload);
      return;
    }
    const child = this.processes.get(event.id);
    if (child?.pid === event.pid) await this.#exit(child, event);
    else {
      const pending = this.#spawning.get(event.id);
      if (pending) pending.exit = event;
    }
  }
  async #exit(child: RemotePty, event: PtyExit) {
    if (this.processes.get(child.id) === child) this.#forget(child.id);
    const listeners = [...child.exits];
    child.exits.clear();
    if (!listeners.length) child.early.exit = event;
    for (const listener of listeners) await listener(event);
  }
  async kill(id: string) {
    const child = this.processes.get(id);
    const result = await this.channel.call("kill", id);
    if (result && child && this.processes.get(id) === child)
      await this.#exit(child, result);
  }
  async remove(id: string) {
    const child = this.processes.get(id);
    try {
      await this.channel.call("remove", id);
    } finally {
      if (child && this.processes.get(id) === child) this.#forget(id);
    }
  }
  async hook(id: string, callback: (payload: HookPayload) => unknown) {
    this.hooks.set(id, callback);
    let url: string;
    try {
      url = await this.channel.call("hookRoute", id);
    } catch (error) {
      this.hooks.delete(id);
      throw error;
    }
    return {
      url,
      dispose: () => {
        this.hooks.delete(id);
        this.send("retireHook", id);
      },
    };
  }
  snapshot(id: string, lines?: number) {
    return lines === undefined
      ? this.channel.call("snapshot", id)
      : this.channel.call("snapshot", id, lines);
  }
  async frozen<T>(id: string, action: () => Promise<T>): Promise<T> {
    const previous = this.locks.get(id) ?? Promise.resolve();
    const task = previous
      .catch(() => {})
      .then(async () => {
        await this.channel.call("freeze", id);
        try {
          return await action();
        } finally {
          await this.channel.call("thaw", id);
        }
      });
    this.locks.set(id, task);
    try {
      return await task;
    } finally {
      if (this.locks.get(id) === task) this.locks.delete(id);
    }
  }
}
