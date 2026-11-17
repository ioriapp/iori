import webPush from "web-push";
import { Agent } from "node:https";
import { createCliNotification, notificationLabels } from "@iori/protocol";
import type {
  FolderHistoryItem,
  PushNotificationPayload,
  TerminalSummary,
} from "@iori/protocol";
import type { HostStore } from "./store.ts";

/** Delivery is independent of team handlers and never blocks CLI state changes. */
export class PushNotifications {
  readonly #agent = new Agent();
  #closed = false;
  readonly #states = new Map<
    string,
    { terminal: TerminalSummary; sent: Set<string> }
  >();
  readonly #store: HostStore;
  readonly #hostKey: string;
  readonly #connected: (publicKey: string) => boolean;
  readonly #folders: () => Promise<{ folders: FolderHistoryItem[] }>;

  constructor(
    store: HostStore,
    hostKey: string,
    connected: (publicKey: string) => boolean,
    folders: () => Promise<{ folders: FolderHistoryItem[] }>,
  ) {
    this.#store = store;
    this.#hostKey = hostKey;
    this.#connected = connected;
    this.#folders = folders;
  }

  close(): void {
    this.#closed = true;
    this.#agent.destroy();
  }

  forget(terminalId: string): void {
    this.#states.delete(terminalId);
  }

  notify(terminal: TerminalSummary): void {
    if (this.#closed) return;
    const status = terminal.cliStatus;
    if (!status) return;
    const previous = this.#states.get(terminal.id);
    const old = previous?.terminal.cliStatus;
    const same =
      (status.state === "waiting" &&
        old?.state === "waiting" &&
        old.waitingSince === status.waitingSince) ||
      (status.state === "done" &&
        old?.state === "done" &&
        old.since === status.since &&
        old.outcome === status.outcome);
    const state =
      same && previous ? previous : { terminal, sent: new Set<string>() };
    state.terminal = terminal;
    this.#states.set(terminal.id, state);
    if (status.state === "waiting" || status.state === "done")
      this.#deliver(state);
  }

  disconnected(publicKey: string): void {
    for (const state of this.#states.values())
      if (state.terminal.cliStatus?.state === "waiting")
        this.#deliver(state, publicKey);
  }

  #deliver(
    state: { terminal: TerminalSummary; sent: Set<string> },
    only?: string,
  ): void {
    const { terminal } = state;
    const status = terminal.cliStatus!;
    const destinations = () =>
      this.#store
        .pushSubscriptions()
        .filter(
          ({ publicKey, settings }) =>
            (!only || publicKey === only) &&
            !state.sent.has(publicKey) &&
            !this.#connected(publicKey) &&
            (status.state === "waiting" ? settings.waiting : settings.done),
        );
    if (!destinations().length) return;
    void this.#folders()
      .then(({ folders }) => {
        if (this.#closed || this.#states.get(terminal.id) !== state) return;
        for (const { publicKey, settings } of destinations()) {
          if (!settings.subscription) continue;
          const notification = createCliNotification(
            this.#hostKey,
            terminal,
            folders,
            (key) => notificationLabels[settings.language][key],
          );
          if (!notification) continue;
          state.sent.add(publicKey);
          // 80/40/180 Unicode character previews and fixed-size IDs keep the UTF-8 JSON below 4096 bytes.
          const payload: PushNotificationPayload = {
            ...notification,
            v: 1,
            target: { hostKey: this.#hostKey, terminalId: terminal.id },
          };
          void webPush
            .sendNotification(settings.subscription, JSON.stringify(payload), {
              contentEncoding: "aes128gcm",
              TTL: 86400,
              agent: this.#agent,
            })
            .catch((error: unknown) => {
              if (this.#closed) return;
              const statusCode =
                error && typeof error === "object" && "statusCode" in error
                  ? error.statusCode
                  : undefined;
              if (statusCode === 404 || statusCode === 410)
                this.#store.removePushSubscription(publicKey, settings);
              // Error objects include endpoint/keys and response bodies: never log them.
              else
                console.error(
                  `iori-host push-delivery-failed${typeof statusCode === "number" ? ` status=${statusCode}` : ""}`,
                );
            });
        }
      })
      .catch(() => {
        if (!this.#closed) console.error("iori-host push-delivery-failed");
      });
  }
}
