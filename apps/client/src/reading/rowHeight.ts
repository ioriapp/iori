import { useLayoutEffect, useRef, useState } from "react";

/** Probe element classes for list rows (28px desktop at 16px root, 40px touch). */
export const LIST_ROW_PROBE_CLASS =
  "pointer-events-none invisible absolute h-7 [@media(pointer:coarse)]:h-10";

/** Probe element classes for code/diff rows (22px at 16px root, scales with rem). */
export const CODE_ROW_PROBE_CLASS =
  "pointer-events-none invisible absolute h-[1.375rem]";

/**
 * The row height in pixels, read from a hidden probe element so virtualized
 * rows follow the root rem scale (12px–24px) and grow for touch input.
 */
export function useRowHeight(fallback = 28) {
  const probe = useRef<HTMLDivElement>(null);
  const [height, setHeight] = useState(fallback);
  useLayoutEffect(() => {
    const element = probe.current;
    if (!element) return;
    const measure = () => {
      if (element.offsetHeight > 0) setHeight(element.offsetHeight);
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  return { probe, height };
}
