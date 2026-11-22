import { useEffect, useState } from "react";
import { ChevronDown, ChevronRight } from "lucide-react";
import type { TaskHistoryData } from "@iori/protocol";
import { connection } from "../connection.ts";
import { Button } from "../components/ui/button.tsx";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "../components/ui/collapsible.tsx";
import { difficultyKey, timeOf } from "./board-i18n.ts";

export type OpenTeamTerminal = (id: string) => void;

function HistoryBody({
  body,
  t,
}: {
  body: string;
  t: (key: string) => string;
}) {
  const [open, setOpen] = useState(false);
  const lines = body.split("\n");
  return (
    <div className="mt-1 space-y-1 text-xs text-muted-foreground">
      <p className="whitespace-pre-wrap [overflow-wrap:anywhere]">
        {lines.slice(0, 3).join("\n")}
      </p>
      {lines.length > 3 && (
        <Collapsible open={open} onOpenChange={setOpen}>
          <CollapsibleTrigger className="inline-flex cursor-pointer items-center gap-1 rounded-xs text-xs text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40">
            {open ? (
              <ChevronDown className="size-3" aria-hidden="true" />
            ) : (
              <ChevronRight className="size-3" aria-hidden="true" />
            )}
            {t("Show all")}
          </CollapsibleTrigger>
          <CollapsibleContent>
            <p className="mt-1 whitespace-pre-wrap [overflow-wrap:anywhere]">
              {lines.slice(3).join("\n")}
            </p>
          </CollapsibleContent>
        </Collapsible>
      )}
    </div>
  );
}

export function TaskHistory({
  host,
  task,
  t,
  language,
  onOpenTerminal,
}: {
  host: string;
  task: string;
  t: (key: string) => string;
  language: string;
  onOpenTerminal: OpenTeamTerminal;
}) {
  const [data, setData] = useState<TaskHistoryData>();
  const [failed, setFailed] = useState(false);
  const [retry, setRetry] = useState(0);

  useEffect(() => {
    let active = true;
    setData(undefined);
    setFailed(false);
    void connection
      .requestHost(host, "teams.task.history", { taskId: task })
      .then((result) => {
        if (!active) return;
        if (result?.ok) {
          setData(result.result);
          setFailed(false);
        } else {
          setFailed(true);
        }
      })
      .catch(() => {
        if (active) setFailed(true);
      });
    return () => {
      active = false;
    };
  }, [host, task, retry]);

  return (
    <div data-iori-view="task-history" className="min-w-0">
      {failed && (
        <div
          role="alert"
          className="mb-3 flex flex-wrap items-center justify-between gap-2 rounded-md border border-status-failed-border bg-status-failed-bg/35 px-3 py-2 text-xs text-foreground"
        >
          <span>{t("Could not load history")}</span>
          <Button
            type="button"
            size="sm"
            variant="outline"
            onClick={() => setRetry((value) => value + 1)}
          >
            {t("Retry")}
          </Button>
        </div>
      )}
      {data && data.events.length > 0 && (
        <ol className="my-3 list-none border-l border-border pl-3.5">
          {data.events.map((event, index) => (
            <li
              key={`${event.at}-${index}`}
              className="relative mb-3.5 text-xs leading-relaxed last:mb-0"
            >
              <span
                aria-hidden="true"
                className="absolute top-2 -left-[1.0625rem] size-1.5 rounded-full bg-muted-foreground"
              />
              <p className="text-muted-foreground [overflow-wrap:anywhere]">
                <strong className="font-medium text-foreground">
                  {t(event.kind)}
                </strong>{" "}
                <time className="tabular-nums">
                  {timeOf(event.at, language)}
                </time>
                {event.role && ` · ${event.role}`}
                {event.candidate &&
                  ` · ${event.candidate.cli} ${event.candidate.model ?? ""}${event.candidate.effort ? ` · ${event.candidate.effort}` : ""}`}
                {event.difficulty &&
                  ` · ${t("Difficulty {difficulty}").replace(
                    "{difficulty}",
                    t(difficultyKey(event.difficulty)),
                  )}`}
              </p>
              {event.body && <HistoryBody body={event.body} t={t} />}
            </li>
          ))}
        </ol>
      )}
      {(data?.childTerminalId || data?.parentTerminalId) && (
        <div className="mt-3 flex flex-wrap gap-2">
          {data.childTerminalId && (
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={() => onOpenTerminal(data.childTerminalId!)}
            >
              {t("Open final screen")}
            </Button>
          )}
          {data.parentTerminalId && (
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={() => onOpenTerminal(data.parentTerminalId!)}
            >
              {t("Open orchestrator conversation")}
            </Button>
          )}
        </div>
      )}
    </div>
  );
}
