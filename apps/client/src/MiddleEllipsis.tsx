import { useLayoutEffect, useRef, useState } from "react";

/** Fit the name to its actual available width, preserving both ends. */
export function MiddleEllipsis({
  text,
  className = "nav-worktree-name",
}: {
  text: string;
  className?: string;
}) {
  const element = useRef<HTMLSpanElement>(null);
  const [fitted, setFitted] = useState(text);
  useLayoutEffect(() => {
    const node = element.current;
    if (!node) return;
    const context = document.createElement("canvas").getContext("2d");
    if (!context) return;
    const update = () => {
      context.font = getComputedStyle(node).font;
      const width = node.clientWidth;
      const parts = Array.from(
        new Intl.Segmenter().segment(text),
        (part) => part.segment,
      );
      if (context.measureText(text).width <= width) {
        setFitted(text);
        return;
      }
      let low = 0;
      let high = parts.length;
      const candidate = (count: number) =>
        `${parts.slice(0, Math.ceil(count / 2)).join("")}…${count ? parts.slice(-Math.floor(count / 2) || parts.length).join("") : ""}`;
      while (low < high) {
        const mid = Math.ceil((low + high) / 2);
        if (context.measureText(candidate(mid)).width <= width) low = mid;
        else high = mid - 1;
      }
      setFitted(candidate(low));
    };
    const observer = new ResizeObserver(update);
    observer.observe(node);
    update();
    let active = true;
    void document.fonts.ready.then(() => {
      if (active) update();
    });
    return () => {
      active = false;
      observer.disconnect();
    };
  }, [text]);
  return (
    <span
      ref={element}
      className={className}
      aria-label={text}
      data-iori-full-name={text}
    >
      {fitted}
    </span>
  );
}
