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
import { DAEMON_PROTOCOL, type DaemonDescriptor } from "./protocol.ts";
import terminalNative from "@iori/terminal-native";

const run = promisify(execFile);
// Healthy Windows daemons wait ~1s in node-pty ConoutConnection.dispose()
// (FLUSH_DATA_INTERVAL = 1000ms) after shutdown RPC returns (~953ms measured;
// ~5-9ms on Linux). Wait 3s before verified termination of a leaked daemon.
const DAEMON_SHUTDOWN_WAIT_MS = 3000;
const DAEMON_EXIT_POLL_MS = 25;

export interface DaemonProcessIdentity {
  start: string;
  commandLine: string;
}

async function isDaemonProcessAlive(pid: number): Promise<boolean> {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === "EPERM";
  }
  if (process.platform === "linux") {
    try {
      const stat = await readFile(`/proc/${pid}/stat`, "utf8");
      const closeParen = stat.lastIndexOf(")");
      if (closeParen < 0) return true;
      const state = stat.slice(closeParen + 2).split(" ")[0];
      return state !== "Z" && state !== "X";
    } catch (error) {
      return (error as NodeJS.ErrnoException).code !== "ENOENT";
    }
  }
  return true;
}

export async function captureDaemonProcessIdentity(
  pid: number,
): Promise<DaemonProcessIdentity | undefined> {
  if (!Number.isInteger(pid) || pid <= 0) return undefined;
  if (process.platform === "linux") {
    try {
      const stat = await readFile(`/proc/${pid}/stat`, "utf8");
      const closeParen = stat.lastIndexOf(")");
      if (closeParen < 0) return undefined;
      const fields = stat.slice(closeParen + 2).split(" ");
      if (fields[0] === "Z" || fields[0] === "X") return undefined;
      const start = fields[19];
      if (!start) return undefined;
      const commandLine = await readFile(`/proc/${pid}/cmdline`, "utf8");
      if (!commandLine) return undefined;
      return { start, commandLine };
    } catch {
      return undefined;
    }
  }
  if (process.platform === "win32") {
    try {
      const script =
        "[Console]::OutputEncoding=[Text.Encoding]::UTF8;" +
        "$p=Get-CimInstance Win32_Process -Filter ('ProcessId='+[int]$env:IORI_DAEMON_PID);" +
        "if($p -and $null -ne $p.CreationDate -and $p.CommandLine){[Console]::Out.Write((@($p.CreationDate.ToFileTimeUtc().ToString(),$p.CommandLine)|ConvertTo-Json -Compress))}";
      const { stdout } = await run(
        "powershell.exe",
        ["-NoProfile", "-NonInteractive", "-Command", script],
        {
          windowsHide: true,
          env: { ...process.env, IORI_DAEMON_PID: String(pid) },
        },
      );
      if (!stdout.trim()) return undefined;
      const parsed = JSON.parse(stdout) as unknown;
      if (
        !Array.isArray(parsed) ||
        typeof parsed[0] !== "string" ||
        typeof parsed[1] !== "string" ||
        !parsed[0] ||
        !parsed[1]
      )
        return undefined;
      return { start: parsed[0], commandLine: parsed[1] };
    } catch {
      return undefined;
    }
  }
  return undefined;
}

export async function terminateVerifiedDaemonProcess(
  pid: number,
  identity: DaemonProcessIdentity | undefined,
): Promise<boolean> {
  if (!identity || !Number.isInteger(pid) || pid <= 0) return false;
  if (process.platform === "linux") {
    const current = await captureDaemonProcessIdentity(pid);
    if (
      !current ||
      current.start !== identity.start ||
      current.commandLine !== identity.commandLine
    )
      return false;
    try {
      process.kill(pid, "SIGKILL");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ESRCH") return false;
      throw error;
    }
    return true;
  }
  if (process.platform === "win32") {
    const script =
      "$p=Get-CimInstance Win32_Process -Filter ('ProcessId='+[int]$env:IORI_DAEMON_PID);" +
      "if($p -and $null -ne $p.CreationDate -and $p.CreationDate.ToFileTimeUtc().ToString() -eq $env:IORI_DAEMON_START -and $p.CommandLine -eq $env:IORI_DAEMON_CMD){" +
      "try{Stop-Process -Id $p.ProcessId -Force -ErrorAction Stop;[Console]::Out.Write('1')}catch{}" +
      "}";
    const { stdout } = await run(
      "powershell.exe",
      ["-NoProfile", "-NonInteractive", "-Command", script],
      {
        windowsHide: true,
        env: {
          ...process.env,
          IORI_DAEMON_PID: String(pid),
          IORI_DAEMON_START: identity.start,
          IORI_DAEMON_CMD: identity.commandLine,
        },
      },
    );
    return stdout.trim() === "1";
  }
  return false;
}

async function waitForDaemonExit(
  pid: number,
  identity: DaemonProcessIdentity | undefined,
  waitMs = DAEMON_SHUTDOWN_WAIT_MS,
): Promise<void> {
  if (!Number.isInteger(pid) || pid <= 0) return;
  const deadline = Date.now() + waitMs;
  while (await isDaemonProcessAlive(pid)) {
    if (Date.now() >= deadline) {
      const terminated = await terminateVerifiedDaemonProcess(
        pid,
        identity,
      ).catch(() => false);
      if (!terminated) return;
      const killDeadline = Date.now() + 1000;
      while ((await isDaemonProcessAlive(pid)) && Date.now() < killDeadline)
        await new Promise((resolve) =>
          setTimeout(resolve, DAEMON_EXIT_POLL_MS),
        );
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, DAEMON_EXIT_POLL_MS));
  }
}
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
    const hello = await channel.call("hello", descriptor.token);
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
): Promise<unknown> {
  const pid = live.hello.pid;
  const identity = await captureDaemonProcessIdentity(pid);
  let result: unknown;
  try {
    // Protocols <=13 deadlock on Windows shutdown while PTY output is paused;
    // terminate those legacy daemons directly and recover from SQLite.
    if (live.hello.version > 13) {
      result = await live.channel.call("shutdown");
    }
  } finally {
    live.channel.close();
  }
  await waitForDaemonExit(
    pid,
    identity,
    live.hello.version <= 13 ? 0 : DAEMON_SHUTDOWN_WAIT_MS,
  );
  return result;
}

/** Explicit stop for incompatible runtimes, uninstall and owned verification cleanup. */
export async function stopTerminalDaemon(root: string): Promise<unknown> {
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
  ) as string[];
  for (const name of files) {
    await mkdir(dirname(join(destination, name)), { recursive: true });
    await cp(join(bundle, name), join(destination, name));
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
            "const {spawn}=require('node:child_process');const child=spawn(process.execPath,process.argv.slice(1),{detached:true,windowsHide:true,stdio:['ignore','ignore',2,'ipc']});child.once('error',()=>process.exit(1));child.once('exit',code=>process.exit(code||1));child.once('message',()=>{child.unref();process.exit(0)});",
            ...args,
          ],
          {
            detached: true,
            windowsHide: true,
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
