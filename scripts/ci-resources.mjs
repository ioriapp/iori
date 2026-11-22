import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const gib = 1024 ** 3;
const isPositiveInteger = (value) => Number.isSafeInteger(value) && value > 0;

function memoryBytes(value) {
  // Docker accepts binary units, including the optional B or iB suffix.
  const match = /^(\d+(?:\.\d*)?|\.\d+) ?(b|[kmgtp](?:i?b)?)?$/i.exec(value);
  if (!match) return 0;
  const power = "bkmgtp".indexOf((match[2] ?? "b")[0].toLowerCase());
  return Number(match[1]) * 1024 ** power;
}

export function ciResources({
  hostMemory,
  hostCpus,
  dockerMemory,
  dockerCpus,
  memoryOverride,
}) {
  // /proc/meminfo can report the physical machine behind an LXC guest.
  const memory = Math.min(
    hostMemory,
    isPositiveInteger(dockerMemory) ? dockerMemory : Infinity,
  );
  const memoryGiB = isPositiveInteger(memory)
    ? Math.min(24, Math.max(8, Math.floor(memory / (2 * gib))))
    : 8;
  const cpus = Math.min(
    hostCpus,
    isPositiveInteger(dockerCpus) ? dockerCpus : Infinity,
  );
  const limit = memoryOverride ? memoryBytes(memoryOverride) : memoryGiB * gib;
  const parallel = isPositiveInteger(cpus) && cpus >= 8 && limit >= 16 * gib;
  const playwrightWorkers = parallel ? 5 : 4;
  return {
    memoryGiB,
    cargoJobs: parallel ? 4 : 2,
    parallelSuites: parallel ? 1 : 0,
    // Host API tests take longer, and each browser worker starts a Host.
    testConcurrency: parallel
      ? Math.min(cpus - playwrightWorkers, Math.floor(cpus / 2))
      : 0,
    playwrightWorkers,
  };
}

function capture(command, ...args) {
  const result = spawnSync(command, args, { encoding: "utf8" });
  return result.status === 0 ? result.stdout.trim() : "";
}

function hostResources() {
  if (process.platform === "darwin")
    return {
      hostMemory: Number(capture("sysctl", "-n", "hw.memsize")),
      hostCpus: Number(capture("sysctl", "-n", "hw.ncpu")),
    };

  let hostMemory = 0;
  try {
    const meminfo = readFileSync("/proc/meminfo", "utf8");
    hostMemory = Number(/^MemTotal:\s+(\d+) kB$/m.exec(meminfo)?.[1]) * 1024;
  } catch {
    // A host without readable memory information uses the 8 GiB default.
  }
  return { hostMemory, hostCpus: Number(capture("nproc")) };
}

if (
  process.argv[1] &&
  fileURLToPath(import.meta.url) === resolve(process.argv[1])
) {
  const [dockerCpus, dockerMemory] = capture(
    "docker",
    "info",
    "--format",
    "{{.NCPU}} {{.MemTotal}}",
  )
    .split(/\s+/)
    .map(Number);
  const resources = ciResources({
    ...hostResources(),
    dockerCpus,
    dockerMemory,
    memoryOverride: process.env.IORI_CI_MEMORY,
  });
  process.stdout.write(Object.values(resources).join(" ") + "\n");
}
