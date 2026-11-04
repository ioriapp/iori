import { createHash } from "node:crypto";
import {
  appendFile,
  mkdir,
  readFile,
  realpath,
  rm,
  writeFile,
} from "node:fs/promises";
import { dirname, isAbsolute, join, relative } from "node:path";
import type { CliDefinitionReason } from "@iori/protocol";
import { attached, type DefinitionFile } from "./definition-file.ts";

export class DefinitionAttachmentError extends Error {
  readonly reason: CliDefinitionReason;
  constructor(reason: CliDefinitionReason) {
    super("Invalid definition attachment");
    this.reason = reason;
  }
}
/** Resolve both the folder and file, including symlinks. A definition folder
 * itself may be a symlink (a user's dotfiles); its attachments cannot escape it. */
export async function definitionFilePath(
  folder: string,
  name: string,
  writing = false,
): Promise<string> {
  attached(name, "file");
  const root = await realpath(folder);
  const path = join(root, name.replaceAll("\\", "/"));
  const contained = (resolved: string) => {
    const subpath = relative(root, resolved);
    if (
      isAbsolute(subpath) ||
      subpath === ".." ||
      subpath.startsWith("../") ||
      subpath.startsWith("..\\")
    )
      throw new DefinitionAttachmentError({ kind: "inside", field: "file" });
  };
  if (writing) {
    let parent = root;
    for (const part of relative(root, dirname(path))
      .split(/[\\/]/u)
      .filter(Boolean)) {
      parent = join(parent, part);
      try {
        contained(await realpath(parent));
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
        await mkdir(parent);
      }
    }
  } else contained(await realpath(path));
  return path;
}
export function imageMime(name: string, bytes: Uint8Array): string | undefined {
  if (/\.png$/iu.test(name))
    return Buffer.from(bytes.subarray(0, 8)).equals(
      Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    )
      ? "image/png"
      : undefined;
  if (!/\.svg$/iu.test(name)) return undefined;
  try {
    const xml = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    // The Client's image decoder checks the complete image when it is chosen.
    // The Host never executes SVG or fetches its external declarations.
    const content = xml
      .replace(
        /<!--[\s\S]*?-->|<\?[\s\S]*?\?>|<!DOCTYPE(?:[^>\[]|\[[\s\S]*?\])*?>/giu,
        "",
      )
      .trimStart();
    return /^<svg(?:\s|\/?>)/u.test(content) ? "image/svg+xml" : undefined;
  } catch {
    return undefined;
  }
}
export const imageHash = (bytes: Uint8Array) =>
  createHash("sha256").update(bytes).digest("hex");
export type DefinitionImage = { bytes: Buffer; mimeType: string };
export async function definitionImages(file: DefinitionFile, folder: string) {
  const images = new Map<string, DefinitionImage>();
  const icon: { light: string; dark?: string; source: "host" } = {
    light: "",
    source: "host",
  };
  for (const theme of ["light", "dark"] as const) {
    const name = file.icon?.[theme];
    if (!name) continue;
    const field = `icon.${theme}`;
    try {
      const bytes = await readFile(await definitionFilePath(folder, name));
      const mimeType = imageMime(name, bytes);
      if (!mimeType) continue;
      const hash = imageHash(bytes);
      icon[theme] = hash;
      images.set(hash, { bytes, mimeType });
    } catch (error) {
      if (error instanceof DefinitionAttachmentError)
        return { reason: { ...error.reason, field } as CliDefinitionReason };
    }
  }
  if (!icon.light) images.clear();
  return { icon: icon.light ? icon : undefined, images };
}
/** In-progress uploads belong to the authenticated client. Only generated
 * names are used on disk; a destination name is resolved when saving. */
export class DefinitionUploads {
  readonly #root: string;
  readonly #ready: Promise<void>;
  constructor(root: string) {
    this.#root = join(root, "cli-definition-uploads");
    this.#ready = rm(this.#root, { recursive: true, force: true });
  }
  path(owner: string, id: string) {
    return join(
      this.#root,
      createHash("sha256").update(owner).digest("hex"),
      id,
    );
  }
  async write(owner: string, id: string, data: string, first: boolean) {
    await this.#ready;
    const path = this.path(owner, id);
    await mkdir(dirname(path), { recursive: true });
    const bytes = Buffer.from(data, "base64");
    if (first) await writeFile(path, bytes);
    else await appendFile(path, bytes);
    return { uploadId: id };
  }
  async discard(owner: string, ids: string[]) {
    await this.#ready;
    await Promise.all(
      ids.map((id) => rm(this.path(owner, id), { force: true })),
    );
    return {};
  }
  async close() {
    await this.#ready;
    await rm(this.#root, { recursive: true, force: true });
  }
}
