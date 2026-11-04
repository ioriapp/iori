// Hook insertion/removal shapes derived from Orca's installer-utils.ts.
// Copyright (c) 2026 Lovecast Inc.; MIT license: ./ORCA-LICENSE.txt.
import {
  mkdir,
  readFile,
  realpath,
  readlink,
  lstat,
  stat,
} from "node:fs/promises";
import { hostHookItems } from "./hook-hosts.ts";
import { writeFileAtomic } from "../fs/atomic-write.ts";
import { rememberHookFile, removeHookFile } from "./hook-files.ts";
import { isDeepStrictEqual } from "node:util";
import { dirname, resolve } from "node:path";
import { object } from "./hooks.ts";
import {
  editHookDocument,
  emptyHookDocument,
  ownHookDocument,
  ownHookFile,
  type HookItem,
  type HookPlace,
  type HookSyntax,
} from "./hook-documents.ts";

export async function readConfig(
  path: string,
): Promise<Record<string, unknown>> {
  try {
    const parsed: unknown = JSON.parse(await readFile(path, "utf8"));
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed))
      throw new Error(`CLI hook config must be an object: ${path}`);
    return parsed as Record<string, unknown>;
  } catch (error) {
    if (
      error &&
      typeof error === "object" &&
      "code" in error &&
      error.code === "ENOENT"
    )
      return {};
    throw error;
  }
}
/** Follow dotfile symlinks, including a link whose target has not been created. */
async function targetPath(path: string): Promise<string> {
  try {
    return await realpath(path);
  } catch (error) {
    if (object(error).code !== "ENOENT") throw error;
    try {
      if ((await lstat(path)).isSymbolicLink())
        return targetPath(resolve(dirname(path), await readlink(path)));
    } catch (missing) {
      if (object(missing).code !== "ENOENT") throw missing;
    }
    return path;
  }
}
export async function writeText(
  path: string,
  content: string,
): Promise<boolean> {
  const target = await targetPath(path);
  let mode = 0o600;
  try {
    if ((await readFile(target, "utf8")) === content) return false;
    mode = (await stat(target)).mode;
  } catch (error) {
    if (object(error).code !== "ENOENT") throw error;
  }
  await rememberHookFile(target);
  await mkdir(dirname(target), { recursive: true });
  await writeFileAtomic(target, content, mode);
  return true;
}
export async function writeConfig(
  path: string,
  value: Record<string, unknown>,
): Promise<void> {
  const existing = await readConfig(path);
  if (isDeepStrictEqual(existing, value)) return;
  try {
    await stat(path);
  } catch (error) {
    if (object(error).code !== "ENOENT") throw error;
    await writeText(path + ".iori-created", "\n");
  }
  await writeText(path, JSON.stringify(value, null, 2) + "\n");
}
export async function removeEmptyConfig(
  path: string,
  value: Record<string, unknown>,
) {
  if (
    Object.keys(value).length &&
    !(Object.keys(value).length === 1 && value.version === 1)
  )
    return false;
  try {
    await stat(path + ".iori-created");
  } catch (error) {
    if (object(error).code === "ENOENT") return false;
    throw error;
  }
  await removeHookFile(await targetPath(path));
  await removeHookFile(path + ".iori-created");
  return true;
}

async function readText(path: string): Promise<string | undefined> {
  try {
    return await readFile(path, "utf8");
  } catch (error) {
    if (object(error).code === "ENOENT") return undefined;
    throw error;
  }
}
/** Replace `owner`'s items in the hooks file at `path` with `items`
 * (none: remove them). A file that iori made goes when nothing is left. */
export async function editHookFile(
  path: string,
  syntax: HookSyntax,
  owner: string,
  place?: HookPlace,
  items: readonly HookItem[] = [],
  recordPath?: string,
): Promise<void> {
  const retained = await hostHookItems(
    recordPath,
    owner,
    path,
    place
      ? items.map(({ event, command }) => ({
          path:
            place.format === "events" ? [...place.at, event] : [...place.at],
          value: place.entry(event, command),
        }))
      : undefined,
  );
  const text = await readText(path);
  if (text === undefined && !items.length && !retained.length) return;
  const next = editHookDocument(
    text ?? "",
    syntax,
    owner,
    place,
    items,
    retained,
  );
  if (next === (text ?? "")) return;
  if (
    syntax === "json" &&
    !items.length &&
    !retained.length &&
    (await removeEmptyConfig(path, JSON.parse(next)))
  )
    return;
  if (text === undefined) await writeText(path + ".iori-created", "\n");
  else if (
    !items.length &&
    emptyHookDocument(next, syntax) &&
    (await readText(path + ".iori-created")) !== undefined
  ) {
    await removeHookFile(await targetPath(path));
    await removeHookFile(path + ".iori-created");
    return;
  }
  await writeText(path, next);
}
/** Write iori's own hooks file. A file of the same name that iori did not
 * place stays as it is (cli-definitions.md「上書きしない」). */
export async function writeOwnHookFile(
  path: string,
  syntax: HookSyntax,
  owner: string,
  base: Record<string, unknown>,
  place: HookPlace,
  items: readonly HookItem[],
  recordPath?: string,
): Promise<void> {
  const text = await readText(path);
  if (text !== undefined && !ownHookFile(text, syntax, owner, base)) return;
  const retained = await hostHookItems(
    recordPath,
    owner,
    path,
    items.map(({ event, command }) => ({
      path: place.format === "events" ? [...place.at, event] : [...place.at],
      value: place.entry(event, command),
    })),
  );
  await writeText(
    path,
    editHookDocument(
      ownHookDocument(syntax, base, place, items),
      syntax,
      owner,
      place,
      items,
      retained,
    ),
  );
}
/** Remove iori's own hooks file. A file that iori did not place stays,
 * without `owner`'s items (cli-definitions.md「上書きしない」). */
export async function removeOwnHookFile(
  path: string,
  syntax: HookSyntax,
  owner: string,
  base: Record<string, unknown>,
  recordPath?: string,
): Promise<void> {
  const retained = await hostHookItems(recordPath, owner, path);
  if (retained.length) {
    const text = await readText(path);
    if (text !== undefined)
      await writeText(
        path,
        editHookDocument(text, syntax, owner, undefined, [], retained),
      );
    return;
  }
  const text = await readText(path);
  if (text === undefined) return;
  if (ownHookFile(text, syntax, owner, base))
    await removeHookFile(await targetPath(path));
  else await editHookFile(path, syntax, owner);
}
