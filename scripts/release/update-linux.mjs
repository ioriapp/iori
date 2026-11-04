import { execFile, spawn } from "node:child_process";
import { promisify } from "node:util";
import { mkdir, writeFile, rm, readFile } from "node:fs/promises";
import { join } from "node:path";
const run = promisify(execFile);
export async function serviceUnit() {
  if (!process.env.NOTIFY_SOCKET) return undefined;
  try {
    const groups = await readFile("/proc/self/cgroup", "utf8");
    return groups
      .split("\n")
      .map((line) => line.split(":").slice(2).join(":").split("/").at(-1))
      .find((part) => part?.endsWith(".service"));
  } catch {
    return undefined;
  }
}
export async function restart(unit) {
  try {
    await run("systemctl", ["--user", "restart", "--no-block", unit]);
  } catch (error) {
    // systemd stops all processes in this service, including this command.
    // Only the new ready Host determines success after reconnection.
    if (error.signal !== "SIGTERM") throw error;
  }
}
export async function launchUpdate(request, work) {
  const quote = (value) =>
    '"' +
    value
      .replaceAll("\\", "\\\\")
      .replaceAll('"', '\\"')
      .replaceAll("%", "%%") +
    '"';
  const node = join(work, "node"),
    entry = join(work, "update.mjs");
  const child = spawn(
    "systemd-run",
    [
      "--user",
      "--quiet",
      "--collect",
      "--wait",
      `--unit=iori-host-update-${request.id}`,
      "--property=Type=exec",
      "--property=TimeoutStartSec=infinity",
      "--property=TimeoutStopSec=infinity",
      `--property=ExecStopPost=${quote(node)} ${quote(entry)} ${quote(join(work, "request.json"))} --cleanup`,
      node,
      entry,
      join(work, "request.json"),
    ],
    { stdio: "ignore" },
  );
  const exited = new Promise((resolve) => {
    child.once("close", (code, signal) => {
      // This observer shares the Host's cgroup. Its termination by a signal
      // does not mean that the separate updater unit has finished.
      if (signal === null) resolve(code);
    });
  });
  await new Promise((resolve, reject) => {
    child.once("spawn", resolve);
    child.once("error", reject);
  });
  child.unref();
  return { exited };
}
export async function adapter(request) {
  const dropIn = join(
    process.env.XDG_RUNTIME_DIR,
    "systemd",
    "user",
    request.unit + ".d",
    "iori-host-update.conf",
  );
  return {
    async prepare() {
      await mkdir(join(dropIn, ".."), { recursive: true });
      await writeFile(
        dropIn,
        "[Service]\nRestart=no\nTimeoutStartSec=infinity\n",
      );
      await run("systemctl", ["--user", "daemon-reload"]);
    },
    async stop() {
      await run("systemctl", ["--user", "stop", request.unit]).catch(
        (error) => {
          // systemctl's EXIT_NOTINSTALLED: an absent unit is already stopped.
          if (error.code !== 5) throw error;
        },
      );
    },
    async start() {
      // Type=notify completes the start job at READY=1. With Restart=no a
      // pre-ready exit fails this job, instead of silently retrying forever.
      await run("systemctl", ["--user", "start", request.unit]);
    },
    async cleanup() {
      try {
        await rm(dropIn, { force: true });
      } finally {
        await run("systemctl", ["--user", "daemon-reload"]);
      }
    },
    async extract(archive, destination) {
      await mkdir(destination, { recursive: true });
      await run("tar", ["-xzf", archive, "-C", destination]);
    },
  };
}
