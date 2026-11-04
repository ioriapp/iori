import { useEffect, useLayoutEffect, useRef, useState } from "react";

// Bytes of one huge line kept as text; the rest is read again as the user scrolls.
const WINDOW_BYTES = 32 * 1024;
const MAX_WIDTH_PX = 8_000_000;

let canvas: HTMLCanvasElement | undefined;
function measure(text: string, font: string): number {
  canvas ??= document.createElement("canvas");
  const context = canvas.getContext("2d");
  if (!context) return text.length * 8;
  context.font = font;
  return context.measureText(text).width;
}

/** The UTF-16 length of the text in `bytes[0..byteCount)`. */
function textLength(bytes: Uint8Array, byteCount: number): number {
  let length = 0;
  for (let at = 0; at < byteCount && at < bytes.length; at += 1) {
    const byte = bytes[at]!;
    if ((byte & 0xc0) === 0x80) continue;
    length += byte >= 0xf0 ? 2 : 1;
  }
  return length;
}

export type LongLineRead = (
  offset: number,
  length: number,
  signal: AbortSignal,
) => Promise<Uint8Array>;

/**
 * One logical line too long to render whole. Its horizontal position maps to
 * a byte position; only the text around it is read and drawn.
 */
export function LongLine({
  read,
  start,
  locateEnd,
  focus,
  onError,
}: {
  read: LongLineRead;
  /** Where the line's text starts. */
  start: number;
  /** Where the line's text ends (exclusive). */
  locateEnd: (signal: AbortSignal) => Promise<number>;
  focus?: { byteOffset: number; byteLength: number };
  onError: (error: unknown) => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [end, setEnd] = useState<number>();
  const [anchor, setAnchor] = useState(focus?.byteOffset ?? start);
  const [view, setView] = useState<{
    offset: number;
    bytes: Uint8Array;
    text: string;
  }>();
  const [bytesPerPx, setBytesPerPx] = useState(1 / 8);
  const total = end === undefined ? 0 : Math.max(1, end - start);
  const width = Math.min(MAX_WIDTH_PX, Math.max(1, total / bytesPerPx));

  useEffect(() => {
    const controller = new AbortController();
    void locateEnd(controller.signal).then(setEnd, (error: unknown) => {
      if (!controller.signal.aborted) onError(error);
    });
    return () => controller.abort();
  }, [start]);

  // Read the window around the anchor byte.
  useEffect(() => {
    if (end === undefined) return;
    const controller = new AbortController();
    const from = Math.max(
      start,
      Math.min(anchor - WINDOW_BYTES / 4, end - WINDOW_BYTES),
    );
    void read(from, Math.min(WINDOW_BYTES, end - from), controller.signal).then(
      (bytes) => {
        let skip = 0;
        while (
          skip < 3 &&
          skip < bytes.length &&
          (bytes[skip]! & 0xc0) === 0x80
        )
          skip += 1;
        const body = bytes.subarray(skip);
        const text = new TextDecoder()
          .decode(body, { stream: true })
          .replace(/\r?\n$/u, "");
        setView({ offset: from + skip, bytes: body, text });
      },
      (error: unknown) => {
        if (!controller.signal.aborted) onError(error);
      },
    );
    return () => controller.abort();
  }, [end, Math.floor(anchor / (WINDOW_BYTES / 2))]);

  // A search match moves the line so the match is in view once its text is read.
  const pendingFocus = useRef<number | undefined>(undefined);
  useEffect(() => {
    if (!focus) return;
    pendingFocus.current = focus.byteOffset;
    setAnchor(focus.byteOffset);
  }, [focus?.byteOffset]);

  const element = ref.current;
  const font = element ? getComputedStyle(element).font : "";
  let left = 0;
  let markStart = -1;
  let markEnd = -1;
  if (view && element) {
    const anchorByte = Math.max(
      view.offset,
      Math.min(anchor, view.offset + view.bytes.length),
    );
    const anchorIndex = textLength(view.bytes, anchorByte - view.offset);
    const anchorPx = ((anchorByte - start) / total) * width;
    left = anchorPx - measure(view.text.slice(0, anchorIndex), font);
    if (
      focus &&
      focus.byteOffset >= view.offset &&
      focus.byteOffset < view.offset + view.bytes.length
    ) {
      markStart = textLength(view.bytes, focus.byteOffset - view.offset);
      markEnd = textLength(
        view.bytes,
        focus.byteOffset + focus.byteLength - view.offset,
      );
    }
  }
  // Learn the real width of the characters to keep the scrollbar proportional.
  const spacer = useRef<HTMLDivElement>(null);
  // A hidden view has no width; the match is placed once the line is laid out.
  const [shownWidth, setShownWidth] = useState(0);
  useLayoutEffect(() => {
    const element = ref.current;
    if (!element) return;
    const observer = new ResizeObserver(() =>
      setShownWidth(element.clientWidth),
    );
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  useLayoutEffect(() => {
    const element = ref.current;
    if (!view || !element || end === undefined || element.clientWidth === 0)
      return;
    let ratio = bytesPerPx;
    const pixels = measure(view.text, getComputedStyle(element).font);
    if (view.bytes.length >= 256 && pixels > 0) {
      ratio = view.bytes.length / pixels;
      setBytesPerPx(ratio);
    }
    const target = pendingFocus.current;
    if (
      target === undefined ||
      target < view.offset ||
      target > view.offset + view.bytes.length
    )
      return;
    pendingFocus.current = undefined;
    // Start the view a third of its width (in real characters) before the match.
    const before = Math.round((element.clientWidth / 3) * ratio);
    let left = Math.max(start, target - before);
    while (
      left > view.offset &&
      (view.bytes[left - view.offset]! & 0xc0) === 0x80
    )
      left -= 1;
    const nextWidth = Math.min(MAX_WIDTH_PX, Math.max(1, total / ratio));
    if (spacer.current)
      spacer.current.style.width = `${nextWidth + element.clientWidth}px`;
    element.scrollLeft = ((left - start) / total) * nextWidth;
    setAnchor(left);
  }, [view, anchor, shownWidth]);

  return (
    <div
      ref={ref}
      className="reading-long-line"
      data-iori-scroll="long-line"
      data-iori-window-start={view?.offset}
      data-iori-window-end={view ? view.offset + view.bytes.length : undefined}
      tabIndex={0}
      onScroll={(event) => {
        const target = event.currentTarget;
        if (target.clientWidth === 0) return;
        setAnchor(start + Math.round((target.scrollLeft / width) * total));
      }}
      onKeyDown={(event) => {
        if (
          !ref.current ||
          end === undefined ||
          (event.key !== "Home" && event.key !== "End")
        )
          return;
        event.preventDefault();
        if (event.key === "Home") ref.current.scrollLeft = 0;
        else {
          pendingFocus.current = Math.max(start, end - 1);
          setAnchor(pendingFocus.current);
        }
      }}
    >
      <div
        ref={spacer}
        className="reading-long-line-spacer"
        // The end of the line can scroll to the left edge.
        style={{ width: width + (ref.current?.clientWidth ?? 0) }}
      >
        {view && (
          <span style={{ left }}>
            {markStart >= 0 ? (
              <>
                {view.text.slice(0, markStart)}
                <mark data-iori-part="search-current">
                  {view.text.slice(markStart, markEnd)}
                </mark>
                {view.text.slice(markEnd)}
              </>
            ) : (
              view.text
            )}
          </span>
        )}
      </div>
    </div>
  );
}
