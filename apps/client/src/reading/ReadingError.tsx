import type { ReactNode } from "react";
import { CircleAlert } from "lucide-react";
import { cn } from "cn";
import { Button } from "../components/ui/button.tsx";

/**
 * A failed read of Files or Git and the way to read again (ui.md「内容の状態」):
 * red marks the failure, the reason stays readable, and retry is an outlined button.
 */
export function ReadingError({
  children,
  retryLabel,
  action,
  onRetry,
  centered = false,
}: {
  children: ReactNode;
  retryLabel: string;
  /** The retry's data-iori-action, where tests press it. */
  action?: string;
  onRetry: () => void;
  /** No content has been read yet; use the same placement as an empty surface. */
  centered?: boolean;
}) {
  return (
    <div
      className={cn(
        "peer/error text-xs text-foreground",
        centered
          ? "flex min-h-0 flex-1 flex-col items-center justify-center p-6 text-center"
          : "flex flex-none flex-wrap items-center gap-x-2.5 gap-y-1.5 border-b border-status-failed-border bg-status-failed-bg/35 px-3 py-1.5",
      )}
      data-centered={centered || undefined}
      role="alert"
    >
      {centered ? (
        <div className="flex max-w-md flex-col items-center gap-3 rounded-md border border-status-failed-border bg-status-failed-bg/35 px-5 py-5">
          <div className="flex size-8 items-center justify-center rounded-md border border-status-failed-border bg-status-failed-bg text-status-failed-text">
            <CircleAlert className="size-4" aria-hidden="true" />
          </div>
          <span className="min-w-0 text-sm text-foreground [overflow-wrap:anywhere]">
            {children}
          </span>
          <Button
            variant="outline"
            size="sm"
            className="[@media(pointer:coarse)]:min-h-11"
            data-iori-action={action}
            onClick={onRetry}
          >
            {retryLabel}
          </Button>
        </div>
      ) : (
        <>
          <CircleAlert
            className="size-3.5 flex-none text-status-failed-text"
            aria-hidden="true"
          />
          <span className="min-w-0 [overflow-wrap:anywhere]">{children}</span>
          <Button
            variant="outline"
            size="sm"
            className="[@media(pointer:coarse)]:min-h-11"
            data-iori-action={action}
            onClick={onRetry}
          >
            {retryLabel}
          </Button>
        </>
      )}
    </div>
  );
}
