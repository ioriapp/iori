import { createHash } from "node:crypto";
import { constants, type BigIntStats } from "node:fs";
import {
  appendFile,
  mkdir,
  open,
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
export const imageHash = (bytes: Uint8Array) =>
  createHash("sha256").update(bytes).digest("hex");

/** Checks the SVG opening tag without retaining its prolog or loading XML. */
function svgOpening() {
  const prologs = [
    { start: "<!--", end: "-->" },
    { start: "<?", end: "?>" },
    { start: "<!doctype", end: ">" },
  ];
  let tail = "";
  let end = "";
  let inDoctype = false;
  return (chunk: string): boolean | undefined => {
    let text = tail + chunk;
    tail = "";
    for (;;) {
      if (end) {
        const index =
          inDoctype && end === ">" ? text.search(/[>\[]/u) : text.indexOf(end);
        if (index < 0) {
          tail = end.length > 1 ? text.slice(1 - end.length) : "";
          return undefined;
        }
        const delimiter = text[index];
        text = text.slice(index + end.length);
        end = inDoctype && delimiter === "[" ? "]" : end === "]" ? ">" : "";
        if (!end) inDoctype = false;
        continue;
      }
      text = text.trimStart();
      if (/^<svg(?:\s|\/?>)/u.test(text)) return true;
      const lower = text.slice(0, 9).toLowerCase();
      const prolog = prologs.find(({ start }) => lower.startsWith(start));
      if (prolog) {
        text = text.slice(prolog.start.length);
        end = prolog.end;
        inDoctype = end === ">";
      } else if (
        ["<svg", "<svg/"].some((prefix) => prefix.startsWith(text)) ||
        prologs.some(
          ({ start }) => start.startsWith(lower) && text.length <= start.length,
        )
      ) {
        tail = text;
        return undefined;
      } else return false;
    }
  };
}

export type DefinitionImage = {
  path: string;
  info: BigIntStats;
  mimeType: string;
};
const sameFile = (a: BigIntStats, b: BigIntStats) =>
  a.dev === b.dev &&
  a.ino === b.ino &&
  a.size === b.size &&
  a.mtimeNs === b.mtimeNs &&
  a.ctimeNs === b.ctimeNs;
const READ_REGULAR = constants.O_RDONLY | constants.O_NONBLOCK;

export async function inspectDefinitionImage(name: string, path: string) {
  const png = /\.png$/iu.test(name);
  if (!png && !/\.svg$/iu.test(name)) return undefined;
  const file = await open(path, READ_REGULAR);
  try {
    const info = await file.stat({ bigint: true });
    if (!info.isFile()) return undefined;
    const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
    const head = png ? Buffer.alloc(signature.length) : undefined;
    let headBytes = 0;
    const decoder = png ? undefined : new TextDecoder("utf-8", { fatal: true });
    const opening = svgOpening();
    let isSvg: boolean | undefined;
    const hash = createHash("sha256");
    for await (const chunk of file.createReadStream({ autoClose: false })) {
      hash.update(chunk);
      if (head && headBytes < head.length)
        headBytes += (chunk as Buffer).copy(head, headBytes);
      if (decoder) {
        let text;
        try {
          text = decoder.decode(chunk, { stream: true });
        } catch {
          return undefined;
        }
        isSvg ??= opening(text);
        if (isSvg === false) return undefined;
      }
    }
    if (decoder) {
      let last;
      try {
        last = decoder.decode();
      } catch {
        return undefined;
      }
      isSvg ??= opening(last);
    }
    if (!(head ? head.equals(signature) : isSvg)) return undefined;
    if (!sameFile(info, await file.stat({ bigint: true }))) return undefined;
    return {
      hash: hash.digest("hex"),
      path,
      info,
      mimeType: png ? "image/png" : "image/svg+xml",
    };
  } finally {
    await file.close();
  }
}

/** The protocol identifies the exact icon bytes by hash across range reads. */
export async function readDefinitionIcon(
  image: DefinitionImage,
  offset: number,
) {
  const file = await open(image.path, READ_REGULAR);
  try {
    const info = await file.stat({ bigint: true });
    if (!sameFile(image.info, info)) throw new Error("Image changed");
    const size = Number(info.size);
    const bytes = Buffer.allocUnsafe(
      Math.min(1_048_576, Math.max(0, size - offset)),
    );
    let read = 0;
    while (read < bytes.length) {
      const { bytesRead } = await file.read(
        bytes,
        read,
        bytes.length - read,
        offset + read,
      );
      if (bytesRead === 0) break;
      read += bytesRead;
    }
    if (!sameFile(info, await file.stat({ bigint: true })))
      throw new Error("Image changed");
    return {
      bytesBase64: bytes.subarray(0, read).toString("base64"),
      nextOffset: offset + read,
      eof: offset + read >= size,
      mimeType: image.mimeType,
    };
  } finally {
    await file.close();
  }
}

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
      const image = await inspectDefinitionImage(
        name,
        await definitionFilePath(folder, name),
      );
      if (!image) continue;
      icon[theme] = image.hash;
      images.set(image.hash, image);
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
