import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import type { MaintenanceStatus } from "@iori/protocol";
import { loadNativeAddon } from "../native.ts";
import type { MaintenanceService } from "./manager.ts";

export async function removalRequest(
  service: MaintenanceService,
  storage: string,
  hostKey: string,
  status: MaintenanceStatus,
  statusFile: string,
) {
  const directory = join(dirname(storage), "iori-host-uninstall");
  await mkdir(directory, { recursive: true, mode: 0o700 });
  if (process.platform === "win32")
    loadNativeAddon().restrictToCurrentUser(directory);
  const name = createHash("sha256")
    .update(JSON.stringify([hostKey, status.operationId]))
    .digest("hex");
  const previous = await readFile(
    join(storage, "maintenance/previous-update.txt"),
    "utf8",
  ).catch((error) => {
    if (error.code !== "ENOENT") throw error;
    return undefined;
  });
  const pending = await readFile(
    join(storage, "maintenance/pending-cleanup.txt"),
    "utf8",
  )
    .then((value) => JSON.parse(value) as string[])
    .catch(() => []);
  return {
    id: randomUUID(),
    bundle: service.bundle,
    storage,
    unit: service.unit,
    hostKey,
    status,
    statusFile,
    receipt: join(directory, name + ".json"),
    backups: [...new Set([...(previous ? [previous] : []), ...pending])],
  };
}
