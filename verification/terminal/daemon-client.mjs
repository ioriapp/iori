import { createConnection } from "node:net";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { stripVTControlCharacters } from "node:util";
import {
  FrameDecoder,
  decodeFrame,
  encodeFrame,
} from "../../packages/protocol/src/index.ts";
import addon from "../../apps/host/native/index.js";

async function invitation(root) {
  const control = JSON.parse(
    await readFile(join(root, "control.json"), "utf8"),
  );
  const socket = createConnection({ host: "127.0.0.1", port: control.port });
  await new Promise((resolve, reject) => {
    socket.once("connect", resolve);
    socket.once("error", reject);
  });
  try {
    socket.end(
      Buffer.from(
        encodeFrame({
          token: control.token,
          operationId: randomUUID(),
          method: "invite.create",
          params: {},
        }),
      ),
    );
    const decoder = new FrameDecoder();
    for await (const chunk of socket)
      for (const frame of decoder.push(chunk)) {
        const response = decodeFrame(frame);
        if (!response.ok) throw new Error("Invite rejected");
        return response.result.invite;
      }
    throw new Error("Invite connection closed");
  } finally {
    socket.destroy();
  }
}

export async function terminalClient(root, port) {
  const invite = await invitation(root);
  const identity = addon.generateIdentity();
  const endpoint = await addon.Endpoint.bind(identity.secretKey, [
    "127.0.0.1:0",
  ]);
  identity.secretKey.fill(0);
  let connection;
  const connect = async () => {
    connection = await endpoint.connect(Buffer.from(invite.hostKey, "hex"), [
      `127.0.0.1:${port}`,
    ]);
  };
  const request = async (method, params = {}) => {
    const stream = await connection.openBi();
    await stream.write(
      Buffer.from(
        encodeFrame({
          kind: "request",
          operationId: randomUUID(),
          method,
          params,
        }),
      ),
    );
    await stream.finish();
    const decoder = new FrameDecoder();
    for (;;) {
      const chunk = await stream.read(65536);
      if (chunk === null) throw new Error("Request stream closed");
      for (const frame of decoder.push(chunk)) {
        const response = decodeFrame(frame);
        if (!response.ok)
          throw new Error(`${method} rejected: ${response.error.code}`);
        return response.result;
      }
    }
  };
  await connect();
  await request("pair", {
    secret: invite.secret,
    deviceName: "Terminal lifecycle verification",
  });
  return {
    request,
    reconnect: connect,
    async open(id) {
      const stream = await connection.openBi();
      const observation = {
        text: "",
        snapshot: false,
        stream,
        error: undefined,
      };
      await stream.write(
        Buffer.from(
          encodeFrame({
            kind: "terminal",
            action: "open",
            operationId: randomUUID(),
            terminalId: id,
            viewId: randomUUID(),
            deviceClass: "desktop",
            cols: 100,
            rows: 30,
            snapshotMaxLines: 5000,
            snapshotMaxBytes: 4 * 1024 * 1024,
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
        ),
      );
      const decoder = new FrameDecoder();
      observation.task = (async () => {
        for (;;) {
          const chunk = await stream.read(65536);
          if (chunk === null) return;
          for (const bytes of decoder.push(chunk)) {
            const frame = decodeFrame(bytes);
            if (frame.kind === "terminal.snapshot") {
              observation.snapshot = true;
              observation.text += stripVTControlCharacters(
                frame.snapshot.scrollbackAnsi + frame.snapshot.snapshotAnsi,
              );
            } else if (frame.kind === "terminal.error") {
              observation.error = new Error(frame.message);
            } else if (frame.kind === "terminal.output")
              observation.text += stripVTControlCharacters(frame.data);
          }
        }
      })().catch(() => {});
      observation.input = (data) =>
        stream.write(
          Buffer.from(encodeFrame({ kind: "terminal.input", data })),
        );
      return observation;
    },
    async close() {
      connection?.close(0, Buffer.alloc(0));
      await endpoint.close();
    },
  };
}
