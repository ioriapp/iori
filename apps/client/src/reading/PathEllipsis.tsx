import { useLayoutEffect, useRef, useState } from "react";
import { cn } from "cn";

let measureContext: CanvasRenderingContext2D | null | undefined;

function textMeasurer(element: HTMLElement): (text: string) => number {
  if (measureContext === undefined) {
    measureContext =
      typeof document !== "undefined"
        ? document.createElement("canvas").getContext("2d")
        : null;
  }
  const style = getComputedStyle(element);
  const font =
    style.font || `${style.fontWeight} ${style.fontSize} ${style.fontFamily}`;
  if (!measureContext) {
    const px = Number.parseFloat(style.fontSize) || 13;
    return (text) => text.length * px * 0.55;
  }
  measureContext.font = font;
  const ctx = measureContext;
  return (text) => ctx.measureText(text).width;
}

interface FittedPath {
  text: string;
  clipFilename: boolean;
}

function fitLeadingPath(
  path: string,
  fullWidth: number,
  maxWidth: number,
  measure: (text: string) => number,
): FittedPath {
  if (maxWidth <= 0 || fullWidth <= maxWidth + 0.5) {
    return { text: path, clipFilename: false };
  }
  const parts = path.split("/");
  if (parts.length <= 1) {
    return { text: path, clipFilename: true };
  }
  const canvasFull = measure(path);
  const scale = canvasFull > 0 ? fullWidth / canvasFull : 1;
  const limit = maxWidth - 0.5;
  for (let i = 1; i < parts.length; i += 1) {
    const candidate = `…/${parts.slice(i).join("/")}`;
    if (measure(candidate) * scale <= limit) {
      return { text: candidate, clipFilename: false };
    }
  }
  return {
    text: parts[parts.length - 1] ?? path,
    clipFilename: true,
  };
}

/**
 * Displays a file path, omitting leading directory segments (`…/dir/file`)
 * when space is limited and truncating the filename's end only as a last resort.
 */
export function PathEllipsis({
  path,
  className,
}: {
  path: string;
  className?: string;
}) {
  const boxRef = useRef<HTMLSpanElement>(null);
  const probeRef = useRef<HTMLSpanElement>(null);
  const shownRef = useRef<HTMLSpanElement>(null);
  const [fitted, setFitted] = useState<FittedPath>({
    text: path,
    clipFilename: false,
  });

  useLayoutEffect(() => {
    const box = boxRef.current;
    const probe = probeRef.current;
    const shown = shownRef.current;
    if (!box || !probe || !shown) return;
    let cancelled = false;
    const update = () => {
      if (cancelled) return;
      const range = document.createRange();
      range.selectNodeContents(probe);
      const fullWidth = range.getBoundingClientRect().width;
      const maxWidth = box.getBoundingClientRect().width;
      const next = fitLeadingPath(
        path,
        fullWidth,
        maxWidth,
        textMeasurer(shown),
      );
      setFitted((prev) =>
        prev.text === next.text && prev.clipFilename === next.clipFilename
          ? prev
          : next,
      );
    };
    update();
    const observer = new ResizeObserver(update);
    observer.observe(box);
    void document.fonts?.ready.then(update);
    return () => {
      cancelled = true;
      observer.disconnect();
    };
  }, [path]);

  const shown = fitted.text === "" ? path : fitted.text;
  return (
    <span
      ref={boxRef}
      className={cn(
        "grid min-w-0 flex-[0_1_auto] grid-cols-[minmax(0,1fr)]",
        className,
      )}
    >
      <span
        ref={probeRef}
        className="pointer-events-none invisible col-start-1 row-start-1 overflow-hidden whitespace-nowrap"
        aria-hidden="true"
      >
        {path}
      </span>
      <span
        ref={shownRef}
        className={cn(
          "col-start-1 row-start-1 min-w-0 overflow-hidden whitespace-nowrap",
          fitted.clipFilename && "truncate",
        )}
      >
        {shown}
      </span>
    </span>
  );
}

interface BreadcrumbFit {
  start: number;
  omitted: boolean;
}

/**
 * Renders breadcrumb path segments inside `.reading-breadcrumb`, omitting
 * leading segments (`… › dir › file`) so the filename stays visible when narrow.
 */
export function BreadcrumbPath({ path }: { path: string }) {
  const parts = path.split("/");
  const probeRef = useRef<HTMLSpanElement>(null);
  const ellipsisRef = useRef<HTMLSpanElement>(null);
  const partRefs = useRef<(HTMLSpanElement | null)[]>([]);
  partRefs.current.length = parts.length;
  const [fit, setFit] = useState<BreadcrumbFit>({ start: 0, omitted: false });

  useLayoutEffect(() => {
    const probe = probeRef.current;
    if (!probe) return;
    let cancelled = false;
    const update = () => {
      if (cancelled) return;
      const available = probe.clientWidth;
      if (available <= 0 || parts.length === 0) return;
      const first = partRefs.current[0];
      const last = partRefs.current[parts.length - 1];
      if (!first || !last) return;
      const firstLeft = first.getBoundingClientRect().left;
      const lastRight = last.getBoundingClientRect().right;
      const limit = available + 0.5;
      if (lastRight - firstLeft <= limit) {
        setFit((prev) =>
          prev.start === 0 && !prev.omitted
            ? prev
            : { start: 0, omitted: false },
        );
        return;
      }
      const ellipsisWidth =
        ellipsisRef.current?.getBoundingClientRect().width ?? 0;
      for (let i = 1; i < parts.length; i += 1) {
        const seg = partRefs.current[i];
        if (!seg) continue;
        const tailWidth = lastRight - seg.getBoundingClientRect().left;
        if (ellipsisWidth + tailWidth <= limit) {
          setFit((prev) =>
            prev.start === i && prev.omitted
              ? prev
              : { start: i, omitted: true },
          );
          return;
        }
      }
      const onlyLast: BreadcrumbFit = {
        start: Math.max(0, parts.length - 1),
        omitted: false,
      };
      setFit((prev) =>
        prev.start === onlyLast.start && prev.omitted === onlyLast.omitted
          ? prev
          : onlyLast,
      );
    };
    update();
    const observer = new ResizeObserver(update);
    observer.observe(probe);
    void document.fonts?.ready.then(update);
    return () => {
      cancelled = true;
      observer.disconnect();
    };
  }, [path, parts.length]);

  const visible = fit.omitted
    ? ["…", ...parts.slice(fit.start)]
    : parts.slice(fit.start);

  const segClass =
    "flex-none [&:not(:last-child)]:after:px-1 [&:not(:last-child)]:after:opacity-70 [&:not(:last-child)]:after:content-['›']";

  return (
    <>
      <span
        ref={probeRef}
        className="pointer-events-none invisible relative col-start-1 row-start-1 flex min-w-0 overflow-hidden"
        aria-hidden="true"
      >
        <span
          ref={ellipsisRef}
          className={cn(segClass, "absolute top-0 left-0")}
        >
          …
        </span>
        {parts.map((part, index) => (
          <span
            key={index}
            className={segClass}
            ref={(el) => {
              partRefs.current[index] = el;
            }}
          >
            {part}
          </span>
        ))}
      </span>
      <span className="col-start-1 row-start-1 flex min-w-0 overflow-hidden">
        {visible.map((part, index) => {
          const isLast = index === visible.length - 1;
          return (
            <span
              key={index}
              data-last={isLast || undefined}
              className={cn(
                segClass,
                isLast && "min-w-0 flex-[0_1_auto] truncate text-foreground",
              )}
            >
              {part}
            </span>
          );
        })}
      </span>
    </>
  );
}
