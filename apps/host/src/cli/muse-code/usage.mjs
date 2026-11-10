import { spawnSync } from "node:child_process";

try {
  const result = spawnSync("muse", ["usage", "--json"], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "ignore"],
  });
  if (result.status === 0) {
    const allowance = JSON.parse(result.stdout)?.allowance;
    const windows = [];
    for (const [window, minutes] of [
      [allowance?.window, 300],
      [allowance?.weekly, 10080],
    ]) {
      const used = window?.usedPercent;
      if (typeof used !== "number" || used < 0 || used > 100) continue;
      windows.push({
        remaining: 100 - used,
        minutes,
        ...(typeof window.resetsAtMs === "number"
          ? { resetsAt: window.resetsAtMs }
          : {}),
      });
    }
    if (windows.length) process.stdout.write(JSON.stringify({ windows }));
  }
} catch {
  // No usable allowance is available.
}
