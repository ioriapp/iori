import type { TeamStallReason } from "@iori/protocol";
import { stoppedDescendantPidsByRoot } from "./stopped-descendants.ts";
import type { TerminalSession } from "./terminal-session.ts";
const DEFAULT_STALL_MS = 120_000;
const DEFAULT_STALL_POLL_MS = 5_000;

function stallTiming(): { stallMs: number; pollMs: number } {
  const raw = process.env.IORI_TEST_STALL_MS;
  const parsed = raw ? Number(raw) : NaN;
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return { stallMs: DEFAULT_STALL_MS, pollMs: DEFAULT_STALL_POLL_MS };
  }
  return {
    stallMs: parsed,
    pollMs: Math.max(
      20,
      Math.min(DEFAULT_STALL_POLL_MS, Math.floor(parsed / 4)),
    ),
  };
}

function watchesForStall(runtime: TerminalSession) {
  return (
    !runtime.stopped &&
    !runtime.ptyExited &&
    !runtime.setup &&
    runtime.pty &&
    runtime.cli &&
    (runtime.cliStatus?.state === "active" ||
      (!runtime.cliStatus && runtime.teamOptions)) &&
    runtime.cliStatus?.stalledSince === undefined
  );
}

type Stalled = { id: string; since: number; reason: TeamStallReason }[];
export class CliStallMonitor {
  readonly #sessions: ReadonlyMap<string, TerminalSession>;
  readonly #changed: (session: TerminalSession) => void;
  readonly #stalled: (items: Stalled) => void | Promise<void>;
  #closed = false;
  constructor(
    sessions: ReadonlyMap<string, TerminalSession>,
    changed: (session: TerminalSession) => void,
    stalled: (items: Stalled) => void | Promise<void>,
  ) {
    this.#sessions = sessions;
    this.#changed = changed;
    this.#stalled = stalled;
  }
  #stallTimer?: NodeJS.Timeout;
  #stallChecking?: Promise<void>;

  close() {
    this.#closed = true;
    if (this.#stallTimer) {
      clearTimeout(this.#stallTimer);
      this.#stallTimer = undefined;
    }
    return this.#stallChecking;
  }

  schedule(): void {
    if (this.#closed || this.#stallTimer || this.#stallChecking) return;
    const hasActiveUnstalled = [...this.#sessions.values()].some(
      watchesForStall,
    );
    if (!hasActiveUnstalled) return;
    const { pollMs } = stallTiming();
    this.#stallTimer = setTimeout(() => {
      this.#stallTimer = undefined;
      if (this.#closed) return;
      const running = this.#runStallCheck().finally(() => {
        if (this.#stallChecking === running) this.#stallChecking = undefined;
        this.schedule();
      });
      this.#stallChecking = running;
    }, pollMs);
    this.#stallTimer.unref();
  }

  async #runStallCheck(): Promise<void> {
    if (this.#closed) return;
    const candidates = [...this.#sessions.values()]
      .filter(watchesForStall)
      .map((runtime) => ({
        runtime,
        pid: runtime.pty!.pid,
        generation: runtime.stallGeneration,
      }));
    if (candidates.length === 0) return;
    const { stallMs } = stallTiming();
    const stoppedByRoot = await stoppedDescendantPidsByRoot(
      candidates.map((c) => c.pid),
    );
    if (this.#closed) return;
    const now = Date.now();
    const newlyStalled: {
      id: string;
      since: number;
      reason: TeamStallReason;
    }[] = [];
    for (const { runtime, pid, generation } of candidates) {
      if (
        !watchesForStall(runtime) ||
        runtime.pty?.pid !== pid ||
        runtime.stallGeneration !== generation
      )
        continue;
      const currentStopped = stoppedByRoot.get(pid);
      const previousStopped =
        runtime.stoppedDescendantSince ?? new Map<number, number>();
      const nextStopped = new Map<number, number>();
      let stoppedStall = false;
      if (currentStopped) {
        for (const childPid of currentStopped) {
          const firstSeen = previousStopped.get(childPid) ?? now;
          nextStopped.set(childPid, firstSeen);
          if (now - firstSeen >= stallMs) stoppedStall = true;
        }
      }
      runtime.stoppedDescendantSince = nextStopped;
      const outputBaseline = Math.max(
        runtime.lastOutputAt ?? 0,
        runtime.stallResetAt ?? 0,
        runtime.cliStatus?.since ?? runtime.record.createdAt,
      );
      const outputStall = now - outputBaseline >= stallMs;
      if (!stoppedStall && !outputStall) continue;
      const reason: TeamStallReason = stoppedStall ? "stopped" : "output";
      runtime.initialCliStall = !runtime.cliStatus;
      runtime.cliStatus = {
        ...(runtime.cliStatus ?? {
          state: "active",
          since: runtime.record.createdAt,
        }),
        stalledSince: now,
      };
      this.#changed(runtime);
      newlyStalled.push({ id: runtime.record.id, since: now, reason });
    }
    if (newlyStalled.length > 0) {
      Promise.resolve(this.#stalled(newlyStalled)).catch(() => {
        console.error("iori-host cli-stall-callback-failed");
      });
    }
  }
}
