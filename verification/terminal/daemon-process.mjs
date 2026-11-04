import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { isAbsolute, join, relative, resolve, sep } from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const run = promisify(execFile);
const units = new Map();

async function daemonUnit(root) {
  if (process.platform !== "linux") return undefined;
  try {
    const { pid } = JSON.parse(
      await readFile(join(root, "terminal-daemon", "connection.json"), "utf8"),
    );
    const cgroup = await readFile(`/proc/${pid}/cgroup`, "utf8");
    return cgroup
      .split(/[\/\n]/u)
      .find((part) =>
        /^iori-terminal-[a-f0-9]+-[a-f0-9-]+\.service$/u.test(part),
      );
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
  if (!unit) return;
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
    const { stopTerminalDaemon: stopDaemon } =
      await import("../../apps/host/src/terminal/daemon/launch.ts");
    await stopDaemon(root);
  }
  for (const entry of units.values()) {
    if (entry.root !== root) continue;
    await stopUnit(entry.unit);
    entry.removed = true;
  }
}

export function terminalDaemonEvidence() {
  return [...units.values()].map(({ root: _root, ...entry }) => entry);
}

async function stopUnit(unit) {
  if (await loaded(unit)) {
    try {
      await run("systemctl", ["--user", "stop", unit]);
    } catch (error) {
      if (await loaded(unit)) throw error;
    }
  }
  assert.equal(
    await loaded(unit),
    false,
    "the owned daemon unit must be collected",
  );
}

/** Recover only daemons whose systemd working directory is inside this owned run. */
export async function stopTerminalDaemonsUnder(directory) {
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
  ]);
  for (const line of stdout.trim().split("\n")) {
    const unit = line.trim().split(/\s+/u)[0];
    if (!/^iori-terminal-[a-f0-9]+-[a-f0-9-]+\.service$/u.test(unit)) continue;
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
      continue;
    }
    const path = workingDirectory.trim();
    if (!isAbsolute(path)) continue;
    const child = relative(root, path);
    if (child === ".." || child.startsWith(`..${sep}`) || isAbsolute(child))
      continue;
    await stopUnit(unit);
    console.log(`検証用Terminal係を回収: ${unit}`);
  }
}
