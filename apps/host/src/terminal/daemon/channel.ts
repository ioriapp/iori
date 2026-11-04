import { randomUUID } from "node:crypto";
import type { Socket } from "node:net";

type Message =
  | { kind: "request"; id: string; method: string; args: unknown[] }
  | { kind: "response"; id: string; value?: unknown; error?: string }
  | { kind: "event"; value: unknown };

/** One authenticated local connection; a write's reply also carries backpressure. */
export class DaemonChannel {
  readonly socket: Socket;
  readonly pending = new Map<
    string,
    { resolve: (value: unknown) => void; reject: (error: Error) => void }
  >();
  handle: (method: string, args: unknown[]) => Promise<unknown> = async () => {
    throw new Error("Host is disconnected");
  };
  event: (value: unknown) => void = () => {};
  disconnected: () => void = () => {};
  #header = Buffer.alloc(4);
  #headerBytes = 0;
  #chunks: Buffer[] = [];
  #payloadBytes = 0;
  #length = 0;
  constructor(socket: Socket) {
    this.socket = socket;
    socket.on("data", (data) => {
      let offset = 0;
      while (offset < data.length) {
        if (this.#headerBytes < 4) {
          const count = Math.min(4 - this.#headerBytes, data.length - offset);
          data.copy(this.#header, this.#headerBytes, offset, offset + count);
          this.#headerBytes += count;
          offset += count;
          if (this.#headerBytes < 4) return;
          this.#length = this.#header.readUInt32BE(0);
        }
        const count = Math.min(
          this.#length - this.#payloadBytes,
          data.length - offset,
        );
        this.#chunks.push(data.subarray(offset, offset + count));
        this.#payloadBytes += count;
        offset += count;
        if (this.#payloadBytes < this.#length) return;
        const payload = Buffer.concat(this.#chunks, this.#length);
        this.#chunks = [];
        this.#payloadBytes = 0;
        this.#headerBytes = 0;
        try {
          this.#receive(JSON.parse(payload.toString("utf8")) as Message);
        } catch {
          socket.destroy();
          return;
        }
      }
    });
    socket.on("error", () => {});
    socket.on("close", () => {
      for (const pending of this.pending.values())
        pending.reject(new Error("Terminal daemon connection closed"));
      this.pending.clear();
      this.disconnected();
    });
  }
  #receive(message: Message) {
    if (message.kind === "response") {
      const pending = this.pending.get(message.id);
      this.pending.delete(message.id);
      if (message.error) pending?.reject(new Error(message.error));
      else pending?.resolve(message.value);
    } else if (message.kind === "event") this.event(message.value);
    else if (message.kind === "request") {
      void this.handle(message.method, message.args).then(
        (value) => this.#send({ kind: "response", id: message.id, value }),
        () =>
          this.#send({
            kind: "response",
            id: message.id,
            error: "Terminal operation failed",
          }),
      );
    } else this.socket.destroy();
  }
  #send(message: Message) {
    if (!this.socket.destroyed) {
      const payload = Buffer.from(JSON.stringify(message));
      const header = Buffer.alloc(4);
      header.writeUInt32BE(payload.length);
      this.socket.write(Buffer.concat([header, payload]));
    }
  }
  call<T>(method: string, ...args: unknown[]): Promise<T> {
    if (this.socket.destroyed)
      return Promise.reject(new Error("Terminal daemon connection closed"));
    const id = randomUUID();
    return new Promise<unknown>((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.#send({ kind: "request", id, method, args });
    }) as Promise<T>;
  }
  send(value: unknown) {
    this.#send({ kind: "event", value });
  }
  close() {
    this.socket.destroy();
  }
}
