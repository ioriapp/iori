import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

export function writeMemoryEvidence(file, measurement) {
  try {
    writeFileSync(file, JSON.stringify(measurement, null, 2) + "\n", {
      flag: "wx",
    });
  } catch (error) {
    return memoryEvidenceError(file, error);
  }
}

function memoryEvidenceError(file, error) {
  const reason = `MemoryPeakの記録に失敗: ${file}: ${error.message}`;
  console.error(reason);
  return reason;
}

// Read before this scope exits: successful transient scopes may be collected
// before the outer process can query systemd. OOM uses the outer owner's record.
export function recordCurrentMemoryEvidence(file) {
  try {
    const group = readFileSync("/proc/self/cgroup", "utf8")
      .split("\n")
      .find((line) => line.startsWith("0::"))
      .slice(3);
    const directory = join("/sys/fs/cgroup", group);
    return writeMemoryEvidence(file, {
      source: "cgroup",
      peakBytes: Number(readFileSync(join(directory, "memory.peak"), "utf8")),
      limitBytes: Number(readFileSync(join(directory, "memory.max"), "utf8")),
    });
  } catch (error) {
    return memoryEvidenceError(file, error);
  }
}
