import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { createConnection } from "node:net";
import { join } from "node:path";
import {
  FrameDecoder,
  decodeFrame,
  encodeFrame,
  parseResponse,
} from "../../packages/protocol/src/index.ts";
import { loadNativeAddon } from "../../apps/host/src/native.ts";

async function* frames(stream) {
  const decoder = new FrameDecoder();
  for (;;) {
    const chunk = await stream.read(64 * 1024);
    if (chunk === null) return;
    for (const frame of decoder.push(chunk)) yield decodeFrame(frame);
  }
}

async function first(stream) {
  let response;
  // Read the normal response through FIN. A completed receive half no longer
  // accepts stop(), so cleanup must not stop it a second time.
  for await (const frame of frames(stream)) response ??= frame;
  if (response !== undefined) return response;
  throw new Error("Hostが応答の前に接続を閉じました");
}

// The normal local control socket creates the invite; secrets stay in memory.
async function localInvite(dataRoot) {
  const control = JSON.parse(
    await readFile(join(dataRoot, "iori-host", "control.json"), "utf8"),
  );
  const socket = createConnection({ host: "127.0.0.1", port: control.port });
  try {
    await new Promise((resolve, reject) => {
      socket.once("connect", resolve);
      socket.once("error", reject);
    });
    const response = new Promise((resolve, reject) => {
      const decoder = new FrameDecoder();
      socket.on("data", (chunk) => {
        try {
          const complete = decoder.push(chunk);
          if (complete.length) resolve(decodeFrame(complete[0]));
        } catch (error) {
          reject(error);
        }
      });
      socket.once("error", reject);
      socket.once("end", () => reject(new Error("招待を取得できません")));
    });
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
    const result = parseResponse("invite.create", await response);
    if (!result.ok) throw new Error("招待を作れません");
    return result.result.invite;
  } finally {
    socket.destroy();
  }
}

const SUBSCRIPTION_ENDED = "Hostの購読が終了しました";

function observation(stream, select) {
  const values = [];
  const waiters = new Set();
  let ended;
  const consuming = (async () => {
    try {
      for await (const frame of frames(stream)) {
        values.push(select(frame));
        for (const wake of waiters) wake();
      }
      ended = new Error(SUBSCRIPTION_ENDED);
    } catch (error) {
      ended = error;
    } finally {
      for (const wake of waiters) wake();
    }
  })();
  return {
    values,
    async waitFor(predicate) {
      for (;;) {
        const found = values.find(predicate);
        if (found !== undefined) return found;
        if (ended) throw ended;
        await new Promise((resolve) => {
          const wake = () => {
            waiters.delete(wake);
            resolve();
          };
          waiters.add(wake);
        });
      }
    },
    finished: consuming,
  };
}

/** A native iroh client paired through the same invite flow as the Client. */
export async function connectClient(dataRoot) {
  const invite = await localInvite(dataRoot);
  const addon = loadNativeAddon();
  const identity = addon.generateIdentity();
  const endpoint = await addon.Endpoint.bind(identity.secretKey, [
    "127.0.0.1:0",
  ]);
  identity.secretKey.fill(0);
  let peer;
  const subscriptions = new Set();
  const open = async (envelope, finish = true) => {
    const stream = await peer.openBi();
    await stream.write(Buffer.from(encodeFrame(envelope)));
    if (finish) await stream.finish();
    return stream;
  };
  const request = async (method, params = {}) => {
    const stream = await open({
      kind: "request",
      operationId: randomUUID(),
      method,
      params,
    });
    const response = parseResponse(method, await first(stream));
    if (!response.ok)
      throw new Error(
        `Host request failed: ${method} (${response.error.code})`,
      );
    return response.result;
  };
  try {
    peer = await endpoint.connect(
      Buffer.from(invite.hostKey, "hex"),
      invite.addresses,
    );
    await request("pair", { secret: invite.secret, deviceName: "Host E2E" });
  } catch (error) {
    peer?.close(0, Buffer.from("cleanup"));
    await endpoint.close();
    throw error;
  }
  return {
    request,
    async readingWatch(root, scope) {
      const stream = await open({
        kind: "subscribe",
        operationId: randomUUID(),
        method: "reading.watch",
        params: { root, scope },
      });
      const watch = observation(stream, (frame) => frame);
      subscriptions.add(watch);
      return watch;
    },
    async events() {
      const stream = await open({
        kind: "subscribe",
        operationId: randomUUID(),
        method: "events",
        params: {},
      });
      const events = observation(stream, (frame) => frame);
      subscriptions.add(events);
      return events;
    },
    /** Like a Client, reopen a Terminal whose stream ended with an earlier PTY. */
    async terminalUntil(terminalId, predicate) {
      for (;;) {
        const terminal = await this.terminal(terminalId);
        try {
          return await terminal.waitFor(predicate);
        } catch (error) {
          if (error.message !== SUBSCRIPTION_ENDED) throw error;
        }
      }
    },
    async terminal(
      terminalId,
      { cols = 120, rows = 24, deviceClass = "desktop", claimSize } = {},
    ) {
      const stream = await open(
        {
          kind: "terminal",
          operationId: randomUUID(),
          action: "open",
          terminalId,
          viewId: randomUUID(),
          deviceClass,
          cols,
          rows,
          ...(claimSize === undefined ? {} : { claimSize }),
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
        },
        false,
      );
      let output = "";
      const terminal = observation(stream, (frame) => {
        if (frame.kind === "terminal.snapshot")
          output += frame.snapshot.scrollbackAnsi + frame.snapshot.snapshotAnsi;
        if (frame.kind === "terminal.output") output += frame.data;
        return { frame, output };
      });
      subscriptions.add(terminal);
      await terminal.waitFor(({ frame }) => frame.kind === "terminal.snapshot");
      return {
        ...terminal,
        resize: (cols, rows) =>
          stream.write(
            Buffer.from(encodeFrame({ kind: "terminal.resize", cols, rows })),
          ),
        focus: (cols, rows) =>
          stream.write(
            Buffer.from(encodeFrame({ kind: "terminal.focus", cols, rows })),
          ),
        input: (data) =>
          stream.write(
            Buffer.from(encodeFrame({ kind: "terminal.input", data })),
          ),
        // A RegExp waits for the whole match, e.g. a line through its newline.
        output: async (text) =>
          (
            await terminal.waitFor(({ output }) =>
              text instanceof RegExp
                ? text.test(output)
                : output.includes(text),
            )
          ).output,
      };
    },
    async close() {
      peer.close(0, Buffer.from("cleanup"));
      try {
        await Promise.all([...subscriptions].map((entry) => entry.finished));
      } finally {
        await endpoint.close();
      }
    },
  };
}
