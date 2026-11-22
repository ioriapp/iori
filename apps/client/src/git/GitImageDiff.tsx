import { translator } from "../i18n.ts";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { X } from "lucide-react";
import type { GitImageSide } from "@iori/protocol";
import { Button } from "../components/ui/button";
import { Spinner } from "../components/ui/spinner";
import { ToggleGroup, ToggleGroupItem } from "../components/ui/toggle-group";
import { ReadingError } from "../reading/ReadingError.tsx";
import {
  ImageFacts,
  ImageUnavailable,
  ImageViewport,
  type ImageSize,
} from "../reading/ImageViewport.tsx";
import type { GitImage } from "./image-source.ts";

function ImageSide({
  image,
  side,
  single,
  scale,
  locale,
  onSize,
  onOpen,
  onRetry,
}: {
  image: GitImage;
  side: GitImageSide;
  single: boolean;
  scale: number;
  locale: string;
  onSize: (url: string, size: ImageSize) => void;
  onOpen: (keyboard: boolean) => void;
  onRetry: () => void;
}) {
  const t = translator(locale);
  const label = single ? undefined : side === "old" ? t("Before") : t("After");
  const openLabel = single
    ? t("Open image")
    : side === "old"
      ? t("Open before")
      : t("Open after");
  const [failedUrl, setFailedUrl] = useState<string>();
  const unavailable =
    Boolean(image.url && failedUrl === image.url) ||
    Boolean(image.info?.present && !image.mimeType?.startsWith("image/"));
  const loading = !image.url && !image.error && !unavailable;
  return (
    <section
      className="image-diff-side relative flex min-h-0 min-w-0 flex-1 flex-col group-data-[narrow=true]/split:w-full group-data-[narrow=true]/split:flex-none [&+.image-diff-side]:border-l [&+.image-diff-side]:border-border group-data-[narrow=true]/split:[&+.image-diff-side]:border-t group-data-[narrow=true]/split:[&+.image-diff-side]:border-l-0"
      aria-label={label}
      data-image-side={side}
    >
      <div
        className="flex-none px-3 py-2 text-xs font-medium text-foreground group-data-[narrow=true]/split:sticky group-data-[narrow=true]/split:top-0 group-data-[narrow=true]/split:z-[1] group-data-[narrow=true]/split:bg-background"
        aria-hidden={!label || undefined}
      >
        {label ?? "\u00a0"}
      </div>
      <div
        className="reading-image-frame flex flex-none items-start justify-start overflow-visible px-3 py-0"
        data-fit="true"
        aria-busy={loading || undefined}
      >
        {image.error && !image.url ? (
          <ReadingError retryLabel={t("Retry")} onRetry={onRetry}>
            {image.error}
          </ReadingError>
        ) : loading ? (
          <Spinner
            className="text-muted-foreground"
            aria-hidden="true"
            aria-label={undefined}
          />
        ) : unavailable ? (
          <ImageUnavailable locale={locale} />
        ) : (
          <Button
            variant="ghost"
            className="block h-auto max-w-full rounded-none border-0 bg-transparent p-0 hover:bg-transparent"
            aria-label={openLabel}
            title={openLabel}
            data-iori-action="git-image-open"
            data-side={side}
            onClick={(event) => onOpen(event.detail === 0)}
          >
            <img
              src={image.url}
              alt={label ? `${label} ${image.path}` : image.path}
              className="box-content max-h-none max-w-full flex-none border border-border bg-[repeating-conic-gradient(var(--muted)_0_25%,transparent_0_50%)] bg-[length:16px_16px]"
              style={
                image.natural
                  ? {
                      width: image.natural.width * scale,
                      height: image.natural.height * scale,
                    }
                  : undefined
              }
              onLoad={(event) =>
                onSize(image.url!, {
                  width: event.currentTarget.naturalWidth,
                  height: event.currentTarget.naturalHeight,
                })
              }
              onError={() => setFailedUrl(image.url)}
            />
          </Button>
        )}
      </div>
      {image.error && image.url && (
        <ReadingError retryLabel={t("Retry")} onRetry={onRetry}>
          {image.error}
        </ReadingError>
      )}
      {image.url && (
        <ImageFacts
          image={image}
          natural={unavailable ? undefined : image.natural}
        />
      )}
    </section>
  );
}

export function GitImageDiff({
  images,
  active,
  single,
  locale,
  retry,
  onBackHandler,
}: {
  images: Record<GitImageSide, GitImage>;
  active: boolean;
  single: boolean;
  locale: string;
  retry: (side: GitImageSide) => void;
  onBackHandler?: (handler: (() => boolean) | undefined) => void;
}) {
  const t = translator(locale);
  const [sizes, setSizes] = useState<Record<string, ImageSize>>({});
  const [opened, setOpened] = useState<GitImageSide>();
  const [scale, setScale] = useState(1);
  const columnsRef = useRef<HTMLDivElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const opener = useRef<HTMLElement | null>(null);
  const openedByKeyboard = useRef(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const sides = (["old", "new"] as const).filter(
    (side) =>
      (!single || side === "new") && images[side].info?.present !== false,
  );
  const content = (side: GitImageSide) => ({
    ...images[side],
    natural: sizes[images[side].url ?? ""],
  });
  const largestWidth = Math.max(
    ...sides.map((side) => content(side).natural?.width ?? 1),
  );
  const largestHeight = Math.max(
    ...sides.map((side) => content(side).natural?.height ?? 1),
  );
  const close = () => {
    setOpened(undefined);
  };
  const closeAction = useRef(close);
  closeAction.current = close;
  const back = useRef(onBackHandler);
  back.current = onBackHandler;
  useEffect(() => {
    if (!opened) {
      opener.current?.focus();
      return;
    }
    closeRef.current?.focus({ focusVisible: openedByKeyboard.current });
  }, [Boolean(opened)]);
  useEffect(() => {
    if (!opened || !active) return;
    back.current?.(() => {
      closeAction.current();
      return true;
    });
    const key = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      const pane = containerRef.current?.closest(".git-pane");
      if (!pane?.contains(document.activeElement)) return;
      if (
        document.querySelector(
          '[data-state="open"][role="dialog"], [data-state="open"][role="alertdialog"], dialog[open]',
        )
      )
        return;
      event.preventDefault();
      event.stopPropagation();
      closeAction.current();
    };
    document.addEventListener("keydown", key, true);
    return () => {
      back.current?.(undefined);
      document.removeEventListener("keydown", key, true);
    };
  }, [Boolean(opened), active]);
  useLayoutEffect(() => {
    const columns = columnsRef.current;
    if (!columns) return;
    const fit = () => {
      if (!columns.clientWidth) return;
      const widths = [
        ...columns.querySelectorAll<HTMLElement>(".reading-image-frame"),
      ].map((frame) => {
        const css = getComputedStyle(frame);
        return (
          frame.clientWidth -
          parseFloat(css.paddingLeft) -
          parseFloat(css.paddingRight) -
          2
        );
      });
      setScale(Math.min(1, Math.min(...widths) / largestWidth));
    };
    fit();
    const observer = new ResizeObserver(fit);
    observer.observe(columns);
    return () => observer.disconnect();
  }, [largestWidth, sides.join(",")]);
  useLayoutEffect(() => {
    const element = scrollRef.current;
    const columns = columnsRef.current;
    if (!element || !columns) return;
    const update = () => {
      element.dataset.overflow = String(
        element.scrollTop + element.clientHeight < element.scrollHeight - 1,
      );
    };
    const observer = new ResizeObserver(update);
    observer.observe(element);
    observer.observe(columns);
    element.addEventListener("scroll", update);
    update();
    return () => {
      observer.disconnect();
      element.removeEventListener("scroll", update);
    };
  }, []);
  return (
    <div ref={containerRef} className="relative flex min-h-0 flex-1 flex-col">
      <div
        ref={scrollRef}
        className="reading-body relative block min-h-0 flex-1 overflow-auto data-[overflow=true]:[mask-image:linear-gradient(to_bottom,var(--foreground)_calc(100%-2rem),transparent)] [&[hidden]]:hidden"
        hidden={Boolean(opened)}
      >
        <div
          ref={columnsRef}
          className="flex min-h-full min-w-0 items-stretch group-data-[narrow=true]/split:flex-col"
        >
          {sides.map((side) => (
            <ImageSide
              key={side}
              image={content(side)}
              side={side}
              single={single}
              scale={scale}
              locale={locale}
              onSize={(url, size) =>
                setSizes((previous) =>
                  previous[url]?.width === size.width &&
                  previous[url]?.height === size.height
                    ? previous
                    : { ...previous, [url]: size },
                )
              }
              onOpen={(keyboard) => {
                openedByKeyboard.current = keyboard;
                opener.current = document.activeElement as HTMLElement;
                setOpened(side);
              }}
              onRetry={() => retry(side)}
            />
          ))}
        </div>
      </div>
      {opened && (
        <div
          className="flex min-h-0 flex-1 flex-col"
          data-iori-part="git-image-expanded"
        >
          <div className="flex h-9 min-w-0 flex-none items-center gap-1 border-b border-border px-1.5 [@media(pointer:coarse)]:h-11">
            {sides.length > 1 && (
              <ToggleGroup
                type="single"
                value={opened}
                size="sm"
                onValueChange={(value) => {
                  if (value) setOpened(value as GitImageSide);
                }}
              >
                <ToggleGroupItem
                  value="old"
                  className="[@media(pointer:coarse)]:min-h-11 [@media(pointer:coarse)]:px-3"
                  data-iori-action="git-image-before"
                >
                  {t("Before")}
                </ToggleGroupItem>
                <ToggleGroupItem
                  value="new"
                  className="[@media(pointer:coarse)]:min-h-11 [@media(pointer:coarse)]:px-3"
                  data-iori-action="git-image-after"
                >
                  {t("After")}
                </ToggleGroupItem>
              </ToggleGroup>
            )}
            <span className="flex-1" />
            <Button
              ref={closeRef}
              variant="ghost"
              size="icon-sm"
              className="[@media(pointer:coarse)]:size-11"
              data-iori-action="git-image-close"
              aria-label={t("Close")}
              title={t("Close")}
              onClick={close}
            >
              <X />
            </Button>
          </div>
          <ImageViewport
            image={content(opened)}
            locale={locale}
            canvasSize={{ width: largestWidth, height: largestHeight }}
            alt={
              single
                ? images[opened].path
                : `${opened === "old" ? t("Before") : t("After")} ${images[opened].path}`
            }
          />
        </div>
      )}
    </div>
  );
}
