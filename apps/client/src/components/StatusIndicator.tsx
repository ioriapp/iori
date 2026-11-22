import type { HTMLAttributes } from "react";
import { Check } from "lucide-react";
import { cn } from "cn";
import { Badge } from "./ui/badge.tsx";
import type { AgentStatus } from "./StatusDot.tsx";

export type IndicatorStatus = AgentStatus | "running" | "idle" | "unresponsive";

const STATUS_META: Record<
  IndicatorStatus,
  {
    labelKey: string;
    dotClass: string;
    badgeVariant: "running" | "waiting" | "failed" | "neutral";
    pulse?: boolean;
    check?: boolean;
  }
> = {
  active: {
    labelKey: "Running",
    dotClass: "bg-status-running",
    badgeVariant: "running",
    pulse: true,
  },
  running: {
    labelKey: "Running",
    dotClass: "bg-status-running",
    badgeVariant: "running",
    pulse: true,
  },
  waiting: {
    labelKey: "Attention",
    dotClass: "bg-status-waiting",
    badgeVariant: "waiting",
  },
  idle: {
    labelKey: "Idle",
    dotClass: "bg-status-stopped",
    badgeVariant: "neutral",
  },
  done: {
    labelKey: "Done",
    dotClass: "bg-status-complete",
    badgeVariant: "neutral",
    check: true,
  },
  failed: {
    labelKey: "Failed",
    dotClass: "bg-status-failed",
    badgeVariant: "failed",
  },
  stopped: {
    labelKey: "Stopped",
    dotClass: "bg-status-stopped",
    badgeVariant: "neutral",
  },
  unresponsive: {
    labelKey: "Not responding",
    dotClass: "bg-status-failed",
    badgeVariant: "failed",
  },
};

export function StatusIndicator({
  status,
  animated = true,
  t,
  label,
  showTitle = true,
  className,
  ...props
}: HTMLAttributes<HTMLSpanElement> & {
  status: IndicatorStatus;
  animated?: boolean;
  t?: (key: string) => string;
  label?: string;
  showTitle?: boolean;
}) {
  const meta = STATUS_META[status];
  const resolvedLabel = label ?? (t ? t(meta.labelKey) : meta.labelKey);

  if (meta.check) {
    return (
      <span
        role="img"
        aria-label={resolvedLabel}
        title={showTitle ? resolvedLabel : undefined}
        data-status={status}
        data-animated="false"
        className={cn(
          "inline-flex size-3 shrink-0 items-center justify-center text-status-complete",
          className,
        )}
        {...props}
      >
        <Check className="size-3" strokeWidth={2.25} aria-hidden="true" />
      </span>
    );
  }

  return (
    <span
      role="img"
      aria-label={resolvedLabel}
      title={showTitle ? resolvedLabel : undefined}
      data-status={status}
      data-animated={animated && meta.pulse ? "true" : "false"}
      className={cn(
        "inline-block size-2 shrink-0 rounded-full",
        meta.dotClass,
        animated && meta.pulse && "status-dot-pulse",
        className,
      )}
      {...props}
    />
  );
}

export function StatusBadge({
  status,
  t,
  labelOverride,
  animated = true,
  className,
}: {
  status: IndicatorStatus;
  t?: (key: string) => string;
  labelOverride?: string;
  animated?: boolean;
  className?: string;
}) {
  const meta = STATUS_META[status];
  const resolvedLabel = labelOverride ?? (t ? t(meta.labelKey) : meta.labelKey);

  return (
    <Badge variant={meta.badgeVariant} className={className}>
      {meta.check ? (
        <Check
          className="size-3 shrink-0"
          strokeWidth={2.25}
          aria-hidden="true"
        />
      ) : (
        <span
          aria-hidden="true"
          className={cn(
            "inline-block size-1.5 shrink-0 rounded-full",
            meta.dotClass,
            animated && meta.pulse && "status-dot-pulse",
          )}
        />
      )}
      {resolvedLabel}
    </Badge>
  );
}
