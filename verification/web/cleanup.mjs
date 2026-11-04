import { stopTerminalDaemonsUnder } from "../terminal/daemon-process.mjs";
import { mkdir, readdir, readFile, realpath, rm } from "node:fs/promises";
import { join, resolve } from "node:path";

function running(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    // If ownership cannot be observed, preserve the folder rather than delete it.
    return error.code !== "ESRCH";
  }
}

async function legacyRunnerActive(runnerPath) {
  // Earlier runners have no owner.pid. Do not sweep their folders while one is running.
  for (const pid of await readdir("/proc")) {
    if (!/^\d+$/.test(pid) || Number(pid) === process.pid) continue;
    try {
      const args = (await readFile(`/proc/${pid}/cmdline`, "utf8")).split("\0");
      const cwd = await realpath(`/proc/${pid}/cwd`);
      if (args[1] && resolve(cwd, args[1]) === runnerPath) return true;
    } catch {
      // Processes can disappear between the directory listing and observation.
    }
  }
  return false;
}

export async function cleanStaleRuns(runsRoot, runnerPath) {
  await mkdir(runsRoot, { recursive: true });
  let legacyActive;
  for (const entry of await readdir(runsRoot, { withFileTypes: true })) {
    if (!entry.isDirectory() || !entry.name.startsWith("run-")) continue;
    const path = join(runsRoot, entry.name);
    try {
      const pid = Number(await readFile(join(path, "owner.pid"), "utf8"));
      if (running(pid)) continue;
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
      legacyActive ??= await legacyRunnerActive(runnerPath);
      if (legacyActive) continue;
    }
    await stopTerminalDaemonsUnder(path);
    await rm(path, { recursive: true, force: true });
  }
}

export async function pruneScreenshots(evidenceRoot, latestRun, scenario) {
  await mkdir(evidenceRoot, { recursive: true });
  for (const entry of await readdir(evidenceRoot, { withFileTypes: true })) {
    if (
      !entry.isDirectory() ||
      !entry.name.startsWith("run-") ||
      entry.name === latestRun
    )
      continue;
    const path = join(evidenceRoot, entry.name);
    let result;
    try {
      result = JSON.parse(await readFile(join(path, "result.json"), "utf8"));
    } catch {
      // Missing/unreadable records may be active or interrupted runs; keep their evidence.
      continue;
    }
    if (!result.passed || !result.cleanup || result.scenario !== scenario)
      continue;
    for (const image of await readdir(path, { withFileTypes: true }))
      if (image.isFile() && image.name.endsWith(".png"))
        await rm(join(path, image.name), { force: true });
  }
}
