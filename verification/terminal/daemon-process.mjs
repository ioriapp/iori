import assert from "node:assert/strict";
import { readFile, rm } from "node:fs/promises";
import { isAbsolute, join, relative, resolve, sep } from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const run = promisify(execFile);
const units = new Map();
const unboundedRoots = new Set();

async function unitIsUnder(unit, root) {
  let workingDirectory;
  try {
    ({ stdout: workingDirectory } = await run("systemctl", [
      "--user",
      "show",
      unit,
      "--property=WorkingDirectory",
      "--value",
    ]));
  } catch (error) {
    if (await loaded(unit)) throw error;
    return false;
  }
  const path = workingDirectory.trim();
  if (!isAbsolute(path)) return false;
  const child = relative(resolve(root), path);
  return child !== ".." && !child.startsWith(`..${sep}`) && !isAbsolute(child);
}

async function daemonUnit(root) {
  if (process.platform !== "linux") return undefined;
  try {
    const { pid } = JSON.parse(
      await readFile(join(root, "terminal-daemon", "connection.json"), "utf8"),
    );
    const cgroup = await readFile(`/proc/${pid}/cgroup`, "utf8");
    const unit = cgroup
      .split(/[\/\n]/u)
      .find((part) =>
        /^iori-terminal-[a-f0-9]+-[a-f0-9-]+\.service$/u.test(part),
      );
    // If systemd cannot be queried, ownership is not established. The caller
    // can still shut down the daemon through its own connection.
    return unit && (await unitIsUnder(unit, root).catch(() => false))
      ? unit
      : undefined;
  } catch (error) {
    if (error.code === "ENOENT") return undefined;
    throw error;
  }
}

async function loaded(unit) {
  try {
    const { stdout } = await run("systemctl", [
      "--user",
      "show",
      unit,
      "--property=LoadState",
      "--value",
    ]);
    return stdout.trim() !== "not-found";
  } catch (error) {
    if (error.stdout?.trim() === "not-found") return false;
    throw error;
  }
}

/** The product uses its normal unit; only the owned verification run caps it. */
export async function boundTerminalDaemon(root) {
  const unit = await daemonUnit(root);
  if (!unit) {
    unboundedRoots.add(root);
    return;
  }
  await run("systemctl", [
    "--user",
    "set-property",
    "--runtime",
    unit,
    "MemoryMax=4G",
    "MemorySwapMax=0",
  ]);
  const { stdout } = await run("systemctl", [
    "--user",
    "show",
    unit,
    "--property=MemoryMax",
    "--property=MemorySwapMax",
  ]);
  const properties = Object.fromEntries(
    stdout
      .trim()
      .split("\n")
      .map((line) => line.split("=")),
  );
  assert.equal(properties.MemoryMax, String(4 * 1024 ** 3));
  assert.equal(properties.MemorySwapMax, "0");
  units.set(unit, {
    root,
    unit,
    memoryMax: Number(properties.MemoryMax),
    memorySwapMax: 0,
    removed: false,
  });
}

export async function stopTerminalDaemon(root) {
  const current = await daemonUnit(root);
  if (current && !units.has(current))
    units.set(current, { root, unit: current, removed: false });
  // A shell can defer SIGHUP while Readline is waiting after an Escape key.
  // Recover the owned verification service as a whole instead of waiting for
  // each PTY to acknowledge the product's graceful shutdown request.
  if (!current) {
    if (process.platform === "linux") {
      // The connection descriptor may already have been removed by shutdown.
      // Without a user session the product starts a detached daemon instead.
      // When a session is configured, propagate bus/stop failures so the owner
      // record remains available for recovery on the next run.
      if (process.env.DBUS_SESSION_BUS_ADDRESS || process.env.XDG_RUNTIME_DIR)
        await stopTerminalDaemonsUnder(root);
      try {
        await run("flock", [
          join(root, ".verification-daemon-cleanup.lock"),
          process.execPath,
          import.meta.filename,
          "--stop-fallback",
          root,
        ]);
      } catch (error) {
        if (error.code !== 66) throw error;
        // The owned directory has already been removed by another cleanup.
      }
    } else {
      const { stopTerminalDaemon: stopDaemon } =
        await import("../../apps/host/src/terminal/daemon/launch.ts");
      await stopDaemon(root);
    }
  }
  for (const entry of units.values()) {
    if (entry.root !== root) continue;
    // Every entry passed daemonUnit's ownership check when it was recorded.
    await stopUnit(entry.unit);
    entry.removed = true;
  }
}

export function terminalDaemonEvidence() {
  return [
    ...[...units.values()].map(({ root: _root, ...entry }) => entry),
    ...[...unboundedRoots].map(() => ({
      unit: null,
      memoryMax: null,
      reason: "no-owned-unit",
    })),
  ];
}

async function stopUnit(unit) {
  if (await loaded(unit)) {
    try {
      await run("systemctl", ["--user", "stop", unit]);
    } catch (error) {
      if (await loaded(unit)) throw error;
    }
  }
  // Stopping a service and collecting its transient unit are separate states.
  const { stdout } = await run("systemctl", [
    "--user",
    "show",
    unit,
    "--property=LoadState",
    "--property=ActiveState",
    "--property=SubState",
    "--property=Result",
  ]).catch((error) => {
    if (error.stdout?.includes("LoadState=not-found"))
      return { stdout: error.stdout };
    throw error;
  });
  const state = Object.fromEntries(
    stdout
      .trim()
      .split("\n")
      .map((line) => line.split("=")),
  );
  assert.ok(
    state.LoadState === "not-found" ||
      (state.ActiveState === "inactive" &&
        state.SubState === "dead" &&
        state.Result === "success"),
    `the owned daemon unit must be stopped: ${JSON.stringify(state)}`,
  );
}

/** Recover only daemons whose systemd working directory is inside this owned run. */
export async function stopTerminalDaemonsUnder(directory) {
  return stopVerificationUnitsUnder(directory, false);
}

export async function stopVerificationUnitsUnder(
  directory,
  includeHosts = true,
) {
  if (process.platform !== "linux")
    throw new Error("Web runner daemon cleanup requires Linux systemd");
  const root = resolve(directory);
  const { stdout } = await run("systemctl", [
    "--user",
    "list-units",
    "--all",
    "--plain",
    "--no-legend",
    "iori-terminal-*.service",
    ...(includeHosts ? ["iori-host-update-verification-*.service"] : []),
  ]);
  for (const line of stdout.trim().split("\n")) {
    const unit = line.trim().split(/\s+/u)[0];
    const terminal = /^iori-terminal-[a-f0-9]+-[a-f0-9-]+\.service$/u.test(
      unit,
    );
    const host = /^iori-host-update-verification-[a-f0-9-]+\.service$/u.test(
      unit,
    );
    if (!terminal && !(includeHosts && host)) continue;
    let owned = await unitIsUnder(unit, root);
    if (!owned && host) {
      const { stdout: command } = await run("systemctl", [
        "--user",
        "show",
        unit,
        "--property=ExecStart",
        "--value",
      ]);
      const escapedRoot = root.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
      owned = new RegExp(
        `(?:^|[\\s="'])${escapedRoot}(?=[/\\s;"'}]|$)`,
        "u",
      ).test(command);
    }
    if (!owned) continue;
    if (terminal) await stopUnit(unit);
    else {
      await run("systemctl", ["--user", "stop", unit]);
      await rm(join(process.env.XDG_RUNTIME_DIR, "systemd/user", unit), {
        force: true,
      });
      await run("systemctl", ["--user", "daemon-reload"]);
      await run("systemctl", ["--user", "reset-failed", unit]).catch(() => {});
    }
    console.log(`検証用unitを回収: ${unit}`);
  }
}

if (process.argv[2] === "--stop-fallback") {
  const root = process.argv[3];
  let descriptor;
  try {
    descriptor = JSON.parse(
      await readFile(join(root, "terminal-daemon/connection.json"), "utf8"),
    );
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
  if (descriptor) {
    const { stopTerminalDaemon: stopDaemon } =
      await import("../../apps/host/src/terminal/daemon/launch.ts");
    await stopDaemon(root);
  }
}
