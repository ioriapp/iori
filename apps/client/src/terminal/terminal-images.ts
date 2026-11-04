import {
  MAX_FRAME_BYTES,
  isTerminalImageExtension,
  type TerminalImageExtension,
  type TerminalSummary,
} from "@iori/protocol";
import { terminalRequest } from "./terminal-api.ts";
import { terminalDropText } from "./terminal-drop-path.ts";

export function terminalImageExtension(file: File): TerminalImageExtension {
  const mimeExtensions: Record<string, TerminalImageExtension> = {
    "image/png": "png",
    "image/jpeg": "jpg",
    "image/gif": "gif",
    "image/webp": "webp",
    "image/heic": "heic",
    "image/heif": "heif",
    "image/avif": "avif",
    "image/bmp": "bmp",
  };
  const extension =
    mimeExtensions[file.type.toLowerCase()] ??
    file.name.match(/\.([^.]+)$/u)?.[1]?.toLowerCase();
  if (!isTerminalImageExtension(extension))
    throw new Error("Unknown image format");
  return extension;
}

export async function sendTerminalImages(
  target: { connectionId: string; summary: TerminalSummary },
  images: { blob: Blob; extension: TerminalImageExtension }[],
): Promise<string> {
  const paths: string[] = [];
  for (const { blob, extension } of images) {
    const imageId = crypto.randomUUID();
    // Leave room for JSON metadata and base64's 4/3 expansion in a 4 MiB frame.
    const chunkBytes = Math.floor(MAX_FRAME_BYTES / 2 / 3) * 3;
    for (let offset = 0; offset < blob.size; offset += chunkBytes) {
      const chunk = blob.slice(offset, offset + chunkBytes);
      const data = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onerror = () => reject(reader.error);
        reader.onload = () => resolve((reader.result as string).split(",")[1]!);
        reader.readAsDataURL(chunk);
      });
      const result = await terminalRequest(
        target.connectionId,
        "terminal.image.write",
        {
          terminalId: target.summary.id,
          imageId,
          extension,
          data,
          first: offset === 0,
          last: offset + chunk.size === blob.size,
        },
      );
      if (result.path) {
        const text = terminalDropText(
          result.path,
          undefined,
          target.summary.shell,
        );
        if (text !== undefined) paths.push(text);
      }
    }
  }
  return paths.join("");
}
