import { constants } from "node:fs";
import { open } from "node:fs/promises";

/** Queue work in arrival order. Aborting a queued operation removes it immediately. */
export function createConcurrencyLimiter(limit: number) {
  if (!Number.isSafeInteger(limit) || limit < 1)
    throw new RangeError("Concurrency must be a positive integer");
  let active = 0;
  const queued = new Set<() => void>();
  return function run<T>(
    task: (signal?: AbortSignal) => T | PromiseLike<T>,
    signal?: AbortSignal,
  ): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      signal?.throwIfAborted();
      const abort = () => {
        queued.delete(start);
        reject(signal?.reason);
      };
      const start = () => {
        queued.delete(start);
        signal?.removeEventListener("abort", abort);
        active += 1;
        void Promise.resolve()
          .then(() => {
            signal?.throwIfAborted();
            return task(signal);
          })
          .then(resolve, reject)
          .finally(() => {
            active -= 1;
            queued.values().next().value?.();
          });
      };
      if (active < limit) start();
      else {
        queued.add(start);
        signal?.addEventListener("abort", abort, { once: true });
      }
    });
  };
}

/** Preserve input order while keeping at most `limit` jobs in flight. */
export async function mapWithConcurrency<T, U>(
  items: readonly T[],
  limit: number,
  task: (item: T, index: number, signal?: AbortSignal) => U | PromiseLike<U>,
  signal?: AbortSignal,
): Promise<U[]> {
  if (!Number.isSafeInteger(limit) || limit < 1)
    throw new RangeError("Concurrency must be a positive integer");
  signal?.throwIfAborted();
  const results: U[] = new Array<U>(items.length);
  let next = 0;
  let failed = false;
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, async () => {
      while (!failed && next < items.length) {
        try {
          signal?.throwIfAborted();
          const index = next++;
          results[index] = await task(items[index]!, index, signal);
        } catch (error) {
          failed = true;
          throw error;
        }
      }
    }),
  );
  return results;
}

export class ByteLimitError extends Error {
  constructor(limit: number) {
    super(`Input exceeded the ${limit}-byte limit`);
  }
}

/** Reads a regular file whose complete contents are needed in memory. */
export async function readBoundedFileBytes(
  path: string,
  maxBytes: number,
): Promise<Buffer> {
  const file = await open(path, constants.O_RDONLY | constants.O_NONBLOCK);
  try {
    const info = await file.stat();
    if (!info.isFile()) throw new Error("Expected a regular file");
    if (info.size > maxBytes) throw new ByteLimitError(maxBytes);
    const chunks: Buffer[] = [];
    let size = 0;
    const stream = file.createReadStream({ end: maxBytes, autoClose: false });
    for await (const chunk of stream) {
      size += chunk.length;
      if (size > maxBytes) throw new ByteLimitError(maxBytes);
      chunks.push(chunk);
    }
    return Buffer.concat(chunks, size);
  } finally {
    await file.close();
  }
}

/** Content-Length is a hint: decoded or chunked bodies are checked as they arrive. */
export async function readBoundedResponseBytes(
  response: Response,
  maxBytes: number,
): Promise<Buffer> {
  const declared = response.headers.get("content-length");
  if (
    declared !== null &&
    /^\d+$/u.test(declared) &&
    Number(declared) > maxBytes
  ) {
    void response.body?.cancel().catch(() => {});
    throw new ByteLimitError(maxBytes);
  }
  if (!response.body) return Buffer.alloc(0);
  const reader = response.body.getReader();
  let bytes = Buffer.alloc(0);
  let size = 0;
  try {
    for (;;) {
      const next = await reader.read();
      if (next.done) return bytes.subarray(0, size);
      const end = size + next.value.byteLength;
      if (end > maxBytes) {
        void reader.cancel().catch(() => {});
        throw new ByteLimitError(maxBytes);
      }
      if (end > bytes.length) {
        const buffer = Buffer.allocUnsafe(
          Math.min(maxBytes, Math.max(end, bytes.length * 2)),
        );
        bytes.copy(buffer, 0, 0, size);
        bytes = buffer;
      }
      bytes.set(next.value, size);
      size = end;
    }
  } finally {
    reader.releaseLock();
  }
}
