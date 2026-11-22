import { useLayoutEffect, useRef, useState, type ReactNode } from "react";
import "./reading.css";

export type Worktree = { path: string; label: string };

// Below this width the list and the detail are shown one at a time.
export const NARROW_WIDTH = 720;
const MIN_RATIO = 15;
const MAX_RATIO = 65;
export const DEFAULT_RATIO = 25;

/**
 * A list beside its detail. The divider moves with the pointer or the arrow
 * keys and its place is kept with the View; narrow screens show one side at a time.
 */
export function SplitPane({
  list,
  children,
  detailOpen,
  listOpen,
  onNarrow,
  locale = "en",
  ratio: savedRatio = DEFAULT_RATIO,
  minListWidth,
  onRatio,
}: {
  list: ReactNode;
  children: ReactNode;
  /** On a narrow screen, whether the detail replaces the list. */
  detailOpen: boolean;
  /** On a wide screen, whether the list is shown. */
  listOpen: boolean;
  onNarrow?: (narrow: boolean) => void;
  locale?: string;
  /** The list's share of the width, in percent, as saved with the View. */
  ratio?: number;
  /** The narrowest the list gets beside the detail, in pixels. */
  minListWidth?: number;
  /** Each new width while the divider moves; the View saves it once it settles. */
  onRatio?: (ratio: number) => void;
}) {
  const root = useRef<HTMLDivElement>(null);
  const [narrow, setNarrow] = useState(false);
  const [ratio, setRatio] = useState(() =>
    Number.isFinite(savedRatio)
      ? Math.min(MAX_RATIO, Math.max(MIN_RATIO, savedRatio))
      : DEFAULT_RATIO,
  );

  useLayoutEffect(() => {
    const element = root.current;
    if (!element) return;
    const measure = () => {
      const value = element.clientWidth < NARROW_WIDTH;
      setNarrow(value);
      onNarrow?.(value);
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, [onNarrow]);

  const change = (value: number) => {
    const next = Math.min(MAX_RATIO, Math.max(MIN_RATIO, value));
    setRatio(next);
    onRatio?.(next);
  };

  const showList = narrow ? !detailOpen : listOpen;
  const showDetail = narrow ? detailOpen : true;
  return (
    <div
      ref={root}
      className="reading-split group/split relative flex min-h-0 flex-1 overflow-hidden"
      data-narrow={narrow}
      style={
        {
          "--reading-list-width": `${ratio}%`,
          ...(minListWidth
            ? { "--reading-list-min": `${minListWidth}px` }
            : {}),
        } as React.CSSProperties
      }
    >
      <aside
        className="reading-list relative flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden bg-background data-[wide=true]:w-(--reading-list-width) data-[wide=true]:min-w-[var(--reading-list-min,10rem)] data-[wide=true]:flex-none [&[hidden]]:hidden"
        hidden={!showList}
        data-wide={!narrow}
      >
        {list}
      </aside>
      {showList && showDetail && (
        <div
          role="separator"
          aria-orientation="vertical"
          tabIndex={0}
          aria-valuemin={MIN_RATIO}
          aria-valuemax={MAX_RATIO}
          aria-valuenow={Math.round(ratio)}
          aria-label={locale.startsWith("ja") ? "一覧の幅" : "List width"}
          className="reading-divider relative w-px flex-none cursor-col-resize touch-none bg-border transition-colors before:absolute before:inset-y-0 before:-inset-x-[3px] before:z-[2] before:content-[''] hover:bg-primary/50 focus-visible:outline-2 focus-visible:outline-ring"
          onPointerDown={(event) => {
            const element = root.current;
            if (!element) return;
            event.currentTarget.setPointerCapture(event.pointerId);
            const bounds = element.getBoundingClientRect();
            const move = (moved: PointerEvent) =>
              change(((moved.clientX - bounds.left) / bounds.width) * 100);
            const up = () => {
              window.removeEventListener("pointermove", move);
              window.removeEventListener("pointerup", up);
            };
            window.addEventListener("pointermove", move);
            window.addEventListener("pointerup", up);
          }}
          onKeyDown={(event) => {
            if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
              event.preventDefault();
              change(ratio + (event.key === "ArrowLeft" ? -2 : 2));
            }
          }}
        />
      )}
      <section
        className="reading-detail relative flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden [&[hidden]]:hidden"
        hidden={!showDetail}
      >
        {children}
      </section>
    </div>
  );
}
