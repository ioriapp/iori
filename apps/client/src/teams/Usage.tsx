import "../usage/usage-line.css";
import { useUsagePreferences } from "../usage/preferences.tsx";
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
  const { display } = useUsagePreferences();
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
    if (!element || !usage?.windows.length) return;
    const fit = () => {
      const items = [
        ...element.querySelectorAll<HTMLElement>("[data-iori-usage-window]"),
      ];
      const more = element.querySelector<HTMLElement>(
        "[data-iori-usage-more]",
      )!;
      element.removeAttribute("data-short");
      items.forEach((item) => (item.hidden = false));
      more.hidden = true;
      if (element.scrollWidth <= element.clientWidth) return;
      element.setAttribute("data-short", "");
      if (element.scrollWidth <= element.clientWidth) return;
      for (let visible = items.length - 1; visible >= 0; visible--) {
        items.forEach((item, index) => (item.hidden = index >= visible));
        more.hidden = false;
        more.textContent = `+${items.length - visible}`;
        if (element.scrollWidth <= element.clientWidth) break;
      }
    };
    fit();
    const observer = new ResizeObserver(fit);
    observer.observe(element);
    void document.fonts.ready.then(fit);
    return () => observer.disconnect();
  }, [compact, usage, now, model, name, display]);
  if (!usage?.windows.length) return null;
  const windows = usage.windows
    .filter(
      (window) => model === undefined || usageAppliesToModel(window, model),
    )
    .map((window) => {
      const minutes =
        window.resetsAt === undefined
          ? undefined
          : Math.max(0, Math.ceil((window.resetsAt - now) / 60000));
      const prefix = `${window.name ? `${window.name} ` : ""}`;
      return {
        full:
          prefix +
          formatUsage(window.minutes, window.remaining, minutes, display),
        short:
          prefix +
          formatUsage(window.minutes, window.remaining, undefined, display),
      };
    });
  if (!windows.length) return null;
  const content = windows.map((window, index) => (
    <span key={index} data-iori-usage-window>
      {index > 0 && "　"}
      <span className="usage-line-full">{window.full}</span>
      <span className="usage-line-short">{window.short}</span>
    </span>
  ));
  if (!compact)
    return (
      <div
        className="team-usage usage-line"
        data-iori-usage={cliId}
        ref={line}
        title={
          (name ? name + " " : "") +
          windows.map((window) => window.full).join("　")
        }
      >
        {name && <span>{name} </span>}
        {content}
        <span data-iori-usage-more hidden />
      </div>
    );
  return (
    <Tooltip open={open} onOpenChange={setOpen}>
      <TooltipTrigger asChild>
        <div
          className="team-usage team-usage-compact usage-line"
          ref={line}
          data-iori-usage={cliId}
          role="button"
          tabIndex={0}
          aria-label={
            (name ? name + " " : "") +
            windows.map((window) => window.full).join("　")
          }
          onClick={() => setOpen(true)}
          onKeyDown={(event) => {
            if (event.key === "Enter" || event.key === " ") {
              event.preventDefault();
              setOpen(true);
            }
          }}
        >
          {name && <span>{name} </span>}
          {content}
          <span data-iori-usage-more hidden />
        </div>
      </TooltipTrigger>
      <TooltipContent>
        <span>
          {(name ? name + " " : "") +
            windows.map((window) => window.full).join("　")}
        </span>
      </TooltipContent>
    </Tooltip>
  );
}
