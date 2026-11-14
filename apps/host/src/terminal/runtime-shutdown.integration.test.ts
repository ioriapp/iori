import assert from "node:assert/strict";
import test from "node:test";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import { setImmediate as nextTurn } from "node:timers/promises";
import { randomUUID } from "node:crypto";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { TerminalManager } from "./manager.ts";
import { TerminalRuntime, TERMINAL_PARSER_SUBSCRIPTIONS } from "./runtime.ts";
import { RemotePtys } from "./remote-pty.ts";
import { attachTerminalDaemon, stopTerminalDaemon } from "./daemon/launch.ts";
import { HostStore } from "../store.ts";
import { CliRegistry } from "../cli/registry.ts";
import { loadNativeAddon } from "../native.ts";

const run = promisify(execFile);
const daemonEntry = fileURLToPath(
  new URL("./daemon/entry.ts", import.meta.url),
);

// The daemon deliberately outlives its Host, so ending node:test's worker does
// not own its lifetime. Only these tests own the unique root and its daemons.
// Use OS termination here: the product shutdown request can itself be the
// operation that timed out. No unrelated Host or daemon is selected.
async function stopOwnedDaemons(root: string) {
  // These integration tests run only in the Linux CI container, not on Windows.
  const descriptor = await readFile(
    join(root, "terminal-daemon", "connection.json"),
    "utf8",
  ).then(
    (value) => JSON.parse(value) as { endpoint: string },
    (error: NodeJS.ErrnoException) => {
      if (error.code !== "ENOENT") throw error;
      return undefined;
    },
  );
  const { stdout } = await run("ps", ["-eww", "-o", "pid=,ppid=,args="]);
  const processes = stdout
    .trim()
    .split("\n")
    .map((line) => {
      const [, pid, parent, command] = line.match(
        /^\s*(\d+)\s+(\d+)\s+(.*)$/u,
      )!;
      return { pid: Number(pid), parent: Number(parent), command: command! };
    });
  const owned = processes.filter(
    ({ command }) => command.includes(daemonEntry) && command.includes(root),
  );
  for (const parent of owned) {
    for (const child of processes) {
      if (child.parent === parent.pid && !owned.includes(child))
        owned.push(child);
    }
  }
  // PTYs have their own process groups. Killing only the daemon's group would
  // miss the shell; stop the descendants before their parent can disappear.
  for (const { pid } of owned.reverse()) {
    try {
      process.kill(pid, "SIGKILL");
    } catch (error) {
      if (!(
        error instanceof Error &&
        "code" in error &&
        error.code === "ESRCH"
      ))
        throw error;
    }
  }
  if (descriptor)
    await rm(dirname(descriptor.endpoint), { recursive: true, force: true });
}

// E2E cannot place Host shutdown between opening a saved terminal and the real
// daemon finishing its screen restoration, or make both requests arrive in one
// socket read. Corking the real socket coalesces writes without mocking replies.
test("opening a saved terminal during shutdown never requests a missing daemon screen", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "iori-terminal-shutdown-"));
  const store = new HostStore(join(root, "host.sqlite"));
  const addon = loadNativeAddon();
  let server: Awaited<ReturnType<typeof addon.Endpoint.bind>> | undefined;
  let client: Awaited<ReturnType<typeof addon.Endpoint.bind>> | undefined;
  const clis = new CliRegistry(store, () => {});
  let manager: TerminalManager | undefined;
  let runtime: TerminalRuntime | undefined;
  let channel:
    Awaited<ReturnType<typeof attachTerminalDaemon>>["channel"] | undefined;
  t.after(async () => {
    channel?.close();
    runtime?.disconnected();
    clis.close();
    // Start local shutdown, but never await the operation this test may have
    // timed out in. Killing its owned daemon releases the pending IPC calls.
    void manager?.close().catch(() => {});
    try {
      await stopOwnedDaemons(root);
    } finally {
      await Promise.all([client?.close(), server?.close()]);
      store.close();
    }
    await rm(root, { recursive: true, force: true });
  });
  server = await addon.Endpoint.bind(addon.generateIdentity().secretKey, [
    "127.0.0.1:0",
  ]);
  client = await addon.Endpoint.bind(addon.generateIdentity().secretKey, [
    "127.0.0.1:0",
  ]);
  manager = await TerminalManager.create(store, () => {}, root);
  const created = await manager.createTerminal(
    { clientPublicKey: "test", operationId: randomUUID() },
    root,
  );
  assert.ok(created.ok);
  const id = created.result.terminal.id;
  await manager.close();
  t.signal.throwIfAborted();
  manager = undefined;
  // The saved screen is already persisted. Preparing its restoration must not
  // depend on the fresh shell handling a graceful shutdown signal.
  await stopOwnedDaemons(root);
  t.signal.throwIfAborted();
  store.markTerminalsForRestart();
  ({ channel } = await attachTerminalDaemon(root));
  await channel.call("attach", TERMINAL_PARSER_SUBSCRIPTIONS);
  runtime = await TerminalRuntime.create(
    store,
    () => {},
    root,
    clis,
    new RemotePtys(channel),
  );
  const incoming = server.accept().then((value) => {
    assert.ok(value);
    return value.handshake();
  });
  const connection = await client.connect(
    Buffer.from(server.publicKeyHex, "hex"),
    server.boundSockets,
  );
  const hostConnection = await incoming;
  const stream = await connection.openBi();
  await stream.write(Buffer.from("open"));
  const hostStream = await hostConnection.acceptBi();
  assert.ok(hostStream);
  await hostStream.read(4);
  channel.socket.cork();
  const opening = runtime.openStream(
    hostConnection,
    hostStream,
    {
      kind: "terminal",
      action: "open",
      operationId: randomUUID(),
      terminalId: id,
      viewId: randomUUID(),
      cols: 80,
      rows: 24,
      deviceClass: "desktop",
      snapshotMaxLines: 5000,
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
    },
    async () => undefined,
  );
  const closing = runtime.close();
  await nextTurn();
  channel.socket.uncork();
  await Promise.all([opening, closing]);
  runtime = undefined;
  assert.ok(store.terminal(id)?.snapshot);
});

// E2E cannot close the daemon connection in the turn where restoring a saved
// team CLI has sent its screen and hook requests but has not received replies.
test("failed team CLI restoration never leaves an unhandled screen rejection", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "iori-terminal-restoration-"));
  // Launching Pi installs its hooks into this test's home, not the user's.
  const home = process.env.HOME;
  const piHome = process.env.PI_CODING_AGENT_DIR;
  process.env.HOME = root;
  delete process.env.PI_CODING_AGENT_DIR;
  const store = new HostStore(join(root, "host.sqlite"));
  const clis = new CliRegistry(store, () => {});
  let manager: TerminalManager | undefined;
  let runtime: TerminalRuntime | undefined;
  let channel:
    Awaited<ReturnType<typeof attachTerminalDaemon>>["channel"] | undefined;
  t.after(async () => {
    channel?.close();
    runtime?.disconnected();
    clis.close();
    void manager?.close().catch(() => {});
    try {
      await stopOwnedDaemons(root);
    } finally {
      store.close();
    }
    await rm(root, { recursive: true, force: true });
    // Restored only after the CLIs are closed, so no hook write reaches the
    // user's home.
    if (home === undefined) delete process.env.HOME;
    else process.env.HOME = home;
    if (piHome !== undefined) process.env.PI_CODING_AGENT_DIR = piHome;
  });
  manager = await TerminalManager.create(store, () => {}, root);
  const created = await manager.createTerminal(
    { clientPublicKey: "test", operationId: randomUUID() },
    root,
  );
  assert.ok(created.ok);
  const id = created.result.terminal.id;
  await manager.close();
  t.signal.throwIfAborted();
  manager = undefined;
  // As above, this stop only prepares a saved screen for restoration.
  await stopOwnedDaemons(root);
  t.signal.throwIfAborted();
  store.markTerminalsForRestart();
  // The saved CLI identity is restoration input; no model or CLI process is
  // needed because the daemon disconnects before a process can be started.
  store.setTerminalCli(id, {
    cli: { id: "pi", name: "Pi", icon: { light: "pi-badge.svg" } },
    command: "pi",
    observed: true,
    session: { id: "restoration", file: join(root, "session.jsonl") },
    resumePending: true,
  });
  ({ channel } = await attachTerminalDaemon(root));
  await channel.call("attach", TERMINAL_PARSER_SUBSCRIPTIONS);
  runtime = await TerminalRuntime.create(
    store,
    () => {},
    root,
    clis,
    new RemotePtys(channel),
  );
  channel.socket.cork();
  const resuming = runtime.restartTeamTerminal(id, {
    conversation: "restoration",
    env: {},
    team: {
      candidate: {
        id: "parent",
        cli: "pi",
        model: "openai/gpt-6-luna",
        tools: [],
        minimum: "",
      },
      instructions: "",
      instructionFile: join(root, "instructions.md"),
      teamFilesDirectory: root,
      commandDirectory: root,
    },
  });
  const rejected = assert.rejects(
    resuming,
    /Terminal daemon connection closed/u,
  );
  await nextTurn();
  // Stop through the real daemon's independent control connection. Its socket
  // close rejects both outstanding requests, including the deferred screen.
  await stopTerminalDaemon(root);
  t.signal.throwIfAborted();
  await rejected;
  await nextTurn();
  runtime.disconnected();
  runtime = undefined;
});
