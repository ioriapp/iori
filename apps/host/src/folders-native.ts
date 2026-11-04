import { stat } from "node:fs/promises";
import { homedir } from "node:os";
import { parse } from "node:path";
import type { FolderEntry } from "@iori/protocol";

async function windowsDriveRoots(): Promise<FolderEntry[]> {
  const entries: FolderEntry[] = [];
  for (let letter = 65; letter <= 90; letter += 1) {
    const path = `${String.fromCharCode(letter)}:\\`;
    try {
      if ((await stat(path)).isDirectory()) entries.push({ name: path, path });
    } catch {
      // A drive that is absent or cannot be inspected is not a browse root.
    }
  }
  return entries;
}

export async function folderRoots(): Promise<FolderEntry[]> {
  if (process.platform === "win32") return windowsDriveRoots();
  const root = parse(homedir()).root;
  return [{ name: root, path: root }];
}
