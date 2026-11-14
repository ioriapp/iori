import { stopTerminalDaemon } from "./terminal/daemon/launch.ts";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { createConnection, createServer } from "node:net";
import { createSocket, type Socket as DatagramSocket } from "node:dgram";
import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  FrameDecoder,
  decodeFrame,
  encodeFrame,
  eventSchema,
  inviteSchema,
  parseResponse,
  responseSchema,
} from "@iori/protocol";
import { loadNativeAddon } from "./native.ts";
import { startHost } from "./host.ts";
import { DaemonChannel } from "./terminal/daemon/channel.ts";
import { DAEMON_PROTOCOL } from "./terminal/daemon/protocol.ts";
import type {
  NativeAddon,
  NativeBiStream,
  NativeConnection,
  NativeEndpoint,
} from "./native.ts";

const READ_CHUNK_BYTES = 64 * 1024;

async function availablePort(): Promise<number> {
  const server = createServer();
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => resolve());
  });
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  const port = address.port;
  await new Promise<void>((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
  });
  return port;
}

async function readFrame(
  stream: NativeBiStream,
  decoder = new FrameDecoder(),
): Promise<unknown> {
  while (true) {
    const chunk = await stream.read(READ_CHUNK_BYTES);
    if (chunk === null) throw new Error("stream closed before a frame arrived");
    const frames = decoder.push(chunk);
    if (frames.length === 0) continue;
    assert.equal(frames.length, 1);
    return decodeFrame(frames[0]!);
  }
}

async function sendRequest(
  connection: NativeConnection,
  request: unknown,
): Promise<unknown> {
  const stream = await connection.openBi();
  await stream.write(Buffer.from(encodeFrame(request)));
  await stream.finish();
  return readFrame(stream);
}

async function connectClient(
  addon: NativeAddon,
  host: NativeEndpoint,
  port: number,
): Promise<{
  endpoint: NativeEndpoint;
  connection: NativeConnection;
  publicKey: string;
}> {
  const identity = addon.generateIdentity();
  const endpoint = await addon.Endpoint.bind(identity.secretKey, [
    "127.0.0.1:0",
  ]);
  identity.secretKey.fill(0);
  try {
    const connection = await endpoint.connect(
      Buffer.from(host.publicKeyHex, "hex"),
      [`127.0.0.1:${port}`],
    );
    return {
      endpoint,
      connection,
      publicKey: identity.publicKeyHex,
    };
  } catch (error) {
    await endpoint.close();
    throw error;
  }
}

async function readLocalInvite(
  dataHome: string,
): Promise<ReturnType<typeof inviteSchema.parse>> {
  const control = JSON.parse(
    await readFile(join(dataHome, "iori-host", "control.json"), "utf8"),
  ) as { port: number; token: string };
  const socket = createConnection({ host: "127.0.0.1", port: control.port });
  await new Promise<void>((resolve, reject) => {
    socket.once("connect", resolve);
    socket.once("error", reject);
  });

  const operationId = randomUUID();
  const frame = new Promise<unknown>((resolve, reject) => {
    const decoder = new FrameDecoder();
    const onData = (chunk: Buffer) => {
      try {
        const frames = decoder.push(chunk);
        if (frames.length > 0) {
          socket.off("error", onError);
          socket.off("data", onData);
          resolve(decodeFrame(frames[0]!));
        }
      } catch (error) {
        socket.off("error", onError);
        socket.off("data", onData);
        reject(error);
      }
    };
    const onError = (error: Error) => {
      socket.off("data", onData);
      reject(error);
    };
    socket.on("data", onData);
    socket.once("error", onError);
    socket.end(
      Buffer.from(
        encodeFrame({
          token: control.token,
          operationId,
          method: "invite.create",
          params: {},
        }),
      ),
    );
  });

  try {
    const response = parseResponse("invite.create", await frame);
    assert.equal(response.ok, true);
    if (!response.ok) throw new Error("local invite creation was rejected");
    return inviteSchema.parse(response.result.invite);
  } finally {
    socket.destroy();
  }
}

async function pair(
  client: Awaited<ReturnType<typeof connectClient>>,
  secret: string,
  deviceName: string,
): Promise<void> {
  const response = parseResponse(
    "pair",
    await sendRequest(client.connection, {
      kind: "request",
      operationId: randomUUID(),
      method: "pair",
      params: { secret, deviceName },
    }),
  );
  assert.equal(response.ok, true);
}

async function consumeUntilClosed(stream: NativeBiStream): Promise<void> {
  const decoder = new FrameDecoder();
  try {
    while (true) {
      const chunk = await stream.read(READ_CHUNK_BYTES);
      if (chunk === null) return;
      decoder.push(chunk);
    }
  } catch {
    return;
  }
}

// E2EではHost情報の取得を待つ間に端末登録を確実に重ねられないため、本物の接続で順序を確かめる。
test("events購読でHost情報の待機中に登録した端末は最初のsnapshotに含まれる", async () => {
  const addon = loadNativeAddon();
  const dataHome = await mkdtemp(join(tmpdir(), "iori-events-"));
  const port = await availablePort();
  const previousDataHome = process.env.XDG_DATA_HOME;
  const previousPort = process.env.IORI_HOST_PORT;
  process.env.XDG_DATA_HOME = dataHome;
  process.env.IORI_HOST_PORT = String(port);
  const descriptorPath = join(
    dataHome,
    "iori-host",
    "terminal-daemon",
    "connection.json",
  );
  const helloReceived = Promise.withResolvers<void>();
  const releaseHello = Promise.withResolvers<void>();
  const server = createServer((socket) => {
    const channel = new DaemonChannel(socket);
    channel.handle = async (method) => {
      assert.equal(method, "hello");
      helloReceived.resolve();
      await releaseHello.promise;
      return { version: DAEMON_PROTOCOL, pid: process.pid };
    };
  });
  let descriptor: string | undefined;
  let host: Awaited<ReturnType<typeof startHost>> | undefined;
  let administrator: Awaited<ReturnType<typeof connectClient>> | undefined;
  let newClient: Awaited<ReturnType<typeof connectClient>> | undefined;
  try {
    host = await startHost(addon);
    administrator = await connectClient(addon, host.endpoint, port);
    await pair(
      administrator,
      (await readLocalInvite(dataHome)).secret,
      "Admin",
    );
    const invite = parseResponse(
      "invite.create",
      await sendRequest(administrator.connection, {
        kind: "request",
        operationId: randomUUID(),
        method: "invite.create",
        params: {},
      }),
    );
    assert.equal(invite.ok, true);
    if (!invite.ok) throw new Error("invite creation failed");
    newClient = await connectClient(addon, host.endpoint, port);

    descriptor = await readFile(descriptorPath, "utf8");
    const endpoint =
      process.platform === "win32"
        ? `\\\\.\\pipe\\iori-events-${randomUUID()}`
        : join(dataHome, "daemon.sock");
    await new Promise<void>((resolve, reject) => {
      server.once("error", reject);
      server.listen(endpoint, resolve);
    });
    await writeFile(
      descriptorPath,
      JSON.stringify({ ...JSON.parse(descriptor), endpoint }),
    );
    const subscription = await administrator.connection.openBi();
    await subscription.write(
      Buffer.from(
        encodeFrame({
          kind: "subscribe",
          operationId: randomUUID(),
          method: "events",
          params: {},
        }),
      ),
    );
    await subscription.finish();
    await helloReceived.promise;
    await pair(newClient, invite.result.invite.secret, "New client");
    releaseHello.resolve();

    const first = eventSchema.parse(await readFrame(subscription));
    assert.equal(first?.type, "snapshot");
    if (first?.type !== "snapshot")
      throw new Error("first event was not a snapshot");
    assert.ok(
      first.devices.some((device) => device.publicKey === newClient!.publicKey),
    );
  } finally {
    releaseHello.resolve();
    if (descriptor !== undefined) await writeFile(descriptorPath, descriptor);
    for (const client of [newClient, administrator]) {
      if (client) {
        client.connection.close(0, Buffer.from("test cleanup"));
        await client.endpoint.close();
      }
    }
    if (server.listening)
      await new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      );
    await host?.close();
    await stopTerminalDaemon(join(dataHome, "iori-host"));
    if (previousDataHome === undefined) delete process.env.XDG_DATA_HOME;
    else process.env.XDG_DATA_HOME = previousDataHome;
    if (previousPort === undefined) delete process.env.IORI_HOST_PORT;
    else process.env.IORI_HOST_PORT = previousPort;
    await rm(dataHome, { recursive: true, force: true });
  }
});

// 通常UIは未登録の要求を出さず、接続と購読のstream終了も直接見られないため、実addon経路で確かめる。
test("Hostは未登録の端末管理・Host情報・フォルダー管理・Terminal一覧と既定shell設定・events購読を受け付けず、失効した接続を残さない", async () => {
  const addon = loadNativeAddon();
  const dataHome = await mkdtemp(join(tmpdir(), "iori-host-auth-"));
  const port = await availablePort();
  const previousDataHome = process.env.XDG_DATA_HOME;
  const previousPort = process.env.IORI_HOST_PORT;
  process.env.XDG_DATA_HOME = dataHome;
  process.env.IORI_HOST_PORT = String(port);

  let host: Awaited<ReturnType<typeof startHost>> | undefined;
  let unregistered: Awaited<ReturnType<typeof connectClient>> | undefined;
  let administrator: Awaited<ReturnType<typeof connectClient>> | undefined;
  let revoked: Awaited<ReturnType<typeof connectClient>> | undefined;
  try {
    host = await startHost(addon);
    unregistered = await connectClient(addon, host.endpoint, port);

    const unauthorizedRequests = [
      {
        kind: "request",
        operationId: randomUUID(),
        method: "devices.list",
        params: {},
      },
      {
        kind: "request",
        operationId: randomUUID(),
        method: "invite.create",
        params: {},
      },
      {
        kind: "request",
        operationId: randomUUID(),
        method: "devices.revoke",
        params: { publicKey: "0".repeat(64) },
      },
      {
        kind: "request",
        operationId: randomUUID(),
        method: "host.info",
        params: {},
      },
      {
        kind: "request",
        operationId: randomUUID(),
        method: "folders.browse",
        params: {},
      },
      {
        kind: "request",
        operationId: randomUUID(),
        method: "folders.history",
        params: {},
      },
      {
        kind: "request",
        operationId: randomUUID(),
        method: "folders.open",
        params: { path: join(tmpdir(), "not-opened") },
      },
      {
        kind: "request",
        operationId: randomUUID(),
        method: "folders.sidebar.remove",
        params: { path: join(tmpdir(), "not-opened") },
      },
      {
        kind: "request",
        operationId: randomUUID(),
        method: "terminal.list",
        params: {},
      },
      {
        kind: "request",
        operationId: randomUUID(),
        method: "terminal.defaultShell.set",
        params: { shell: "bash" },
      },
    ];
    for (const request of unauthorizedRequests) {
      const response = responseSchema.parse(
        await sendRequest(unregistered.connection, request),
      );
      assert.equal(response.ok, false);
      if (!response.ok) assert.equal(response.error.code, "not_registered");
    }

    const unauthorizedSubscription = await unregistered.connection.openBi();
    await unauthorizedSubscription.write(
      Buffer.from(
        encodeFrame({
          kind: "subscribe",
          operationId: randomUUID(),
          method: "events",
          params: {},
        }),
      ),
    );
    await unauthorizedSubscription.finish();
    const deniedSubscription = responseSchema.parse(
      await readFrame(unauthorizedSubscription),
    );
    assert.equal(deniedSubscription.ok, false);
    if (!deniedSubscription.ok)
      assert.equal(deniedSubscription.error.code, "not_registered");

    administrator = await connectClient(addon, host.endpoint, port);
    const firstInvite = await readLocalInvite(dataHome);
    await pair(administrator, firstInvite.secret, "Admin");

    const secondInviteResponse = parseResponse(
      "invite.create",
      await sendRequest(administrator.connection, {
        kind: "request",
        operationId: randomUUID(),
        method: "invite.create",
        params: {},
      }),
    );
    assert.equal(secondInviteResponse.ok, true);
    if (!secondInviteResponse.ok) {
      throw new Error("administrator invite creation was rejected");
    }
    const secondInvite = inviteSchema.parse(secondInviteResponse.result.invite);

    revoked = await connectClient(addon, host.endpoint, port);
    await pair(revoked, secondInvite.secret, "Revoked client");
    const subscription = await revoked.connection.openBi();
    const subscriptionDecoder = new FrameDecoder();
    await subscription.write(
      Buffer.from(
        encodeFrame({
          kind: "subscribe",
          operationId: randomUUID(),
          method: "events",
          params: {},
        }),
      ),
    );
    await subscription.finish();
    assert.equal(
      eventSchema.parse(await readFrame(subscription, subscriptionDecoder))
        ?.type,
      "snapshot",
    );

    const revokeResponse = parseResponse(
      "devices.revoke",
      await sendRequest(administrator.connection, {
        kind: "request",
        operationId: randomUUID(),
        method: "devices.revoke",
        params: { publicKey: revoked.publicKey },
      }),
    );
    assert.equal(revokeResponse.ok, true);

    const [closeReason] = await Promise.all([
      revoked.connection.closed(),
      consumeUntilClosed(subscription),
    ]);
    assert.equal(closeReason.includes("not_registered"), true);
  } finally {
    for (const client of [revoked, administrator, unregistered]) {
      if (client) {
        client.connection.close(0, Buffer.from("test cleanup"));
        await client.endpoint.close();
      }
    }
    await host?.close();
    await stopTerminalDaemon(join(dataHome, "iori-host"));
    if (previousDataHome === undefined) delete process.env.XDG_DATA_HOME;
    else process.env.XDG_DATA_HOME = previousDataHome;
    if (previousPort === undefined) delete process.env.IORI_HOST_PORT;
    else process.env.IORI_HOST_PORT = previousPort;
    await rm(dataHome, { recursive: true, force: true });
  }
});

// 通常UIは決まった画像の拡張子だけを送り、不正・欠落した値は作れないため、本物のHostへの要求で確かめる。
test("Hostは一覧に無い拡張子でファイルを作らない", async () => {
  const addon = loadNativeAddon();
  const dataHome = await mkdtemp(join(tmpdir(), "iori-host-image-"));
  const port = await availablePort();
  const previousDataHome = process.env.XDG_DATA_HOME;
  const previousPort = process.env.IORI_HOST_PORT;
  process.env.XDG_DATA_HOME = dataHome;
  process.env.IORI_HOST_PORT = String(port);
  let host: Awaited<ReturnType<typeof startHost>> | undefined;
  let client: Awaited<ReturnType<typeof connectClient>> | undefined;
  try {
    host = await startHost(addon);
    client = await connectClient(addon, host.endpoint, port);
    const invite = await readLocalInvite(dataHome);
    await pair(client, invite.secret, "Image client");
    const created = parseResponse(
      "terminal.create",
      await sendRequest(client.connection, {
        kind: "request",
        operationId: randomUUID(),
        method: "terminal.create",
        params: { cwd: dataHome },
      }),
    );
    assert.equal(created.ok, true);
    if (!created.ok) throw new Error("terminal creation failed");
    const terminalId = created.result.terminal.id;
    for (const extension of ["svg", "../outside", undefined]) {
      const response = responseSchema.parse(
        await sendRequest(client.connection, {
          kind: "request",
          operationId: randomUUID(),
          method: "terminal.image.write",
          params: {
            terminalId,
            imageId: randomUUID(),
            data: "aW1hZ2U=",
            extension,
            first: true,
            last: true,
          },
        }),
      );
      assert.deepEqual(response, {
        ok: false,
        error: { code: "invalid_request" },
      });
    }
    const directory = join(dataHome, "iori-host", "terminal-images");
    const files = await readdir(directory, { recursive: true }).catch(
      (error: NodeJS.ErrnoException) => {
        if (error.code === "ENOENT") return [];
        throw error;
      },
    );
    assert.deepEqual(files, []);
  } finally {
    if (client) {
      client.connection.close(0, Buffer.from("test cleanup"));
      await client.endpoint.close();
    }
    await host?.close();
    await stopTerminalDaemon(join(dataHome, "iori-host"));
    if (previousDataHome === undefined) delete process.env.XDG_DATA_HOME;
    else process.env.XDG_DATA_HOME = previousDataHome;
    if (previousPort === undefined) delete process.env.IORI_HOST_PORT;
    else process.env.IORI_HOST_PORT = previousPort;
    await rm(dataHome, { recursive: true, force: true });
  }
});

// 通常UIではHostの受信担当だけを終了できないため、本物のnative Endpointを閉じて復旧経路を確かめる。
test("Hostの受信用Endpointが外から閉じられても、同じ鍵で作り直して登録済みClientの新しい接続へ応答する", async (t) => {
  const addon = loadNativeAddon();
  const dataHome = await mkdtemp(join(tmpdir(), "iori-host-recovery-"));
  const port = await availablePort();
  const previousDataHome = process.env.XDG_DATA_HOME;
  const previousPort = process.env.IORI_HOST_PORT;
  process.env.XDG_DATA_HOME = dataHome;
  process.env.IORI_HOST_PORT = String(port);
  let host: Awaited<ReturnType<typeof startHost>> | undefined;
  let client: Awaited<ReturnType<typeof connectClient>> | undefined;
  try {
    host = await startHost(addon);
    client = await connectClient(addon, host.endpoint, port);
    const invite = await readLocalInvite(dataHome);
    await pair(client, invite.secret, "Recovery client");
    const subscription = await client.connection.openBi();
    await subscription.write(
      Buffer.from(
        encodeFrame({
          kind: "subscribe",
          operationId: randomUUID(),
          method: "events",
          params: {},
        }),
      ),
    );
    await subscription.finish();
    assert.equal(
      eventSchema.parse(await readFrame(subscription))?.type,
      "snapshot",
    );

    const previousEndpoint = host.endpoint;
    const publicKey = previousEndpoint.publicKeyHex;
    const restoreStarted = performance.now();
    await previousEndpoint.close();
    await Promise.all([
      client.connection.closed(),
      consumeUntilClosed(subscription),
    ]);
    while (host.endpoint === previousEndpoint) {
      await new Promise<void>((resolve) => setTimeout(resolve, 10));
    }
    t.diagnostic(
      `Endpoint recovery: ${Math.round(performance.now() - restoreStarted)} ms`,
    );
    assert.equal(host.endpoint.publicKeyHex, publicKey);
    // Keep the real closed wrappers alive: no JavaScript GC is needed to bind
    // the port again, and later actions must reject without a native panic.
    await assert.rejects(client.connection.openBi(), /closed/);
    await assert.rejects(client.connection.acceptBi(), /closed/);
    assert.throws(() => client!.connection.paths(), /closed/);
    for (const action of [
      () => subscription.read(1),
      () => subscription.write(Buffer.from("closed")),
      () => subscription.finish(),
      () => subscription.reset(0),
      () => subscription.stop(0),
      () => subscription.bytesRead(),
      () => subscription.stopped(),
    ])
      await assert.rejects(action, /closed|stopped|reset|connection lost/);
    client.connection = await client.endpoint.connect(
      Buffer.from(publicKey, "hex"),
      [`127.0.0.1:${port}`],
    );
    const response = parseResponse(
      "host.info",
      await sendRequest(client.connection, {
        kind: "request",
        operationId: randomUUID(),
        method: "host.info",
        params: {},
      }),
    );
    assert.equal(response.ok, true);
    await host.close();
    host = undefined;
  } finally {
    if (client) {
      client.connection.close(0, Buffer.from("test cleanup"));
      await client.endpoint.close();
    }
    await host?.close();
    await stopTerminalDaemon(join(dataHome, "iori-host"));
    if (previousDataHome === undefined) delete process.env.XDG_DATA_HOME;
    else process.env.XDG_DATA_HOME = previousDataHome;
    if (previousPort === undefined) delete process.env.IORI_HOST_PORT;
    else process.env.IORI_HOST_PORT = previousPort;
    await rm(dataHome, { recursive: true, force: true });
  }
});

// E2E cannot prevent V8 from collecting native stream wrappers. Keep the Host's
// wrappers alive so cancellation must return QUIC stream credit without GC.
test("取り消した監視・events購読・読み取りのstreamがGC待ちで接続の枠を塞がない", async (t) => {
  const addon = loadNativeAddon();
  const retained: NativeBiStream[] = [];
  const trackedAddon: NativeAddon = {
    ...addon,
    Endpoint: new Proxy({} as typeof addon.Endpoint, {
      get(target, key, receiver) {
        if (key !== "bind") return Reflect.get(addon.Endpoint, key, receiver);
        return async (...args: Parameters<typeof addon.Endpoint.bind>) => {
          const endpoint = await addon.Endpoint.bind(...args);
          return new Proxy(endpoint, {
            get(target, key) {
              if (key === "accept")
                return async () => {
                  const incoming = await target.accept();
                  if (!incoming) return incoming;
                  return new Proxy(incoming, {
                    get(target, key) {
                      if (key === "handshake")
                        return async () => {
                          const connection = await target.handshake();
                          return new Proxy(connection, {
                            get(target, key) {
                              if (key === "acceptBi")
                                return async () => {
                                  const stream = await target.acceptBi();
                                  retained.push(stream);
                                  return stream;
                                };
                              const value = Reflect.get(target, key, target);
                              return typeof value === "function"
                                ? value.bind(target)
                                : value;
                            },
                          });
                        };
                      const value = Reflect.get(target, key, target);
                      return typeof value === "function"
                        ? value.bind(target)
                        : value;
                    },
                  });
                };
              const value = Reflect.get(target, key, target);
              return typeof value === "function" ? value.bind(target) : value;
            },
          });
        };
      },
    }),
  };
  const dataHome = await mkdtemp(join(tmpdir(), "iori-cancelled-streams-"));
  const previousDataHome = process.env.XDG_DATA_HOME;
  const previousPort = process.env.IORI_HOST_PORT;
  const port = await availablePort();
  process.env.XDG_DATA_HOME = dataHome;
  process.env.IORI_HOST_PORT = String(port);
  let host: Awaited<ReturnType<typeof startHost>> | undefined;
  let client: Awaited<ReturnType<typeof connectClient>> | undefined;
  try {
    t.signal.addEventListener(
      "abort",
      () => {
        void client?.endpoint.close();
      },
      { once: true },
    );
    host = await startHost(trackedAddon);
    client = await connectClient(addon, host.endpoint, port);
    await pair(
      client,
      (await readLocalInvite(dataHome)).secret,
      "Cancellation client",
    );
    // noq's default connection credit is 100 bidirectional streams. Exercise
    // both subscription paths beyond that credit, retaining every Host wrapper.
    for (const method of ["reading.watch", "events"] as const) {
      for (let index = 0; index < 128; index += 1) {
        const stream = await client.connection.openBi();
        await stream.write(
          Buffer.from(
            encodeFrame({
              kind: "subscribe",
              operationId: randomUUID(),
              method,
              params:
                method === "events" ? {} : { root: dataHome, scope: "files" },
            }),
          ),
        );
        await stream.finish();
        const event = (await readFrame(stream)) as { type: string };
        assert.equal(
          event.type,
          method === "events" ? "snapshot" : "reading.changed",
        );
        await stream.stop(0);
      }
    }
    for (let index = 0; index < 128; index += 1) {
      const stream = await client.connection.openBi();
      await stream.write(
        Buffer.from(
          encodeFrame({
            kind: "request",
            operationId: randomUUID(),
            method: "files.list",
            params: { root: dataHome, path: "", start: 0, count: 10 },
          }),
        ),
      );
      await stream.finish();
      await stream.stop(0);
    }
    const response = responseSchema.parse(
      await sendRequest(client.connection, {
        kind: "request",
        operationId: randomUUID(),
        method: "host.info",
        params: {},
      }),
    );
    assert.equal(response.ok, true);
    assert.ok(retained.length >= 386);
  } finally {
    if (client) {
      client.connection.close(0, Buffer.from("test cleanup"));
      await client.endpoint.close();
    }
    await host?.close();
    await stopTerminalDaemon(join(dataHome, "iori-host"));
    if (previousDataHome === undefined) delete process.env.XDG_DATA_HOME;
    else process.env.XDG_DATA_HOME = previousDataHome;
    if (previousPort === undefined) delete process.env.IORI_HOST_PORT;
    else process.env.IORI_HOST_PORT = previousPort;
    await rm(dataHome, { recursive: true, force: true });
  }
});

// 通常UIでは未登録の鍵100個の接続を保持したり、枠の長さだけを不正に送れないため、実Hostと実addonを使う。
test("未登録の接続100本と未完のhandshake10本が残っていても登録済みの端末が新しく要求でき、古い接続と1KiBを超す枠を閉じる", async () => {
  const addon = loadNativeAddon();
  const dataHome = await mkdtemp(join(tmpdir(), "iori-host-pre-auth-"));
  const port = await availablePort();
  const previousDataHome = process.env.XDG_DATA_HOME;
  const previousPort = process.env.IORI_HOST_PORT;
  process.env.XDG_DATA_HOME = dataHome;
  process.env.IORI_HOST_PORT = String(port);
  let host: Awaited<ReturnType<typeof startHost>> | undefined;
  const clients: Awaited<ReturnType<typeof connectClient>>[] = [];
  const proxies: DatagramSocket[] = [];
  const stalled: NativeEndpoint[] = [];
  const attempts: Promise<void>[] = [];
  const releaseReplies: (() => void)[] = [];
  let cleaningUp = false;
  try {
    host = await startHost(addon);
    const registered = await connectClient(addon, host.endpoint, port);
    clients.push(registered);
    await pair(
      registered,
      (await readLocalInvite(dataHome)).secret,
      "😀".repeat(63),
    );
    registered.connection.close(
      0,
      Buffer.from("reconnect after filling slots"),
    );
    await registered.connection.closed();
    const request = {
      kind: "request",
      operationId: randomUUID(),
      method: "host.info",
      params: {},
    };
    for (let index = 0; index < 100; index += 1) {
      const client = await connectClient(addon, host.endpoint, port);
      clients.push(client);
      assert.deepEqual(await sendRequest(client.connection, request), {
        ok: false,
        error: { code: "not_registered" },
      });
    }
    // Forward each client's Initial to the real Host, but retain the Host's
    // reply. These are real, started QUIC handshakes without client completion.
    for (let index = 0; index < 10; index += 1) {
      const proxy = createSocket("udp4");
      proxies.push(proxy);
      await new Promise<void>((resolve) => proxy.bind(0, "127.0.0.1", resolve));
      const identity = addon.generateIdentity();
      const client = await addon.Endpoint.bind(identity.secretKey, [
        "127.0.0.1:0",
      ]);
      identity.secretKey.fill(0);
      stalled.push(client);
      const replied = Promise.withResolvers<void>();
      let clientPort: number | undefined;
      let releasing = false;
      const held: Buffer[] = [];
      releaseReplies.push(() => {
        releasing = true;
        for (const packet of held) proxy.send(packet, clientPort!, "127.0.0.1");
        held.length = 0;
      });
      proxy.on("message", (packet, remote) => {
        if (remote.port === port) {
          replied.resolve();
          if (releasing) proxy.send(packet, clientPort!, "127.0.0.1");
          else held.push(packet);
        } else {
          clientPort = remote.port;
          proxy.send(packet, port, "127.0.0.1");
        }
      });
      attempts.push(
        client
          .connect(Buffer.from(host.endpoint.publicKeyHex, "hex"), [
            `127.0.0.1:${proxy.address().port}`,
          ])
          .then(
            (connection) => {
              connection.close(0, Buffer.from("test cleanup"));
              if (!cleaningUp)
                throw new Error("held handshake unexpectedly completed");
            },
            () => {},
          ),
      );
      await replied.promise;
    }
    registered.connection = await registered.endpoint.connect(
      Buffer.from(host.endpoint.publicKeyHex, "hex"),
      [`127.0.0.1:${port}`],
    );
    assert.equal(
      responseSchema.parse(await sendRequest(registered.connection, request))
        .ok,
      true,
    );
    const next = await connectClient(addon, host.endpoint, port);
    clients.push(next);
    assert.equal(
      responseSchema.parse(await sendRequest(next.connection, request)).ok,
      false,
    );
    assert.ok(
      (await clients[1]!.connection.closed()).includes(
        "pre-auth connection limit",
      ),
    );
    const oversized = await next.connection.openBi();
    const header = Buffer.alloc(4);
    header.writeUInt32BE(1025);
    await oversized.write(header);
    assert.ok(
      (await next.connection.closed()).includes("invalid request frame"),
    );
    assert.equal(
      responseSchema.parse(await sendRequest(registered.connection, request))
        .ok,
      true,
    );
  } finally {
    // Release the transport for cleanup instead of waiting for QUIC's idle expiry.
    cleaningUp = true;
    for (const release of releaseReplies) release();
    await Promise.all(attempts);
    for (const endpoint of stalled) await endpoint.close();
    for (const proxy of proxies)
      await new Promise<void>((resolve) => proxy.close(() => resolve()));
    for (const client of clients) {
      client.connection.close(0, Buffer.from("test cleanup"));
      await client.endpoint.close();
    }
    await host?.close();
    await stopTerminalDaemon(join(dataHome, "iori-host"));
    if (previousDataHome === undefined) delete process.env.XDG_DATA_HOME;
    else process.env.XDG_DATA_HOME = previousDataHome;
    if (previousPort === undefined) delete process.env.IORI_HOST_PORT;
    else process.env.IORI_HOST_PORT = previousPort;
    await rm(dataHome, { recursive: true, force: true });
  }
});
