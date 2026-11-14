import assert from "node:assert/strict";
import { test } from "node:test";
import { createServer, connect, type Socket } from "node:net";
import { setImmediate as nextTurn } from "node:timers/promises";
import { DaemonChannel } from "./daemon/channel.ts";
import { RemotePtys } from "./remote-pty.ts";
import type { PtyEvent, SpawnPty, PtyOutput } from "./daemon/protocol.ts";

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
  channel.handle = async (method, args) => {
    if (method === "data") return remote.data(...(args as [number, PtyOutput]));
    if (method === "event") return remote.event(args[0] as PtyEvent);
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
  } finally {
    host.destroy();
    daemon.destroy();
    await new Promise((resolve) => server.close(resolve));
  }
});
