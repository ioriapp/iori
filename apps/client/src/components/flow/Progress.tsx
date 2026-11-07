import {
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { Check, X } from "lucide-react";
import { Spinner } from "../ui/spinner.tsx";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "../ui/tabs.tsx";
import { rich } from "./Notice.tsx";
import "./flow.css";

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
    <ol className="host-steps">
      {items.map((item) => (
        <li key={item.label} data-state={item.state}>
          {item.state === "done" && (
            <Check className="ci-passed" aria-label={t("Done")} />
          )}
          {item.state === "current" && <Spinner aria-label={t("Running")} />}
          {item.state === "failed" && (
            <X className="ci-failed" aria-label={t("Failed")} />
          )}
          {(item.state === "next" || item.state === "stopped") && (
            <span className="host-step-dot" aria-hidden="true" />
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
      className="host-log"
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
      className="host-progress"
      data-iori-view="host-progress"
    >
      <TabsList variant="line" className="host-progress-tabs">
        <TabsTrigger
          data-iori-action="host-progress-steps"
          value="steps"
          id={`${id}-steps-tab`}
          aria-controls={`${id}-steps`}
        >
          {t("Progress")}
        </TabsTrigger>
        <TabsTrigger
          data-iori-action="host-progress-log"
          value="log"
          id={`${id}-log-tab`}
          aria-controls={`${id}-log`}
        >
          {t("Log")}
        </TabsTrigger>
      </TabsList>
      <TabsContent
        value="steps"
        id={`${id}-steps`}
        aria-labelledby={`${id}-steps-tab`}
        className="host-progress-steps"
      >
        <StepList items={items} names={names} t={t} />
        {children}
      </TabsContent>
      <TabsContent
        value="log"
        id={`${id}-log`}
        aria-labelledby={`${id}-log-tab`}
        className="host-progress-log"
      >
        <LogView lines={log} />
        {children}
      </TabsContent>
    </Tabs>
  );
}
