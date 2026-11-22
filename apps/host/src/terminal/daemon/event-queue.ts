import type { PtyEvent } from "./protocol.ts";

/** Delivery order is per Terminal. Eviction order spans all Terminals. */
export class EventQueue {
  readonly #sessions = new Map<string, Set<PtyEvent>>();
  readonly #hooks = new Map<PtyEvent, number>();
  readonly #exits = new Map<PtyEvent, number>();
  #bytes = 0;

  get ids() {
    return this.#sessions.keys();
  }

  first(id: string) {
    return this.#sessions.get(id)?.values().next().value;
  }

  push(event: PtyEvent) {
    const bytes = Buffer.byteLength(JSON.stringify(event));
    const session = this.#sessions.get(event.id) ?? new Set<PtyEvent>();
    session.add(event);
    this.#sessions.set(event.id, session);
    (event.kind === "hook" ? this.#hooks : this.#exits).set(event, bytes);
    this.#bytes += bytes;
  }

  trim() {
    while (
      this.#hooks.size + this.#exits.size > 1024 ||
      this.#bytes > 8 * 1024 * 1024
    ) {
      this.remove(
        (this.#hooks.size ? this.#hooks : this.#exits).keys().next().value!,
      );
    }
  }

  remove(event: PtyEvent) {
    const entries = event.kind === "hook" ? this.#hooks : this.#exits;
    const bytes = entries.get(event);
    // An acknowledgment may arrive after an offline queue was trimmed.
    if (bytes === undefined) return;
    entries.delete(event);
    this.#bytes -= bytes;
    const session = this.#sessions.get(event.id)!;
    session.delete(event);
    if (!session.size) this.#sessions.delete(event.id);
  }
}
