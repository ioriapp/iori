import assert from "node:assert/strict";
import test from "node:test";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import { randomUUID } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { createConnection } from "node:net";
import { networkInterfaces } from "node:os";
import { join } from "node:path";
import {
  FrameDecoder,
  decodeFrame,
  encodeFrame,
} from "../../packages/protocol/src/index.ts";
import { loadNativeAddon } from "../../apps/host/src/native.ts";
import { runHostTest } from "../../verification/host/process.mjs";

async function localRequest(dataRoot, method) {
  const control = JSON.parse(
    await readFile(join(dataRoot, "iori-host", "control.json"), "utf8"),
  );
  const socket = createConnection({ host: "127.0.0.1", port: control.port });
  try {
    const response = new Promise((resolve, reject) => {
      const decoder = new FrameDecoder();
      socket.on("data", (chunk) => {
        const frames = decoder.push(chunk);
        if (frames.length) resolve(decodeFrame(frames[0]));
      });
      socket.once("error", reject);
      socket.once("end", () => reject(new Error("Host closed local control")));
    });
    socket.end(
      Buffer.from(
        encodeFrame({
          token: control.token,
          operationId: randomUUID(),
          method,
          params: {},
        }),
      ),
    );
    const result = await response;
    assert.equal(result.ok, true);
    return result.result;
  } finally {
    socket.destroy();
  }
}

// 「許可しない」の Host には LAN から届かず、後から許可すると同じ Host に届く。
test("このPCだけのHostは外からの接続と招待を拒み、許可後は同じ鍵とportで接続できる", (t) =>
  runHostTest(t, async ({ client, dataRoot, restart, stage }) => {
    const address = Object.values(networkInterfaces())
      .flat()
      .find((entry) => entry.family === "IPv4" && !entry.internal)?.address;
    assert.ok(address);
    const addon = loadNativeAddon();
    const identity = addon.generateIdentity();
    const endpoint = await addon.Endpoint.bind(identity.secretKey, [
      `${address}:0`,
    ]);
    identity.secretKey.fill(0);
    t.after(() => endpoint.close());
    const before = await client.request("host.info");
    const port = Number(before.addresses[0].split(":").at(-1));
    const target = `${address}:${port}`;
    stage("設定の無いHostにはLANから届く");
    const original = await endpoint.connect(
      Buffer.from(before.publicKey, "hex"),
      [target],
    );
    original.close(0, Buffer.from("done"));
    stage("このPCだけの設定でHostを起動する");
    client = await restart({
      whileStopped: () =>
        writeFile(
          join(dataRoot, "iori-host", "network.json"),
          JSON.stringify({ scope: "loopback" }),
        ),
    });
    const local = await client.request("host.info");
    assert.equal(local.connectionScope, "loopback");
    assert.ok(
      local.addresses.includes(
        `127.0.0.1:${local.addresses[0].split(":").at(-1)}`,
      ),
    );
    assert.ok(
      local.addresses.every(
        (address) =>
          address.startsWith("127.0.0.1:") || address.startsWith("[::1]:"),
      ),
    );
    stage("ほかのデバイス向けの招待は作れない");
    await assert.rejects(
      client.request("invite.create"),
      /Host request failed/u,
    );
    stage("コマンドの招待もQRやコードを表示しない");
    await assert.rejects(
      promisify(execFile)(
        process.execPath,
        [
          fileURLToPath(
            new URL("../../apps/host/src/invite-cli.ts", import.meta.url),
          ),
        ],
        { env: { ...process.env, XDG_DATA_HOME: dataRoot } },
      ),
      (error) =>
        error.code === 1 &&
        error.stdout === "" &&
        error.stderr.trim() ===
          "This PC can connect. To connect from other devices, select “Allow connections from other devices” in Connection settings.",
    );
    stage("LANアドレスでは接続を受けない");
    const localPort = local.addresses[0].split(":").at(-1);
    await assert.rejects(
      endpoint.connect(Buffer.from(local.publicKey, "hex"), [
        `${address}:${localPort}`,
      ]),
    );
    stage("このPCの制御から接続を許可する");
    await localRequest(dataRoot, "host.connections.allow");
    const { invite } = await localRequest(dataRoot, "invite.create");
    assert.ok(invite.addresses.includes(`${address}:${localPort}`));
    const connected = await endpoint.connect(
      Buffer.from(local.publicKey, "hex"),
      [`${address}:${localPort}`],
    );
    connected.close(0, Buffer.from("done"));
    stage("再起動後もLANから接続できる");
    client = await restart();
    const restarted = await client.request("host.info");
    assert.equal(restarted.publicKey, local.publicKey);
    const afterRestart = await endpoint.connect(
      Buffer.from(restarted.publicKey, "hex"),
      [`${address}:${restarted.addresses[0].split(":").at(-1)}`],
    );
    afterRestart.close(0, Buffer.from("done"));
  }));

// 壊れた設定でもHostが起動し、このPCの中だけで接続を受ける。
test("壊れたnetwork.jsonでもHostが起動しLANからの接続を拒む", (t) =>
  runHostTest(t, async ({ client, dataRoot, restart, stage }) => {
    stage("壊れた設定でHostを起動する");
    client = await restart({
      whileStopped: () =>
        writeFile(join(dataRoot, "iori-host", "network.json"), "{"),
    });
    const info = await client.request("host.info");
    assert.equal(info.connectionScope, "loopback");
    const address = Object.values(networkInterfaces())
      .flat()
      .find((entry) => entry.family === "IPv4" && !entry.internal)?.address;
    assert.ok(address);
    const addon = loadNativeAddon();
    const identity = addon.generateIdentity();
    const endpoint = await addon.Endpoint.bind(identity.secretKey, [
      `${address}:0`,
    ]);
    identity.secretKey.fill(0);
    t.after(() => endpoint.close());
    stage("LANからの接続を拒む");
    await assert.rejects(
      endpoint.connect(Buffer.from(info.publicKey, "hex"), [
        `${address}:${info.addresses[0].split(":").at(-1)}`,
      ]),
    );
  }));
