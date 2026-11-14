import { ForgeReadError } from "./failure.ts";
import { github } from "./github.ts";
import { forgejo } from "./forgejo.ts";
import type { ForgeAdapter } from "./types.ts";

const adapters: ForgeAdapter[] = [github, forgejo];

/** Share detection facts from marks with settings; settings only detects unseen origins. */
export class ForgeDetection {
  readonly #known = new Map<string, ForgeAdapter | undefined>();
  readonly #pending = new Map<
    string,
    { request: Promise<ForgeAdapter | undefined>; refresh: boolean }
  >();
  readonly onChange: () => void;
  constructor(onChange: () => void) {
    this.onChange = onChange;
  }
  forSettings(origin: string): { adapter?: ForgeAdapter; pending: boolean } {
    const known = this.#known.has(origin);
    if (!known) void this.resolve(origin).catch(() => undefined);
    return { adapter: this.#known.get(origin), pending: !known };
  }
  async resolve(
    origin: string,
    signal?: AbortSignal,
    refresh = false,
    reportFailure = false,
  ): Promise<ForgeAdapter | undefined> {
    if (!refresh && this.#known.has(origin)) return this.#known.get(origin);
    const pending = this.#pending.get(origin);
    if (pending) {
      try {
        await pending.request;
      } catch {
        // Another view may have stopped its observation. This caller still
        // owns a read if its own signal has not been cancelled.
        signal?.throwIfAborted();
      }
      signal?.throwIfAborted();
      if (
        (!refresh || pending.refresh) &&
        this.#known.has(origin) &&
        (!reportFailure || this.#known.get(origin))
      )
        return this.#known.get(origin);
      return this.resolve(origin, signal, refresh, reportFailure);
    }
    const request = (async () => {
      let found: ForgeAdapter | undefined;
      for (const adapter of adapters) {
        try {
          if (await adapter.detect(origin, signal)) {
            found = adapter;
            break;
          }
        } catch (error) {
          signal?.throwIfAborted();
          if (
            reportFailure &&
            error instanceof ForgeReadError &&
            error.status !== 404
          )
            throw error;
        }
      }
      signal?.throwIfAborted();
      const changed =
        !this.#known.has(origin) || this.#known.get(origin)?.id !== found?.id;
      this.#known.set(origin, found);
      if (changed) this.onChange();
      return found;
    })();
    this.#pending.set(origin, { request, refresh });
    try {
      return await request;
    } finally {
      this.#pending.delete(origin);
    }
  }
}
