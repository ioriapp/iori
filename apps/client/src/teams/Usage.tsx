import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { usageAppliesToModel, type CliUsage } from "@iori/protocol";
import { formatUsage } from "../usage-format.ts";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "../components/ui/tooltip.tsx";
export function Usage({
  cliId,
  usage,
  name,
  model,
  compact = false,
}: {
  cliId: string;
  usage?: CliUsage;
  name?: string;
  model?: string;
  compact?: boolean;
}) {
  const [now, setNow] = useState(Date.now);
  const [open, setOpen] = useState(false);
  useEffect(() => {
    if (!usage) return;
    const timer = setInterval(() => setNow(Date.now()), 60000);
    return () => clearInterval(timer);
  }, [usage]);
  const line = useRef<HTMLDivElement>(null);
  // A single narrow line drops whole windows from the end, never digits.
  useLayoutEffect(() => {
    const element = line.current;
    if (compact || !element) return;
    const fit = () => {
      const items = [
        ...element.querySelectorAll<HTMLElement>(
          ":scope > [data-iori-usage-window]",
        ),
      ];
      const more = element.querySelector<HTMLElement>(
        ":scope > [data-iori-usage-more]",
      );
      if (!more || !items.length) return;
      const show = (count: number) => {
        for (const [index, item] of items.entries())
          item.hidden = index >= count;
        more.textContent = `+${items.length - count}`;
        more.hidden = count === items.length;
      };
      show(items.length);
      if (getComputedStyle(element).whiteSpace !== "nowrap") return;
      const left = element.getBoundingClientRect().left;
      const fits = (item: HTMLElement) =>
        item.getBoundingClientRect().right - left <= element.clientWidth;
      if (fits(items.at(-1)!)) return;
      let count = items.length - 1;
      for (; count > 1; count--) {
        show(count);
        if (fits(more)) return;
      }
      show(count);
    };
    fit();
    const observer = new ResizeObserver(fit);
    observer.observe(element);
    return () => observer.disconnect();
  }, [compact, usage, now, model, name]);
  if (!usage) return null;
  const windows = usage.windows
    .filter(
      (window) => model === undefined || usageAppliesToModel(window, model),
    )
    .map((window, index) => {
      const minutes =
        window.resetsAt === undefined
          ? undefined
          : Math.max(0, Math.ceil((window.resetsAt - now) / 60000));
      const prefix = `${index === 0 && name ? `${name} ` : ""}${window.name ? `${window.name} ` : ""}`;
      return {
        full:
          prefix +
          formatUsage(window.minutes, Math.round(window.remaining), minutes),
        short:
          prefix + formatUsage(window.minutes, Math.round(window.remaining)),
      };
    });
  const content = windows.map((window, index) => (
    <span key={index} data-iori-usage-window>
      <span className="team-usage-full">{window.full}</span>
      <span className="team-usage-short" aria-hidden={compact || undefined}>
        {window.short}
      </span>
    </span>
  ));
  if (!compact)
    return (
      <div
        className="team-usage"
        data-iori-usage={cliId}
        ref={line}
        title={windows.map((window) => window.full).join(" · ")}
      >
        {content}
        <span data-iori-usage-more hidden />
      </div>
    );
  return (
    <Tooltip open={open} onOpenChange={setOpen}>
      <TooltipTrigger asChild>
        <div
          className="team-usage team-usage-compact"
          data-iori-usage={cliId}
          role="button"
          tabIndex={0}
          aria-label={windows.map((window) => window.full).join(" · ")}
          onClick={() => setOpen(true)}
          onKeyDown={(event) => {
            if (event.key === "Enter" || event.key === " ") {
              event.preventDefault();
              setOpen(true);
            }
          }}
        >
          {content}
        </div>
      </TooltipTrigger>
      <TooltipContent>
        <span>{windows.map((window) => window.full).join(" · ")}</span>
      </TooltipContent>
    </Tooltip>
  );
}
