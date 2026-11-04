import assert from "node:assert/strict";
import test from "node:test";
import { randomUUID } from "node:crypto";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setImmediate as nextTurn } from "node:timers/promises";
import {
  FrameDecoder,
  decodeFrame,
  terminalServerMessageSchema,
  encodeFrame,
  type TerminalOpenStream,
} from "@iori/protocol";
import { HostStore } from "../store.ts";
import { loadNativeAddon, type NativeBiStream } from "../native.ts";
import { TerminalManager } from "./manager.ts";
import { stopTerminalDaemon } from "./daemon/launch.ts";

async function* frames(stream: NativeBiStream) {
  const decoder = new FrameDecoder();
  for (;;) {
    const chunk = await stream.read(65536);
    if (chunk === null) return;
    for (const frame of decoder.push(chunk)) {
      const message = decodeFrame(frame);
      yield message;
    }
  }
}

// E2E cannot suspend a native write at an arbitrary output boundary while a
// second receiver drains. The shell fixture is Linux-only, matching this
// verification boundary. Only that write is gated: both directions use real
// QUIC streams, and input runs through the real runtime, daemon and shell.
test(
  "retiring overflowing output never drops queued input or restores its old PTY size",
  { skip: process.platform !== "linux" },
  async (t) => {
    const root = await mkdtemp(join(tmpdir(), "iori-terminal-input-drain-"));
    const store = new HostStore(join(root, "host.sqlite"));
    const terminals = await TerminalManager.create(store, () => {}, root);
    const addon = loadNativeAddon();
    const server = await addon.Endpoint.bind(
      addon.generateIdentity().secretKey,
      ["127.0.0.1:0"],
    );
    const client = await addon.Endpoint.bind(
      addon.generateIdentity().secretKey,
      ["127.0.0.1:0"],
    );
    const release = Promise.withResolvers<void>();
    const retired = Promise.withResolvers<void>();
    let holdOutput = false;
    t.after(async () => {
      release.resolve();
      await Promise.all([client.close(), server.close()]);
      await terminals.close();
      await stopTerminalDaemon(root);
      store.close();
      await rm(root, { recursive: true, force: true });
    });
    const created = await terminals.createTerminal(
      { clientPublicKey: "test", operationId: randomUUID() },
      root,
    );
    assert.ok(created.ok);
    const accepted = server.accept().then((incoming) => {
      assert.ok(incoming);
      return incoming.handshake();
    });
    const connection = await client.connect(
      Buffer.from(server.publicKeyHex, "hex"),
      server.boundSockets,
    );
    const host = await accepted;
    const open = (viewId: string): TerminalOpenStream => ({
      kind: "terminal",
      action: "open",
      operationId: randomUUID(),
      terminalId: created.result.terminal.id,
      viewId,
      deviceClass: "desktop",
      cols: 80,
      rows: 24,
      snapshotMaxLines: 100,
      snapshotMaxBytes: 1024 * 1024,
      viewAttributes: {
        foreground: [255, 255, 255],
        background: [0, 0, 0],
        cursor: [255, 255, 255],
        ansi: Array.from({ length: 16 }, () => [0, 0, 0]),
        colorSchemeMode: "dark",
        cursorStyle: "block",
        cursorBlink: false,
      },
    });
    const attach = async (slow: boolean) => {
      const stream = await connection.openBi();
      await stream.write(Buffer.from("open"));
      const peer = await host.acceptBi();
      await peer.read(4);
      const input = frames(peer);
      const opening = terminals.openStream(
        host,
        {
          read: (length: number) => peer.read(length),
          bytesRead: () => peer.bytesRead(),
          stopped: () => peer.stopped(),
          write: async (bytes: Buffer) => {
            if (
              slow &&
              holdOutput &&
              terminalServerMessageSchema.parse(decodeFrame(bytes.subarray(4)))
                ?.kind === "terminal.output"
            )
              await release.promise;
            await peer.write(bytes);
          },
          finish: () => peer.finish(),
          reset: async (code: number) => {
            await peer.reset(code);
            if (slow) retired.resolve();
          },
          stop: (code: number) => peer.stop(code),
        },
        open(randomUUID()),
        async () => (await input.next()).value,
      );
      void opening.catch(() => {});
      const output = frames(stream);
      const first = await output.next();
      assert.equal(
        terminalServerMessageSchema.parse(first.value)?.kind,
        "terminal.snapshot",
      );
      return { stream, output, opening };
    };
    const slow = await attach(true);
    const fast = await attach(false);
    const resized = Promise.withResolvers<void>();
    const reading = (async () => {
      for await (const value of fast.output) {
        const frame = terminalServerMessageSchema.parse(value);
        if (
          frame?.kind === "terminal.size" &&
          frame.cols === 101 &&
          frame.rows === 31
        )
          resized.resolve();
      }
    })();
    void reading.catch(() => {});
    holdOutput = true;
    await slow.stream.write(
      Buffer.from(
        encodeFrame({
          kind: "terminal.input",
          data: "python3 -c 'import os;os.write(1,b\"x\"*1048576)'\r",
        }),
      ),
    );
    await retired.promise;
    await fast.stream.write(
      Buffer.from(
        encodeFrame({ kind: "terminal.resize", cols: 101, rows: 31 }),
      ),
    );
    await resized.promise;
    // Input was accepted for the retiring stream. Its output reset must not
    // STOP_SENDING this half or let these old dimensions replace the newer view.
    await slow.stream.write(
      Buffer.from(
        encodeFrame({
          kind: "terminal.input",
          data: "printf 'once\\n' >> received; stty size > received-size\r",
        }),
      ),
    );
    await slow.stream.finish();
    let receivedSize: string | undefined;
    while (!receivedSize?.trim()) {
      t.signal.throwIfAborted();
      receivedSize = await readFile(join(root, "received-size"), "utf8").catch(
        (error: NodeJS.ErrnoException) => {
          if (error.code !== "ENOENT") throw error;
          return undefined;
        },
      );
      if (!receivedSize?.trim()) await nextTurn();
    }
    assert.equal(await readFile(join(root, "received"), "utf8"), "once\n");
    assert.equal(receivedSize.trim(), "31 101");
    release.resolve();
    await slow.opening;
    await fast.stream.finish();
    await fast.opening;
  },
);
