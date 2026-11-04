import { spawn, execFile } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { connect } from "node:net";
import {
  cp,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  chmod,
  open,
} from "node:fs/promises";
import { watch } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { DaemonChannel } from "./channel.ts";
import {
  DAEMON_PROTOCOL,
  type DaemonDescriptor,
  type DaemonHello,
} from "./protocol.ts";
import type { PtyScreen } from "./protocol.ts";
import terminalNative from "@iori/terminal-native";

const run = promisify(execFile);
const entry = fileURLToPath(
  new URL(
    `./entry${import.meta.filename.endsWith(".ts") ? ".ts" : ".js"}`,
    import.meta.url,
  ),
);
async function connectDaemon(descriptor: DaemonDescriptor) {
  const socket = connect(descriptor.endpoint);
  await new Promise<void>((yes, no) => {
    socket.once("connect", yes);
    socket.once("error", no);
  });
  const channel = new DaemonChannel(socket);
  try {
    const hello = await channel.call<DaemonHello>("hello", descriptor.token);
    return { channel, hello };
  } catch (error) {
    channel.close();
    throw error;
  }
}
async function existing(root: string) {
  try {
    const descriptor = JSON.parse(
      await readFile(join(root, "terminal-daemon", "connection.json"), "utf8"),
    ) as DaemonDescriptor;
    return await connectDaemon(descriptor);
  } catch {
    // Unreadable descriptors and stale endpoints do not prevent a cold start.
    return undefined;
  }
}

export async function terminalDaemonCanContinue(
  root: string,
): Promise<boolean> {
  const live = await existing(root);
  if (!live) return false;
  try {
    return live.hello.version === DAEMON_PROTOCOL;
  } finally {
    live.channel.close();
  }
}

async function shutdownTerminalDaemon(
  live: Awaited<ReturnType<typeof connectDaemon>>,
): Promise<PtyScreen[] | undefined> {
  try {
    // Protocols 4–13 share this PTY transport. Earlier daemons expose a
    // different attach result; later ones already resume output when stopping.
    if (live.hello.version >= 4 && live.hello.version <= 13) {
      live.channel.handle = async (method) => {
        if (method === "data") return;
        throw new Error("Terminal daemon is stopping");
      };
      const sessions = await live.channel.call<PtyScreen[]>("attach");
      await live.channel.call("activate");
      // Keep acknowledging output until every PTY exits. On Windows a paused
      // output socket cannot close, so shutdown's own snapshot would deadlock.
      await Promise.all(
        sessions.map((session) => live.channel.call("kill", session.id)),
      );
      await live.channel.call("shutdown");
      return sessions;
    }
    return await live.channel.call<PtyScreen[] | undefined>("shutdown");
  } finally {
    live.channel.close();
  }
}

/** Explicit stop for incompatible runtimes, uninstall and owned verification cleanup. */
export async function stopTerminalDaemon(
  root: string,
): Promise<PtyScreen[] | undefined> {
  const live = await existing(root);
  if (!live) return undefined;
  return shutdownTerminalDaemon(live);
}

async function materialize(root: string) {
  if (entry.endsWith(".ts")) return { executable: process.execPath, entry };
  // Called only after the previous daemon stopped. Windows may still hold an
  // exiting native library; leave that copy for the next cold start to reclaim.
  await rm(join(root, "terminal-daemon", "runtime"), {
    recursive: true,
    force: true,
  }).catch(() => {});
  const bundle = resolve(dirname(entry), "../../..");
  const version = (
    JSON.parse(await readFile(join(bundle, "package.json"), "utf8")) as {
      version: string;
    }
  ).version;
  const destination = join(
    root,
    "terminal-daemon",
    "runtime",
    version,
    randomUUID(),
  );
  await mkdir(destination, { recursive: true, mode: 0o700 });
  // Live node/native libraries never reference the install directory being replaced.
  const files = JSON.parse(
    await readFile(join(bundle, "terminal-daemon-files.json"), "utf8"),
  ) as { sources: string[]; packages: string[] };
  for (const name of [
    "runtime",
    "package.json",
    ...files.sources,
    ...files.packages.map((name) => `node_modules/${name}`),
  ]) {
    await mkdir(dirname(join(destination, name)), { recursive: true });
    await cp(join(bundle, name), join(destination, name), { recursive: true });
  }
  return {
    executable: join(
      destination,
      "runtime",
      process.platform === "win32" ? "node.exe" : "node",
    ),
    entry: join(destination, "src", "terminal", "daemon", "entry.js"),
  };
}

export async function attachTerminalDaemon(root: string): Promise<{
  channel: DaemonChannel;
  continued: boolean;
  previous?: unknown;
}> {
  const live = await existing(root);
  if (live?.hello.version === DAEMON_PROTOCOL)
    return { channel: live.channel, continued: true };
  let previous: unknown;
  if (live) previous = await shutdownTerminalDaemon(live);
  const directory = join(root, "terminal-daemon");
  await mkdir(directory, { recursive: true, mode: 0o700 });
  if (process.platform === "win32")
    terminalNative.restrictToCurrentUser(directory);
  else await chmod(directory, 0o700);
  const identity = createHash("sha256")
    .update(resolve(root))
    .digest("hex")
    .slice(0, 24);
  const endpointDirectory =
    process.platform === "win32"
      ? directory
      : await mkdtemp(join(tmpdir(), "iori-terminal-"));
  const endpoint =
    process.platform === "win32"
      ? `\\\\.\\pipe\\iori-terminal-${identity}-${randomUUID()}`
      : join(endpointDirectory, "terminal.sock");
  if (process.platform !== "win32") await rm(endpoint, { force: true });
  await rm(join(directory, "connection.json"), { force: true });
  const materialized = await materialize(root);
  let systemd = false;
  if (process.platform === "linux") {
    systemd = await run("systemctl", ["--user", "show-environment"]).then(
      () => true,
      () => false,
    );
  }
  const args = [materialized.entry, root, endpoint];
  const log = await open(join(directory, "startup.log"), "w", 0o600);
  const ready = new Promise<void>((resolveReady, reject) => {
    const watcher = watch(directory, () => {
      void readFile(join(directory, "connection.json")).then(
        () => {
          watcher.close();
          resolveReady();
        },
        (error) => {
          if (error.code !== "ENOENT") {
            watcher.close();
            reject(error);
          }
        },
      );
    });
    watcher.on("error", reject);
    const env = { ...process.env };
    delete env.NOTIFY_SOCKET;
    delete env.INVOCATION_ID;
    delete env.JOURNAL_STREAM;
    const child = systemd
      ? spawn(
          "systemd-run",
          [
            "--user",
            "--quiet",
            "--collect",
            "--wait",
            `--unit=iori-terminal-${identity}-${randomUUID()}`,
            "--property=Type=exec",
            `--working-directory=${root}`,
            ...Object.keys(env).map((name) => `--setenv=${name}`),
            materialized.executable,
            ...args,
          ],
          { detached: true, stdio: "ignore", env },
        )
      : spawn(
          materialized.executable,
          [
            "-e",
            "const {spawn}=require('node:child_process');const child=spawn(process.execPath,process.argv.slice(1),{detached:true,stdio:['ignore','ignore',2,'ipc']});child.once('error',()=>process.exit(1));child.once('exit',code=>process.exit(code||1));child.once('message',()=>{child.unref();process.exit(0)});",
            ...args,
          ],
          {
            detached: true,
            stdio: ["ignore", "ignore", log.fd],
            cwd: root,
            env,
          },
        );
    child.once("error", (error) => {
      watcher.close();
      reject(error);
    });
    child.once("exit", (code) => {
      if (code !== 0) {
        watcher.close();
        reject(new Error("Terminal daemon could not start"));
      }
    });
    child.unref();
  });
  try {
    await ready;
  } finally {
    await log.close();
  }
  const started = await existing(root);
  if (!started) throw new Error("Terminal daemon did not open its connection");
  return { channel: started.channel, continued: false, previous };
}
