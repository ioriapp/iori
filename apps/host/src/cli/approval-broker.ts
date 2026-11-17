import { randomBytes, randomUUID } from "node:crypto";
import { createServer, type ServerResponse } from "node:http";
import { chmod, mkdir, rename, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { TerminalApprovalResponse } from "@iori/protocol";
import { object } from "./hooks.ts";

type Pending = { id: string; response: ServerResponse };
type Route = {
  pending?: Pending;
  begin: (payload: Record<string, unknown>, id: string) => Promise<boolean>;
  end: (id: string) => void;
};

/** Host-owned loopback channel. The daemon never reads the connection files. */
export class ApprovalBroker {
  readonly #routes = new Map<string, Route>();
  readonly #terminals = new Map<string, Route>();
  readonly #server = createServer((req, res) => {
    const route = this.#routes.get(req.url ?? "");
    if (req.method !== "POST" || !route) {
      res.writeHead(404).end();
      return;
    }
    void (async () => {
      let body = "";
      for await (const chunk of req) body += chunk;
      const payload = object(JSON.parse(body));
      const id = randomUUID();
      if (!(await route.begin(payload, id))) {
        res.end("{}");
        return;
      }
      this.#finish(route);
      if (res.destroyed) {
        route.end(id);
        return;
      }
      const pending = { id, response: res };
      route.pending = pending;
      res.once("close", () => {
        if (route.pending === pending) this.#finish(route);
      });
      res.writeHead(200, { "Content-Type": "application/json" });
      res.flushHeaders();
    })().catch(() => {
      if (!res.headersSent) res.end("{}");
    });
  });
  #port = 0;
  readonly directory: string;
  constructor(directory: string) {
    this.directory = directory;
  }
  async start() {
    this.#server.requestTimeout = 0;
    await new Promise<void>((resolve, reject) => {
      this.#server.once("error", reject);
      this.#server.listen(0, "127.0.0.1", resolve);
    });
    const address = this.#server.address();
    if (address && typeof address === "object") this.#port = address.port;
    await mkdir(this.directory, { recursive: true, mode: 0o700 });
    await chmod(this.directory, 0o700);
  }
  file(terminalId: string) {
    return join(this.directory, `${terminalId}.json`);
  }
  async register(terminalId: string, begin: Route["begin"], end: Route["end"]) {
    this.remove(terminalId);
    const route: Route = { begin, end };
    const path = `/${randomBytes(32).toString("hex")}`;
    this.#routes.set(path, route);
    this.#terminals.set(terminalId, route);
    const file = this.file(terminalId);
    this.#files.add(file);
    const temporary = `${file}.${randomUUID()}`;
    await writeFile(
      temporary,
      JSON.stringify({ url: `http://127.0.0.1:${this.#port}${path}` }),
      { mode: 0o600 },
    );
    await rename(temporary, file);
    return file;
  }
  #finish(route: Route, decision?: "allow" | "deny") {
    const pending = route.pending;
    if (!pending) return;
    route.pending = undefined;
    pending.response.end(
      JSON.stringify(decision ? { decision } : { accepted: true }),
    );
    route.end(pending.id);
  }
  cancel(terminalId: string) {
    const route = this.#terminals.get(terminalId);
    if (route) this.#finish(route);
  }
  respond(
    terminalId: string,
    id: string,
    decision: "allow" | "deny",
  ): TerminalApprovalResponse {
    const route = this.#terminals.get(terminalId);
    if (route?.pending?.id !== id) return { status: "stale" };
    this.#finish(route, decision);
    return { status: "sent" };
  }
  remove(terminalId: string) {
    const route = this.#terminals.get(terminalId);
    if (!route) return;
    this.#finish(route);
    this.#terminals.delete(terminalId);
    for (const [path, item] of this.#routes)
      if (item === route) this.#routes.delete(path);
  }
  async close() {
    for (const id of this.#terminals.keys()) this.remove(id);
    await new Promise<void>((resolve) => this.#server.close(() => resolve()));
    await Promise.all(
      [...this.#files].map((file) => rm(file, { force: true })),
    );
  }
  readonly #files = new Set<string>();
}
