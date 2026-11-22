// The authoritative screen remains alive while the Host is disconnected.
import { createServer } from "node:net";
import { chmod, mkdir, rename, rm, open } from "node:fs/promises";
import { randomBytes, timingSafeEqual } from "node:crypto";
import { dirname, join } from "node:path";
import * as pty from "node-pty";
import { buildTerminalSnapshotRestoreSequence } from "@iori/protocol/terminal-restore";
import type { CommandCaller } from "../../teams/local-command.ts";
import { EventQueue } from "./event-queue.ts";
import { HeadlessEmulator } from "./headless-emulator.ts";
import { HookReceiver } from "./hook-receiver.ts";
import { CommandReceiver } from "./command-receiver.ts";
import { killPty } from "./pty-kill.ts";
import { getWindowsPtyCompatibility } from "../platform.ts";
import { DaemonChannel, type Handlers } from "./channel.ts";
import {
  DAEMON_PROTOCOL,
  type DaemonRpc,
  type HostRpc,
  type PtyScreen,
  type PtyEvent,
  type PtyState,
  type PtyModes,
} from "./protocol.ts";
import type { ParserSubscriptions } from "./parser-events.ts";
import terminalNative from "@iori/terminal-native";
import type { TerminalViewAttributes } from "../shared/terminal-view-attributes.ts";

interface Session {
  id: string;
  child?: pty.IPty;
  conptyDll?: boolean;
  emulator: HeadlessEmulator;
  serial: Promise<void>;
  exit?: { exitCode: number; signal?: number };
  exited: Promise<void>;
  stopping?: Promise<void>;
  frozen: boolean;
  parsed: Promise<void>;
  paused: boolean;
  attributes: TerminalViewAttributes | null;
  sequence: number;
  sentModes?: string;
}
export async function runTerminalDaemon(root: string, endpoint: string) {
  const token = randomBytes(32),
    descriptorPath = join(root, "terminal-daemon", "connection.json");
  const sessions = new Map<string, Session>();
  const peers = new Set<DaemonChannel<HostRpc, DaemonRpc>>();
  const hooks = new HookReceiver();
  const hookRoutes = new Map<string, ReturnType<HookReceiver["register"]>>();
  const routes = new Map<
    string,
    Awaited<ReturnType<CommandReceiver["register"]>>
  >();
  const events = new EventQueue();
  const draining = new Set<string>();
  let host: DaemonChannel<HostRpc, DaemonRpc> | undefined,
    active = false,
    eventsReady = false,
    ending = false;
  let subscriptions: ParserSubscriptions = { osc: [], csi: [] };
  const waiters = new Set<() => void>();
  function wake() {
    for (const done of waiters) done();
    waiters.clear();
  }
  function retain(event: PtyEvent) {
    events.push(event);
    if (!eventsReady) events.trim();
    else if (!draining.has(event.id)) void deliver(event.id);
  }
  function drain() {
    for (const id of events.ids) if (!draining.has(id)) void deliver(id);
  }
  async function deliver(id: string) {
    draining.add(id);
    const recipient = host;
    try {
      let entry;
      while (eventsReady && host && (entry = events.first(id))) {
        await host.call("event", entry);
        events.remove(entry);
      }
    } catch {
      /* Unprocessed hooks and exits remain for the next Host. */
    } finally {
      draining.delete(id);
      if (host && host !== recipient && eventsReady) drain();
    }
  }
  const commands = new CommandReceiver<CommandCaller>(async (caller, argv) => {
    while (!host || !eventsReady) {
      if (ending) throw new Error("Terminal daemon stopped");
      await new Promise<void>((resolve) => waiters.add(resolve));
    }
    // A call already handed to the Host is never repeated after a disconnect.
    try {
      return await host.call("command", caller, argv);
    } catch {
      return {
        ok: false,
        text: "結果は分かりません。`iori tasks` で状態を確かめてから、必要なら実行し直してください。\n",
      };
    }
  });
  await commands.listen(root);
  await hooks.listen();
  const modes = (s: Session): PtyModes => ({
    modes: s.emulator.getModes(),
    showCursor: s.emulator.showCursor,
  });
  const state = (s: Session): PtyState => {
    // A complete state is also delivered by attach and screenWrite. The next
    // output must compare against the modes this Host actually received.
    s.sentModes = undefined;
    return {
      ...modes(s),
      sequence: s.sequence,
      osc: [...s.emulator.parserEvents.latest.values()],
    };
  };
  const screen = (s: Session): PtyScreen => ({
    id: s.id,
    pid: s.child?.pid ?? 0,
    live: Boolean(s.child && !s.exit),
    exit: s.exit,
    snapshot: s.emulator.getSnapshot(),
    state: state(s),
  });
  async function snapshots() {
    for (const s of sessions.values()) s.child?.pause();
    await Promise.all([...sessions.values()].map((s) => s.serial));
    return [...sessions.values()].map(screen);
  }
  async function stop(s: Session) {
    const child = s.child;
    if (!s.stopping && child && (!s.exit || s.conptyDll)) {
      const stopping = Promise.resolve()
        .then(async () => {
          s.paused = false;
          s.frozen = false;
          wake();
          child.resume();
          if (!s.exit) killPty(child);
          else if (s.conptyDll) child.kill();
          await s.exited;
        })
        .catch((error: unknown) => {
          if (s.stopping === stopping) s.stopping = undefined;
          throw error;
        });
      s.stopping = stopping;
    }
    await s.stopping;
  }
  const server = createServer((socket) => {
    const peer = new DaemonChannel<HostRpc, DaemonRpc>(socket);
    peers.add(peer);
    let authenticated = false;
    peer.disconnected = () => {
      peers.delete(peer);
      if (host === peer) {
        host = undefined;
        active = false;
        eventsReady = false;
        events.trim();
        wake();
        for (const s of sessions.values()) {
          s.paused = false;
          s.frozen = false;
          s.child?.resume();
        }
      }
    };
    peer.authorize = (method) => {
      if (!authenticated && method !== "hello") {
        peer.close();
        throw new Error("Unauthorized terminal connection");
      }
      if (
        authenticated &&
        method !== "attach" &&
        method !== "shutdown" &&
        host !== peer
      )
        throw new Error("Terminal Host is not attached");
    };
    peer.handle = {
      hello(supplied) {
        if (
          authenticated ||
          typeof supplied !== "string" ||
          !/^[a-f0-9]{64}$/u.test(supplied) ||
          !timingSafeEqual(Buffer.from(supplied, "hex"), token)
        ) {
          peer.close();
          throw new Error("Unauthorized terminal connection");
        }
        authenticated = true;
        return { version: DAEMON_PROTOCOL, pid: process.pid };
      },
      async shutdown() {
        ending = true;
        eventsReady = false;
        events.trim();
        wake();
        const saved = await snapshots();
        await Promise.all([...sessions.values()].map(stop));
        for (const s of sessions.values()) s.emulator.dispose();
        await hooks.close();
        await commands.close();
        await rm(descriptorPath, { force: true });
        if (process.platform !== "win32")
          await rm(dirname(endpoint), { recursive: true, force: true });
        setImmediate(() => {
          for (const connection of peers) connection.socket.end();
          server.close();
        });
        return saved;
      },
      async attach(requested) {
        subscriptions = requested;
        for (const s of sessions.values())
          s.emulator.parserEvents.subscribe(subscriptions);
        host?.close();
        host = undefined;
        active = false;
        eventsReady = false;
        events.trim();
        for (const session of sessions.values()) {
          session.frozen = false;
          session.paused = false;
        }
        wake();
        const saved = await snapshots();
        host = peer;
        return saved;
      },
      activate() {
        active = true;
        wake();
        for (const s of sessions.values()) if (!s.paused) s.child?.resume();
      },
      commandsReady() {
        eventsReady = true;
        wake();
        drain();
      },
      pauseCommands() {
        eventsReady = false;
        events.trim();
      },
      async commandRoute(key, caller, base) {
        let route = routes.get(key);
        if (!route) {
          route = await commands.register(caller, base);
          routes.set(key, route);
        }
        return route.env;
      },
      retireRoute(id) {
        routes.get(id)?.dispose();
        routes.delete(id);
      },
      hookRoute(id) {
        let route = hookRoutes.get(id);
        if (!route) {
          route = hooks.register(async (payload) => {
            retain({ id, kind: "hook", payload });
          });
          hookRoutes.set(id, route);
        }
        return route.url;
      },
      retireHook(id) {
        hookRoutes.get(id)?.dispose();
        hookRoutes.delete(id);
      },
      async screen(id, cols, rows, seed, links) {
        if (sessions.has(id)) return state(sessions.get(id)!);
        let session!: Session;
        const windowsHost = process.platform === "win32";
        const emulator = new HeadlessEmulator({
          cols,
          rows,
          scrollback: 5000,
          ...(getWindowsPtyCompatibility()?.backend === "conpty"
            ? { reflowCursorLine: true }
            : {}),
          onQueryReply: (reply) => session?.child?.write(reply),
        });
        if (windowsHost)
          emulator.installConptyPrimaryDeviceAttributesOverride();
        emulator.installViewAttributeResponder(
          () => session?.attributes ?? null,
        );
        emulator.parserEvents.subscribe(subscriptions);
        emulator.setRestoredOscLinks(links);
        await emulator.write(seed);
        session = {
          id,
          emulator,
          serial: Promise.resolve(),
          parsed: Promise.resolve(),
          exited: Promise.resolve(),
          paused: false,
          frozen: false,
          attributes: null,
          sequence: 0,
        };
        sessions.set(id, session);
        return state(session);
      },
      async snapshot(id, scrollbackRows) {
        const s = sessions.get(id)!;
        await s.parsed;
        return s.emulator.getSnapshot({
          scrollbackRows,
        });
      },
      async visibleLines(id) {
        const session = sessions.get(id);
        if (!session?.child) return undefined;
        await session.parsed;
        return session.emulator.getVisibleLines();
      },
      async visibleLinesFromSnapshot(snapshot) {
        const emulator = new HeadlessEmulator({
          cols: snapshot.cols,
          rows: snapshot.rows,
          scrollback: 0,
        });
        try {
          await emulator.write(buildTerminalSnapshotRestoreSequence(snapshot));
          return emulator.getVisibleLines();
        } finally {
          emulator.dispose();
        }
      },
      async screenWrite(id, data) {
        const s = sessions.get(id)!;
        s.parsed = s.emulator.write(data);
        await s.parsed;
        return state(s);
      },
      screenCursor(id) {
        return sessions.get(id)!.emulator.getCursorRow();
      },
      async freeze(id) {
        const s = sessions.get(id)!;
        s.child?.pause();
        s.serial = s.serial.then(() => {
          s.frozen = true;
        });
        await s.serial;
      },
      thaw(id) {
        const s = sessions.get(id);
        if (s) {
          s.frozen = false;
          wake();
          if (!s.paused) s.child?.resume();
        }
      },
      async spawn(request) {
        const session = sessions.get(request.id)!;
        await stop(session);
        const emulator = session.emulator;
        const child = pty.spawn(
          request.executable,
          request.args,
          request.options,
        );
        let exited!: () => void;
        session.child = child;
        session.conptyDll =
          process.platform === "win32" &&
          "useConptyDll" in request.options &&
          Boolean(request.options.useConptyDll);
        session.exit = undefined;
        session.stopping = undefined;
        session.exited = new Promise((resolve) => {
          exited = resolve;
        });
        child.onData((data) => {
          if (session.stopping) return;
          child.pause();
          session.serial = session.serial
            .then(async () => {
              while (
                ((host && !active) || session.frozen) &&
                !ending &&
                !session.stopping
              )
                await new Promise<void>((resolve) => waiters.add(resolve));
              if (session.stopping) return;
              emulator.parserEvents.take();
              session.parsed = emulator.write(data, {
                forwardQueryReplies: true,
              });
              await session.parsed;
              session.sequence++;
              const events = emulator.parserEvents.take();
              const currentModes = modes(session);
              const encodedModes = JSON.stringify(currentModes);
              if (host && active && !session.stopping) {
                await host
                  .call("data", child.pid, {
                    sequence: session.sequence,
                    data,
                    events,
                    ...(session.sentModes === encodedModes
                      ? {}
                      : { modes: currentModes }),
                  })
                  .then(
                    () => {
                      session.sentModes = encodedModes;
                    },
                    () => {},
                  );
              }
            })
            .finally(() => {
              if (!session.paused && !session.frozen && !ending) child.resume();
            });
        });
        child.onExit((value) => {
          session.exit = value;
          exited();
          session.serial = session.serial.then(() => {
            retain({
              id: session.id,
              kind: "exit",
              pid: child.pid,
              ...value,
            });
          });
        });
        return { pid: child.pid };
      },
      write(id, data) {
        sessions.get(id)?.child?.write(data);
      },
      resize(id, cols, rows) {
        const s = sessions.get(id);
        if (s) {
          s.emulator.resize(cols, rows);
          s.child?.resize(cols, rows);
        }
      },
      attributes(id, attributes) {
        const s = sessions.get(id);
        if (s) {
          s.attributes = attributes;
          s.emulator.applyPushedViewAttributes(s.attributes);
        }
      },
      pause(id) {
        const s = sessions.get(id);
        if (s) {
          s.paused = true;
          s.child?.pause();
        }
      },
      resume(id) {
        const s = sessions.get(id);
        if (s) {
          s.paused = false;
          if (!s.frozen) s.child?.resume();
        }
      },
      async kill(id) {
        const s = sessions.get(id);
        if (s) {
          await stop(s);
          return s.exit;
        }
      },
      async remove(id) {
        const s = sessions.get(id);
        if (s) {
          await stop(s);
          s.emulator.dispose();
          sessions.delete(s.id);
        }
      },
    } satisfies Handlers<DaemonRpc>;
  });
  await mkdir(join(root, "terminal-daemon"), { recursive: true, mode: 0o700 });
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(endpoint, resolve);
  });
  if (process.platform === "win32")
    terminalNative.restrictTerminalPipe(endpoint);
  else await chmod(endpoint, 0o600);
  const descriptor = await open(descriptorPath + ".tmp", "w", 0o600);
  try {
    await descriptor.writeFile(
      JSON.stringify({
        version: DAEMON_PROTOCOL,
        pid: process.pid,
        token: token.toString("hex"),
        endpoint,
      }),
    );
    await descriptor.sync();
  } finally {
    await descriptor.close();
  }
  await rename(descriptorPath + ".tmp", descriptorPath);
  if (process.send) {
    process.send("ready");
    process.disconnect();
  }
}
