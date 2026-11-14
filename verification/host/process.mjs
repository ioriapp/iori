import {
  registerCleanup,
  ownVerificationDirectory,
  recoverStaleVerificationRuns,
  registerVerificationDaemon,
} from "../lifecycle.mjs";
import { fork } from "node:child_process";
import { createSocket } from "node:dgram";
import { createServer } from "node:net";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { stopCliProcesses } from "../cli/home.mjs";
import { verificationHostEnvironment } from "../cli/environment.mjs";
import { stopTerminalDaemon } from "../terminal/daemon-process.mjs";
import { connectClient } from "./client.mjs";
import { prepareHostEnvironment } from "./environment.mjs";
import { loadNativeAddon } from "../../apps/host/src/native.ts";

/** A Host uses one number for its UDP endpoint and its TCP webhook listener. */
async function availablePort() {
  for (;;) {
    const socket = createSocket("udp4");
    const server = createServer();
    try {
      await new Promise((resolve, reject) => {
        socket.once("error", reject);
        socket.bind(0, "127.0.0.1", resolve);
      });
      const { port } = socket.address();
      const free = await new Promise((resolve) => {
        server.once("error", () => resolve(false));
        server.listen(port, () => resolve(true));
      });
      if (free) return port;
    } finally {
      await new Promise((resolve) => socket.close(resolve));
      if (server.listening)
        await new Promise((resolve) => server.close(resolve));
    }
  }
}

/** A port can be taken between choosing and binding it; choose again then. */
async function launch(isolatedEnvironment, distribution, onStderr) {
  for (let attempt = 1; ; attempt++) {
    try {
      return await launchOnce(isolatedEnvironment, distribution, onStderr);
    } catch (error) {
      if (!error.beforeReady || attempt === 3) throw error;
    }
  }
}

async function launchOnce(isolatedEnvironment, distribution, onStderr) {
  const port =
    Number(isolatedEnvironment.IORI_HOST_PORT) || (await availablePort());
  const environment = verificationHostEnvironment();
  delete environment.CLAUDE_CODE_OAUTH_TOKEN;
  delete environment.IORI_HOST_PORT;
  const child = fork(
    import.meta.filename,
    [
      "--host",
      ...(distribution ? ["--distribution", distribution] : []),
      ...(isolatedEnvironment.IORI_UI_SERVICE_BUNDLE
        ? ["--service-bundle", isolatedEnvironment.IORI_UI_SERVICE_BUNDLE]
        : []),
    ],
    {
      stdio: ["ignore", "ignore", "pipe", "ipc"],
      env: {
        ...environment,
        ...isolatedEnvironment,
        IORI_HOST_PORT: String(port),
      },
    },
  );
  let stderr = "";
  child.stderr.on("data", (chunk) => {
    stderr = (stderr + chunk).slice(-4096);
    onStderr?.(chunk.toString());
  });
  const exited = new Promise((resolve, reject) => {
    child.once("error", reject);
    child.once("close", (code, signal) => {
      if (code === 0) resolve();
      else
        reject(
          new Error(
            `検証Hostが正常に終了しませんでした: ${signal ?? code}\n${stderr}`,
          ),
        );
    });
  });
  void exited.catch(() => {});
  try {
    await Promise.race([
      new Promise((resolve) => child.once("message", resolve)),
      exited.then(() => {
        throw new Error("検証Hostが起動前に終了しました");
      }),
    ]);
  } catch (error) {
    child.kill("SIGTERM");
    await exited.catch(() => {});
    error.beforeReady = true;
    throw error;
  }
  return {
    async close({ interrupt = false } = {}) {
      if (interrupt) {
        child.kill("SIGKILL");
        await exited.catch((error) => {
          if (child.signalCode !== "SIGKILL") throw error;
        });
      } else {
        if (child.connected) child.send("stop");
        await exited;
      }
    },
  };
}

/** Each test owns its Host, identity, client and daemon, including on failure. */
export async function startHostTest(
  t,
  {
    maintenance = false,
    distribution,
    serviceBundle,
    environment = {},
    prepareEnvironment,
    onStderr,
  } = {},
) {
  await recoverStaleVerificationRuns();
  const dataRoot = await mkdtemp(join(tmpdir(), "iori-host-e2e-"));
  await ownVerificationDirectory(dataRoot);
  await registerVerificationDaemon(join(dataRoot, "iori-host"));
  const clients = new Set();
  let host;
  const cleanup = registerCleanup(async () => {
    try {
      try {
        await Promise.all([...clients].map((client) => client.close()));
      } finally {
        try {
          await host?.close();
        } finally {
          await stopTerminalDaemon(join(dataRoot, "iori-host"));
        }
      }
      if (process.platform === "linux")
        await stopCliProcesses(join(dataRoot, "cli-home"));
      await rm(dataRoot, { recursive: true, force: true });
    } catch (error) {
      t.diagnostic("失敗時の段: 専用の接続・Host・Terminal・保存先を片付ける");
      throw error;
    }
  });
  t.after(cleanup);
  const isolatedEnvironment = {
    ...(await prepareHostEnvironment(dataRoot)),
    ...environment,
    ...(await prepareEnvironment?.(dataRoot)),
    IORI_HOST_PORT: String(await availablePort()),
  };
  if (serviceBundle) isolatedEnvironment.IORI_UI_SERVICE_BUNDLE = serviceBundle;
  if (maintenance) isolatedEnvironment.IORI_E2E_MAINTENANCE = "1";
  host = await launch(isolatedEnvironment, distribution, onStderr);
  const identity = maintenance
    ? loadNativeAddon().generateIdentity()
    : undefined;
  if (identity) t.after(() => identity.secretKey.fill(0));
  const connect = async () => {
    const client = await connectClient(dataRoot, identity?.secretKey);
    clients.add(client);
    return client;
  };
  let currentClient = await connect();
  return {
    dataRoot,
    get client() {
      return currentClient;
    },
    async stop({ stopDaemon = false } = {}) {
      await Promise.all([...clients].map((client) => client.close()));
      clients.clear();
      await host?.close();
      host = undefined;
      if (stopDaemon) await stopTerminalDaemon(join(dataRoot, "iori-host"));
    },
    async start() {
      host = await launch(isolatedEnvironment, distribution, onStderr);
      currentClient = await connect();
      return currentClient;
    },
    async restart({
      whileStopped,
      interrupt = false,
      distribution: nextDistribution = distribution,
    } = {}) {
      await Promise.all([...clients].map((client) => client.close()));
      clients.clear();
      await host.close({ interrupt });
      await whileStopped?.();
      distribution = nextDistribution;
      host = await launch(isolatedEnvironment, distribution, onStderr);
      currentClient = await connect();
      return currentClient;
    },
  };
}

/** Record the observable result being awaited, without imposing a deadline. */
export async function runHostTest(t, body, options) {
  let current = "専用のHostを起動してClientを登録する";
  let reported = false;
  const report = () => {
    if (!reported) t.diagnostic(`失敗時の段: ${current}`);
    reported = true;
  };
  t.signal.addEventListener("abort", report, { once: true });
  try {
    const host = await startHostTest(t, options);
    await body({
      ...host,
      stage: (name) => {
        current = name;
      },
    });
  } catch (error) {
    report();
    throw error;
  } finally {
    t.signal.removeEventListener("abort", report);
  }
}

if (process.argv.includes("--host")) {
  const os = process.env.IORI_E2E_MAINTENANCE
    ? await import("../../scripts/release/update-linux.mjs")
    : undefined;
  const serviceIndex = process.argv.indexOf("--service-bundle");
  const serviceBundle =
    serviceIndex === -1 ? undefined : process.argv[serviceIndex + 1];
  const service = serviceBundle
    ? {
        bundle: serviceBundle,
        unit: "iori-ui-fixture.service",
        restart() {
          throw new Error("No OS installer in the UI fixture");
        },
        launchUpdate() {
          throw new Error("No OS installer in the UI fixture");
        },
      }
    : os && {
        bundle: process.cwd(),
        unit: "iori-e2e.service",
        restart: () => os.restart("iori-e2e.service"),
        launchUpdate: os.launchUpdate,
        ...(await import("../../scripts/release/uninstall-linux.mjs")),
      };
  const distributionIndex = process.argv.indexOf("--distribution");
  const { startHost: start } = await import(
    distributionIndex === -1
      ? new URL("../../apps/host/src/host.ts", import.meta.url)
      : pathToFileURL(join(process.argv[distributionIndex + 1], "src/host.js"))
  );
  const host = await start(
    undefined,
    service,
    distributionIndex === -1
      ? serviceBundle
      : process.argv[distributionIndex + 1],
  );
  await host.maintenanceReady();
  const close = registerCleanup(() => host.close());
  process.send("ready");
  await new Promise((resolve) => {
    process.once("message", resolve);
    process.once("disconnect", resolve);
  });
  await close();
  if (process.connected) process.disconnect();
  process.exit(0);
}
