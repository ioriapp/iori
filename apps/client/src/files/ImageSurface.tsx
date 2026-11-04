import { useEffect, useRef, useState } from "react";
import { Maximize, Minus, Plus } from "lucide-react";
import type { FileInfo } from "@iori/protocol";
import { Button } from "../components/ui/button";
import {
  ReadConnectionLost,
  decodeBytes,
  isAbort,
  readErrorCopy,
  type ReadingTransport,
} from "../reading/transport.ts";
import { formatBytes } from "../reading/format.ts";
import { ReadingError } from "../reading/ReadingError.tsx";

const CHUNK_BYTES = 1_048_576;
const ZOOM_STEP = 1.25;

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
  const { url, error, setError, retry } = useImageUrl(
    transport,
    root,
    info,
    locale,
  );
  const [natural, setNatural] = useState<{ width: number; height: number }>();
  const [fit, setFit] = useState(true);
  const [scale, setScale] = useState(1);
  const frame = useRef<HTMLDivElement>(null);
  const fittedScale = () => {
    const box = frame.current;
    if (!box || !natural) return 1;
    return Math.min(
      1,
      box.clientWidth / natural.width,
      box.clientHeight / natural.height,
    );
  };
  const zoom = (factor: number) => {
    const base = fit ? fittedScale() : scale;
    setFit(false);
    setScale(base * factor);
  };
  const shownScale = fit ? fittedScale() : scale;
  return (
    <div className="reading-image-surface">
      <div
        className="reading-overlay reading-image-tools"
        data-iori-part="image-tools"
      >
        <Button
          variant="ghost"
          size="icon-sm"
          data-iori-action="image-zoom-out"
          aria-label={ja ? "縮小" : "Zoom out"}
          onClick={() => zoom(1 / ZOOM_STEP)}
        >
          <Minus />
        </Button>
        <span className="reading-overlay-status" data-iori-part="image-scale">
          {Math.round(shownScale * 100)}%
        </span>
        <Button
          variant="ghost"
          size="icon-sm"
          data-iori-action="image-zoom-in"
          aria-label={ja ? "拡大" : "Zoom in"}
          onClick={() => zoom(ZOOM_STEP)}
        >
          <Plus />
        </Button>
        <Button
          variant="ghost"
          size="sm"
          data-iori-action="image-actual-size"
          onClick={() => {
            setFit(false);
            setScale(1);
          }}
        >
          {ja ? "等倍" : "100%"}
        </Button>
        <Button
          variant="ghost"
          size="icon-sm"
          data-iori-action="image-fit"
          aria-label={ja ? "全体を表示" : "Fit image"}
          aria-pressed={fit}
          onClick={() => setFit(true)}
        >
          <Maximize />
        </Button>
      </div>
      {error && (
        <ReadingError retryLabel={ja ? "再試行" : "Retry"} onRetry={retry}>
          {error}
        </ReadingError>
      )}
      <div ref={frame} className="reading-image-frame" data-fit={fit}>
        {url && (
          <img
            src={url}
            alt={info.path}
            data-iori-part="file-image"
            style={
              !fit && natural
                ? {
                    width: natural.width * scale,
                    height: natural.height * scale,
                  }
                : undefined
            }
            onLoad={(event) =>
              setNatural({
                width: event.currentTarget.naturalWidth,
                height: event.currentTarget.naturalHeight,
              })
            }
            onError={() =>
              setError(
                ja
                  ? "この画像の形式は表示できません。"
                  : "This image format cannot be displayed.",
              )
            }
          />
        )}
      </div>
      <div className="reading-image-facts">
        {natural && (
          <span>
            {natural.width} × {natural.height}
          </span>
        )}
        {info.mimeType && <span>{info.mimeType}</span>}
        {info.sizeBytes !== undefined && (
          <span>{formatBytes(info.sizeBytes)}</span>
        )}
      </div>
    </div>
  );
}
