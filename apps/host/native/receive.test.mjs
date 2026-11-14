import assert from "node:assert/strict";
import { performance } from "node:perf_hooks";
import test from "node:test";
import addon from "./index.js";

test("応答の受信確認の後に相手が閉じても、受信済みの本文を読み込める", async () => {
  const serverIdentity = addon.generateIdentity();
  const clientIdentity = addon.generateIdentity();
  const server = await addon.Endpoint.bind(serverIdentity.secretKey, [
    "127.0.0.1:0",
  ]);
  const client = await addon.Endpoint.bind(clientIdentity.secretKey, [
    "127.0.0.1:0",
  ]);
  const body = Buffer.from(
    JSON.stringify({ ok: true, result: { relay: null } }),
  );
  const header = Buffer.alloc(4);
  header.writeUInt32BE(body.length);
  try {
    const responding = (async () => {
      const peer = await (await server.accept()).handshake();
      const stream = await peer.acceptBi();
      await stream.read(1024);
      await stream.write(Buffer.concat([header, body]));
      await stream.finish();
      await stream.stopped();
      await server.close();
    })();
    const peer = await client.connect(
      Buffer.from(serverIdentity.publicKeyHex, "hex"),
      server.boundSockets,
    );
    const stream = await peer.openBi();
    await stream.write(Buffer.from("request"));
    await stream.finish();
    assert.deepEqual(await stream.read(4), header);
    // Occupy only JavaScript while native QUIC acknowledges the response and closes.
    const until = performance.now() + 200;
    while (performance.now() < until) {}
    await responding;
    await peer.closed();
    const chunks = [];
    let remaining = header.readUInt32BE();
    while (remaining > 0) {
      const chunk = await stream.read(remaining);
      assert.notEqual(chunk, null);
      chunks.push(chunk);
      remaining -= chunk.length;
    }
    assert.deepEqual(Buffer.concat(chunks), body);
    assert.equal(await stream.read(1), null);
  } finally {
    await client.close();
    await server.close();
  }
});
