import type { ReactNode } from "react";
import { CircleAlert } from "lucide-react";
import { Button } from "../components/ui/button.tsx";

/**
 * A failed read of Files or Git and the way to read again (ui.md「読めな
 * かった時の見た目」): red is only the mark, the reason keeps the foreground
 * color, and the retry is an outlined button.
 */
export function ReadingError({
  children,
  retryLabel,
  action,
  onRetry,
}: {
  children: ReactNode;
  retryLabel: string;
  /** The retry's data-iori-action, where tests press it. */
  action?: string;
  onRetry: () => void;
}) {
  return (
    <div className="reading-error" role="alert">
      <CircleAlert
        className="reading-error-mark"
        size={14}
        aria-hidden="true"
      />
      <span className="reading-error-text">{children}</span>
      <Button
        variant="outline"
        size="sm"
        data-iori-action={action}
        onClick={onRetry}
      >
        {retryLabel}
      </Button>
    </div>
  );
}
