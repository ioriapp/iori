import { existsSync, watch } from "node:fs";
import { basename, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(fileURLToPath(import.meta.url));
const stopRequestPath = process.env.IORI_HOST_STOP_REQUEST;
if (!stopRequestPath) throw new Error("Host stop request path is missing");
const stopRequestName = basename(stopRequestPath);
process.chdir(root);

const { startHost } = await import("./apps/host/src/host.ts");
const host = await startHost();

function waitForStopRequest() {
  if (existsSync(stopRequestPath)) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const watcher = watch(root, (_eventType, filename) => {
      if (
        filename?.toString() !== stopRequestName ||
        !existsSync(stopRequestPath)
      ) {
        return;
      }
      watcher.close();
      resolve();
    });
    watcher.once("error", (error) => {
      watcher.close();
      reject(error);
    });
    if (existsSync(stopRequestPath)) {
      watcher.close();
      resolve();
    }
  });
}

await waitForStopRequest();
await host.close();
process.stdout.write("Host.close completed\n");
process.exit(0);
