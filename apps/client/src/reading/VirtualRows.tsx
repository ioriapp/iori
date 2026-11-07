import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useReducer,
  useRef,
  type KeyboardEvent,
  type ReactNode,
} from "react";
import { defaultRangeExtractor, useVirtualizer } from "@tanstack/react-virtual";

// Taller content is mapped onto this many pixels so every WebView can scroll it.
const MAX_SCROLL_PX = 8_000_000;
const OVERSCAN = 8;

export type ScrollRequest = {
  index: number;
  align?: "start" | "center" | "nearest";
  /** Changes for every request so the same index can be requested again. */
  key: number;
};

type Props = {
  count: number;
  /** Keep native selection endpoints mounted outside the visible window. */
  retained?: number[];
  rowHeight: number;
  renderRow: (index: number) => ReactNode;
  onRange?: (first: number, last: number) => void;
  onPosition?: (index: number) => void;
  scrollRequest?: ScrollRequest;
  initialIndex?: number;
  className?: string;
  label?: string;
  dataId?: string;
  role?: string;
  /** Rows wrap and are measured; otherwise every row has `rowHeight`. */
  wrap?: boolean;
  onKeyDown?: (event: KeyboardEvent<HTMLDivElement>) => void;
};

/** Only the rows in view (and a few around them) are in the DOM. */
export function VirtualRows(props: Props) {
  return props.wrap ? <MeasuredRows {...props} /> : <FixedRows {...props} />;
}

function useViewportHeight(ref: React.RefObject<HTMLDivElement | null>) {
  const [height, setHeight] = useReducer(
    (_: number, value: number) => value,
    0,
  );
  useLayoutEffect(() => {
    const element = ref.current;
    if (!element) return;
    setHeight(element.clientHeight);
    const observer = new ResizeObserver(() => setHeight(element.clientHeight));
    observer.observe(element);
    return () => observer.disconnect();
  }, [ref]);
  return height;
}

/**
 * Fixed-height rows. Positions are computed directly; content taller than the
 * browser can scroll is mapped proportionally so the scrollbar spans the whole list.
 */
function FixedRows({
  count,
  retained = [],
  rowHeight,
  renderRow,
  onRange,
  onPosition,
  scrollRequest,
  initialIndex = 0,
  className = "",
  label,
  dataId,
  role,
  onKeyDown,
}: Props) {
  const ref = useRef<HTMLDivElement>(null);
  const height = useViewportHeight(ref);
  const [, render] = useReducer((value: number) => value + 1, 0);
  const total = count * rowHeight;
  const spacer = Math.min(total, MAX_SCROLL_PX);
  const scale =
    total > spacer && spacer > height
      ? (total - height) / (spacer - height)
      : 1;
  const logicalTop = useRef(initialIndex * rowHeight);
  const ownScroll = useRef<number | undefined>(undefined);

  const place = useCallback(
    (top: number) => {
      const element = ref.current;
      const maximum = Math.max(0, total - (element?.clientHeight ?? 0));
      logicalTop.current = Math.max(0, Math.min(maximum, top));
      if (element) {
        const scrollTop = Math.round(logicalTop.current / scale);
        if (element.scrollTop !== scrollTop) {
          ownScroll.current = scrollTop;
          element.scrollTop = scrollTop;
        }
      }
      render();
    },
    [scale, total],
  );

  // A hidden list cannot scroll; its place is applied again when it is shown.
  useLayoutEffect(() => {
    if (height > 0) place(logicalTop.current);
  }, [height > 0]);

  // The saved position is applied once the list is long enough to contain it.
  const initial = useRef<number | undefined>(initialIndex);
  useLayoutEffect(() => {
    if (initial.current === undefined || count <= initial.current) return;
    place(initial.current * rowHeight);
    initial.current = undefined;
  }, [count]);

  const wheel = useRef<(event: WheelEvent) => void>(undefined);
  wheel.current = (event) => {
    // In mapped mode a wheel step moves the content by its own distance, not the scaled one.
    if (scale === 1 || event.ctrlKey || event.deltaY === 0) return;
    event.preventDefault();
    const step =
      event.deltaMode === 1
        ? event.deltaY * rowHeight
        : event.deltaMode === 2
          ? event.deltaY * height
          : event.deltaY;
    initial.current = undefined;
    place(logicalTop.current + step);
  };
  useEffect(() => {
    const element = ref.current;
    if (!element) return;
    const listener = (event: WheelEvent) => wheel.current?.(event);
    element.addEventListener("wheel", listener, { passive: false });
    return () => element.removeEventListener("wheel", listener);
  }, []);

  useEffect(() => {
    if (!scrollRequest) return;
    initial.current = undefined;
    const element = ref.current;
    const view = element?.clientHeight ?? 0;
    const top = scrollRequest.index * rowHeight;
    const align = scrollRequest.align ?? "nearest";
    if (align === "start") place(top);
    else if (align === "center") place(top - (view - rowHeight) / 2);
    else if (top < logicalTop.current) place(top);
    else if (top + rowHeight > logicalTop.current + view)
      place(top + rowHeight - view);
  }, [scrollRequest?.key]);

  const first = Math.max(
    0,
    Math.floor(logicalTop.current / rowHeight) - OVERSCAN,
  );
  const last = Math.min(
    count - 1,
    Math.ceil((logicalTop.current + height) / rowHeight) + OVERSCAN,
  );
  const visible = Math.min(
    count - 1,
    Math.floor(logicalTop.current / rowHeight),
  );
  useEffect(() => {
    if (count > 0) onRange?.(first, last);
  }, [first, last, count, onRange]);
  useEffect(() => {
    if (count > 0) onPosition?.(Math.max(0, visible));
  }, [visible, count, onPosition]);

  const scrollTop = ref.current?.scrollTop ?? 0;
  const rows: ReactNode[] = [];
  const indices = new Set(retained);
  for (let index = first; index <= last; index += 1) indices.add(index);
  for (const index of [...indices].sort((a, b) => a - b))
    rows.push(
      <div
        key={index}
        className="reading-virtual-row"
        data-index={index}
        style={{
          top: scrollTop + index * rowHeight - logicalTop.current,
          height: rowHeight,
        }}
      >
        {renderRow(index)}
      </div>,
    );
  return (
    <div
      ref={ref}
      className={`reading-virtual ${className}`}
      aria-label={label}
      role={role}
      data-iori-scroll={dataId}
      data-iori-row-count={count}
      tabIndex={0}
      onKeyDown={onKeyDown}
      onScroll={(event) => {
        const element = event.currentTarget;
        // Hiding the list and showing it again reset scrollTop; that is not the user scrolling.
        if (height === 0 || element.clientHeight === 0) return;
        if (ownScroll.current === element.scrollTop) {
          ownScroll.current = undefined;
          return;
        }
        ownScroll.current = undefined;
        initial.current = undefined;
        logicalTop.current = element.scrollTop * scale;
        render();
      }}
    >
      <div className="reading-virtual-spacer" style={{ height: spacer }}>
        {rows}
      </div>
    </div>
  );
}

/** Wrapped rows of different heights, measured as they are shown. */
function MeasuredRows({
  count,
  retained = [],
  rowHeight,
  renderRow,
  onRange,
  onPosition,
  scrollRequest,
  initialIndex = 0,
  className = "",
  label,
  dataId,
  role,
  onKeyDown,
}: Props) {
  const ref = useRef<HTMLDivElement>(null);
  const virtual = useVirtualizer({
    count,
    getScrollElement: () => ref.current,
    estimateSize: () => rowHeight,
    overscan: OVERSCAN,
    rangeExtractor: (range) =>
      [...new Set([...defaultRangeExtractor(range), ...retained])].sort(
        (a, b) => a - b,
      ),
    initialOffset: initialIndex * rowHeight,
  });
  const items = virtual.getVirtualItems();
  const first = Math.max(0, (virtual.range?.startIndex ?? 0) - OVERSCAN);
  const last = Math.min(count - 1, (virtual.range?.endIndex ?? 0) + OVERSCAN);
  useEffect(() => {
    if (count > 0) onRange?.(first, last);
  }, [first, last, count, onRange]);
  useEffect(() => {
    if (scrollRequest)
      virtual.scrollToIndex(scrollRequest.index, {
        align:
          scrollRequest.align === "nearest"
            ? "auto"
            : (scrollRequest.align ?? "auto"),
      });
  }, [scrollRequest?.key]);
  return (
    <div
      ref={ref}
      className={`reading-virtual ${className}`}
      aria-label={label}
      role={role}
      data-iori-scroll={dataId}
      data-iori-row-count={count}
      tabIndex={0}
      onKeyDown={onKeyDown}
      onScroll={(event) => {
        if (event.currentTarget.clientHeight === 0) return;
        const top = event.currentTarget.scrollTop;
        const item = items.find((value) => value.end > top);
        if (item) onPosition?.(item.index);
      }}
    >
      <div
        className="reading-virtual-spacer"
        style={{ height: virtual.getTotalSize() }}
      >
        {items.map((item) => (
          <div
            key={item.key}
            data-index={item.index}
            ref={virtual.measureElement}
            className="reading-virtual-row wrap"
            style={{ top: item.start, minHeight: rowHeight }}
          >
            {renderRow(item.index)}
          </div>
        ))}
      </div>
    </div>
  );
}
