import { timingSafeEqual } from "node:crypto";
import {
  createServer,
  type IncomingMessage,
  type Server,
  type ServerResponse,
} from "node:http";
import { networkInterfaces } from "node:os";
import type {
  AutomationReceived,
  AutomationRun,
  AutomationWebhookListener,
} from "@iori/protocol";
import type { HostStore } from "../store.ts";
import {
  webhookAddressAllowed,
  webhookAddressPriority,
} from "./webhook-address.ts";

function reject(response: ServerResponse, status: number): void {
  response.writeHead(status, { Connection: "close" });
  response.end();
}

function readBody(
  request: IncomingMessage,
  response: ServerResponse,
): Promise<string | undefined> {
  return new Promise((resolve, fail) => {
    const chunks: Buffer[] = [];
    let size = 0;
    const cleanup = () => {
      request.off("data", data);
      request.off("end", end);
      request.off("aborted", aborted);
    };
    const data = (chunk: Buffer) => {
      size += chunk.length;
      if (size > 1_048_576) {
        request.pause();
        cleanup();
        reject(response, 413);
        resolve(undefined);
      } else chunks.push(chunk);
    };
    const end = () => {
      cleanup();
      try {
        resolve(
          new TextDecoder("utf-8", { fatal: true }).decode(
            Buffer.concat(chunks),
          ),
        );
      } catch {
        reject(response, 415);
        resolve(undefined);
      }
    };
    const error = (cause: Error) => {
      cleanup();
      fail(cause);
    };
    const aborted = () => error(new Error("Webhook request aborted"));
    request.on("data", data);
    request.on("end", end);
    request.once("error", error);
    request.on("aborted", aborted);
  });
}

export class AutomationWebhookServer {
  readonly port: number;
  readonly store: HostStore;
  readonly receive: (
    id: string,
    received: AutomationReceived,
    respond: (run: AutomationRun) => void,
  ) => Promise<boolean>;
  #servers: Server[] = [];
  #scope?: "lan" | "local";
  #error?: "port";

  constructor(
    port: number,
    store: HostStore,
    receive: AutomationWebhookServer["receive"],
  ) {
    this.port = port;
    this.store = store;
    this.receive = receive;
  }

  info(): AutomationWebhookListener | undefined {
    if (!this.#scope) return undefined;
    return {
      port: this.port,
      addresses: [
        ...new Set(
          Object.values(networkInterfaces()).flatMap((entries) =>
            (entries ?? [])
              .filter(
                (entry) =>
                  !entry.internal &&
                  webhookAddressAllowed(entry.address, "lan") &&
                  !webhookAddressAllowed(entry.address, "local"),
              )
              .map((entry) => entry.address),
          ),
        ),
      ].sort((a, b) => webhookAddressPriority(a) - webhookAddressPriority(b)),
      ...(this.#error ? { error: this.#error } : {}),
    };
  }

  async sync(): Promise<void> {
    const webhooks = this.store
      .automations()
      .flatMap((a) => (a.webhook ? [a.webhook] : []));
    const scope = !webhooks.length
      ? undefined
      : webhooks.some((w) => w.scope === "lan")
        ? "lan"
        : "local";
    if (scope === this.#scope && !this.#error) return;
    await this.#closeServers();
    this.#scope = scope;
    this.#error = undefined;
    if (!scope) return;
    try {
      for (const host of scope === "lan"
        ? ["0.0.0.0", "::"]
        : ["127.0.0.1", "::1"]) {
        const server = createServer((request, response) => {
          void this.#handle(request, response).catch(() => {
            if (!response.headersSent) reject(response, 500);
          });
        });
        try {
          await new Promise<void>((resolve, fail) => {
            const error = (cause: Error) => fail(cause);
            server.once("error", error);
            server.listen({ port: this.port, host, ipv6Only: true }, () => {
              server.off("error", error);
              resolve();
            });
          });
          this.#servers.push(server);
        } catch (cause) {
          const code = (cause as NodeJS.ErrnoException).code;
          if (code !== "EADDRNOTAVAIL" && code !== "EAFNOSUPPORT") throw cause;
        }
      }
      if (!this.#servers.length)
        throw new Error("No webhook address available");
    } catch {
      this.#error = "port";
      await this.#closeServers();
    }
  }

  async close(): Promise<void> {
    await this.#closeServers();
    this.#scope = undefined;
  }

  async #closeServers(): Promise<void> {
    const servers = this.#servers.splice(0);
    await Promise.all(
      servers.map(
        (server) =>
          new Promise<void>((resolve) => {
            server.close(() => resolve());
            server.closeAllConnections();
          }),
      ),
    );
  }

  async #handle(
    request: IncomingMessage,
    response: ServerResponse,
  ): Promise<void> {
    const receivedAt = Date.now();
    if (request.method !== "POST") return reject(response, 405);
    const rawUrl = request.url ?? "";
    const queryAt = rawUrl.indexOf("?");
    const path = queryAt < 0 ? rawUrl : rawUrl.slice(0, queryAt);
    const queryString = queryAt < 0 ? "" : rawUrl.slice(queryAt + 1);
    const id = /^\/hooks\/([^/]+)$/u.exec(path)?.[1];
    const automation = this.store.automations().find((a) => a.id === id);
    if (!automation?.webhook) return reject(response, 404);
    const from = request.socket.remoteAddress ?? "";
    if (!webhookAddressAllowed(from, automation.webhook.scope))
      return reject(response, 403);
    const authorization = request.headers.authorization;
    const token = /^Bearer +(.+)$/iu.exec(authorization ?? "")?.[1] ?? "";
    const actual = Buffer.from(token);
    const expected = Buffer.from(automation.webhookToken!);
    if (actual.length !== expected.length || !timingSafeEqual(actual, expected))
      return reject(response, 401);
    const body = await readBody(request, response);
    if (body === undefined) return;
    const query: Record<string, string[]> = Object.create(null);
    for (const [name, value] of new URLSearchParams(queryString))
      (query[name] ??= []).push(value);
    const headers: Record<string, string> = Object.create(null);
    for (const [name, value] of Object.entries(request.headers)) {
      if (
        ["authorization", "cookie", "proxy-authorization"].includes(name) ||
        value === undefined
      )
        continue;
      headers[name] = Array.isArray(value) ? value.join(", ") : value;
    }
    const accepted = await this.receive(
      automation.id,
      { receivedAt, from, query, headers, body },
      (run) => {
        response.writeHead(202, { "Content-Type": "application/json" });
        response.end(
          JSON.stringify({
            run: run.id,
            status: run.reason ? "skipped" : "started",
            ...(run.reason ? { reason: run.reason } : {}),
          }),
        );
      },
    );
    if (!accepted) reject(response, 404);
  }
}
