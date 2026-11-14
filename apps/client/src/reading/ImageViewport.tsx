import { translator } from "../i18n.ts";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { Maximize, Minus, Plus } from "lucide-react";
import { Button } from "../components/ui/button";
import { formatBytes } from "./format.ts";

export type ImageSize = { width: number; height: number };
export type ImageContent = {
  url?: string;
  path: string;
  mimeType?: string;
  sizeBytes?: number;
  natural?: ImageSize;
};

export function ImageFacts({
  image,
  natural,
}: {
  image: ImageContent;
  natural?: ImageSize;
}) {
  return (
    <div className="reading-image-facts">
      {natural && (
        <span>
          {natural.width} × {natural.height}
        </span>
      )}
      {image.mimeType && <span>{image.mimeType}</span>}
      {image.sizeBytes !== undefined && (
        <span>{formatBytes(image.sizeBytes)}</span>
      )}
    </div>
  );
}

export function ImageUnavailable({ locale }: { locale: string }) {
  return (
    <p className="reading-inline-note reading-image-unavailable">
      {locale.startsWith("ja")
        ? "この画像は表示できません。"
        : "This image cannot be displayed."}
    </p>
  );
}

const ZOOM_STEP = 1.25;

/** Files and Git share the same image controls and gestures. Changing the
 * source preserves zoom; a shared canvas keeps either side's scroll range. */
export function ImageViewport({
  image,
  locale,
  canvasSize,
  alt,
}: {
  image: ImageContent;
  locale: string;
  canvasSize?: ImageSize;
  alt?: string;
}) {
  const t = translator(locale);
  const [decoded, setDecoded] = useState<{ url?: string; size: ImageSize }>();
  const [failedUrl, setFailedUrl] = useState<string>();
  const natural = decoded?.url === image.url ? decoded?.size : image.natural;
  const unavailable = Boolean(image.url && failedUrl === image.url);
  const [fit, setFit] = useState(true);
  const [scale, setScale] = useState(1);
  const [boxSize, setBoxSize] = useState<ImageSize>();
  const frame = useRef<HTMLDivElement>(null);
  const extent = canvasSize ?? natural;
  const fittedScale =
    extent && boxSize
      ? Math.min(
          1,
          boxSize.width / extent.width,
          boxSize.height / extent.height,
        )
      : 1;
  const shownScale = fit ? fittedScale : scale;
  const anchor = useRef<{ left: number; top: number } | undefined>(undefined);
  const zoom = (factor: number, point?: { x: number; y: number }) => {
    const box = frame.current;
    if (box && point)
      anchor.current = {
        left: (box.scrollLeft + point.x) * factor - point.x,
        top: (box.scrollTop + point.y) * factor - point.y,
      };
    setFit(false);
    setScale(shownScale * factor);
  };
  const zoomRef = useRef(zoom);
  zoomRef.current = zoom;
  useLayoutEffect(() => {
    const box = frame.current;
    if (!box) return;
    const measure = () => {
      const css = getComputedStyle(box);
      setBoxSize({
        width:
          box.clientWidth -
          parseFloat(css.paddingLeft) -
          parseFloat(css.paddingRight),
        height:
          box.clientHeight -
          parseFloat(css.paddingTop) -
          parseFloat(css.paddingBottom),
      });
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(box);
    return () => observer.disconnect();
  }, []);
  useLayoutEffect(() => {
    if (anchor.current && frame.current) {
      frame.current.scrollLeft = anchor.current.left;
      frame.current.scrollTop = anchor.current.top;
      anchor.current = undefined;
    }
  }, [shownScale]);
  useEffect(() => {
    const box = frame.current;
    if (!box) return;
    const wheel = (event: WheelEvent) => {
      if (!event.ctrlKey) return;
      event.preventDefault();
      const rect = box.getBoundingClientRect();
      zoomRef.current(event.deltaY < 0 ? ZOOM_STEP : 1 / ZOOM_STEP, {
        x: event.clientX - rect.left,
        y: event.clientY - rect.top,
      });
    };
    let distance: number | undefined;
    const touch = (event: TouchEvent) => {
      if (event.touches.length !== 2) {
        distance = undefined;
        return;
      }
      const [a, b] = [event.touches[0]!, event.touches[1]!];
      const next = Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY);
      if (distance && next) {
        const rect = box.getBoundingClientRect();
        zoomRef.current(next / distance, {
          x: (a.clientX + b.clientX) / 2 - rect.left,
          y: (a.clientY + b.clientY) / 2 - rect.top,
        });
      }
      distance = next;
      if (event.cancelable) event.preventDefault();
    };
    const finish = () => {
      distance = undefined;
    };
    box.addEventListener("wheel", wheel, { passive: false });
    box.addEventListener("touchstart", touch, { passive: false });
    box.addEventListener("touchmove", touch, { passive: false });
    box.addEventListener("touchend", finish);
    box.addEventListener("touchcancel", finish);
    return () => {
      box.removeEventListener("wheel", wheel);
      box.removeEventListener("touchstart", touch);
      box.removeEventListener("touchmove", touch);
      box.removeEventListener("touchend", finish);
      box.removeEventListener("touchcancel", finish);
    };
  }, []);
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
          aria-label={t("Zoom out")}
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
          aria-label={t("Zoom in")}
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
          {t("100%")}
        </Button>
        <Button
          variant="ghost"
          size="icon-sm"
          data-iori-action="image-fit"
          aria-label={t("Fit image")}
          aria-pressed={fit}
          onClick={() => setFit(true)}
        >
          <Maximize />
        </Button>
      </div>
      <div
        ref={frame}
        className="reading-image-frame reading-image-viewport"
        data-fit={fit}
      >
        {unavailable ? (
          <ImageUnavailable locale={locale} />
        ) : (
          image.url && (
            <div
              className="reading-image-canvas"
              style={
                extent
                  ? {
                      width: extent.width * shownScale,
                      height: extent.height * shownScale,
                    }
                  : undefined
              }
            >
              <img
                src={image.url}
                alt={alt ?? image.path}
                data-iori-part="file-image"
                style={
                  natural
                    ? {
                        width: natural.width * shownScale,
                        height: natural.height * shownScale,
                      }
                    : undefined
                }
                onLoad={(event) =>
                  setDecoded({
                    url: image.url,
                    size: {
                      width: event.currentTarget.naturalWidth,
                      height: event.currentTarget.naturalHeight,
                    },
                  })
                }
                onError={() => setFailedUrl(image.url)}
              />
            </div>
          )
        )}
      </div>
      <ImageFacts image={image} natural={unavailable ? undefined : natural} />
    </div>
  );
}
