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
import { timeOf } from "./board-i18n.ts";
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
    <div className="history-body">
      <p>{lines.slice(0, 3).join("\n")}</p>
      {lines.length > 3 && (
        <Collapsible open={open} onOpenChange={setOpen}>
          <CollapsibleTrigger className="history-summary">
            {open ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
            {t("Show all")}
          </CollapsibleTrigger>
          <CollapsibleContent>
            <p>{lines.slice(3).join("\n")}</p>
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
    void connection
      .requestHost(host, "teams.task.history", { taskId: task })
      .then((result) => {
        if (!active) return;
        if (result?.ok) {
          setData(result.result);
          setFailed(false);
        } else setFailed(true);
      })
      .catch(() => {
        if (active) setFailed(true);
      });
    return () => {
      active = false;
    };
  }, [host, task, retry]);
  return (
    <div data-iori-view="task-history">
      {failed && (
        <p role="alert">
          {t("Could not load history")}{" "}
          <Button
            size="sm"
            variant="outline"
            onClick={() => setRetry((value) => value + 1)}
          >
            {t("Retry")}
          </Button>
        </p>
      )}
      <ol className="task-timeline">
        {data?.events.map((event, index) => (
          <li key={`${event.at}-${index}`}>
            <p>
              <strong>{event.kind}</strong>{" "}
              <time>{timeOf(event.at, language)}</time>
              {event.role && ` · ${event.role}`}
              {event.candidate &&
                ` · ${event.candidate.cli} ${event.candidate.model ?? ""}${event.candidate.effort ? ` · ${event.candidate.effort}` : ""}`}
              {event.difficulty &&
                ` · Difficulty ${event.difficulty[0]!.toUpperCase() + event.difficulty.slice(1)}`}
            </p>
            {event.body && <HistoryBody body={event.body} t={t} />}
          </li>
        ))}
      </ol>
      <div className="history-links">
        {data?.childTerminalId && (
          <Button
            size="sm"
            variant="outline"
            onClick={() => onOpenTerminal(data.childTerminalId!)}
          >
            {t("Open final screen")}
          </Button>
        )}
        {data?.parentTerminalId && (
          <Button
            size="sm"
            variant="outline"
            onClick={() => onOpenTerminal(data.parentTerminalId!)}
          >
            {t("Open parent conversation")}
          </Button>
        )}
      </div>
    </div>
  );
}
