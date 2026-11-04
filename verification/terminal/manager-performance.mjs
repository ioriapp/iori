import {
  boundTerminalDaemon,
  stopTerminalDaemon,
  terminalDaemonEvidence,
} from "./daemon-process.mjs";
// Change comparison measurement only; this tool has no acceptance verdict.
import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { monitorEventLoopDelay, performance } from "node:perf_hooks";
import { setImmediate } from "node:timers";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { decodeFrame } from "../../packages/protocol/src/index.ts";
import { HostStore } from "../../apps/host/src/store.ts";
import { TerminalManager } from "../../apps/host/src/terminal/manager.ts";

const outputPath = process.argv[2];
if (!outputPath) {
  throw new Error("usage: node manager-performance.mjs <evidence-json-path>");
}

const evidenceDirectory = join(outputPath, "..");
await mkdir(evidenceDirectory, { recursive: true });
const databaseDirectory = await mkdtemp(join(tmpdir(), "iori-terminal-perf-"));
let store;
let manager;

const queue = [];
const waiters = [];
const pushFrame = (frame) => {
  const waiter = waiters.shift();
  if (waiter) waiter(frame);
  else queue.push(frame);
};
const readFrame = () => {
  if (queue.length > 0) return Promise.resolve(queue.shift());
  return new Promise((resolve) => waiters.push(resolve));
};
const marker = "X".repeat(50);
const viewAttributes = {
  foreground: [255, 255, 255],
  background: [0, 0, 0],
  cursor: [135, 134, 232],
  ansi: Array.from({ length: 256 }, () => [0, 0, 0]),
  colorSchemeMode: "dark",
  cursorStyle: "block",
  cursorBlink: true,
};
let outputBytes = 0;
let receivedOutput = "";
let resolveMarker;
const markerReceived = new Promise((resolve) => {
  resolveMarker = resolve;
});
const stream = {
  async write(frame) {
    const message = decodeFrame(frame.subarray(4));
    if (message.kind === "terminal.output") {
      outputBytes += Buffer.byteLength(message.data);
      receivedOutput += message.data;
      if (receivedOutput.includes(marker)) resolveMarker();
    }
  },
  async finish() {},
  async reset() {},
  async stop() {},
};

let openTask;
let terminalId;
let elapsedMs;
let eventLoop;
try {
  store = new HostStore(join(databaseDirectory, "host.sqlite"));
  manager = await TerminalManager.create(store, () => {}, databaseDirectory);
  await boundTerminalDaemon(databaseDirectory);
  const shell = manager.list().ok && manager.list().result.defaultShell;
  assert.ok(
    shell,
    "a default terminal shell must be available for this measurement",
  );

  const created = await manager.createTerminal(
    { clientPublicKey: "0".repeat(64), operationId: randomUUID() },
    process.cwd(),
    shell,
  );
  assert.equal(created.ok, true, "terminal creation must succeed");
  if (!created.ok) throw new Error("terminal creation failed");
  terminalId = created.result.terminal.id;

  openTask = manager.openStream(
    {},
    stream,
    {
      kind: "terminal",
      operationId: randomUUID(),
      action: "open",
      terminalId,
      viewId: randomUUID(),
      viewAttributes,
      deviceClass: "desktop",
      cols: 120,
      rows: 40,
      snapshotMaxLines: 5_000,
      snapshotMaxBytes: 4 * 1024 * 1024,
    },
    readFrame,
  );

  while (true) {
    await new Promise((resolve) => setImmediate(resolve));
    if (queue.length === 0 && waiters.length > 0) break;
  }

  const histogram = monitorEventLoopDelay({ resolution: 1 });
  histogram.enable();
  const command = `seq 1 50000 | awk '{ printf "%s%s\\n", $0, sprintf("%050d", 0) }'; head -c 50 /dev/zero | tr '\\000' X; printf '\\n'\r`;
  const startedAt = performance.now();
  pushFrame({ kind: "terminal.input", data: command });
  await markerReceived;
  elapsedMs = performance.now() - startedAt;
  histogram.disable();
  eventLoop = {
    resolutionMs: 1,
    maxMs: Number((histogram.max / 1e6).toFixed(3)),
    p99Ms: Number((histogram.percentile(99) / 1e6).toFixed(3)),
  };
} finally {
  pushFrame(undefined);
  try {
    if (openTask) await openTask;
  } finally {
    try {
      if (manager) await manager.close();
      await stopTerminalDaemon(databaseDirectory);
    } finally {
      try {
        if (store) store.close();
      } finally {
        await rm(databaseDirectory, { recursive: true, force: true });
      }
    }
  }
}

assert.equal(
  receivedOutput.includes(marker),
  true,
  "the output marker must be observed",
);
const result = {
  version: 1,
  measurement: "TerminalManager live PTY output path",
  command:
    "seq 1 50000 | awk '{ printf \"%s%s\\n\", $0, sprintf(\"%050d\", 0) }'; head -c 50 /dev/zero | tr '\\000' X; printf '\\n'",
  markerLength: marker.length,
  elapsedMs: Number(elapsedMs.toFixed(3)),
  outputBytes,
  eventLoop,
  host: process.platform,
  node: process.version,
  daemonUnits: terminalDaemonEvidence(),
};
await writeFile(outputPath, `${JSON.stringify(result, null, 2)}\n`, "utf8");
console.log(JSON.stringify(result));
