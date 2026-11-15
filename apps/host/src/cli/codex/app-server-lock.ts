import { homedir } from "node:os";
import { join, resolve } from "node:path";

const queues = new Map<string, Promise<void>>();

export function codexHomeDirectory(home = homedir()): string {
  return process.env.CODEX_HOME || join(home, ".codex");
}

function lockKey(directory: string): string {
  const resolved = resolve(directory);
  return process.platform === "win32" ? resolved.toLowerCase() : resolved;
}

function waitWithAbort(
  pending: Promise<void>,
  signal: AbortSignal | undefined,
): Promise<void> {
  if (!signal) return pending;
  if (signal.aborted) {
    return Promise.reject(
      signal.reason ?? new DOMException("Aborted", "AbortError"),
    );
  }
  return new Promise<void>((resolvePromise, rejectPromise) => {
    const onAbort = () => {
      rejectPromise(signal.reason ?? new DOMException("Aborted", "AbortError"));
    };
    signal.addEventListener("abort", onAbort, { once: true });
    pending.then(
      () => {
        signal.removeEventListener("abort", onAbort);
        resolvePromise();
      },
      () => {
        signal.removeEventListener("abort", onAbort);
        resolvePromise();
      },
    );
  });
}

/**
 * Serializes Codex `app-server` startup per `CODEX_HOME` so concurrent Host
 * probes do not initialize the SQLite state runtime at the same time.
 */
export async function acquireCodexAppServerLock(
  directory = codexHomeDirectory(),
  signal?: AbortSignal,
): Promise<() => void> {
  if (signal?.aborted) {
    throw signal.reason ?? new DOMException("Aborted", "AbortError");
  }
  const key = lockKey(directory);
  const previous = queues.get(key) ?? Promise.resolve();
  let releaseTurn!: () => void;
  const turn = new Promise<void>((resolvePromise) => {
    releaseTurn = resolvePromise;
  });
  const tail = previous.then(() => turn);
  queues.set(key, tail);

  let released = false;
  const release = () => {
    if (released) return;
    released = true;
    releaseTurn();
    void tail.then(() => {
      if (queues.get(key) === tail) queues.delete(key);
    });
  };

  try {
    await waitWithAbort(previous, signal);
    if (signal?.aborted) {
      throw signal.reason ?? new DOMException("Aborted", "AbortError");
    }
    return release;
  } catch (error) {
    release();
    throw error;
  }
}

export async function withCodexAppServerLock<T>(
  directory: string,
  signal: AbortSignal | undefined,
  run: () => Promise<T>,
): Promise<T> {
  const release = await acquireCodexAppServerLock(directory, signal);
  try {
    return await run();
  } finally {
    release();
  }
}
