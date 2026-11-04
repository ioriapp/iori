import { useLayoutEffect, useRef, useState } from "react";

/**
 * The list row height in pixels, read from the pane's --reading-row so it
 * follows the sample's --row and grows for touch input.
 */
export function useRowHeight(fallback = 26) {
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
