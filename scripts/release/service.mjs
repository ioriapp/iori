import { execFile } from "node:child_process";
import { promisify } from "node:util";
let host;
const notifySocket = process.env.NOTIFY_SOCKET;
let service;
if (process.platform === "linux" && notifySocket) {
  const os = await import("./update-linux.mjs");
  const unit = await os.serviceUnit();
  if (unit)
    service = {
      bundle: import.meta.dirname,
      unit,
      restart: () => os.restart(unit),
      launchUpdate: os.launchUpdate,
      ...(await import("./uninstall-linux.mjs")),
    };
} else if (process.argv.includes("--launcher")) {
  const os = await import("./update-windows.mjs");
  service = {
    bundle: import.meta.dirname,
    restart: async () => {
      process.exitCode = 75;
      stopHost();
    },
    launchUpdate: os.launchUpdate,
    ...(await import("./uninstall-windows.mjs")),
  };
}
let stopHost;

delete process.env.NOTIFY_SOCKET;
const stopped = new Promise((resolve) => {
  stopHost = resolve;
  process.once("SIGTERM", resolve);
  process.once("SIGINT", resolve);
  process.once("message", resolve);
  if (process.argv.includes("--launcher")) process.stdin.once("data", resolve);
});
try {
  const { startHost } = await import("./src/host.js");
  host = await startHost(undefined, service, import.meta.dirname);
  if (notifySocket)
    await promisify(execFile)("systemd-notify", ["--ready"], {
      env: { ...process.env, NOTIFY_SOCKET: notifySocket },
    });
  if (process.connected) process.send("ready");
  if (process.argv.includes("--launcher")) process.stdout.write("ready\n");
  await host.maintenanceReady();
  await stopped;
} catch (error) {
  process.stderr.write(`Hostを起動できませんでした: ${error.message}\n`);
  process.exitCode = 1;
} finally {
  await host?.close();
  if (process.connected) process.disconnect();
}
process.exit(process.exitCode ?? 0);
