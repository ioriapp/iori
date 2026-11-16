import { realpath } from "node:fs/promises";
import { discoverRepository } from "../git-reading.ts";

const key = (path: string) =>
  process.platform === "win32" ? path.toLowerCase() : path;

export async function trustTeamWorkspace(
  cwd: string,
  sidebar: string[],
): Promise<boolean> {
  const actual = await realpath(cwd).catch(() => undefined);
  if (!actual) return false;
  const paths = await Promise.all(
    sidebar.map((path) => realpath(path).catch(() => undefined)),
  );
  if (paths.some((path) => path && key(path) === key(actual))) return true;
  const repository = await discoverRepository(actual).catch(() => undefined);
  if (!repository) return false;
  const common = await realpath(repository.commonDir).catch(() => undefined);
  if (!common) return false;
  for (const path of paths) {
    if (!path) continue;
    const entry = await discoverRepository(path).catch(() => undefined);
    if (!entry || key(entry.root) !== key(path)) continue;
    const entryCommon = await realpath(entry.commonDir).catch(() => undefined);
    if (entryCommon && key(common) === key(entryCommon)) return true;
  }
  return false;
}
