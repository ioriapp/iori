import { createRequire } from "node:module";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { startBridge } from "./bridge.mjs";

const root = resolve(import.meta.dirname, "../..");
const requireClient = createRequire(resolve(root, "apps/client/package.json"));

async function createWebServer(port) {
  const { createServer } = await import(
    pathToFileURL(requireClient.resolve("vite"))
  );
  return createServer({
    root: resolve(root, "apps/client"),
    configFile: resolve(root, "apps/client/vite.config.ts"),
    mode: "web",
    define: { __IORI_WEB_BRIDGE_URL__: '""' },
    server: { host: "127.0.0.1", port, strictPort: true },
  });
}

async function prepareWebDependencies() {
  const vite = await createWebServer(0);
  try {
    await vite.listen();
    const client = vite.environments.client;
    // Crawl the same entry as index.html, including Vite's static pre-transforms.
    await client.transformRequest("/src/main.tsx");
    await client.waitForRequestsIdle();
    // Vite 8 commits optimized files after the crawl and scan. Wait for that
    // work before close(), which otherwise cancels the optimizer.
    const optimizer = client.depsOptimizer;
    await optimizer?.scanProcessing;
    await Promise.all(
      Object.values(optimizer?.metadata.discovered ?? {}).map(
        (dependency) => dependency.processing,
      ),
    );
  } finally {
    await vite.close();
  }
}

export async function startWeb({
  storageRoot,
  port = 1420,
  onRequest,
  onResponse,
  transformResponse,
  onEvent,
  onHostEventStream,
  onTerminalEvent,
  updateSource,
  hostUninstall = false,
}) {
  const signalListeners = process.listeners("SIGTERM");
  const vite = await createWebServer(port);
  // Vite exits the process on SIGTERM. The caller owns shutdown and calls
  // close(), so its failure evidence and cleanup still run.
  for (const listener of process.listeners("SIGTERM"))
    if (!signalListeners.includes(listener)) process.off("SIGTERM", listener);
  let bridge;
  try {
    await vite.listen();
    const url = `http://127.0.0.1:${vite.httpServer.address().port}`;
    bridge = await startBridge({
      storageRoot,
      origin: url,
      onRequest,
      onResponse,
      transformResponse,
      onEvent,
      onHostEventStream,
      onTerminalEvent,
      updateSource,
      hostUninstall,
    });
    // No startup warmup: update define before the first page request triggers JS transforms.
    vite.config.define.__IORI_WEB_BRIDGE_URL__ = JSON.stringify(bridge.url);
    return {
      url,
      faults: bridge.faults,
      sendTerminalInput: (...args) => bridge.sendTerminalInput(...args),
      requestHost: (...args) => bridge.requestHost(...args),
      setOffline: (value) => bridge.setOffline(value),
      async close() {
        await bridge.close();
        await vite.close();
      },
    };
  } catch (error) {
    await bridge?.close();
    await vite.close();
    throw error;
  }
}

if (
  process.argv[1] &&
  resolve(process.argv[1]) === import.meta.filename &&
  process.argv.includes("--prepare-dependencies")
) {
  await prepareWebDependencies();
} else if (
  process.argv[1] &&
  resolve(process.argv[1]) === import.meta.filename
) {
  const web = await startWeb({
    storageRoot: resolve(
      process.env.IORI_WEB_CLIENT_DATA ?? resolve(root, ".local/web-client"),
    ),
    port: Number(process.env.IORI_WEB_PORT ?? 1420),
  });
  console.log(`開発用Client: ${web.url}（終了: Ctrl+C）`);
  await new Promise((resolve) => {
    process.once("SIGINT", resolve);
    process.once("SIGTERM", resolve);
  });
  await web.close();
}
