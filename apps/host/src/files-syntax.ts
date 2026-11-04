import { Worker } from "node:worker_threads";
import type { ReadResultByMethod } from "@iori/protocol";
import { throwIfAborted } from "./reading-failure.ts";
import type { TextScan } from "./text-lines.ts";

export const MAX_SYNTAX_FILE_BYTES = 20 * 1024 * 1024;
export const MAX_SYNTAX_FILE_LINES = 300_000;
export type SyntaxResult = ReadResultByMethod["files.syntax"];
export type SyntaxSnapshot = {
  canonical: string;
  identity: string;
  revision: string;
  scan: TextScan;
};
export type SyntaxCommand =
  | {
      kind: "load";
      key: string;
      revision: string;
      language: string;
      bytes: Uint8Array<ArrayBuffer>;
      replaceFrom: number;
      previousRevision?: string;
      cancelled: Int32Array<SharedArrayBuffer>;
    }
  | { kind: "forget"; key: string }
  | {
      kind: "read";
      id: number;
      key: string;
      startLine: number;
      lineCount: number;
      cancelled: Int32Array<SharedArrayBuffer>;
    };
export type SyntaxReply =
  { id: number; result: SyntaxResult } | { id: number; error: string };

type Pending = {
  resolve: (result: SyntaxResult) => void;
  reject: (error: unknown) => void;
};
type Cached = SyntaxSnapshot & {
  language: string;
  cancelled: Int32Array<SharedArrayBuffer>;
};
type Loading = {
  canonical: string;
  revision: string;
  cancelled: Int32Array<SharedArrayBuffer>;
  promise: Promise<void>;
};
// Like the text index, only the eight most recently read files stay resident.
const CACHE_FILES = 8;
let nextId = 0;
let current: ReturnType<typeof startWorker> | undefined;
const cancellation = () => new Int32Array(new SharedArrayBuffer(4));

function startWorker() {
  const worker = new Worker(
    new URL(
      `./files-syntax-worker${import.meta.filename.endsWith(".ts") ? ".ts" : ".js"}`,
      import.meta.url,
    ),
  );
  const pending = new Map<number, Pending>();
  const cached = new Map<string, Cached>();
  const loading = new Map<string, Loading>();
  const owner = { worker, pending, cached, loading };
  worker.on("message", (reply: SyntaxReply) => {
    const request = pending.get(reply.id);
    if (!request) return;
    pending.delete(reply.id);
    if ("error" in reply) request.reject(new Error(reply.error));
    else request.resolve(reply.result);
    if (pending.size === 0) worker.unref();
  });
  const fail = (error: unknown) => {
    if (current === owner) current = undefined;
    for (const request of pending.values()) request.reject(error);
    pending.clear();
    cached.clear();
  };
  worker.on("error", fail);
  worker.on("exit", () => fail(new Error("Syntax worker stopped")));
  worker.unref();
  return owner;
}

/** Stop obsolete reads immediately, retaining their body and checkpoints so an
 * append can continue them. The worker never needs to drain messages to cancel. */
export function forgetOutdatedFileSyntax(file: {
  canonical: string;
  revision: string;
}): void {
  const owner = current;
  if (!owner) return;
  for (const old of [...owner.cached.values(), ...owner.loading.values()]) {
    if (old.canonical === file.canonical && old.revision !== file.revision)
      Atomics.store(old.cancelled, 0, 1);
  }
}

function waitForLoad(
  loading: Promise<void>,
  signal?: AbortSignal,
): Promise<void> {
  if (!signal) return loading;
  return new Promise((resolve, reject) => {
    const abort = () => reject(signal.reason ?? new Error("read cancelled"));
    signal.addEventListener("abort", abort, { once: true });
    void loading.then(
      () => {
        signal.removeEventListener("abort", abort);
        resolve();
      },
      (error: unknown) => {
        signal.removeEventListener("abort", abort);
        reject(error);
      },
    );
  });
}

/** The caller opens and reads the file through withFile. Only its transferable
 * bytes cross to the worker; decoding and splitting happen there. */
export async function readFileSyntax(
  file: SyntaxSnapshot,
  path: string,
  language: string,
  range: { startLine: number; lineCount: number },
  load: (previous?: SyntaxSnapshot) => Promise<{
    bytes: Buffer<ArrayBuffer>;
    replaceFrom: number;
    previousRevision?: string;
  }>,
  signal?: AbortSignal,
): Promise<SyntaxResult> {
  throwIfAborted(signal);
  const owner = (current ??= startWorker());
  // Aliases may have different extensions, hence different languages.
  const key = JSON.stringify([file.canonical, path]);
  if (owner.cached.get(key)?.revision !== file.revision) {
    let loading = owner.loading.get(key);
    if (loading?.revision !== file.revision) {
      const cancelled = cancellation();
      const task: Loading = {
        canonical: file.canonical,
        revision: file.revision,
        cancelled,
        promise: Promise.resolve(),
      };
      const previous = owner.cached.get(key);
      task.promise = load(
        previous?.language === language ? previous : undefined,
      )
        .then(async (body) => {
          if (Atomics.load(cancelled, 0) !== 0) return;
          // Another file may evict the append's base while its bytes are read.
          // Send a complete snapshot in that case, rather than a suffix alone.
          if (
            body.previousRevision &&
            owner.cached.get(key)?.revision !== body.previousRevision
          )
            body = await load();
          // A newer revision observed while reading supersedes this load.
          if (Atomics.load(cancelled, 0) !== 0) return;
          owner.worker.postMessage(
            {
              kind: "load",
              key,
              revision: file.revision,
              language,
              cancelled,
              ...body,
            } satisfies SyntaxCommand,
            [body.bytes.buffer],
          );
          owner.cached.delete(key);
          owner.cached.set(key, {
            canonical: file.canonical,
            identity: file.identity,
            revision: file.revision,
            scan: file.scan,
            language,
            cancelled,
          });
          while (owner.cached.size > CACHE_FILES) {
            const oldest = owner.cached.keys().next().value!;
            Atomics.store(owner.cached.get(oldest)!.cancelled, 0, 1);
            owner.cached.delete(oldest);
            owner.worker.postMessage({
              kind: "forget",
              key: oldest,
            } satisfies SyntaxCommand);
          }
        })
        .finally(() => {
          if (owner.loading.get(key) === task) owner.loading.delete(key);
        });
      owner.loading.set(key, task);
      loading = task;
    }
    await waitForLoad(loading.promise, signal);
    if (Atomics.load(loading.cancelled, 0) !== 0)
      throw new Error("Syntax revision superseded");
  }
  throwIfAborted(signal);
  if (current !== owner) throw new Error("Syntax worker stopped");
  const cached = owner.cached.get(key);
  // Several different files can finish loading in the same turn.
  if (!cached) return readFileSyntax(file, path, language, range, load, signal);
  owner.cached.delete(key);
  owner.cached.set(key, cached);
  const id = ++nextId;
  const cancelled = cancellation();
  return new Promise((resolve, reject) => {
    const abort = () => {
      Atomics.store(cancelled, 0, 1);
      owner.pending.delete(id);
      signal?.removeEventListener("abort", abort);
      reject(signal?.reason ?? new Error("read cancelled"));
      if (owner.pending.size === 0) owner.worker.unref();
    };
    const finish = () => signal?.removeEventListener("abort", abort);
    owner.pending.set(id, {
      resolve: (value) => {
        finish();
        resolve(value);
      },
      reject: (error) => {
        finish();
        reject(error);
      },
    });
    signal?.addEventListener("abort", abort, { once: true });
    owner.worker.ref();
    owner.worker.postMessage({
      kind: "read",
      key,
      id,
      cancelled,
      ...range,
    } satisfies SyntaxCommand);
  });
}
