import { relative, isAbsolute, sep } from "node:path";
import { Worker } from "node:worker_threads";

export type WatchCommand =
  | { kind: "watch"; id: number; directory: string; recursive: boolean }
  | { kind: "close"; id: number }
  | { kind: "stop-path"; id: number; path: string };
export type WatchEvent =
  | { kind: "stopped"; id: number }
  | { kind: "ready"; id: number }
  | { kind: "change"; id: number; path?: string }
  | { kind: "failed"; id: number; code?: string };

type Subscription = {
  directory: string;
  recursive: boolean;
  listener: (path: string | undefined) => void;
  failed: (error: unknown) => void;
  ready: boolean;
  resolve: (stop: () => void) => void;
  reject: (error: unknown) => void;
};
let nextId = 0;
const stopping = new Map<number, () => void>();
let current:
  { worker: Worker; subscriptions: Map<number, Subscription> } | undefined;

/** The OS watcher stays off the request thread: on Linux recursive fs.watch
 * synchronously scans every file, both at startup and when folders change. */
export function watchDirectory(
  directory: string,
  recursive: boolean,
  listener: (path: string | undefined) => void,
  failed: (error: unknown) => void,
): Promise<() => void> {
  if (!current) {
    const worker = new Worker(
      new URL(
        `./directory-watch-worker${import.meta.filename.endsWith(".ts") ? ".ts" : ".js"}`,
        import.meta.url,
      ),
    );
    const subscriptions = new Map<number, Subscription>();
    const owner = { worker, subscriptions };
    current = owner;
    const release = (id: number) => {
      subscriptions.delete(id);
      if (subscriptions.size === 0) {
        if (current === owner) current = undefined;
        void worker.terminate();
      }
    };
    worker.on("message", (event: WatchEvent) => {
      if (event.kind === "stopped") {
        stopping.get(event.id)?.();
        stopping.delete(event.id);
        return;
      }
      const subscription = subscriptions.get(event.id);
      if (!subscription) return;
      if (event.kind === "ready") {
        subscription.ready = true;
        subscription.resolve(() => {
          if (!subscriptions.has(event.id)) return;
          worker.postMessage({
            kind: "close",
            id: event.id,
          } satisfies WatchCommand);
          release(event.id);
        });
      } else if (event.kind === "change") {
        subscription.listener(event.path);
      } else {
        release(event.id);
        const error = Object.assign(new Error("Could not watch this folder"), {
          code: event.code,
        });
        if (subscription.ready) subscription.failed(error);
        else subscription.reject(error);
      }
    });
    const fail = (error: unknown) => {
      if (current === owner) current = undefined;
      for (const done of stopping.values()) done();
      stopping.clear();
      const pending = [...subscriptions.values()];
      subscriptions.clear();
      for (const subscription of pending) {
        if (subscription.ready) subscription.failed(error);
        else subscription.reject(error);
      }
    };
    worker.on("error", fail);
    worker.on("exit", () => fail(new Error("Directory watcher stopped")));
  }
  const { worker, subscriptions } = current;
  const id = ++nextId;
  return new Promise((resolve, reject) => {
    subscriptions.set(id, {
      directory,
      recursive,
      listener,
      failed,
      ready: false,
      resolve,
      reject,
    });
    worker.postMessage({
      kind: "watch",
      id,
      directory,
      recursive,
    } satisfies WatchCommand);
  });
}

export async function stopWatchingPath(
  path: string,
): Promise<(restore: boolean) => void> {
  const owner = current;
  if (!owner) return () => {};
  const affected = [...owner.subscriptions].filter(([, subscription]) => {
    const rel = relative(path, subscription.directory);
    return (
      rel === "" ||
      (!isAbsolute(rel) && rel !== ".." && !rel.startsWith(`..${sep}`))
    );
  });
  const id = ++nextId;
  await new Promise<void>((resolve) => {
    stopping.set(id, resolve);
    owner.worker.postMessage({
      kind: "stop-path",
      id,
      path,
    } satisfies WatchCommand);
  });
  return (restore) => {
    for (const [id, subscription] of affected) {
      if (!owner.subscriptions.has(id)) continue;
      if (restore) {
        owner.worker.postMessage({
          kind: "watch",
          id,
          directory: subscription.directory,
          recursive: subscription.recursive,
        } satisfies WatchCommand);
        subscription.listener(undefined);
      } else {
        owner.subscriptions.delete(id);
        subscription.failed(
          Object.assign(new Error("Folder was removed"), { code: "ENOENT" }),
        );
      }
    }
    if (owner.subscriptions.size === 0) {
      if (current === owner) current = undefined;
      void owner.worker.terminate();
    }
  };
}
