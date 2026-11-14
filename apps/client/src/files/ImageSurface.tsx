import { translator } from "../i18n.ts";
import { useEffect, useRef, useState } from "react";
import type { FileInfo } from "@iori/protocol";
import {
  ReadConnectionLost,
  isAbort,
  readErrorCopy,
  type ReadingTransport,
} from "../reading/transport.ts";
import { ImageViewport } from "../reading/ImageViewport.tsx";
import { ReadingError } from "../reading/ReadingError.tsx";
import { readFileChunks } from "./read-file-chunks.ts";
import { useConnectionRetry } from "../reading/useConnectionRetry.ts";

/** Reads an image into a Blob in the WebView; nothing is written to the device. */
function useImageUrl(
  transport: ReadingTransport,
  root: string,
  info: FileInfo,
  locale: string,
  refresh: number,
) {
  const [url, setUrl] = useState<string>();
  const [error, setError] = useState<string>();
  const [retry, setRetry] = useState(0);
  const shown = useRef<string | undefined>(undefined);
  const { attempt, begin } = useConnectionRetry(refresh);
  useEffect(() => {
    const controller = new AbortController();
    const lost = begin();
    void (async () => {
      const parts = await readFileChunks(
        transport,
        root,
        info.path,
        controller.signal,
      );
      if (controller.signal.aborted) return;
      // The previous image stays until the new one is ready.
      if (shown.current) URL.revokeObjectURL(shown.current);
      shown.current = URL.createObjectURL(
        new Blob(parts, { type: info.mimeType }),
      );
      setUrl(shown.current);
      setError(undefined);
    })().catch((cause: unknown) => {
      if (controller.signal.aborted || isAbort(cause)) return;
      if (cause instanceof ReadConnectionLost) return lost();
      setError(readErrorCopy(cause, locale));
    });
    return () => controller.abort();
  }, [transport, root, info.path, info.revision, retry, attempt, begin]);
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
  refresh,
}: {
  transport: ReadingTransport;
  root: string;
  info: FileInfo;
  alt?: string;
  locale: string;
  refresh: number;
}) {
  const { url, error } = useImageUrl(transport, root, info, locale, refresh);
  if (error)
    return <span className="reading-inline-note">{alt ?? info.path}</span>;
  return url ? <img src={url} alt={alt ?? info.path} /> : null;
}

export function ImageSurface({
  transport,
  root,
  info,
  locale,
  refresh,
}: {
  transport: ReadingTransport;
  root: string;
  info: FileInfo;
  locale: string;
  refresh: number;
}) {
  const t = translator(locale);
  const { url, error, retry } = useImageUrl(
    transport,
    root,
    info,
    locale,
    refresh,
  );
  return (
    <div className="reading-image-surface">
      {error && (
        <ReadingError centered={!url} retryLabel={t("Retry")} onRetry={retry}>
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
