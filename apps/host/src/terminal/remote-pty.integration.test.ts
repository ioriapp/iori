import assert from "node:assert/strict";
import { test } from "node:test";
import { createServer, connect, Socket } from "node:net";
import { setImmediate as nextTurn } from "node:timers/promises";
import { DaemonChannel } from "./daemon/channel.ts";
import { RemotePtys } from "./remote-pty.ts";
import type { SpawnPty } from "./daemon/protocol.ts";

const frame = (message: unknown) => {
  const payload = Buffer.from(JSON.stringify(message));
  const header = Buffer.alloc(4);
  header.writeUInt32BE(payload.length);
  return Buffer.concat([header, payload]);
};

// Whether the Terminal daemon's spawn answer and the new shell's first output
// share one read of the local socket depends on how busy the Host is (such as
// right after checking out a large worktree). A UI scenario cannot choose how
// the bytes arrive; the daemon side here writes them in one piece.
test("a shell's output and exit that arrive with its spawn answer reach the Host's listeners", async () => {
  const server = createServer();
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as { port: number };
  const accepted = new Promise<Socket>((resolve) =>
    server.once("connection", resolve),
  );
  const host = connect(port, "127.0.0.1");
  const daemon = await accepted;
  const channel = new DaemonChannel(host);
  const remote = new RemotePtys(channel);
  // As TerminalManager hands the daemon's requests to the Host's processes.
  channel.handle = {
    data: (pid, output) => remote.data(pid, output),
    event: (event) => remote.event(event),
  };
  const output = "\u001b[?2004hiori-test# ";
  daemon.once("data", (bytes) => {
    const request = JSON.parse(bytes.subarray(4).toString("utf8")) as {
      id: string;
    };
    daemon.write(
      Buffer.concat([
        frame({ kind: "response", id: request.id, value: { pid: 4242 } }),
        frame({
          kind: "request",
          id: "data",
          method: "data",
          args: [4242, { sequence: 1, data: output, events: [] }],
        }),
        frame({
          kind: "request",
          id: "exit",
          method: "event",
          args: [{ id: "terminal", kind: "exit", pid: 4242, exitCode: 0 }],
        }),
      ]),
    );
  });
  try {
    const child = await remote.spawn({ id: "terminal" } as SpawnPty);
    const received: string[] = [];
    const exits: number[] = [];
    child.onData((data) => received.push(data.data));
    child.onExit((event) => exits.push(event.exitCode));
    await nextTurn();
    assert.deepEqual(received, [output]);
    assert.deepEqual(exits, [0]);
    assert.equal(remote.processes.has(child.id), false);
    assert.equal(remote.byPid.has(child.pid), false);
  } finally {
    host.destroy();
    daemon.destroy();
    await new Promise((resolve) => server.close(resolve));
  }
});

test("a delayed exit cannot retire another terminal that reused the pid", async () => {
  const socket = new Socket();
  const remote = new RemotePtys(new DaemonChannel(socket));
  const old = remote.attach({ id: "old", pid: 42 });
  const current = remote.attach({ id: "current", pid: 42 });
  const exits: string[] = [];
  old.onExit(() => exits.push(old.id));
  current.onExit(() => exits.push(current.id));
  try {
    await remote.event({ kind: "exit", id: old.id, pid: 42, exitCode: 1 });
    assert.deepEqual(exits, [old.id]);
    assert.equal(remote.byPid.get(42), current);
    assert.equal(remote.processes.has(old.id), false);
  } finally {
    socket.destroy();
  }
});

test("typing into a disconnected PTY reports the failed write", async () => {
  const socket = new Socket();
  const remote = new RemotePtys(new DaemonChannel(socket));
  const child = remote.attach({ id: "terminal", pid: 42 });
  socket.destroy();
  await assert.rejects(async () => child.write("x"), /connection closed/u);
});
