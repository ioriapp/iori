import * as React from "react";
import { AlertCircle, Inbox, RotateCcw } from "lucide-react";
import { cn } from "cn";
import { Button } from "./ui/button.tsx";

export type AsyncViewMode = "loading" | "empty" | "error" | "ready";

export interface AsyncStateProps {
  mode: AsyncViewMode;
  t?: (key: string) => string;
  loadingLabel?: string;
  /** Delay before showing the loading skeleton to avoid flicker on fast responses. */
  loadingDelayMs?: number;
  skeletonRows?: number;
  emptyIcon?: React.ReactNode;
  emptyTitle: string;
  emptyDescription?: string;
  emptyActionLabel?: string;
  onEmptyAction?: () => void;
  errorTitle: string;
  errorReason?: string;
  retryLabel?: string;
  onRetry?: () => void;
  compact?: boolean;
  className?: string;
  children: React.ReactNode;
}

export function AsyncState({
  mode,
  t,
  loadingLabel,
  loadingDelayMs = 150,
  skeletonRows = 3,
  emptyIcon,
  emptyTitle,
  emptyDescription,
  emptyActionLabel,
  onEmptyAction,
  errorTitle,
  errorReason,
  retryLabel,
  onRetry,
  compact = false,
  className,
  children,
}: AsyncStateProps) {
  const [showLoading, setShowLoading] = React.useState(
    mode === "loading" && loadingDelayMs <= 0,
  );

  React.useEffect(() => {
    if (mode !== "loading") {
      setShowLoading(false);
      return;
    }
    if (loadingDelayMs <= 0) {
      setShowLoading(true);
      return;
    }
    const timer = window.setTimeout(() => {
      setShowLoading(true);
    }, loadingDelayMs);
    return () => window.clearTimeout(timer);
  }, [mode, loadingDelayMs]);

  const resolvedLoadingLabel = loadingLabel ?? (t ? t("Loading") : "Loading");
  const resolvedRetryLabel = retryLabel ?? (t ? t("Retry") : "Retry");

  if (mode === "loading") {
    if (!showLoading) return null;
    return (
      <div
        role="status"
        aria-live="polite"
        className={cn(
          "flex flex-col border-y border-border bg-background",
          compact ? "px-3.5 py-3" : "px-4 py-4",
          className,
        )}
      >
        <div className="mb-2.5 flex items-center justify-between">
          <span className="text-xs font-medium text-muted-foreground">
            {resolvedLoadingLabel}
          </span>
          <span className="skeleton-shimmer h-2.5 w-16 rounded-sm bg-muted" />
        </div>
        <div className="flex flex-col divide-y divide-border-subtle border-t border-border-subtle">
          {Array.from({ length: skeletonRows }).map((_, idx) => (
            <div key={idx} className="flex items-center gap-3 py-3">
              <span className="skeleton-shimmer size-2 shrink-0 rounded-full bg-muted" />
              <div className="flex min-w-0 flex-1 flex-col gap-1.5">
                <span
                  className="skeleton-shimmer h-3 rounded-xs bg-muted"
                  style={{ width: `${Math.max(24, 72 - idx * 11)}%` }}
                />
                <span
                  className="skeleton-shimmer h-2.5 rounded-xs bg-muted/80"
                  style={{ width: `${Math.max(20, 48 - idx * 6)}%` }}
                />
              </div>
              <span className="skeleton-shimmer h-5 w-14 shrink-0 rounded-sm bg-muted" />
            </div>
          ))}
        </div>
      </div>
    );
  }

  if (mode === "empty") {
    return (
      <div
        className={cn(
          "flex flex-col items-center justify-center border-y border-border bg-background text-center",
          compact ? "gap-2.5 px-4 py-7" : "gap-3 px-6 py-10",
          className,
        )}
      >
        <div className="flex size-9 items-center justify-center rounded-md border border-border-subtle bg-muted text-muted-foreground">
          {emptyIcon ?? <Inbox className="size-4" aria-hidden="true" />}
        </div>
        <div className="flex max-w-sm flex-col gap-1">
          <p className="text-sm font-medium text-foreground">{emptyTitle}</p>
          {emptyDescription && (
            <p className="text-xs text-muted-foreground">{emptyDescription}</p>
          )}
        </div>
        {emptyActionLabel && onEmptyAction && (
          <Button
            type="button"
            variant="default"
            size="sm"
            onClick={onEmptyAction}
            className="mt-1"
          >
            {emptyActionLabel}
          </Button>
        )}
      </div>
    );
  }

  if (mode === "error") {
    return (
      <div
        role="alert"
        className={cn(
          "flex flex-col items-center justify-center rounded-md border border-status-failed-border bg-status-failed-bg/35 text-center",
          compact ? "gap-2.5 px-4 py-6" : "gap-3 px-6 py-9",
          className,
        )}
      >
        <div className="flex size-9 items-center justify-center rounded-md border border-status-failed-border bg-status-failed-bg text-status-failed-text">
          <AlertCircle className="size-4" aria-hidden="true" />
        </div>
        <div className="flex min-w-0 max-w-md flex-col gap-1">
          <p className="text-sm font-medium text-foreground">{errorTitle}</p>
          {errorReason && (
            <p className="break-words [overflow-wrap:anywhere] text-xs text-muted-foreground">
              {errorReason}
            </p>
          )}
        </div>
        {onRetry && (
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={onRetry}
            className="mt-1"
          >
            <RotateCcw className="size-3.5" aria-hidden="true" />
            {resolvedRetryLabel}
          </Button>
        )}
      </div>
    );
  }

  return <>{children}</>;
}
