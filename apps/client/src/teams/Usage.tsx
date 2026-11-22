import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { usageAppliesToModel, type CliUsage } from "@iori/protocol";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "../components/ui/tooltip.tsx";
import { formatUsage } from "../usage-format.ts";
import { useUsagePreferences } from "../usage/preferences.tsx";

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

  const fullText =
    (name ? `${name} ` : "") + windows.map((window) => window.full).join("　");
  const content = windows.map((window, index) => (
    <span
      key={index}
      data-iori-usage-window
      className="ms-0 [&[hidden]]:hidden"
    >
      {index > 0 && "　"}
      <span className="group-data-[short]/usage-line:hidden">
        {window.full}
      </span>
      <span className="hidden group-data-[short]/usage-line:inline">
        {window.short}
      </span>
    </span>
  ));

  if (!compact)
    return (
      <div
        className="group/usage-line team-usage block min-w-0 overflow-hidden whitespace-nowrap text-2xs leading-[1.125rem] tabular-nums text-muted-foreground"
        data-iori-usage={cliId}
        ref={line}
        title={fullText}
      >
        {name && <span>{name} </span>}
        {content}
        <span data-iori-usage-more hidden className="ms-3 [&[hidden]]:hidden" />
      </div>
    );

  return (
    <Tooltip open={open} onOpenChange={setOpen}>
      <TooltipTrigger asChild>
        <div
          className="group/usage-line team-usage block min-w-0 cursor-pointer overflow-hidden whitespace-nowrap text-2xs leading-[1.125rem] tabular-nums text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring"
          ref={line}
          data-iori-usage={cliId}
          role="button"
          tabIndex={0}
          aria-label={fullText}
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
          <span
            data-iori-usage-more
            hidden
            className="ms-3 [&[hidden]]:hidden"
          />
        </div>
      </TooltipTrigger>
      <TooltipContent>
        <span>{fullText}</span>
      </TooltipContent>
    </Tooltip>
  );
}
