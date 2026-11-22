import { useEffect, useState, type ReactNode } from "react";
import { cn } from "cn";

/**
 * Subtle delayed loading skeleton for reading lists and surfaces (ui.md「内容の状態」).
 * Fast responses never flicker; slower reads show shape without a retry button.
 */
export function ReadingLoading({
  label,
  rows = 5,
  delayMs = 150,
  compact = false,
  className,
}: {
  label: string;
  rows?: number;
  delayMs?: number;
  compact?: boolean;
  className?: string;
}) {
  const [shown, setShown] = useState(delayMs <= 0);
  useEffect(() => {
    if (delayMs <= 0) {
      setShown(true);
      return;
    }
    const timer = window.setTimeout(() => setShown(true), delayMs);
    return () => window.clearTimeout(timer);
  }, [delayMs]);

  if (!shown) return null;
  return (
    <div
      role="status"
      aria-live="polite"
      className={cn(
        "flex flex-col bg-background",
        compact ? "px-3 py-2.5" : "min-h-0 flex-1 px-4 py-4",
        className,
      )}
    >
      <span className="mb-2 text-xs font-medium text-muted-foreground">
        {label}
      </span>
      <div className="flex flex-col divide-y divide-border-subtle border-t border-border-subtle">
        {Array.from({ length: rows }).map((_, index) => (
          <div
            key={index}
            className={cn(
              "flex items-center gap-2.5",
              compact ? "py-2" : "py-2.5",
            )}
          >
            <span
              className="skeleton-shimmer h-3 rounded-xs bg-muted"
              style={{ width: `${Math.max(28, 76 - index * 9)}%` }}
            />
          </div>
        ))}
      </div>
    </div>
  );
}

/** Flat centered empty state for reading lists and details. */
export function ReadingEmpty({
  title,
  description,
  icon,
  state,
  compact = false,
  className,
}: {
  title: string;
  description?: string;
  icon?: ReactNode;
  state?: string;
  compact?: boolean;
  className?: string;
}) {
  return (
    <div
      data-iori-state={state}
      className={cn(
        "flex min-h-0 flex-1 flex-col items-center justify-center text-center",
        compact ? "gap-1.5 px-4 py-6" : "gap-2 px-6 py-8",
        className,
      )}
    >
      {icon && (
        <div className="flex size-8 items-center justify-center rounded-md border border-border-subtle bg-muted text-muted-foreground">
          {icon}
        </div>
      )}
      <p className="m-0 text-sm text-muted-foreground">{title}</p>
      {description && (
        <p className="m-0 text-xs text-muted-foreground">{description}</p>
      )}
    </div>
  );
}
