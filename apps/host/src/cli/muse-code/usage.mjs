import { spawnSync } from "node:child_process";

try {
  const result = spawnSync("muse", ["usage", "--json"], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "ignore"],
  });
  if (result.status === 0)
    process.stdout.write(JSON.stringify(JSON.parse(result.stdout)));
} catch {
  // Leave the last displayed value unchanged when the command fails.
}
