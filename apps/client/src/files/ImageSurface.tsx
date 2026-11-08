import { useEffect, useRef, useState } from "react";
import type { FileInfo } from "@iori/protocol";
import {
  ReadConnectionLost,
  decodeBytes,
  isAbort,
  readErrorCopy,
  type ReadingTransport,
} from "../reading/transport.ts";
import { ImageViewport } from "../reading/ImageViewport.tsx";
import { ReadingError } from "../reading/ReadingError.tsx";

const CHUNK_BYTES = 1_048_576;

/** Reads an image into a Blob in the WebView; nothing is written to the device. */
function useImageUrl(
  transport: ReadingTransport,
  root: string,
  info: FileInfo,
  locale: string,
) {
  const [url, setUrl] = useState<string>();
  const [error, setError] = useState<string>();
  const [retry, setRetry] = useState(0);
  const shown = useRef<string | undefined>(undefined);
  useEffect(() => {
    const controller = new AbortController();
    void (async () => {
      const parts: Uint8Array<ArrayBuffer>[] = [];
      let offset = 0;
      for (;;) {
        const result = await transport.request(
          "files.read",
          { root, path: info.path, offset, length: CHUNK_BYTES },
          controller.signal,
        );
        parts.push(decodeBytes(result.bytesBase64));
        offset = result.nextOffset;
        if (result.eof) break;
      }
      if (controller.signal.aborted) return;
      // The previous image stays until the new one is ready.
      if (shown.current) URL.revokeObjectURL(shown.current);
      shown.current = URL.createObjectURL(
        new Blob(parts, { type: info.mimeType }),
      );
      setUrl(shown.current);
      setError(undefined);
    })().catch((cause: unknown) => {
      if (
        controller.signal.aborted ||
        isAbort(cause) ||
        cause instanceof ReadConnectionLost
      )
        return;
      setError(readErrorCopy(cause, locale));
    });
    return () => controller.abort();
  }, [transport, root, info.path, info.revision, retry]);
  useEffect(
    () => () => {
      if (shown.current) URL.revokeObjectURL(shown.current);
    },
    [],
  );
  return {
    url,
    error,
    setError,
    retry: () => setRetry((value) => value + 1),
  };
}

export function InlineImage({
  transport,
  root,
  info,
  alt,
  locale,
}: {
  transport: ReadingTransport;
  root: string;
  info: FileInfo;
  alt?: string;
  locale: string;
}) {
  const { url, error } = useImageUrl(transport, root, info, locale);
  if (error)
    return <span className="reading-inline-note">{alt ?? info.path}</span>;
  return url ? <img src={url} alt={alt ?? info.path} /> : null;
}

export function ImageSurface({
  transport,
  root,
  info,
  locale,
}: {
  transport: ReadingTransport;
  root: string;
  info: FileInfo;
  locale: string;
}) {
  const ja = locale.startsWith("ja");
  const { url, error, retry } = useImageUrl(transport, root, info, locale);
  return (
    <div className="reading-image-surface">
      {error && (
        <ReadingError
          centered={!url}
          retryLabel={ja ? "再試行" : "Retry"}
          onRetry={retry}
        >
          {error}
        </ReadingError>
      )}
      {(!error || url) && (
        <ImageViewport
          image={{
            url,
            path: info.path,
            mimeType: info.mimeType,
            sizeBytes: info.sizeBytes,
          }}
          locale={locale}
        />
      )}
    </div>
  );
}
