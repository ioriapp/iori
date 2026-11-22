import { MAX_FRAME_BYTES, type Event } from "@iori/protocol";
import type { NativeBiStream } from "./native.ts";
import { frameBytes } from "./host-transport.ts";

// Allow a burst of small state changes or one maximum-size protocol frame.
// The write in flight counts towards both limits.
const MAX_PENDING_EVENTS = 256;
const MAX_PENDING_BYTES = MAX_FRAME_BYTES + 4;

type LocalWaiter = (event: Event) => void;
type EventStream = Pick<NativeBiStream, "write" | "reset">;
interface EventSubscription {
  connection: object;
  stream: EventStream;
  pending: { bytes: Buffer; sent?: () => void }[];
  pendingBytes: number;
  inviteStatusesSent: Set<string>;
}

export class EventHub {
  readonly #subscriptions = new Set<EventSubscription>();
  readonly #localWaiters = new Map<string, Set<LocalWaiter>>();

  addSubscription(connection: object, stream: EventStream): EventSubscription {
    const subscription: EventSubscription = {
      connection,
      stream,
      pending: [],
      pendingBytes: 0,
      inviteStatusesSent: new Set(),
    };
    this.#subscriptions.add(subscription);
    return subscription;
  }

  removeConnection(connection: object): void {
    for (const subscription of this.#subscriptions) {
      if (subscription.connection === connection)
        this.removeSubscription(subscription);
    }
  }

  removeSubscription(subscription: EventSubscription): void {
    this.#subscriptions.delete(subscription);
    for (const entry of subscription.pending) entry.sent?.();
    subscription.pending.length = 0;
    subscription.pendingBytes = 0;
    subscription.inviteStatusesSent.clear();
  }

  #disconnect(subscription: EventSubscription): void {
    if (!this.#subscriptions.has(subscription)) return;
    this.removeSubscription(subscription);
    // Native reset interrupts a blocked write without closing the connection.
    void subscription.stream.reset(0).catch(() => undefined);
  }

  send(subscription: EventSubscription, event: Event): Promise<void> {
    return new Promise((resolve) => {
      try {
        this.#enqueue(subscription, event, frameBytes(event), resolve);
      } catch {
        this.#disconnect(subscription);
        resolve();
      }
    });
  }

  #enqueue(
    subscription: EventSubscription,
    event: Event,
    bytes: Buffer,
    sent?: () => void,
  ): void {
    if (!this.#subscriptions.has(subscription)) {
      sent?.();
      return;
    }
    if (event.type === "invite.status") {
      const key = `${event.operationId}:${event.status}`;
      if (subscription.inviteStatusesSent.has(key)) {
        sent?.();
        return;
      }
      subscription.inviteStatusesSent.add(key);
    }
    if (
      subscription.pending.length >= MAX_PENDING_EVENTS ||
      subscription.pendingBytes + bytes.length > MAX_PENDING_BYTES
    ) {
      this.#disconnect(subscription);
      sent?.();
      return;
    }
    subscription.pendingBytes += bytes.length;
    subscription.pending.push({ bytes, sent });
    if (subscription.pending.length === 1) void this.#drain(subscription);
  }

  async #drain(subscription: EventSubscription): Promise<void> {
    try {
      while (subscription.pending.length) {
        await subscription.stream.write(subscription.pending[0]!.bytes);
        // Removal also clears the in-flight entry.
        const entry = subscription.pending.shift();
        if (!entry) return;
        subscription.pendingBytes -= entry.bytes.length;
        entry.sent?.();
      }
    } catch {
      this.#disconnect(subscription);
    }
  }

  waitForInvite(operationId: string, waiter: LocalWaiter): () => void {
    let waiters = this.#localWaiters.get(operationId);
    if (!waiters) {
      waiters = new Set();
      this.#localWaiters.set(operationId, waiters);
    }
    waiters.add(waiter);
    return () => {
      waiters?.delete(waiter);
      if (waiters?.size === 0) this.#localWaiters.delete(operationId);
    };
  }

  publish(event: Event): void {
    if (this.#subscriptions.size) {
      try {
        const bytes = frameBytes(event);
        for (const subscription of this.#subscriptions) {
          this.#enqueue(subscription, event, bytes);
        }
      } catch {
        // An unencodable event cannot be delivered. Reopen with a snapshot.
        for (const subscription of this.#subscriptions)
          this.#disconnect(subscription);
      }
    }

    const operationId =
      event.type === "device.registered"
        ? event.inviteOperationId
        : event.type === "invite.status"
          ? event.operationId
          : undefined;
    if (!operationId) return;
    for (const waiter of this.#localWaiters.get(operationId) ?? []) {
      waiter(event);
    }
  }
}
