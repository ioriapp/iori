import type { HTMLAttributes } from "react";
import { Check } from "lucide-react";
import { cn } from "cn";

export type AgentStatus = "active" | "waiting" | "stopped" | "done" | "failed";

const labels: Record<AgentStatus, string> = {
  active: "Running",
  waiting: "Attention",
  stopped: "Stopped",
  done: "Done",
  failed: "Failed",
};

const dotClasses: Record<Exclude<AgentStatus, "done">, string> = {
  active: "bg-status-running",
  waiting: "bg-status-waiting",
  failed: "bg-status-failed",
  stopped: "bg-status-stopped",
};

export function StatusDot({
  state,
  animated = true,
  t,
  label,
  className,
  "aria-label": ariaLabel,
  ...props
}: HTMLAttributes<HTMLSpanElement> & {
  state: AgentStatus;
  animated?: boolean;
  t?: (key: string) => string;
  label?: string;
}) {
  const resolvedLabel =
    label ?? ariaLabel ?? (t ? t(labels[state]) : labels[state]);

  if (state === "done") {
    return (
      <span
        role="img"
        aria-label={resolvedLabel}
        {...props}
        data-status={state}
        data-animated={animated ? "true" : "false"}
        className={cn(
          "state-dot state-done inline-flex size-3 shrink-0 items-center justify-center align-middle text-status-complete",
          className,
        )}
      >
        <Check aria-hidden="true" className="block size-3" strokeWidth={2.25} />
      </span>
    );
  }

  return (
    <span
      role="img"
      aria-label={resolvedLabel}
      {...props}
      data-status={state}
      data-animated={animated ? "true" : "false"}
      className={cn(
        "state-dot inline-flex size-1.5 shrink-0 items-center justify-center rounded-full align-middle",
        `state-${state}`,
        dotClasses[state],
        state === "active" && animated && "status-dot-pulse",
        className,
      )}
    />
  );
}
