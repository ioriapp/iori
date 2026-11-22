import { useEffect, useState } from "react";
import { Spinner } from "../components/ui/spinner.tsx";

const WAITING_DELAY_MS = 150;

/**
 * Subtle delayed loading indicator shown while a terminal tab waits for its
 * Host terminal summary to arrive, preventing blank surfaces without flicker.
 */
export function TerminalWaiting({ t }: { t: (key: string) => string }) {
  const [shown, setShown] = useState(false);

  useEffect(() => {
    const timer = window.setTimeout(() => setShown(true), WAITING_DELAY_MS);
    return () => window.clearTimeout(timer);
  }, []);

  if (!shown) {
    return (
      <div className="flex min-h-0 flex-1 bg-background" aria-busy="true" />
    );
  }

  return (
    <div
      role="status"
      aria-live="polite"
      className="flex min-h-0 flex-1 items-center justify-center gap-2 bg-background px-4 py-6 text-xs text-muted-foreground"
    >
      <Spinner
        role={undefined}
        aria-label={undefined}
        aria-hidden="true"
        className="size-3.5 text-muted-foreground"
      />
      <span>{t("Loading")}</span>
    </div>
  );
}
