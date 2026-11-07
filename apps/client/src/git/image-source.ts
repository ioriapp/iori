import { useEffect, useRef, useState } from "react";
import type {
  GitDiffSource,
  GitImageSide,
  ReadResultByMethod,
} from "@iori/protocol";
import {
  ReadConnectionLost,
  ReadError,
  decodeBytes,
  isAbort,
  readErrorCopy,
  type ReadingTransport,
} from "../reading/transport.ts";
import type { ImageContent } from "../reading/ImageViewport.tsx";

export type GitImage = ImageContent & {
  info?: ReadResultByMethod["git.imageInfo"];
  error?: string;
};
const CHUNK_BYTES = 1_048_576;

/** Only the selected diff reads image bytes. Each side can finish or fail
 * independently; a changing revision restarts the image rather than mixing it. */
export function useGitImages(
  transport: ReadingTransport,
  root: string,
  source: GitDiffSource,
  enabled: boolean,
  single: boolean,
  refreshKey: number,
  locale: string,
) {
  const [retries, setRetries] = useState({ old: 0, new: 0 });
  const retry = (side: GitImageSide) =>
    setRetries((value) => ({ ...value, [side]: value[side] + 1 }));
  const old = useGitImage(
    transport,
    root,
    source,
    enabled && !single,
    "old",
    refreshKey,
    retries.old,
    locale,
  );
  const after = useGitImage(
    transport,
    root,
    source,
    enabled,
    "new",
    refreshKey,
    retries.new,
    locale,
  );
  return { images: { old, new: after }, retry };
}

function useGitImage(
  transport: ReadingTransport,
  root: string,
  source: GitDiffSource,
  enabled: boolean,
  side: GitImageSide,
  refreshKey: number,
  retry: number,
  locale: string,
) {
  const [image, setImage] = useState<GitImage>({ path: source.path });
  const shown = useRef<
    | { url: string; root: string; sourceKey: string; revision: string }
    | undefined
  >(undefined);
  const sourceKey = JSON.stringify(source);
  useEffect(() => {
    if (!enabled || source.kind === "stage") return;
    const controller = new AbortController();
    setImage((value) => ({ ...value, error: undefined }));
    void (async () => {
      for (;;) {
        controller.signal.throwIfAborted();
        const info = await transport.request(
          "git.imageInfo",
          { root, source, side },
          controller.signal,
        );
        setImage((value) => ({
          ...value,
          info,
          path: info.path,
          mimeType: info.mimeType,
          sizeBytes: info.sizeBytes,
        }));
        if (!info.present || !info.mimeType?.startsWith("image/")) return;
        if (
          shown.current?.root === root &&
          shown.current.sourceKey === sourceKey &&
          shown.current.revision === info.revision
        )
          return;
        const parts: Uint8Array<ArrayBuffer>[] = [];
        let offset = 0;
        for (;;) {
          const result = await transport.request(
            "git.imageRead",
            { root, source, side, offset, length: CHUNK_BYTES },
            controller.signal,
          );
          if (result.revision !== info.revision) break;
          parts.push(decodeBytes(result.bytesBase64));
          offset = result.nextOffset;
          if (!result.eof) continue;
          controller.signal.throwIfAborted();
          const url = URL.createObjectURL(
            new Blob(parts, { type: info.mimeType }),
          );
          if (shown.current) URL.revokeObjectURL(shown.current.url);
          shown.current = { url, root, sourceKey, revision: info.revision };
          setImage({
            info,
            url,
            path: info.path,
            mimeType: info.mimeType,
            sizeBytes: result.sizeBytes,
          });
          return;
        }
      }
    })().catch((cause: unknown) => {
      if (
        controller.signal.aborted ||
        isAbort(cause) ||
        cause instanceof ReadConnectionLost
      )
        return;
      // Unknown read failures use the image-specific copy; known reasons are
      // the same as Files, including a deleted path or denied permission.
      const copy = readErrorCopy(cause, locale);
      const reason =
        copy === readErrorCopy(new ReadError("read_failed"), locale)
          ? undefined
          : copy;
      setImage((value) => ({
        ...value,
        error:
          reason ??
          (locale.startsWith("ja")
            ? "画像を読み込めませんでした。"
            : "Could not load the image."),
      }));
    });
    return () => controller.abort();
  }, [transport, root, sourceKey, enabled, side, refreshKey, retry, locale]);
  useEffect(
    () => () => {
      if (shown.current) URL.revokeObjectURL(shown.current.url);
    },
    [],
  );
  return image;
}
