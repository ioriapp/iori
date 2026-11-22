import {
  MAX_FRAME_BYTES,
  MAX_TERMINAL_SNAPSHOT_BYTES,
  MAX_TERMINAL_SNAPSHOT_LINES,
  MOBILE_TERMINAL_SNAPSHOT_BYTES,
  MOBILE_TERMINAL_SNAPSHOT_LINES,
  type TerminalViewAttributes,
  terminalServerMessageSchema,
  type TerminalServerMessage,
} from "@iori/protocol";
import { native } from "../native.ts";

type StreamState = { id?: string; opened: boolean; ready: boolean };
const closed: StreamState = { opened: false, ready: false };
type StreamError = "listen" | "open" | "reopen" | "display" | "input";
type View = {
  connectionId: string;
  terminalId: string;
  mobile: boolean;
  fullHistory: () => boolean;
  measure: (
    id: string,
  ) => Promise<{ fitted: boolean; attributes: TerminalViewAttributes }>;

  claimOnOpen: () => boolean;
  apply: (message: TerminalServerMessage, streamId: string) => Promise<void>;
  ended: () => boolean;
};

export class TerminalStreamController {
  readonly #viewId: string;
  readonly #canSend: (allowStopped: boolean) => boolean;
  readonly #size: () => { cols: number; rows: number };
  readonly #error: (reason: StreamError) => void;
  #sizeOwner?: string;
  #opening = Promise.resolve();
  #writes = Promise.resolve();
  #frames = Promise.resolve();
  #state = closed;
  #listeners = new Set<() => void>();
  #reopen?: (reason: "initial" | "open" | "reopen") => void;

  constructor(
    viewId: string,
    canSend: (allowStopped: boolean) => boolean,
    size: () => { cols: number; rows: number },
    error: (reason: StreamError) => void,
  ) {
    this.#viewId = viewId;
    this.#canSend = canSend;
    this.#size = size;
    this.#error = error;
  }
  get ownsSize() {
    return this.#sizeOwner === this.#viewId;
  }
  get dimensions() {
    return this.#size();
  }
  get acceptsInput() {
    return Boolean(this.#state.id && this.#canSend(false));
  }
  snapshot = () => this.#state;
  subscribe = (listener: () => void) => {
    this.#listeners.add(listener);
    return () => {
      this.#listeners.delete(listener);
    };
  };
  #publish(state: StreamState) {
    this.#state = state;
    for (const listener of this.#listeners) listener();
  }

  send = (
    value: object | Promise<object[]>,
    allowStopped = false,
    input = false,
    onFailure?: () => void,
  ) => {
    const { id, opened } = this.#state;
    if (!id || !this.#canSend(allowStopped)) return false;
    const kind = (value as { kind?: string }).kind;
    const claimsSize =
      input ||
      kind === "terminal.focus" ||
      kind === "terminal.resize" ||
      kind === "terminal.input" ||
      kind === "terminal.submit";
    if (claimsSize) this.#sizeOwner = this.#viewId;
    // Capture the destination and its opening before any later view replaces it.
    const opening = this.#opening;
    this.#writes = this.#writes
      .then(async () => {
        await opening;
        const messages = value instanceof Promise ? await value : [value];
        for (const message of messages) {
          const frame =
            kind === "terminal.focus" && !opened
              ? { ...message, ...this.#size() }
              : message;
          await native.terminalWrite(id, JSON.stringify(frame));
        }
        if (claimsSize && this.#state.id === id) this.#sizeOwner = this.#viewId;
      })
      .catch(() => {
        onFailure?.();
        if (this.#state.id !== id) return;
        if (claimsSize && this.ownsSize) this.#sizeOwner = undefined;
        this.#error("input");
      });
    return true;
  };

  input(data: string | Promise<string>, origin?: "scroll") {
    const messages = (text: string) =>
      splitTerminalInput(text, origin).map((part) => ({
        kind: "terminal.input",
        data: part,
        ...(origin ? { origin } : {}),
      }));
    if (typeof data === "string") {
      for (const message of messages(data)) this.send(message);
    } else this.send(data.then(messages), false, true);
  }

  #detach() {
    const { id } = this.#state;
    if (!id) return;
    // Native sends FIN only after this stream opened and its accepted writes drained.
    void Promise.allSettled([this.#opening, this.#writes])
      .then(() => native.terminalDetach(id))
      .catch(() => undefined);
    this.#publish(closed);
  }

  reopen = () => this.#reopen?.("open");

  #receive(
    frame: { streamId: string; json: string },
    view: View,
    current: () => boolean,
  ) {
    this.#frames = this.#frames
      .then(async () => {
        if (!current()) return;
        const message = terminalServerMessageSchema.parse(
          JSON.parse(frame.json),
        );
        if (!message) return;
        if (
          message.kind === "terminal.snapshot" ||
          message.kind === "terminal.size"
        )
          this.#sizeOwner = message.sizeOwnerViewId;
        await view.apply(message, frame.streamId);
        if (message.kind === "terminal.snapshot" && current())
          this.#publish({ ...this.#state, ready: true });
      })
      .catch(() => {
        if (current() && !this.#state.ready) this.#error("display");
      })
      .finally(() =>
        native.terminalAcknowledge(frame.streamId).catch(() => undefined),
      );
  }

  attach(view: View): () => void {
    let active = true;
    let stops: (() => void)[] = [];
    let listening: Promise<void> | undefined;
    const matches = (event: { connectionId: string; streamId: string }) =>
      active &&
      event.connectionId === view.connectionId &&
      event.streamId === this.#state.id;
    const stopListening = () => {
      for (const stop of stops) stop();
      stops = [];
    };
    const listen = () => {
      // A closed tab can still have an opening and input to drain.
      if (!active || listening) return listening;
      const subscriptions = stops;
      const add = (stop: () => void) => {
        if (active && stops === subscriptions) stops.push(stop);
        else stop();
      };
      listening = Promise.all([
        native
          .onTerminalFrame((frame) => {
            if (!matches(frame)) return;
            this.#receive(frame, view, () => matches(frame));
          })
          .then(add),
        native
          .onTerminalEnded((event) => {
            if (!matches(event)) return;
            const reopen = view.ended();
            this.#detach();
            if (reopen) this.#reopen?.("reopen");
          })
          .then(add),
      ])
        .then(() => undefined)
        .catch((error: unknown) => {
          stopListening();
          listening = undefined;
          throw error;
        });
      return listening;
    };
    this.#reopen = (reason) => {
      this.#detach();
      const id = crypto.randomUUID();
      this.#publish({ id, opened: false, ready: false });
      let failure: "listen" | "open" | "reopen" = "listen";
      this.#opening = this.#opening
        .catch(() => undefined)
        .then(async () => {
          await listen();
          failure = reason === "reopen" ? "reopen" : "open";
          const current = this.#state.id === id;
          if (current) this.#sizeOwner = undefined;
          const claim = current && reason === "initial" && view.claimOnOpen();
          const { fitted, attributes } = await view.measure(id);
          const compact = view.mobile && !view.fullHistory();
          await native.terminalOpen(
            view.connectionId,
            id,
            JSON.stringify({
              kind: "terminal",
              operationId: crypto.randomUUID(),
              action: "open",
              viewId: this.#viewId,
              claimSize: claim && fitted && this.#state.id === id,
              viewAttributes: attributes,
              deviceClass: view.mobile ? "mobile" : "desktop",
              terminalId: view.terminalId,
              ...this.dimensions,
              snapshotMaxLines: compact
                ? MOBILE_TERMINAL_SNAPSHOT_LINES
                : MAX_TERMINAL_SNAPSHOT_LINES,
              snapshotMaxBytes: compact
                ? MOBILE_TERMINAL_SNAPSHOT_BYTES
                : MAX_TERMINAL_SNAPSHOT_BYTES,
            }),
          );
          if (this.#state.id === id)
            this.#publish({ ...this.#state, opened: true });
        });
      void this.#opening.catch(() => {
        if (this.#state.id !== id) return;
        this.#detach();
        this.#error(failure);
      });
    };
    this.#reopen("initial");
    return () => {
      active = false;
      this.#reopen = undefined;
      stopListening();
      this.#detach();
    };
  }
}

/** A burst of layout changes resolves all measurements at the settled size. */
export function terminalFitScheduler(
  measure: () => boolean,
  visible: () => boolean,
) {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const waiters = new Set<(fitted: boolean) => void>();
  const finish = (fitted: boolean) => {
    for (const resolve of waiters) resolve(fitted);
    waiters.clear();
  };
  const cancelTimer = () => clearTimeout(timer);
  const flush = () => {
    cancelTimer();
    const fitted = measure();
    if (fitted || !visible()) finish(fitted);
  };
  return {
    request: (immediate = false) =>
      new Promise<boolean>((resolve) => {
        waiters.add(resolve);
        cancelTimer();
        if (immediate) flush();
        else timer = setTimeout(flush, 100);
      }),
    flush,
    cancelTimer,
    close: () => {
      cancelTimer();
      finish(false);
    },
  };
}

function splitTerminalInput(data: string, origin?: "scroll") {
  const encoder = new TextEncoder();
  const maxDataBytes =
    MAX_FRAME_BYTES -
    encoder.encode(
      JSON.stringify({
        kind: "terminal.input",
        data: "",
        ...(origin ? { origin } : {}),
      }),
    ).byteLength;
  const chunks: string[] = [];
  let current = "";
  let currentBytes = 0;
  for (const character of data) {
    const characterBytes =
      encoder.encode(JSON.stringify(character)).byteLength - 2;
    if (current && currentBytes + characterBytes > maxDataBytes) {
      chunks.push(current);
      current = "";
      currentBytes = 0;
    }
    current += character;
    currentBytes += characterBytes;
  }
  if (current) chunks.push(current);
  return chunks;
}
