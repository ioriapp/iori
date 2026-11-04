import type { DaemonChannel } from "./daemon/channel.ts";
import type { PtyEvent, PtyScreen, SpawnPty } from "./daemon/protocol.ts";
import type { TerminalSnapshot } from "./daemon/types.ts";
type HookPayload = Record<string, unknown>;

type PtyExit = { exitCode: number; signal?: number };
/** Output and an exit that came before the Host listened to the process. */
type Early = { data: string[]; exit?: PtyExit; listened: boolean };

export class RemotePty {
  readonly data = new Set<(data: string) => unknown>();
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
  onData(callback: (data: string) => unknown) {
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
    this.owner.send("write", this.id, data);
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
  kill() {
    void this.owner.kill(this.id).catch(() => {
      console.error("Terminal stop failed");
    });
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
  #spawning = 0;
  constructor(channel: DaemonChannel) {
    this.channel = channel;
  }
  send(method: string, ...args: unknown[]) {
    void this.channel.call(method, ...args).catch(() => {});
  }
  attach(screen: PtyScreen) {
    const process = new RemotePty(
      this,
      screen.id,
      screen.pid,
      this.#unattached.get(screen.pid),
    );
    this.#unattached.delete(screen.pid);
    this.processes.set(screen.id, process);
    this.byPid.set(screen.pid, process);
    return process;
  }
  async spawn(request: SpawnPty) {
    this.#spawning++;
    try {
      const { pid } = await this.channel.call<{ pid: number }>(
        "spawn",
        request,
      );
      return this.attach({ id: request.id, pid } as PtyScreen);
    } finally {
      // Only a spawn in flight can own an unknown pid's output.
      if (--this.#spawning === 0) this.#unattached.clear();
    }
  }
  #early(pid: number): Early | undefined {
    const process = this.byPid.get(pid);
    if (process) return process.early.listened ? undefined : process.early;
    if (!this.#spawning) return undefined;
    let early = this.#unattached.get(pid);
    if (!early)
      this.#unattached.set(pid, (early = { data: [], listened: false }));
    return early;
  }
  async data(pid: number, data: string) {
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
    const process = this.byPid.get(event.pid);
    if (process?.exits.size) {
      for (const listener of [...process.exits]) await listener(event);
      return;
    }
    // An exit before the Host listened waits for its first listener.
    const early = this.#early(event.pid);
    if (early) early.exit = event;
  }
  async kill(id: string) {
    const result = await this.channel.call<
      { exitCode: number; signal?: number } | undefined
    >("kill", id);
    if (result)
      await this.event({
        id,
        kind: "exit",
        pid: this.processes.get(id)!.pid,
        ...result,
      });
  }
  async hook(id: string, callback: (payload: HookPayload) => unknown) {
    this.hooks.set(id, callback);
    const url = await this.channel.call<string>("hookRoute", id);
    return {
      url,
      dispose: () => {
        this.hooks.delete(id);
        this.send("retireHook", id);
      },
    };
  }
  snapshot(id: string, lines?: number) {
    return this.channel.call<TerminalSnapshot>("snapshot", id, lines);
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
