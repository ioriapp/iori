import { createHash } from "node:crypto";
import { mkdir, readdir, stat } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { readConfig, writeText } from "./hook-config.ts";
import { removeHookFile } from "./hook-files.ts";
import type { HookPlacement } from "./hook-documents.ts";

interface HostHooks {
  root: string;
  clis: string[];
  hooks: Record<string, { file: string; items: HookPlacement[] }>;
}
const directory = () => join(homedir(), ".iori", "hooks", "hosts");
const hostPath = (root: string) =>
  join(
    directory(),
    `${createHash("sha256").update(resolve(root)).digest("hex")}.json`,
  );
// Keep record read/modify/write operations together, independently of the
// definition-hooks queue whose tasks call into this module.
let writing: Promise<void> = Promise.resolve();
function serially<T>(task: () => Promise<T>): Promise<T> {
  const next = writing.then(task);
  writing = next.then(
    () => {},
    () => {},
  );
  return next;
}
async function records(): Promise<{ path: string; record: HostHooks }[]> {
  await mkdir(directory(), { recursive: true });
  const result = [];
  for (const name of await readdir(directory())) {
    if (!name.endsWith(".json")) continue;
    const path = join(directory(), name);
    let record: HostHooks;
    try {
      record = (await readConfig(path)) as unknown as HostHooks;
    } catch {
      // Another Host's unreadable record must not stop this Host's hooks.
      continue;
    }
    try {
      await stat(record.root);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT")
        await removeHookFile(path);
      // Keep inaccessible roots and their records for the owning Host.
      continue;
    }
    result.push({ path, record });
  }
  return result;
}
async function save(root: string, record: HostHooks) {
  await writeText(hostPath(root), JSON.stringify(record, null, 2) + "\n");
}
export async function claimHostHooks(root: string, id: string): Promise<void> {
  return serially(async () => {
    const existing = (await records()).find(
      ({ path }) => path === hostPath(root),
    );
    const record = existing?.record ?? {
      root: resolve(root),
      clis: [],
      hooks: {},
    };
    if (!record.clis.includes(id)) record.clis.push(id);
    await save(root, record);
  });
}
/** Record this Host's entries before editing the shared CLI file. Entries
 * needed by another Host are replayed together with this Host's entries. */
export async function hostHookItems(
  recordPath: string | undefined,
  id: string,
  file: string,
  items?: HookPlacement[],
): Promise<HookPlacement[]> {
  if (!recordPath) return [];
  return serially(async () => {
    const root = dirname(recordPath);
    const all = await records();
    const record = all.find(({ path }) => path === hostPath(root))?.record ?? {
      root: resolve(root),
      clis: [],
      hooks: {},
    };
    const retained = all
      .filter(({ path }) => path !== hostPath(root))
      .flatMap(({ record }) => {
        const entry = record.hooks[id];
        return entry?.file === file ? entry.items : [];
      });
    if (items) record.hooks[id] = { file, items };
    else if (record.hooks[id]?.file === file) delete record.hooks[id];
    await save(root, record);
    return retained;
  });
}
export async function otherHostUses(
  root: string,
  id?: string,
  file?: string,
): Promise<boolean> {
  return (await records()).some(
    ({ path, record }) =>
      path !== hostPath(root) &&
      (file
        ? Object.values(record.hooks).some((entry) => entry.file === file)
        : id
          ? record.clis.includes(id)
          : true),
  );
}
export async function releaseHostHooks(root: string): Promise<void> {
  return serially(() => removeHookFile(hostPath(root)));
}
