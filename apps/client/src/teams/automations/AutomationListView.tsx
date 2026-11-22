import { CalendarClock, Clock } from "lucide-react";
import type { Automation, AutomationList } from "@iori/protocol";
import {
  AsyncState,
  type AsyncViewMode,
} from "../../components/AsyncState.tsx";
import { Badge } from "../../components/ui/badge.tsx";
import { useI18n } from "../context.tsx";
import { formatRunReason } from "./types.ts";

export function AutomationListView({
  data,
  listError,
  formatDate,
  onOpen,
  onRetry,
}: {
  data?: AutomationList;
  listError: boolean;
  formatDate: (at: number) => string;
  onOpen: (automation: Automation) => void;
  onRetry: () => void;
}) {
  const { t } = useI18n();

  const mode: AsyncViewMode = !data
    ? listError
      ? "error"
      : "loading"
    : data.automations.length === 0
      ? "empty"
      : "ready";

  return (
    <AsyncState
      mode={mode}
      t={t}
      emptyIcon={<CalendarClock className="size-4" aria-hidden="true" />}
      emptyTitle={t("No automations yet. Create one to schedule an agent.")}
      errorTitle={t("Could not load Automations. Retry.")}
      onRetry={onRetry}
    >
      <div className="divide-y divide-border-subtle border-y border-border">
        {data?.automations.map((automation) => (
          <div
            key={automation.id}
            className="transition-colors [@media(hover:hover)]:hover:bg-accent/40"
          >
            <button
              type="button"
              data-iori-automation-id={automation.id}
              onClick={() => onOpen(automation)}
              className="flex w-full cursor-pointer flex-col gap-1 px-2 py-3.5 text-left outline-none focus-visible:ring-2 focus-visible:ring-ring/40"
            >
              <div className="flex flex-wrap items-center gap-2">
                <strong className="font-heading text-sm font-semibold text-foreground">
                  {automation.name}
                </strong>
                <Badge
                  variant={automation.enabled ? "running" : "neutral"}
                  data-iori-automation-enabled={
                    automation.enabled ? "true" : "false"
                  }
                >
                  {t(automation.enabled ? "Enabled" : "Disabled")}
                </Badge>
              </div>

              <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-2xs tabular-nums text-muted-foreground">
                {automation.enabled && automation.nextAt !== undefined && (
                  <span
                    className="inline-flex items-center gap-1"
                    data-iori-automation-next
                  >
                    <Clock className="size-3 shrink-0" aria-hidden="true" />
                    {t("Next run")}: {formatDate(automation.nextAt)}
                  </span>
                )}
                {automation.lastRun && (
                  <span>
                    {t("Last run")}:{" "}
                    {formatDate(automation.lastRun.scheduledAt)}{" "}
                    {formatRunReason(automation.lastRun, t)}
                  </span>
                )}
              </div>
            </button>
          </div>
        ))}
      </div>
    </AsyncState>
  );
}
