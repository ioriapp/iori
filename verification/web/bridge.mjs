import { removalCommands } from "./host-removal-commands.mjs";
import { updateCommands } from "./updates.mjs";
import { randomBytes, randomUUID } from "node:crypto";
import { createServer } from "node:http";
import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
import { WebSocket, WebSocketServer } from "ws";
import { loadNativeAddon } from "../../apps/host/src/native.ts";
import { openStorage } from "./storage.mjs";

const MAX_FRAME_BYTES = 4 * 1024 * 1024;
const utf8 = new TextDecoder("utf-8", { fatal: true });
const string = (value) => {
  if (typeof value !== "string") throw new Error("expected a string");
  return value;
};
const record = (value) => {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error("expected an object");
  return value;
};

async function resolveAddresses(addresses) {
  if (!Array.isArray(addresses)) throw new Error("expected Host addresses");
  const result = [];
  for (const entry of addresses) {
    const match = /^(?:\[([^\]]+)\]|([^:]+)):(\d+)$/.exec(string(entry));
    if (!match) throw new Error("invalid Host address");
    const host = match[1] ?? match[2];
    const port = Number(match[3]);
    if (port < 1 || port > 65535) throw new Error("invalid Host port");
    const resolved = isIP(host)
      ? [{ address: host }]
      : await lookup(host, { all: true });
    for (const { address } of resolved)
      result.push(`${isIP(address) === 6 ? `[${address}]` : address}:${port}`);
  }
  if (!result.length) throw new Error("no Host addresses were provided");
  return [...new Set(result)];
}

async function readExactly(stream, length, allowEnd = false) {
  const chunks = [];
  let received = 0;
  while (received < length) {
    const chunk = await stream.read(length - received);
    if (chunk === null) {
      if (allowEnd && received === 0) return null;
      throw new Error("stream ended in the middle of a frame");
    }
    chunks.push(chunk);
    received += chunk.length;
  }
  return Buffer.concat(chunks, length);
}
async function readFrame(stream, peer) {
  const header = await readExactly(stream, 4, true);
  if (header === null) return null;
  const length = header.readUInt32BE();
  if (length > MAX_FRAME_BYTES) {
    peer.close(0, Buffer.from("frame exceeds 4 MiB limit"));
    throw new Error("frame exceeds 4 MiB limit");
  }
  return utf8.decode(await readExactly(stream, length));
}
function writeFrame(stream, json) {
  const bytes = Buffer.from(string(json));
  if (bytes.length > MAX_FRAME_BYTES)
    throw new Error("frame exceeds 4 MiB limit");
  const header = Buffer.alloc(4);
  header.writeUInt32BE(bytes.length);
  return stream.write(Buffer.concat([header, bytes]));
}

// One browser connection owns its iroh connections/streams. Page closure detaches,
// but never closes the Host's PTYs. Storage/identity are shared by this dev Client.
function session(
  ws,
  endpoint,
  storage,
  onRequest,
  onResponse,
  transformResponse,
  onEvent,
  onHostEventStream,
  onTerminalEvent,
  isOffline,
  updateSource,
  hostUninstall = false,
) {
  const connections = new Map();
  const byHost = new Map();
  const streams = new Map();
  const earlyCancels = new Set();
  let disposed = false;
  const emit = (event, payload) => {
    if (ws.readyState === WebSocket.OPEN)
      ws.send(JSON.stringify({ event, payload }));
  };
  const connection = (id) => {
    const entry = connections.get(string(id));
    if (!entry) throw new Error("connection is not available");
    return entry;
  };
  const stop = async (entry) => {
    entry.cancelled = true;
    entry.ack?.();
    if (entry.stream && !entry.opening)
      await Promise.allSettled([
        entry.stream.stop(0),
        // FIN already handed the request to the Host. Resetting that send half
        // can replace FIN before it is read, corrupting a valid envelope.
        ...(entry.finished
          ? []
          : [entry.terminal ? entry.stream.finish() : entry.stream.reset(0)]),
      ]);
  };
  const register = (id) => {
    if (earlyCancels.delete(id)) throw new Error("read cancelled");
    const entry = {
      opening: true,
      finished: false,
      cancelled: false,
      stream: undefined,
      ack: undefined,
      writer: Promise.resolve(),
    };
    streams.set(id, entry);
    return entry;
  };
  const open = async (connectionId, id, json, finish) => {
    const peer = connection(connectionId);
    const entry = register(id);
    entry.connection = peer;
    try {
      entry.stream = await peer.openBi();
      // Complete the already-opened envelope before stopping it. Resetting a
      // half-written envelope is a malformed request on the real Host, not a
      // cancellation. No request is retried and no new stream is opened here.
      await writeFrame(entry.stream, json);
      if (finish) {
        await entry.stream.finish();
        entry.finished = true;
      }
      entry.opening = false;
      if (entry.cancelled || disposed) {
        await stop(entry);
        throw new Error("read cancelled");
      }
      return entry;
    } catch (error) {
      entry.opening = false;
      await stop(entry);
      if (streams.get(id) === entry) streams.delete(id);
      throw error;
    }
  };
  const receive = async (entry, id, connectionId, terminal) => {
    let reason = null;
    try {
      while (!entry.cancelled) {
        const json = await readFrame(entry.stream, entry.connection);
        if (json === null) break;
        if (terminal) {
          // Register the ack before emitting; never read ahead of xterm's apply.
          const applied = new Promise((resolve) => {
            entry.ack = resolve;
          });
          onTerminalEvent?.({
            stage: "receive",
            streamId: id,
            kind: JSON.parse(json).kind,
          });
          emit("native://terminal-frame", { connectionId, streamId: id, json });
          await applied;
          entry.ack = undefined;
        } else {
          const payload = { connectionId, subscriptionId: id, json };
          onEvent?.(payload, (json) =>
            emit("native://stream", { ...payload, json }),
          );
          emit("native://stream", payload);
        }
      }
    } catch (error) {
      if (!entry.cancelled) reason = error.message;
    } finally {
      if (!terminal) {
        await stop(entry);
        if (streams.get(id) === entry) streams.delete(id);
      }
      emit(
        terminal ? "native://terminal-ended" : "native://subscription-ended",
        {
          connectionId,
          ...(terminal ? { streamId: id } : { subscriptionId: id }),
          reason,
        },
      );
    }
  };

  const commands = {
    ...updateCommands(updateSource),
    ...(hostUninstall ? removalCommands(onResponse) : {}),
    native_initial_state: (args) =>
      storage.initial({
        language: string(args.language),
        mobile: Boolean(args.mobile),
      }),
    native_save_host: ({ host, select }) => {
      record(host);
      string(host.publicKey);
      string(host.hostName);
      if (
        !Array.isArray(host.addresses) ||
        !host.addresses.every((a) => typeof a === "string")
      )
        throw new Error("expected Host addresses");
      storage.saveHost(host, Boolean(select));
    },
    native_load_view: ({ scope }) => storage.load("view:" + string(scope)),
    native_save_view: ({ scope, value }) =>
      storage.save("view:" + string(scope), value),
    native_load_workspace_layout: ({ scopeKey }) =>
      storage.load("layout:" + string(scopeKey)),
    native_save_workspace_layout: ({ scopeKey, layout }) =>
      storage.save("layout:" + string(scopeKey), layout),
    native_load_client_preferences: () => storage.load("preferences"),
    native_save_client_preferences: ({ preferences }) =>
      storage.save("preferences", preferences),
    native_scan_qr: () => {
      throw new Error("QR scanning is available on Android only");
    },
    native_back_default: () => {},
    native_connect: async ({ publicKey, addresses }) => {
      if (isOffline()) throw new Error("verification connection offline");
      const key = string(publicKey).toLowerCase();
      if (!/^[a-fA-F0-9]{64}$/.test(key))
        throw new Error("invalid Host public key");
      if (!byHost.has(key)) {
        const connecting = (async () => {
          const peer = await endpoint.connect(
            Buffer.from(key, "hex"),
            await resolveAddresses(addresses),
          );
          if (disposed || isOffline()) {
            peer.close(0, Buffer.from("browser closed"));
            throw new Error("browser closed");
          }
          // iroh authenticates the invited key, not the IP/name.
          if (peer.remotePublicKeyHex !== key) {
            peer.close(0, Buffer.from("unexpected Host identity"));
            throw new Error("Host identity did not match");
          }
          const connectionId = randomUUID();
          connections.set(connectionId, peer);
          void peer.closed().then((reason) => {
            if (connections.delete(connectionId)) {
              byHost.delete(key);
              emit("native://disconnected", {
                connectionId,
                reason: reason.includes("not_registered")
                  ? "not_registered"
                  : reason,
              });
            }
          });
          return { connectionId };
        })();
        byHost.set(key, connecting);
        void connecting.catch(() => {
          if (byHost.get(key) === connecting) byHost.delete(key);
        });
      }
      return byHost.get(key);
    },
    native_disconnect: ({ connectionId }) => {
      const peer = connections.get(string(connectionId));
      if (!peer) return;
      connections.delete(connectionId);
      for (const [key, pending] of byHost)
        void pending.then((value) => {
          if (
            value.connectionId === connectionId &&
            byHost.get(key) === pending
          )
            byHost.delete(key);
        });
      peer.close(0, Buffer.from("client disconnected"));
    },
    native_request: async ({ connectionId, json, cancelKey }) => {
      const method = JSON.parse(json).method;
      const replacement = onRequest?.(method);
      if (replacement !== undefined) return replacement;
      const id = cancelKey === undefined ? randomUUID() : string(cancelKey);
      const entry = await open(connectionId, id, json, true);
      try {
        const response = await readFrame(entry.stream, entry.connection);
        if (response === null)
          throw new Error("the response stream ended before a frame arrived");
        await onResponse?.(method, response);
        return transformResponse?.(method, response) ?? response;
      } finally {
        await stop(entry);
        if (streams.get(id) === entry) streams.delete(id);
      }
    },
    native_subscribe: async ({ connectionId, json, cancelKey }) => {
      const id = cancelKey === undefined ? randomUUID() : string(cancelKey);
      // The Client selects its new subscription before opening the stream.
      // Older subscriptions may still deliver frames after this selection.
      if (JSON.parse(json).method === "events")
        onHostEventStream?.({ connectionId, subscriptionId: id }, (json) =>
          emit("native://stream", { connectionId, subscriptionId: id, json }),
        );
      const entry = await open(connectionId, id, json, true);
      void receive(entry, id, connectionId, false);
      return { subscriptionId: id };
    },
    native_cancel_stream: async ({ streamId }) => {
      const id = string(streamId);
      const entry = streams.get(id);
      if (entry) await stop(entry);
      else {
        earlyCancels.add(id);
        if (earlyCancels.size > 64)
          earlyCancels.delete(earlyCancels.values().next().value);
      }
    },
    native_terminal_open: async ({ connectionId, streamId, json }) => {
      const id = string(streamId);
      const previous = streams.get(id);
      if (previous) await stop(previous);
      const entry = await open(connectionId, id, json, false);
      entry.terminal = true;
      void receive(entry, id, connectionId, true);
    },
    native_terminal_acknowledge: ({ streamId }) => {
      onTerminalEvent?.({
        stage: "ack",
        streamId,
        waiting: Boolean(streams.get(string(streamId))?.ack),
      });
      streams.get(string(streamId))?.ack?.();
    },
    native_terminal_write: ({ streamId, json }) => {
      const entry = streams.get(string(streamId));
      if (!entry || entry.cancelled)
        throw new Error("terminal stream is closed");
      const writing = entry.writer.then(() => writeFrame(entry.stream, json));
      entry.writer = writing.catch(() => {});
      return writing;
    },
    native_terminal_detach: async ({ streamId }) => {
      const id = string(streamId);
      const entry = streams.get(id);
      if (entry) {
        streams.delete(id);
        await stop(entry);
      }
    },
  };
  ws.on("message", (data) => {
    void (async () => {
      let id;
      try {
        const message = record(JSON.parse(data.toString()));
        if (!Number.isSafeInteger(message.id))
          throw new Error("invalid call id");
        id = message.id;
        if (!Object.hasOwn(commands, message.command))
          throw new Error("unsupported bridge command");
        const result = await commands[message.command](record(message.args));
        if (ws.readyState === WebSocket.OPEN)
          ws.send(JSON.stringify({ id, result }));
      } catch (error) {
        // Preserve the cause, without appending the request's json or other arguments.
        if (ws.readyState === WebSocket.OPEN)
          ws.send(
            JSON.stringify({
              id,
              // JSON.parse errors can quote invitation-bearing input fragments.
              error:
                error instanceof SyntaxError
                  ? "開発用bridgeがJSONを読み取れませんでした。"
                  : error.message,
            }),
          );
      }
    })();
  });
  const close = async () => {
    disposed = true;
    await Promise.all([...streams.values()].map(stop));
    for (const peer of connections.values())
      peer.close(0, Buffer.from("browser closed"));
    connections.clear();
    byHost.clear();
  };
  close.disconnect = async () => {
    const peers = [...connections.values()];
    for (const peer of peers)
      peer.close(0, Buffer.from("verification connection offline"));
    await Promise.all(peers.map((peer) => peer.closed()));
  };
  return close;
}

export async function startBridge({
  storageRoot,
  origin,
  onRequest,
  onResponse,
  transformResponse,
  onEvent,
  onHostEventStream,
  onTerminalEvent,
  updateSource,
  hostUninstall = false,
}) {
  const storage = await openStorage(storageRoot);
  const addon = loadNativeAddon();
  let endpoint;
  const server = createServer((_request, response) => {
    response.writeHead(404).end();
  });
  const wss = new WebSocketServer({
    noServer: true,
    maxPayload: MAX_FRAME_BYTES * 8,
  });
  const sessions = new Set();
  let offline = false;
  const token = randomBytes(32).toString("hex");
  try {
    // Match the product Client's endpoint(): both IP families on all interfaces,
    // with IPv4 fallback when IPv6 cannot bind. The shared Rust builder still
    // supplies iroh's authenticated, direct-only transport configuration.
    try {
      endpoint = await addon.Endpoint.bind(storage.identity.secretKey, [
        "0.0.0.0:0",
        "[::]:0",
      ]);
    } catch (ipv6Error) {
      try {
        endpoint = await addon.Endpoint.bind(storage.identity.secretKey, [
          "0.0.0.0:0",
        ]);
      } catch (ipv4Error) {
        throw new Error(
          `could not bind a network endpoint: ${ipv4Error.message}; IPv6 attempt: ${ipv6Error.message}`,
        );
      }
    }
    server.on("upgrade", (request, socket, head) => {
      // Loopback alone doesn't prevent a hostile web page from opening a socket.
      if (
        request.headers.origin !== origin ||
        request.url !== `/bridge/${token}`
      ) {
        socket.destroy();
        return;
      }
      wss.handleUpgrade(request, socket, head, (ws) => {
        const close = session(
          ws,
          endpoint,
          storage,
          onRequest,
          onResponse,
          transformResponse,
          onEvent,
          onHostEventStream,
          onTerminalEvent,
          () => offline,
          updateSource,
          hostUninstall,
        );
        sessions.add(close);
        ws.on("error", () => {});
        ws.once("close", () => {
          void close().finally(() => sessions.delete(close));
        });
      });
    });
    await new Promise((resolve, reject) => {
      server.once("error", reject);
      server.listen(0, "127.0.0.1", resolve);
    });
  } catch (error) {
    await endpoint?.close();
    storage.close();
    throw error;
  }
  return {
    url: `ws://127.0.0.1:${server.address().port}/bridge/${token}`,
    async sendTerminalInput(hostKey, addresses, terminalId, data) {
      const peer = await endpoint.connect(
        Buffer.from(hostKey, "hex"),
        await resolveAddresses(addresses),
      );
      const stream = await peer.openBi();
      try {
        await writeFrame(
          stream,
          JSON.stringify({
            kind: "terminal",
            operationId: randomUUID(),
            action: "open",
            terminalId,
            viewId: randomUUID(),
            deviceClass: "desktop",
            cols: 80,
            rows: 24,
            snapshotMaxLines: 100,
            snapshotMaxBytes: 1048576,
            viewAttributes: {
              foreground: [255, 255, 255],
              background: [0, 0, 0],
              cursor: [255, 255, 255],
              ansi: Array.from({ length: 256 }, () => [0, 0, 0]),
              colorSchemeMode: "dark",
              cursorStyle: "block",
              cursorBlink: false,
            },
          }),
        );
        const snapshot = JSON.parse(await readFrame(stream, peer));
        if (snapshot.kind !== "terminal.snapshot")
          throw new Error(
            `terminal snapshot unavailable: ${snapshot.message ?? snapshot.kind}`,
          );
        await writeFrame(
          stream,
          JSON.stringify({ kind: "terminal.input", data }),
        );
        await stream.finish();
      } finally {
        await stream.stop(0);
        peer.close(0, Buffer.from("verification complete"));
      }
    },
    async requestHost(hostKey, addresses, method, params) {
      const peer = await endpoint.connect(
        Buffer.from(hostKey, "hex"),
        await resolveAddresses(addresses),
      );
      const stream = await peer.openBi();
      try {
        await writeFrame(
          stream,
          JSON.stringify({
            kind: "request",
            operationId: randomUUID(),
            method,
            params,
          }),
        );
        await stream.finish();
        return JSON.parse(await readFrame(stream, peer));
      } finally {
        await stream.stop(0);
        peer.close(0, Buffer.from("verification complete"));
      }
    },
    async setOffline(value) {
      offline = value;
      if (value) {
        await Promise.all([...sessions].map((close) => close.disconnect()));
      }
    },
    async close() {
      for (const ws of wss.clients) ws.terminate();
      await Promise.all([...sessions].map((close) => close()));
      await endpoint.close();
      await new Promise((resolve) => wss.close(resolve));
      await new Promise((resolve) => server.close(resolve));
      storage.close();
    },
  };
}
