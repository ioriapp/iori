import {
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { cn } from "cn";
import { Check, X } from "lucide-react";
import { Spinner } from "../ui/spinner.tsx";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "../ui/tabs.tsx";
import { rich } from "./Notice.tsx";

export type StepState = "done" | "current" | "stopped" | "failed" | "next";
export type Step = { label: string; state: StepState };

export function steps(
  labels: string[],
  current: number,
  at: "current" | "stopped" | "failed" = "current",
): Step[] {
  return labels.map((label, index) => ({
    label,
    state: index < current ? "done" : index === current ? at : "next",
  }));
}

export function StepList({
  items,
  names,
  t,
}: {
  items: Step[];
  names?: readonly string[];
  t: (key: string) => string;
}) {
  return (
    <ol className="m-0 grid list-none gap-2.5 py-1">
      {items.map((item) => (
        <li
          key={item.label}
          data-state={item.state}
          className={cn(
            "flex items-center gap-2.5 text-sm",
            item.state === "next" && "text-muted-foreground",
            (item.state === "current" || item.state === "stopped") &&
              "font-semibold text-foreground",
          )}
        >
          {item.state === "done" && (
            <Check
              className="size-4 shrink-0 text-status-complete"
              aria-label={t("Done")}
            />
          )}
          {item.state === "current" && (
            <Spinner
              className="size-4 shrink-0 text-muted-foreground"
              aria-label={t("Running")}
            />
          )}
          {item.state === "failed" && (
            <X
              className="size-4 shrink-0 text-status-failed"
              aria-label={t("Failed")}
            />
          )}
          {(item.state === "next" || item.state === "stopped") && (
            <span
              className="grid size-4 shrink-0 place-items-center"
              aria-hidden="true"
            >
              <span className="size-1.5 rounded-full bg-border" />
            </span>
          )}
          <span>{rich(item.label, names)}</span>
        </li>
      ))}
    </ol>
  );
}

export function LogView({ lines }: { lines: string[] }) {
  const box = useRef<HTMLPreElement>(null);
  const follow = useRef(true);
  useLayoutEffect(() => {
    if (follow.current && box.current)
      box.current.scrollTop = box.current.scrollHeight;
  }, [lines]);
  return (
    <pre
      className="m-0 h-full overflow-auto rounded-md border border-border-subtle bg-muted/35 px-3 py-2 font-mono text-xs leading-relaxed whitespace-pre-wrap [overflow-wrap:anywhere] text-foreground [font-variant-ligatures:none]"
      ref={box}
      onScroll={(event) => {
        const element = event.currentTarget;
        follow.current =
          element.scrollTop + element.clientHeight >= element.scrollHeight - 4;
      }}
    >
      {lines.join("\n")}
    </pre>
  );
}

export function Progress({
  items,
  log,
  initialView = "steps",
  children,
  names,
  t,
}: {
  items: Step[];
  log: string[];
  initialView?: "steps" | "log";
  children?: ReactNode;
  names?: readonly string[];
  t: (key: string) => string;
}) {
  const [view, setView] = useState(initialView);
  const id = useId();
  return (
    <Tabs
      value={view}
      onValueChange={(value) => setView(value as "steps" | "log")}
      className="grid h-full min-h-0 grid-rows-[auto_minmax(0,1fr)] gap-2.5"
      data-iori-view="host-progress"
    >
      <TabsList variant="line" className="w-full justify-start max-md:h-11">
        <TabsTrigger
          data-iori-action="host-progress-steps"
          value="steps"
          id={`${id}-steps-tab`}
          aria-controls={`${id}-steps`}
          className="flex-none px-2.5 text-sm max-md:min-h-11"
        >
          {t("Progress")}
        </TabsTrigger>
        <TabsTrigger
          data-iori-action="host-progress-log"
          value="log"
          id={`${id}-log-tab`}
          aria-controls={`${id}-log`}
          className="flex-none px-2.5 text-sm max-md:min-h-11"
        >
          {t("Log")}
        </TabsTrigger>
      </TabsList>
      <TabsContent
        value="steps"
        id={`${id}-steps`}
        aria-labelledby={`${id}-steps-tab`}
        className="m-0 grid content-start gap-2.5 text-sm data-[state=inactive]:hidden"
      >
        <StepList items={items} names={names} t={t} />
        {children}
      </TabsContent>
      <TabsContent
        value="log"
        id={`${id}-log`}
        aria-labelledby={`${id}-log-tab`}
        className="m-0 grid min-h-0 grid-rows-[minmax(0,1fr)_auto] gap-2.5 text-sm data-[state=inactive]:hidden"
      >
        <LogView lines={log} />
        {children}
      </TabsContent>
    </Tabs>
  );
}
