import { translator } from "../i18n.ts";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { Maximize, Minus, Plus } from "lucide-react";
import { Button } from "../components/ui/button";
import { formatBytes } from "./format.ts";
import { zoomScrollOffset } from "./image-viewport-anchor.ts";

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
    <div className="flex flex-none flex-wrap items-center gap-3 border-t border-border-subtle px-3 py-1.5 text-xs text-muted-foreground tabular-nums">
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
    <p className="my-1 text-xs text-muted-foreground">
      {locale.startsWith("ja")
        ? "この画像は表示できません。"
        : "This image cannot be displayed."}
    </p>
  );
}

const ZOOM_STEP = 1.25;

function measureFrame(box: HTMLDivElement) {
  const css = getComputedStyle(box);
  const padding = {
    left: parseFloat(css.paddingLeft),
    top: parseFloat(css.paddingTop),
  };
  return {
    padding,
    size: {
      width: box.clientWidth - padding.left - parseFloat(css.paddingRight),
      height: box.clientHeight - padding.top - parseFloat(css.paddingBottom),
    },
  };
}

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
  const zoomTo = (nextScale: number, point?: { x: number; y: number }) => {
    const box = frame.current;
    if (box && extent && nextScale !== shownScale) {
      const { size, padding } = measureFrame(box);
      anchor.current = {
        left: zoomScrollOffset({
          boxSize: size.width,
          extent: extent.width,
          padding: padding.left,
          currentScale: shownScale,
          nextScale,
          scroll: box.scrollLeft,
          point: point?.x ?? box.clientWidth / 2,
        }),
        top: zoomScrollOffset({
          boxSize: size.height,
          extent: extent.height,
          padding: padding.top,
          currentScale: shownScale,
          nextScale,
          scroll: box.scrollTop,
          point: point?.y ?? box.clientHeight / 2,
        }),
      };
    }
    setFit(false);
    setScale(nextScale);
  };
  const zoom = (factor: number, point?: { x: number; y: number }) =>
    zoomTo(shownScale * factor, point);
  const zoomRef = useRef(zoom);
  zoomRef.current = zoom;
  useLayoutEffect(() => {
    const box = frame.current;
    if (!box) return;
    const measure = () => setBoxSize(measureFrame(box).size);
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
        x: event.clientX - rect.left - box.clientLeft,
        y: event.clientY - rect.top - box.clientTop,
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
          x: (a.clientX + b.clientX) / 2 - rect.left - box.clientLeft,
          y: (a.clientY + b.clientY) / 2 - rect.top - box.clientTop,
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
    <div className="relative flex min-h-0 flex-1 flex-col">
      <div
        className="absolute top-2 right-4 z-(--z-popover) flex items-center gap-0.5 rounded-lg border border-border bg-popover p-1 text-popover-foreground shadow-md"
        data-iori-part="image-tools"
      >
        <Button
          variant="ghost"
          size="icon-sm"
          className="[@media(pointer:coarse)]:size-11"
          data-iori-action="image-zoom-out"
          aria-label={t("Zoom out")}
          onClick={() => zoom(1 / ZOOM_STEP)}
        >
          <Minus />
        </Button>
        <span
          className="px-1.5 text-xs whitespace-nowrap text-muted-foreground tabular-nums"
          data-iori-part="image-scale"
        >
          {Math.round(shownScale * 100)}%
        </span>
        <Button
          variant="ghost"
          size="icon-sm"
          className="[@media(pointer:coarse)]:size-11"
          data-iori-action="image-zoom-in"
          aria-label={t("Zoom in")}
          onClick={() => zoom(ZOOM_STEP)}
        >
          <Plus />
        </Button>
        <Button
          variant="ghost"
          size="sm"
          className="[@media(pointer:coarse)]:min-h-11"
          data-iori-action="image-actual-size"
          onClick={() => zoomTo(1)}
        >
          {t("100%")}
        </Button>
        <Button
          variant="ghost"
          size="icon-sm"
          className="aria-pressed:bg-accent aria-pressed:text-accent-foreground [@media(pointer:coarse)]:size-11"
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
        className="reading-image-frame flex min-h-0 flex-1 touch-pan-x touch-pan-y overflow-auto p-3"
        data-fit={fit}
      >
        {unavailable ? (
          <div className="m-auto">
            <ImageUnavailable locale={locale} />
          </div>
        ) : (
          image.url && (
            <div
              className="m-auto flex-none"
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
                className={
                  fit
                    ? "max-h-full max-w-full bg-[repeating-conic-gradient(var(--muted)_0_25%,transparent_0_50%)] bg-[length:16px_16px] object-contain"
                    : "max-h-none max-w-none bg-[repeating-conic-gradient(var(--muted)_0_25%,transparent_0_50%)] bg-[length:16px_16px]"
                }
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
