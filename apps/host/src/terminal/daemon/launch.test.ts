import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp, mkdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test, { type TestContext } from "node:test";
import {
  attachTerminalDaemon,
  captureDaemonProcessIdentity,
  stopTerminalDaemon,
  terminateVerifiedDaemonProcess,
} from "./launch.ts";
import { DAEMON_PROTOCOL } from "./protocol.ts";

function daemonScript() {
  return `
const net = require("node:net");
const endpoint = process.argv[1];
const connFile = process.argv[2];
const server = net.createServer((socket) => {
  let pending = Buffer.alloc(0);
  socket.on("data", (chunk) => {
    pending = Buffer.concat([pending, chunk]);
    while (pending.length >= 4) {
      const length = pending.readUInt32BE(0);
      if (pending.length < length + 4) return;
      const msg = JSON.parse(pending.subarray(4, length + 4).toString("utf8"));
      pending = pending.subarray(length + 4);
      const reply = (payload) => {
        const body = Buffer.from(JSON.stringify(payload));
        const header = Buffer.alloc(4);
        header.writeUInt32BE(body.length);
        socket.write(Buffer.concat([header, body]));
      };
      if (msg.method === "hello") {
        reply({ kind: "response", id: msg.id, value: { version: ${DAEMON_PROTOCOL}, pid: process.pid } });
      } else if (msg.method === "shutdown") {
        reply({ kind: "response", id: msg.id, value: [] });
      }
    }
  });
});
server.listen(endpoint, () => {
  require("node:fs").writeFileSync(connFile, JSON.stringify({ endpoint, token: "test", version: ${DAEMON_PROTOCOL}, pid: process.pid }));
  process.stdout.write("READY\\n");
});
setInterval(() => {}, 1000);
`;
}

async function startHangingDaemon(t: TestContext) {
  const root = await mkdtemp(join(tmpdir(), "iori-launch-test-"));
  const daemonDir = join(root, "terminal-daemon");
  await mkdir(daemonDir, { recursive: true });
  const endpoint =
    process.platform === "win32"
      ? `\\\\.\\pipe\\iori-launch-test-${process.pid}-${Date.now()}-${Math.random().toString(16).slice(2)}`
      : join(daemonDir, "daemon.sock");
  const connFile = join(daemonDir, "connection.json");
  const child = spawn(
    process.execPath,
    ["-e", daemonScript(), endpoint, connFile],
    { stdio: ["ignore", "pipe", "pipe"] },
  );
  t.after(async () => {
    try {
      child.kill("SIGKILL");
    } catch {}
    await rm(root, { recursive: true, force: true });
  });
  await new Promise<void>((resolve, reject) => {
    let out = "";
    let err = "";
    child.stdout.on("data", (chunk: Buffer) => {
      out += chunk.toString();
      if (out.includes("READY")) resolve();
    });
    child.stderr.on("data", (chunk: Buffer) => {
      err += chunk.toString();
    });
    child.once("error", reject);
    child.once("exit", (code) =>
      reject(new Error(`fake daemon exited early (${code}): ${err}`)),
    );
  });
  assert.ok(child.pid !== undefined);
  return { root, child, pid: child.pid };
}

function isPidDead(pid: number) {
  try {
    process.kill(pid, 0);
    return false;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code !== "EPERM";
  }
}

test("停止の後も止まらない古いデーモンのプロセスが残らない", async (t) => {
  const { root, child, pid } = await startHangingDaemon(t);
  const exited = new Promise((resolve) => {
    child.once("exit", (code, signal) => resolve({ code, signal }));
  });
  const result = await stopTerminalDaemon(root);
  assert.deepEqual(result, []);
  await exited;
  assert.equal(isPidDead(pid), true);
});

test("同一性が一致しないプロセスを終わらせない", async (t) => {
  const unrelated = spawn(
    process.execPath,
    ["-e", "setInterval(() => {}, 1000)"],
    { stdio: "ignore" },
  );
  t.after(() => {
    try {
      unrelated.kill("SIGKILL");
    } catch {}
  });
  assert.ok(unrelated.pid !== undefined);
  const pid = unrelated.pid;
  const identity = await captureDaemonProcessIdentity(pid);
  assert.ok(identity, "expected to capture unrelated process identity");

  assert.equal(await terminateVerifiedDaemonProcess(pid, undefined), false);
  assert.equal(
    await terminateVerifiedDaemonProcess(pid, {
      start: `${identity.start}-mismatch`,
      commandLine: identity.commandLine,
    }),
    false,
  );
  assert.equal(
    await terminateVerifiedDaemonProcess(pid, {
      start: identity.start,
      commandLine: `${identity.commandLine} --other`,
    }),
    false,
  );
  assert.equal(isPidDead(pid), false);
});

// Restoring or resizing a screen does not advance its PTY output sequence.
test("PTYの出力がなくても復元とサイズ変更が次の保存画面に反映される", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "iori-snapshot-"));
  t.after(async () => {
    await stopTerminalDaemon(root);
    await rm(root, { recursive: true, force: true });
  });
  const { channel } = await attachTerminalDaemon(root);
  try {
    await channel.call("attach", { osc: [], csi: [] });
    await channel.call("screen", "saved", 20, 3, "first");
    const first = await channel.call("snapshot", "saved");
    assert.deepEqual(await channel.call("visibleLinesFromSnapshot", first), [
      "first",
    ]);
    await channel.call("screenWrite", "saved", "\r\nsecond");
    const written = await channel.call("snapshot", "saved");
    assert.deepEqual(await channel.call("visibleLinesFromSnapshot", written), [
      "first",
      "second",
    ]);
    await channel.call("resize", "saved", 30, 4);
    const resized = await channel.call("snapshot", "saved");
    assert.deepEqual([resized.cols, resized.rows], [30, 4]);
  } finally {
    channel.close();
  }
});
