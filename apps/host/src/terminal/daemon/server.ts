// The authoritative screen remains alive while the Host is disconnected.
import { createServer } from "node:net";
import { chmod, mkdir, rename, rm, open } from "node:fs/promises";
import { randomBytes, timingSafeEqual } from "node:crypto";
import { dirname, join } from "node:path";
import * as pty from "node-pty";
import { HeadlessEmulator } from "./headless-emulator.ts";
import { HookReceiver } from "./hook-receiver.ts";
import { CommandReceiver, type CommandResult } from "./command-receiver.ts";
import { killPty } from "./pty-kill.ts";
import { getWindowsPtyCompatibility } from "../platform.ts";
import { DaemonChannel } from "./channel.ts";
import {
  DAEMON_PROTOCOL,
  type SpawnPty,
  type PtyScreen,
  type PtyEvent,
} from "./protocol.ts";
import terminalNative from "@iori/terminal-native";
import type { TerminalViewAttributes } from "../shared/terminal-view-attributes.ts";

interface Session {
  id: string;
  child?: pty.IPty;
  emulator: HeadlessEmulator;
  serial: Promise<void>;
  exit?: { exitCode: number; signal?: number };
  exited: Promise<void>;
  stopping?: Promise<void>;
  frozen: boolean;
  parsed: Promise<void>;
  paused: boolean;
  attributes: TerminalViewAttributes | null;
}
export async function runTerminalDaemon(root: string, endpoint: string) {
  const token = randomBytes(32),
    descriptorPath = join(root, "terminal-daemon", "connection.json");
  const sessions = new Map<string, Session>();
  const peers = new Set<DaemonChannel>();
  const hooks = new HookReceiver();
  const hookRoutes = new Map<string, ReturnType<HookReceiver["register"]>>();
  const routes = new Map<
    string,
    Awaited<ReturnType<CommandReceiver["register"]>>
  >();
  const events: PtyEvent[] = [];
  let host: DaemonChannel | undefined,
    active = false,
    eventsReady = false,
    ending = false,
    draining = false;
  const waiters = new Set<() => void>();
  function wake() {
    for (const done of waiters) done();
    waiters.clear();
  }
  function retain(event: PtyEvent) {
    events.push(event);
    void drain();
  }
  async function drain() {
    if (draining) return;
    draining = true;
    try {
      while (eventsReady && host && events.length) {
        const entry = events[0]!;
        await host.call("event", entry);
        events.shift();
      }
    } catch {
      /* Unprocessed hooks and exits remain for the next Host. */
    } finally {
      draining = false;
    }
  }
  const commands = new CommandReceiver(async (caller, argv) => {
    while (!host || !eventsReady) {
      if (ending) throw new Error("Terminal daemon stopped");
      await new Promise<void>((resolve) => waiters.add(resolve));
    }
    // A call already handed to the Host is never repeated after a disconnect.
    try {
      return await host.call<CommandResult>("command", caller, argv);
    } catch {
      return {
        ok: false,
        text: "結果は分かりません。`iori tasks` で状態を確かめてから、必要なら実行し直してください。\n",
      };
    }
  });
  await commands.listen(root);
  await hooks.listen();
  const screen = (s: Session): PtyScreen => ({
    id: s.id,
    pid: s.child?.pid ?? 0,
    live: Boolean(s.child && !s.exit),
    exit: s.exit,
    snapshot: s.emulator.getSnapshot(),
    title: s.emulator.getLastTitle(),
    cwd: s.emulator.getCwd(),
  });
  async function snapshots() {
    for (const s of sessions.values()) s.child?.pause();
    await Promise.all([...sessions.values()].map((s) => s.serial));
    return [...sessions.values()].map(screen);
  }
  async function stop(s: Session) {
    const child = s.child;
    if (!s.stopping && child && !s.exit) {
      const stopping = Promise.resolve()
        .then(async () => {
          s.paused = false;
          s.frozen = false;
          wake();
          child.resume();
          if (!s.exit) killPty(child);
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
    const peer = new DaemonChannel(socket);
    peers.add(peer);
    let authenticated = false;
    peer.disconnected = () => {
      peers.delete(peer);
      if (host === peer) {
        host = undefined;
        active = false;
        eventsReady = false;
        wake();
        for (const s of sessions.values()) {
          s.paused = false;
          s.frozen = false;
          s.child?.resume();
        }
      }
    };
    peer.handle = async (method, args) => {
      if (!authenticated) {
        const supplied = args[0];
        if (
          method !== "hello" ||
          typeof supplied !== "string" ||
          !/^[a-f0-9]{64}$/u.test(supplied) ||
          !timingSafeEqual(Buffer.from(supplied, "hex"), token)
        ) {
          peer.close();
          throw new Error("Unauthorized terminal connection");
        }
        authenticated = true;
        return { version: DAEMON_PROTOCOL, pid: process.pid };
      }
      if (method === "shutdown") {
        ending = true;
        eventsReady = false;
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
      }
      if (method === "attach") {
        host?.close();
        host = undefined;
        active = false;
        eventsReady = false;
        for (const session of sessions.values()) {
          session.frozen = false;
          session.paused = false;
        }
        wake();
        const saved = await snapshots();
        host = peer;
        return saved;
      }
      if (host !== peer) throw new Error("Terminal Host is not attached");
      switch (method) {
        case "activate":
          active = true;
          wake();
          for (const s of sessions.values()) if (!s.paused) s.child?.resume();
          return;
        case "commandsReady":
          eventsReady = true;
          wake();
          void drain();
          return;
        case "pauseCommands":
          eventsReady = false;
          return;
        case "commandRoute": {
          const [key, caller, base] = args as [
            string,
            Parameters<CommandReceiver["register"]>[0],
            string | undefined,
          ];
          let route = routes.get(key);
          if (!route) {
            route = await commands.register(caller, base);
            routes.set(key, route);
          }
          return route.env;
        }
        case "retireRoute":
          routes.get(args[0] as string)?.dispose();
          routes.delete(args[0] as string);
          return;
        case "hookRoute": {
          const id = args[0] as string;
          let route = hookRoutes.get(id);
          if (!route) {
            route = hooks.register(async (payload) => {
              retain({ id, kind: "hook", payload });
            });
            hookRoutes.set(id, route);
          }
          return route.url;
        }
        case "retireHook":
          hookRoutes.get(args[0] as string)?.dispose();
          hookRoutes.delete(args[0] as string);
          return;
        case "screen": {
          const [id, cols, rows, seed, links] = args as [
            string,
            number,
            number,
            string,
            Parameters<HeadlessEmulator["setRestoredOscLinks"]>[0],
          ];
          if (sessions.has(id)) return;
          let session!: Session;
          const windowsHost = process.platform === "win32";
          const emulator = new HeadlessEmulator({
            cols,
            rows,
            scrollback: 5000,
            pathFlavor: windowsHost ? "win32" : "posix",
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
          };
          sessions.set(id, session);
          return;
        }
        case "snapshot": {
          const s = sessions.get(args[0] as string)!;
          await s.parsed;
          return s.emulator.getSnapshot({
            scrollbackRows: args[1] as number | undefined,
          });
        }
        case "screenWrite": {
          const s = sessions.get(args[0] as string)!;
          s.parsed = s.emulator.write(args[1] as string);
          await s.parsed;
          return;
        }
        case "screenCursor":
          return sessions.get(args[0] as string)!.emulator.getCursorRow();
        case "freeze": {
          const s = sessions.get(args[0] as string)!;
          s.child?.pause();
          s.serial = s.serial.then(() => {
            s.frozen = true;
          });
          await s.serial;
          return;
        }
        case "thaw": {
          const s = sessions.get(args[0] as string);
          if (s) {
            s.frozen = false;
            wake();
            if (!s.paused) s.child?.resume();
          }
          return;
        }
        case "spawn": {
          const request = args[0] as SpawnPty;
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
                session.parsed = emulator.write(data, {
                  forwardQueryReplies: true,
                });
                await session.parsed;
                if (host && active && !session.stopping)
                  await host.call("data", child.pid, data).catch(() => {});
              })
              .finally(() => {
                if (!session.paused && !session.frozen && !ending)
                  child.resume();
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
        }
        case "write":
          sessions.get(args[0] as string)?.child?.write(args[1] as string);
          return;
        case "resize": {
          const s = sessions.get(args[0] as string);
          if (s) {
            s.emulator.resize(args[1] as number, args[2] as number);
            s.child?.resize(args[1] as number, args[2] as number);
          }
          return;
        }
        case "attributes": {
          const s = sessions.get(args[0] as string);
          if (s) {
            s.attributes = args[1] as TerminalViewAttributes;
            s.emulator.applyPushedViewAttributes(s.attributes);
          }
          return;
        }
        case "pause": {
          const s = sessions.get(args[0] as string);
          if (s) {
            s.paused = true;
            s.child?.pause();
          }
          return;
        }
        case "resume": {
          const s = sessions.get(args[0] as string);
          if (s) {
            s.paused = false;
            if (!s.frozen) s.child?.resume();
          }
          return;
        }
        case "kill": {
          const s = sessions.get(args[0] as string);
          if (s) {
            await stop(s);
            return s.exit;
          }
          return;
        }
        case "remove": {
          const s = sessions.get(args[0] as string);
          if (s) {
            await stop(s);
            s.emulator.dispose();
            sessions.delete(s.id);
          }
          return;
        }
        default:
          throw new Error("Unknown PTY operation");
      }
    };
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
