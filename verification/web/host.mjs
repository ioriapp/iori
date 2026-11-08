import os from "node:os";
import { syncBuiltinESMExports } from "node:module";
import { join } from "node:path";
import {
  boundTerminalDaemon,
  stopTerminalDaemon,
} from "../terminal/daemon-process.mjs";
import { fork } from "node:child_process";
import { startHost } from "../../apps/host/src/host.ts";
import { verificationHostEnvironment } from "../cli/environment.mjs";
import { observePtyDimensions } from "./pty-dimensions.mjs";

// A stopped Host process releases its native UDP endpoint as on a real machine.
// Closing an endpoint while retaining its JS/native object in this process does
// not necessarily release the socket before another Host tries to bind it.
export async function startWebHost(
  distribution = process.env.IORI_WEB_HOST_DISTRIBUTION,
  {
    dataRoot = process.env.XDG_DATA_HOME,
    port = process.env.IORI_HOST_PORT,
    onPtyDimensions,
    onLog,
    cliEnvironment = {},
    fixtureHostName,
  } = {},
) {
  const root = join(dataRoot, "iori-host");
  const child = fork(
    distribution ? `${distribution}/service.mjs` : import.meta.filename,
    distribution
      ? []
      : [
          "--host",
          ...(fixtureHostName ? ["--fixture-host-name", fixtureHostName] : []),
        ],
    {
      execPath: distribution
        ? `${distribution}/runtime/node`
        : process.execPath,
      stdio: [
        "ignore",
        onLog ? "pipe" : "ignore",
        onLog ? "pipe" : "inherit",
        "ipc",
      ],
      env: {
        ...verificationHostEnvironment(),
        ...cliEnvironment,
        XDG_DATA_HOME: dataRoot,
        IORI_HOST_PORT: String(port),
      },
    },
  );
  if (onLog) {
    child.stdout.on("data", (chunk) => onLog(chunk));
    child.stderr.on("data", (chunk) => {
      process.stderr.write(chunk);
      onLog(chunk);
    });
  }
  const ready = new Promise((resolve) => {
    child.on("message", (message) => {
      if (message?.kind === "pty-dimensions") onPtyDimensions?.(message.entry);
      else if (message === "ready") resolve();
    });
  });
  const exited = new Promise((resolve, reject) => {
    child.once("error", reject);
    child.once("exit", (code) =>
      code === 0
        ? resolve()
        : reject(new Error("検証Hostが正常に終了しませんでした")),
    );
  });
  // Observe early exits too; the runner still owns and stops this child on error.
  void exited.catch(() => {});
  try {
    await Promise.race([
      ready,
      exited.then(() => {
        throw new Error("検証Hostが起動前に終了しました");
      }),
    ]);
    await boundTerminalDaemon(root);
  } catch (error) {
    child.kill("SIGTERM");
    await exited.catch(() => {});
    await stopTerminalDaemon(root);
    throw error;
  }
  return {
    async close({ stopTerminals = false } = {}) {
      try {
        if (child.connected) child.send("stop");
        await exited;
      } finally {
        if (stopTerminals) await stopTerminalDaemon(root);
      }
    },
  };
}

if (process.argv.includes("--host")) {
  const nameIndex = process.argv.indexOf("--fixture-host-name");
  if (nameIndex !== -1) {
    // Public screenshots use a fictional OS name; Host and transport stay real.
    const name = process.argv[nameIndex + 1];
    os.hostname = () => name;
    syncBuiltinESMExports();
  }
  observePtyDimensions((entry) =>
    process.send({ kind: "pty-dimensions", entry }),
  );
  const host = await startHost();
  process.send("ready");
  await new Promise((resolve) => {
    process.once("message", resolve);
    process.once("disconnect", resolve);
  });
  await host.close();
  if (process.connected) process.disconnect();
  process.exit(0);
}
