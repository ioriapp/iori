import { fork } from "node:child_process";
import { createSocket } from "node:dgram";
import { createServer } from "node:net";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { startHost } from "../../apps/host/src/host.ts";
import { verificationHostEnvironment } from "../cli/environment.mjs";
import { stopTerminalDaemon } from "../terminal/daemon-process.mjs";
import { connectClient } from "./client.mjs";
import { prepareHostEnvironment } from "./environment.mjs";

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
async function launch(isolatedEnvironment) {
  for (let attempt = 1; ; attempt++) {
    try {
      return await launchOnce(isolatedEnvironment);
    } catch (error) {
      if (!error.beforeReady || attempt === 3) throw error;
    }
  }
}

async function launchOnce(isolatedEnvironment) {
  const port = await availablePort();
  const environment = verificationHostEnvironment();
  delete environment.CLAUDE_CODE_OAUTH_TOKEN;
  delete environment.IORI_HOST_PORT;
  const child = fork(import.meta.filename, ["--host"], {
    stdio: ["ignore", "ignore", "pipe", "ipc"],
    env: {
      ...environment,
      ...isolatedEnvironment,
      IORI_HOST_PORT: String(port),
    },
  });
  let stderr = "";
  child.stderr.on("data", (chunk) => {
    stderr = (stderr + chunk).slice(-4096);
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
    async close() {
      if (child.connected) child.send("stop");
      await exited;
    },
  };
}

/** Each test owns its Host, identity, client and daemon, including on failure. */
export async function startHostTest(t) {
  const dataRoot = await mkdtemp(join(tmpdir(), "iori-host-e2e-"));
  const clients = new Set();
  let host;
  t.after(async () => {
    try {
      try {
        await Promise.all([...clients].map((client) => client.close()));
      } finally {
        try {
          await host?.close();
        } finally {
          try {
            await stopTerminalDaemon(join(dataRoot, "iori-host"));
          } finally {
            await rm(dataRoot, { recursive: true, force: true });
          }
        }
      }
    } catch (error) {
      t.diagnostic("失敗時の段: 専用の接続・Host・Terminal・保存先を片付ける");
      throw error;
    }
  });
  const isolatedEnvironment = await prepareHostEnvironment(dataRoot);
  host = await launch(isolatedEnvironment);
  const connect = async () => {
    const client = await connectClient(dataRoot);
    clients.add(client);
    return client;
  };
  return {
    dataRoot,
    client: await connect(),
    async restart({ whileStopped } = {}) {
      await Promise.all([...clients].map((client) => client.close()));
      clients.clear();
      await host.close();
      await whileStopped?.();
      host = await launch(isolatedEnvironment);
      return connect();
    },
  };
}

/** Record the observable result being awaited, without imposing a deadline. */
export async function runHostTest(t, body) {
  let current = "専用のHostを起動してClientを登録する";
  let reported = false;
  const report = () => {
    if (!reported) t.diagnostic(`失敗時の段: ${current}`);
    reported = true;
  };
  t.signal.addEventListener("abort", report, { once: true });
  try {
    const host = await startHostTest(t);
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
