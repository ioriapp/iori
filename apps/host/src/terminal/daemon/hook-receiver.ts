import { createServer, type Server } from "node:http";
import { randomBytes } from "node:crypto";
type HookPayload = Record<string, unknown>;
function object(value: unknown): HookPayload {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as HookPayload)
    : {};
}
/** One process-local loopback listener. Each launched PTY owns a random route,
 * retired on CLI exit; no endpoint file, spool or saved hook state. */
export class HookReceiver {
  readonly #server: Server;
  readonly #routes = new Map<string, (payload: HookPayload) => Promise<void>>();
  #port = 0;
  constructor() {
    this.#server = createServer((request, response) => {
      void (async () => {
        const route = this.#routes.get(request.url ?? "");
        if (request.method !== "POST" || !route) {
          response.writeHead(404).end();
          request.resume();
          return;
        }
        const chunks: Buffer[] = [];
        let bytes = 0;
        for await (const chunk of request) {
          bytes += chunk.length;
          // Match the transport frame budget at this external ingress boundary.
          if (bytes > 1024 * 1024) {
            response.writeHead(413).end();
            request.resume();
            return;
          }
          chunks.push(chunk);
        }
        const payload: unknown = JSON.parse(
          Buffer.concat(chunks).toString("utf8"),
        );
        const record = object(payload);
        // A CLI's own plugin sends the common shape (`iori`), whose items are
        // checked where they are read. A CLI hook names its event.
        if (
          record.iori !== 1 &&
          (typeof record.hook_event_name !== "string" ||
            !record.hook_event_name ||
            record.hook_event_name.length > 128)
        ) {
          response.writeHead(400).end();
          return;
        }
        await route(record);
        response.writeHead(204).end();
      })().catch(() => {
        if (!response.headersSent) response.writeHead(400);
        response.end();
      });
    });
    // No wall-clock deadline changes the CLI's state or fails a hook.
    this.#server.requestTimeout = 0;
    this.#server.headersTimeout = 0;
  }
  async listen(): Promise<void> {
    await new Promise<void>((resolve, reject) => {
      this.#server.once("error", reject);
      this.#server.listen(0, "127.0.0.1", () => {
        this.#server.off("error", reject);
        resolve();
      });
    });
    const address = this.#server.address();
    if (address && typeof address === "object") this.#port = address.port;
  }
  register(handle: (payload: HookPayload) => Promise<void>): {
    url: string;
    dispose: () => void;
  } {
    const route = `/hook/${randomBytes(32).toString("hex")}`;
    this.#routes.set(route, handle);
    return {
      url: `http://127.0.0.1:${this.#port}${route}`,
      dispose: () => {
        this.#routes.delete(route);
      },
    };
  }
  async close(): Promise<void> {
    this.#routes.clear();
    this.#server.closeAllConnections();
    await new Promise<void>((resolve, reject) =>
      this.#server.close((error) => (error ? reject(error) : resolve())),
    );
  }
}
