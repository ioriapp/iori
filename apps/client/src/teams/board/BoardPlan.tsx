import { useState } from "react";
import {
  Activity,
  Check,
  ChevronDown,
  ChevronRight,
  ListTodo,
  X,
} from "lucide-react";
import type {
  BoardAgent,
  BoardConversation,
  PlanActivity,
} from "@iori/protocol";
import { cn } from "cn";
import { Badge } from "../../components/ui/badge.tsx";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "../../components/ui/collapsible.tsx";
import { TextShimmer } from "../TextShimmer.tsx";
import { timeOf } from "../board-i18n.ts";
import {
  agentDuration,
  formatRoleLabel,
  formatUpdatedAgo,
} from "./board-state.tsx";

export function BoardPlan({
  conversation,
  agents,
  now,
  language,
  t,
  className,
  onOpenTerminal,
}: {
  conversation: BoardConversation;
  agents: BoardAgent[];
  now: number;
  language: string;
  t: (key: string) => string;
  className?: string;
  onOpenTerminal: (terminalId: string) => void;
}) {
  const [showGoal, setShowGoal] = useState(false);
  const [showActivity, setShowActivity] = useState(false);
  const [showCancelled, setShowCancelled] = useState(false);

  const plan = conversation.plan;
  const tasks = ["done", "in_progress", "pending"].flatMap(
    (state) => plan?.tasks.filter((task) => task.state === state) ?? [],
  );
  const cancelledTasks =
    plan?.tasks.filter((task) => task.state === "cancelled") ?? [];
  const completed = tasks.filter((task) => task.state === "done").length;
  const activity = [...(plan?.activity ?? [])].reverse();
  const goalUpdate = activity.find(
    (entry) => entry.kind === "goal" && entry.request,
  );

  const taskNumber = (number: number) =>
    t("Task {number}").replace("{number}", String(number));
  const revisions = (count: number) =>
    t("Revisions {count}").replace("{count}", String(count));

  const renderActivity = (event: PlanActivity, index: number) => (
    <p
      key={`${event.at}-${index}`}
      className="flex gap-2.5 text-xs leading-relaxed text-muted-foreground"
    >
      <time className="shrink-0 tabular-nums">
        {timeOf(event.at, language)}
      </time>
      <span className="min-w-0 [overflow-wrap:anywhere]">
        {t(
          event.by === "host"
            ? "Started when delegated"
            : event.request
              ? "Plan updated after your request"
              : "Orchestrator updated the plan",
        )}
        {event.task !== undefined && ` · ${taskNumber(event.task)}`} ·{" "}
        {translateActivityText(event.text, t)}
      </span>
    </p>
  );

  return (
    <section
      className={cn(
        "min-w-0 px-4 py-4 @3xl:border-r @3xl:border-border @3xl:px-6",
        className,
      )}
    >
      <header className="mb-3 flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <ListTodo
            className="size-4 shrink-0 text-muted-foreground"
            aria-hidden="true"
          />
          <h2 className="font-heading text-sm font-semibold text-foreground">
            Plan
          </h2>
        </div>
      </header>

      {plan?.goal ? (
        <div className="pb-3.5">
          <strong className="text-2xs font-medium text-muted-foreground">
            {t("Goal")}
          </strong>
          <p className="mt-1 text-sm leading-relaxed text-foreground [overflow-wrap:anywhere]">
            {plan.goal}
          </p>
          {plan.updatedAt !== undefined && (
            <p className="mt-1 text-2xs tabular-nums text-muted-foreground">
              {formatUpdatedAgo(now - plan.updatedAt, language)}
            </p>
          )}
          {goalUpdate && (
            <Collapsible open={showGoal} onOpenChange={setShowGoal}>
              <CollapsibleTrigger asChild>
                <button
                  type="button"
                  aria-expanded={showGoal}
                  className="mt-1 cursor-pointer rounded-xs text-left text-2xs text-muted-foreground underline underline-offset-3 transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40 [@media(pointer:coarse)]:min-h-10"
                >
                  {t("Goal updated after your request")} ·{" "}
                  {timeOf(goalUpdate.at, language)}
                </button>
              </CollapsibleTrigger>
              {goalUpdate.previousGoal && (
                <CollapsibleContent>
                  <p className="mt-1.5 text-2xs leading-relaxed text-muted-foreground [overflow-wrap:anywhere]">
                    {t("Previous goal")} · {goalUpdate.previousGoal}
                  </p>
                </CollapsibleContent>
              )}
            </Collapsible>
          )}
        </div>
      ) : tasks.length === 0 && cancelledTasks.length === 0 ? (
        <p className="py-4 text-xs text-muted-foreground">{t("No plan yet")}</p>
      ) : null}

      {tasks.length > 0 && (
        <div
          className="mb-3 h-1 overflow-hidden rounded-sm bg-muted"
          role="progressbar"
          aria-label="Plan"
          aria-valuemin={0}
          aria-valuemax={tasks.length}
          aria-valuenow={completed}
        >
          <span
            className="block h-full w-full origin-left bg-status-running transition-transform motion-reduce:transition-none"
            style={{
              transform: `scaleX(${tasks.length ? completed / tasks.length : 0})`,
            }}
          />
        </div>
      )}

      {tasks.length > 0 && (
        <div className="divide-y divide-border-subtle border-t border-border-subtle">
          {tasks.map((task) => {
            const assigned = agents.filter(
              (agent) => agent.plan === task.number,
            );
            const latest = assigned.reduce<BoardAgent | undefined>(
              (newest, agent) =>
                !newest || agent.createdAt > newest.createdAt ? agent : newest,
              undefined,
            );
            const blocked = assigned.some(
              (agent) =>
                agent.cliStatus?.attention ||
                (agent.state === "waiting" && agent.waiting === "candidates"),
            );
            const taskFailed = latest?.state === "failed";
            const state =
              task.state === "done"
                ? "done"
                : blocked
                  ? "blocked"
                  : taskFailed
                    ? "failed"
                    : task.state;

            return (
              <button
                type="button"
                key={task.number}
                data-iori-plan-task={task.number}
                onClick={() =>
                  onOpenTerminal(latest?.terminalId ?? conversation.terminalId)
                }
                className="flex w-full cursor-pointer items-start gap-2.5 rounded-xs px-1.5 py-2.5 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40 [@media(hover:hover)]:hover:bg-accent/50 [@media(pointer:coarse)]:min-h-11"
              >
                <span
                  aria-hidden="true"
                  className="mt-1 flex size-3.5 shrink-0 items-center justify-center"
                >
                  {state === "done" ? (
                    <Check
                      className="size-3.5 text-status-complete"
                      strokeWidth={2.25}
                    />
                  ) : state === "failed" ? (
                    <X
                      className="size-3.5 text-status-failed-text"
                      strokeWidth={2.25}
                    />
                  ) : state === "blocked" ? (
                    <span className="inline-block size-2 rounded-full bg-status-waiting" />
                  ) : state === "in_progress" ? (
                    <span className="status-dot-pulse inline-block size-2 rounded-full bg-status-running" />
                  ) : (
                    <span className="inline-block size-2 rounded-full border border-dashed border-status-stopped" />
                  )}
                </span>
                <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                  <span className="flex min-w-0 flex-wrap items-baseline gap-1.5">
                    {state === "in_progress" ? (
                      <TextShimmer className="text-sm font-medium text-foreground [overflow-wrap:anywhere]">
                        {task.title}
                      </TextShimmer>
                    ) : (
                      <span
                        className={cn(
                          "text-sm [overflow-wrap:anywhere]",
                          state === "done"
                            ? "text-muted-foreground"
                            : "text-foreground",
                        )}
                      >
                        {task.title}
                      </span>
                    )}
                    {task.added && (
                      <Badge
                        variant="outline"
                        className="h-4 px-1 text-2xs font-normal text-muted-foreground"
                      >
                        {t("Added")}
                      </Badge>
                    )}
                  </span>
                  <span className="text-2xs text-muted-foreground [overflow-wrap:anywhere]">
                    {assigned.length
                      ? assigned
                          .map((agent) =>
                            [
                              formatRoleLabel(agent, t),
                              agent.cli?.name,
                              agent.model,
                            ]
                              .filter(Boolean)
                              .join(" · "),
                          )
                          .join(" / ")
                      : "Orchestrator"}
                    {` · ${taskNumber(task.number)}`}
                  </span>
                  {task.checkpoint && (
                    <span
                      title={task.checkpoint}
                      className="truncate text-2xs text-muted-foreground"
                    >
                      {task.checkpoint}
                    </span>
                  )}
                  {assigned.some(
                    (agent) => agent.revisions || agent.decision,
                  ) && (
                    <span className="text-2xs text-muted-foreground">
                      {latest &&
                        latest.revisions > 0 &&
                        `${revisions(latest.revisions)} `}
                      {assigned
                        .filter((agent) => agent.decision)
                        .map((agent) =>
                          t(
                            agent.decision === "accept"
                              ? "Accepted"
                              : "Rejected",
                          ),
                        )
                        .join(" · ")}
                    </span>
                  )}
                </span>
                <time className="mt-0.5 shrink-0 text-2xs tabular-nums text-muted-foreground">
                  {latest ? agentDuration(latest, now) : ""}
                </time>
              </button>
            );
          })}
        </div>
      )}

      {cancelledTasks.length > 0 && (
        <Collapsible open={showCancelled} onOpenChange={setShowCancelled}>
          <CollapsibleTrigger asChild>
            <button
              type="button"
              aria-expanded={showCancelled}
              className="mt-2 flex cursor-pointer items-center gap-1.5 rounded-xs py-2 text-xs text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40 [@media(pointer:coarse)]:min-h-11"
            >
              {showCancelled ? (
                <ChevronDown className="size-3.5" aria-hidden="true" />
              ) : (
                <ChevronRight className="size-3.5" aria-hidden="true" />
              )}
              {t("{count} Cancelled").replace(
                "{count}",
                String(cancelledTasks.length),
              )}
            </button>
          </CollapsibleTrigger>
          <CollapsibleContent>
            <div className="space-y-1 pb-2 pl-5">
              {cancelledTasks.map((task) => (
                <p
                  key={task.number}
                  className="text-xs text-muted-foreground line-through [overflow-wrap:anywhere]"
                >
                  {task.title}
                  {task.reason ? ` · ${task.reason}` : ""}
                </p>
              ))}
            </div>
          </CollapsibleContent>
        </Collapsible>
      )}

      {plan && activity.length > 0 && (
        <Collapsible asChild open={showActivity} onOpenChange={setShowActivity}>
          <section className="mt-4 border-t border-border pt-3">
            <div className="mb-2 flex items-center justify-between gap-2 text-xs font-medium text-muted-foreground">
              <span className="inline-flex items-center gap-1.5">
                <Activity className="size-3.5" aria-hidden="true" />
                {t("Activity")}
              </span>
              {activity.length > 5 && (
                <CollapsibleTrigger asChild>
                  <button
                    type="button"
                    className="cursor-pointer rounded-xs text-xs font-normal text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40 [@media(pointer:coarse)]:min-h-10"
                  >
                    {t(showActivity ? "Show less" : "Show all")}
                  </button>
                </CollapsibleTrigger>
              )}
            </div>
            <div className="space-y-2">
              {activity.slice(0, 5).map(renderActivity)}
            </div>
            {activity.length > 5 && (
              <CollapsibleContent>
                <div className="mt-2 space-y-2">
                  {activity
                    .slice(5)
                    .map((event, index) => renderActivity(event, index + 5))}
                </div>
              </CollapsibleContent>
            )}
          </section>
        </Collapsible>
      )}
    </section>
  );
}

const ACTIVITY_STATUS_TOKENS: Record<string, string> = {
  Pending: "Waiting",
  Running: "Running",
  Done: "Done",
  Cancelled: "Cancelled",
  Blocked: "Blocked",
  Failed: "Failed",
  Stopped: "Stopped",
  "In progress": "Running",
};

function translateActivityText(text: string, t: (key: string) => string) {
  const mapped = ACTIVITY_STATUS_TOKENS[text];
  return mapped ? t(mapped) : text;
}
