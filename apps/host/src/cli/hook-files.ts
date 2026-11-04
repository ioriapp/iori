import { AsyncLocalStorage } from "node:async_hooks";
import {
  lstat,
  readFile,
  readlink,
  mkdir,
  rm,
  writeFile,
  symlink,
} from "node:fs/promises";
import { dirname } from "node:path";
const changes = new AsyncLocalStorage<Map<string, () => Promise<void>>>();
export async function rememberHookFile(path: string) {
  const journal = changes.getStore();
  if (!journal || journal.has(path)) return;
  const info = await lstat(path).catch((error) => {
    if (error.code !== "ENOENT") throw error;
    return undefined;
  });
  const link = info?.isSymbolicLink() ? await readlink(path) : undefined;
  const content = info && !link ? await readFile(path) : undefined;
  journal.set(path, async () => {
    if (!info) {
      await rm(path, { force: true });
      return;
    }
    await mkdir(dirname(path), { recursive: true });
    if (link) {
      await rm(path, { force: true });
      await symlink(link, path);
    } else await writeFile(path, content!, { mode: info.mode });
  });
}
export async function removeHookFile(path: string) {
  await rememberHookFile(path);
  await rm(path, { force: true });
}
export function hookRemovalTransaction() {
  const journal = new Map<string, () => Promise<void>>();
  return {
    run: (action: () => Promise<void>) => changes.run(journal, action),
    async restore() {
      const failures = [];
      for (const restore of [...journal.values()].reverse()) {
        try {
          await restore();
        } catch (error) {
          failures.push(error);
        }
      }
      if (failures.length)
        throw new AggregateError(failures, "Could not restore CLI hooks");
    },
  };
}
