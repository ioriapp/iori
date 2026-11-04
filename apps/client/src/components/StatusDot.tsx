import type { HTMLAttributes } from "react";
import { Check } from "lucide-react";
import "./status-dot.css";

export type AgentStatus = "active" | "waiting" | "stopped" | "done" | "failed";
const labels: Record<AgentStatus, string> = {
  active: "Running",
  waiting: "Attention",
  stopped: "Stopped",
  done: "Done",
  failed: "Failed",
};

export function StatusDot({
  state,
  animated = true,
  className = "",
  ...props
}: HTMLAttributes<HTMLSpanElement> & {
  state: AgentStatus;
  animated?: boolean;
}) {
  return (
    <span
      role="img"
      aria-label={labels[state]}
      {...props}
      data-status={state}
      data-animated={animated ? "true" : "false"}
      className={`state-dot state-${state} ${className}`}
    >
      {state === "done" && (
        <Check aria-hidden="true" size={11} strokeWidth={2.25} />
      )}
    </span>
  );
}
