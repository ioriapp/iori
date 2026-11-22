import { Fragment } from "react";
import { ArrowLeft } from "lucide-react";
import {
  candidateKey,
  taskWorkTime,
  type CandidateSummary,
  type RecordsData,
} from "@iori/protocol";
import { FlatPageHeader } from "../../components/SectionLayout.tsx";
import { Badge } from "../../components/ui/badge.tsx";
import { Button } from "../../components/ui/button.tsx";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "../../components/ui/collapsible.tsx";
import { ChangeAmount } from "../ChangeAmount.tsx";
import { TaskHistory, type OpenTeamTerminal } from "../TaskHistory.tsx";
import {
  compactNumber,
  difficultyKey,
  elapsedTime,
  recordMeasurement,
} from "../board-i18n.ts";

export function RecordDetail({
  host,
  selected,
  tasks,
  expanded,
  onExpandedChange,
  onClose,
  onOpenTerminal,
  t,
  language,
}: {
  host: string;
  selected: CandidateSummary;
  tasks: RecordsData["tasks"];
  expanded: string | undefined;
  onExpandedChange: (taskId: string | undefined) => void;
  onClose: () => void;
  onOpenTerminal: OpenTeamTerminal;
  t: (key: string) => string;
  language: string;
}) {
  const measured = (value: string | undefined, count: number, total: number) =>
    recordMeasurement(value, count, total, language);

  return (
    <aside
      data-iori-view="record-task-list"
      className="w-full shrink-0 border-border bg-background p-4 md:min-h-0 md:w-92 md:overflow-y-auto md:border-l [scrollbar-gutter:stable]"
    >
      <FlatPageHeader
        className="pb-3.5"
        back={
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            className="text-muted-foreground hover:text-foreground [@media(pointer:coarse)]:min-h-11 [@media(pointer:coarse)]:min-w-11"
            aria-label={t("Back")}
            onClick={onClose}
          >
            <ArrowLeft className="size-4" aria-hidden="true" />
          </Button>
        }
        title={
          <>
            {selected.role} ·{" "}
            {selected.candidate.cliName ?? selected.candidate.cli}
          </>
        }
        description={
          [selected.candidate.model, selected.candidate.effort]
            .filter(Boolean)
            .join(" · ") || undefined
        }
      />
      <div className="divide-y divide-border-subtle">
        {tasks
          .filter((task) => selected.taskIds.includes(task.id))
          .sort((a, b) => b.createdAt - a.createdAt)
          .map((task) => {
            const tokens = task.agents.filter((agent) => agent.tokens);
            const workTime = taskWorkTime(task);
            const metrics = [
              ...(workTime !== undefined ? [elapsedTime(workTime)] : []),
              ...(task.changes
                ? [
                    <ChangeAmount
                      key="changes"
                      changes={task.changes}
                      language={language}
                    />,
                  ]
                : []),
              ...(tokens.length > 0
                ? [
                    measured(
                      t("{count} tokens").replace(
                        "{count}",
                        compactNumber(
                          tokens.reduce(
                            (sum, agent) =>
                              sum + agent.tokens!.input + agent.tokens!.output,
                            0,
                          ),
                        ),
                      ),
                      tokens.length,
                      task.agents.length,
                    ),
                  ]
                : []),
            ];
            const handoff =
              task.agents[0]?.candidate &&
              candidateKey(task.agents[0].role, task.agents[0].candidate) !==
                selected.key;
            const decisionLabel = t(
              task.decision
                ? task.decision === "accept"
                  ? "Accepted"
                  : "Rejected"
                : "Pending",
            );
            const decisionVariant =
              task.decision === "accept"
                ? "running"
                : task.decision === "reject"
                  ? "failed"
                  : "waiting";

            return (
              <Collapsible
                asChild
                key={task.id}
                open={expanded === task.id}
                onOpenChange={(open) =>
                  onExpandedChange(open ? task.id : undefined)
                }
              >
                <article className="py-3.5">
                  <CollapsibleTrigger asChild>
                    <button
                      type="button"
                      className="group flex w-full cursor-pointer flex-col gap-1.5 rounded-xs text-left text-xs focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40"
                      data-iori-record-task={task.id}
                      aria-expanded={expanded === task.id}
                    >
                      <time className="text-2xs tabular-nums text-muted-foreground">
                        {new Date(task.createdAt).toLocaleDateString(language)}
                      </time>
                      <strong className="text-sm font-medium text-foreground group-hover:underline group-hover:underline-offset-3 [overflow-wrap:anywhere]">
                        {task.title}
                        {handoff && (
                          <Badge
                            variant="secondary"
                            className="ml-2 align-middle font-normal"
                          >
                            {t("Handoff")}
                          </Badge>
                        )}
                      </strong>
                      <small className="text-2xs text-muted-foreground">
                        {task.team} ·{" "}
                        {t("Version {version}").replace(
                          "{version}",
                          String(task.version),
                        )}{" "}
                        ·{" "}
                        {t("Difficulty {difficulty}").replace(
                          "{difficulty}",
                          t(difficultyKey(task.difficulty)),
                        )}{" "}
                        ·{" "}
                        {t("Revisions {count}").replace(
                          "{count}",
                          String(task.revisions),
                        )}
                      </small>
                      <span className="flex flex-wrap items-center gap-1.5 leading-relaxed text-foreground">
                        <Badge variant={decisionVariant}>{decisionLabel}</Badge>
                        {task.reason && (
                          <span className="text-xs text-muted-foreground [overflow-wrap:anywhere]">
                            {task.reason}
                          </span>
                        )}
                      </span>
                      {metrics.length > 0 && (
                        <small className="flex flex-wrap items-center gap-x-1.5 text-2xs tabular-nums text-muted-foreground">
                          {metrics.map((metric, index) => (
                            <Fragment key={index}>
                              {index > 0 && <span aria-hidden="true">·</span>}
                              {metric}
                            </Fragment>
                          ))}
                        </small>
                      )}
                    </button>
                  </CollapsibleTrigger>
                  <CollapsibleContent>
                    <div className="mt-3">
                      <TaskHistory
                        host={host}
                        task={task.id}
                        t={t}
                        language={language}
                        onOpenTerminal={onOpenTerminal}
                      />
                    </div>
                  </CollapsibleContent>
                </article>
              </Collapsible>
            );
          })}
      </div>
    </aside>
  );
}
