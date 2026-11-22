import { History } from "lucide-react";
import type { AutomationRun } from "@iori/protocol";
import {
  AsyncState,
  type AsyncViewMode,
} from "../../components/AsyncState.tsx";
import { FlatSection } from "../../components/SectionLayout.tsx";
import { Button } from "../../components/ui/button.tsx";
import { native } from "../../native.ts";
import { useI18n } from "../context.tsx";
import { formatRunReason, type HistoryState } from "./types.ts";

export function AutomationHistorySection({
  historyState,
  receivedError,
  formatDate,
  onRetryHistory,
  onShowReceived,
  onOpenTerminal,
}: {
  historyState: HistoryState;
  receivedError?: string;
  formatDate: (at: number) => string;
  onRetryHistory: () => void;
  onShowReceived: (id: string) => void;
  onOpenTerminal: (terminalId: string) => void;
}) {
  const { t, language } = useI18n();
  const { status, runs } = historyState;

  // Keep visible runs during refresh or refresh failure; use 4-state AsyncState otherwise.
  const mode: AsyncViewMode =
    runs.length > 0
      ? "ready"
      : status === "loading" || status === "idle"
        ? "loading"
        : status === "error"
          ? "error"
          : "empty";

  const refreshFailed = status === "error" && runs.length > 0;

  return (
    <FlatSection
      title={t("History")}
      bodyClassName="border-t-0 divide-y-0"
      data-iori-view="automation-history"
    >
      {refreshFailed && (
        <div
          role="alert"
          className="mb-3 flex flex-wrap items-center justify-between gap-2 rounded-md border border-status-failed-border bg-status-failed-bg/45 px-3 py-2 text-xs text-status-failed-text"
        >
          <span>{t(historyState.message)}</span>
          <Button
            type="button"
            variant="outline"
            size="xs"
            onClick={onRetryHistory}
          >
            {t("Retry")}
          </Button>
        </div>
      )}

      <AsyncState
        mode={mode}
        t={t}
        compact
        emptyIcon={<History className="size-4" aria-hidden="true" />}
        emptyTitle={t("Not run yet.")}
        errorTitle={t(
          status === "error"
            ? historyState.message
            : "Could not load automation history. Retry.",
        )}
        onRetry={onRetryHistory}
      >
        <div className="divide-y divide-border-subtle border-y border-border">
          {runs.map((value: AutomationRun) => {
            const reasonText = formatRunReason(value, t);
            return (
              <div
                key={value.id}
                data-iori-automation-run={value.id}
                className="flex flex-col gap-2 py-3.5"
              >
                <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs tabular-nums text-muted-foreground">
                  <span className="font-medium text-foreground">
                    {t(
                      value.trigger === "manual"
                        ? "Run now"
                        : value.trigger === "webhook"
                          ? "Webhook"
                          : value.trigger === "issue"
                            ? "Issue"
                            : "Scheduled",
                    )}
                    : {formatDate(value.scheduledAt)}
                  </span>
                  {value.trigger === "webhook" && value.from && (
                    <span>
                      {t("From")}: {value.from}
                    </span>
                  )}
                  {value.trigger === "issue" && value.issue && (
                    <span>
                      #{value.issue.number} {value.issue.title}
                    </span>
                  )}
                  {value.startedAt !== undefined && (
                    <span>
                      {t("Started")}: {formatDate(value.startedAt)}
                    </span>
                  )}
                </div>

                {reasonText && (
                  <p
                    className="m-0 text-xs text-muted-foreground"
                    data-iori-automation-reason={value.reason ?? "launch"}
                  >
                    {reasonText}
                  </p>
                )}

                {(value.trigger === "issue" && value.issue) ||
                value.trigger === "webhook" ||
                value.terminalId ? (
                  <div className="flex flex-wrap items-center gap-2">
                    {value.trigger === "issue" && value.issue && (
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        data-iori-action="automation-issue-open"
                        onClick={() => void native.openUrl(value.issue!.url)}
                      >
                        {language.startsWith("ja")
                          ? "ブラウザーで開く"
                          : "Open in browser"}
                      </Button>
                    )}
                    {value.trigger === "webhook" && (
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        data-iori-action="automation-received"
                        onClick={() => onShowReceived(value.id)}
                      >
                        {t("Received content")}
                      </Button>
                    )}
                    {value.terminalId && (
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        data-iori-action="automation-conversation"
                        data-iori-terminal-id={value.terminalId}
                        onClick={() => onOpenTerminal(value.terminalId!)}
                      >
                        {t("Open conversation")}
                      </Button>
                    )}
                  </div>
                ) : null}

                {receivedError === value.id && (
                  <div
                    role="alert"
                    className="flex flex-wrap items-center gap-2 rounded-md border border-status-failed-border bg-status-failed-bg/45 px-3 py-2 text-xs text-status-failed-text"
                  >
                    <span>
                      {t("The Host could not complete this operation. Retry.")}
                    </span>
                    <Button
                      type="button"
                      variant="outline"
                      size="xs"
                      onClick={() => onShowReceived(value.id)}
                    >
                      {t("Retry")}
                    </Button>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </AsyncState>
    </FlatSection>
  );
}
