import { useLayoutEffect, useRef, useState } from "react";
import { Terminal } from "lucide-react";
import { CliIcon } from "../CliIcon.tsx";
import type { ActivityGroup } from "./types.ts";

// Measure the existing icons and counts at the user's text size. The summary
// reserves room for the worktree name and keeps only the prefix that fits.
export function WorktreeActivity({
  hostKey,
  groups,
  t,
}: {
  hostKey: string;
  groups: ActivityGroup[];
  t: (key: string) => string;
}) {
  const container = useRef<HTMLSpanElement>(null);
  const measure = useRef<HTMLSpanElement>(null);
  const [visible, setVisible] = useState(groups.length);
  const groupSizes = JSON.stringify(
    groups.map((group) => [group.cli?.id, group.count]),
  );
  const groupCount = groups.length;
  useLayoutEffect(() => {
    const element = container.current;
    const ruler = measure.current;
    if (!element || !ruler) return;
    const resize = () => {
      const items = [...ruler.children];
      const gap = parseFloat(getComputedStyle(ruler).columnGap) || 0;
      const widths = items.map((item) => item.getBoundingClientRect().width);
      const available = element.getBoundingClientRect().width;
      let count = groupCount;
      const width = (length: number) =>
        widths.slice(0, length).reduce((sum, value) => sum + value, 0) +
        Math.max(0, length - 1) * gap;
      if (width(count) > available) {
        while (count > 0 && width(count) + gap + widths[groupCount] > available)
          count--;
      }
      setVisible(count);
    };
    const observer = new ResizeObserver(resize);
    observer.observe(element);
    observer.observe(ruler);
    resize();
    return () => observer.disconnect();
  }, [groupSizes, groupCount]);

  const render = (group: ActivityGroup) => (
    <span
      className="nav-activity-kind flex shrink-0 items-center gap-1 whitespace-nowrap"
      key={group.cli?.id ?? "terminal"}
    >
      {group.cli ? (
        <CliIcon hostKey={hostKey} cli={group.cli} size={14} />
      ) : (
        <Terminal className="size-3.5 shrink-0" aria-hidden="true" />
      )}
      {group.count > 1 && <span>{group.count}</span>}
    </span>
  );

  const description = groups
    .map((group) => `${group.cli?.name ?? t("Terminal")} × ${group.count}`)
    .join(", ");

  return (
    <span
      className="nav-activity-summary relative ml-auto w-max max-w-[45%] min-w-0 shrink-0 overflow-hidden text-xs text-muted-foreground"
      ref={container}
      role="img"
      aria-label={description}
      title={description}
    >
      <span
        className="nav-activity-measure pointer-events-none invisible flex w-max items-center gap-1 whitespace-nowrap [&>:last-child]:absolute"
        ref={measure}
        aria-hidden="true"
      >
        {groups.map(render)}
        <span>+{groups.length}</span>
      </span>
      <span
        className="nav-activity-visible absolute top-0 left-0 flex min-h-4 items-center gap-1 whitespace-nowrap"
        aria-hidden="true"
      >
        {groups.slice(0, visible).map(render)}
        {visible < groups.length && <span>+{groups.length - visible}</span>}
      </span>
    </span>
  );
}
