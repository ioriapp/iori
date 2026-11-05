import { lockEntry } from "../native/locks.mjs";

await lockEntry(import.meta.url);
if (process.argv[process.argv.indexOf("--host") + 1] === "Windows") {
  const {
    windowsSshScenario,
    cleanupWindowsSshBuild,
    cleanupWindowsSshHostOnly,
  } = await import("./windows-ssh.mjs");
  if (process.argv.includes("--cleanup-host"))
    await cleanupWindowsSshHostOnly();
  else if (process.argv.includes("--cleanup-build"))
    await cleanupWindowsSshBuild();
  else await windowsSshScenario();
} else {
  await import("./linux-ssh.mjs");
}
