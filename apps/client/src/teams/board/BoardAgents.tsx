import { Fragment, useState } from "react";
import { creationOrder } from "@iori/protocol";
import type { BoardAgent, BoardData } from "@iori/protocol";
import { ChevronDown, ChevronRight, Users } from "lucide-react";
import { cn } from "cn";
import { CliIcon } from "../../CliIcon.tsx";
import { isStalledCliStatus } from "../../CliStatus.tsx";
import { StatusIndicator } from "../../components/StatusIndicator.tsx";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "../../components/ui/collapsible.tsx";
import { ChangeAmount } from "../ChangeAmount.tsx";
import { TaskHistory, type OpenTeamTerminal } from "../TaskHistory.tsx";
import { Usage } from "../Usage.tsx";
import { compactNumber, difficultyKey, elapsedTime } from "../board-i18n.ts";
import { childStatus } from "../children.ts";
import { useBoardActivity } from "../use-board-activity.ts";
import {
  agentDuration,
  agentIndicatorStatus,
  agentState,
  waitingDescription,
} from "./board-state.tsx";

function CurrentOperation({
  agent,
  language,
  now,
  t,
}: {
  agent: BoardAgent;
  language: string;
  now: number;
  t: (key: string) => string;
}) {
  const state = agentState(agent);
  const activity = useBoardActivity(
    state === "Running" && agent.cliStatus?.state === "active",
    agent.cliStatus?.activity,
    ["Approval", "Question"].includes(state),
  );
  const label =
    activity?.kind === "tool"
      ? [activity.tool, activity.summary].filter(Boolean).join(" ")
      : t(activity?.kind === "thinking" ? "Thinking" : state);
  const stalledElapsed =
    state === "Not responding" && isStalledCliStatus(agent.cliStatus)
      ? elapsedTime(now - agent.cliStatus.stalledSince)
      : undefined;
  const detail =
    agent.state === "waiting"
      ? agent.waiting === "capacity"
        ? `${t("Capacity")} (${agent.role})`
        : waitingDescription(agent, language)
      : agent.state === "reported"
        ? t("Awaiting orchestrator decision")
        : agent.state === "question"
          ? t("Awaiting the orchestrator's answer")
          : agent.state === "stopped"
            ? t(childStatus(agent).description ?? "")
            : undefined;
  const description = [label, stalledElapsed, detail]
    .filter(Boolean)
    .join(" · ");

  return (
    <span
      title={description}
      className="max-w-44 truncate text-2xs text-muted-foreground"
    >
      {description}
    </span>
  );
}

function AgentFailureDetail({
  failure,
  t,
}: {
  failure?: string;
  t: (key: string) => string;
}) {
  const [open, setOpen] = useState(false);
  const text = failure?.trim() ?? "";
  const lines = text ? text.split(/\r?\n/u) : [];
  const summary = lines[0] ?? "";
  const expandable = lines.length > 1 || summary.length > 120;

  return (
    <div className="mt-1.5 rounded-md border border-status-failed-border bg-status-failed-bg/35 px-2.5 py-1.5 text-xs">
      <div className="flex min-w-0 items-center justify-between gap-2">
        <p
          title={summary || t("Failed")}
          className="min-w-0 flex-1 truncate text-status-failed-text"
        >
          <span className="font-medium">{t("Failed")}</span>
          {summary && <span className="text-foreground"> · {summary}</span>}
        </p>
        {expandable && (
          <button
            type="button"
            aria-expanded={open}
            onClick={() => setOpen((value) => !value)}
            className="inline-flex shrink-0 cursor-pointer items-center gap-0.5 rounded-xs text-2xs font-medium text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40 [@media(pointer:coarse)]:min-h-10"
          >
            {open ? (
              <ChevronDown className="size-3" aria-hidden="true" />
            ) : (
              <ChevronRight className="size-3" aria-hidden="true" />
            )}
            {t(open ? "Show less" : "Show all")}
          </button>
        )}
      </div>
      {expandable && open && (
        <pre className="mt-1.5 max-h-60 overflow-auto border-t border-status-failed-border/60 pt-1.5 font-mono text-2xs leading-relaxed whitespace-pre-wrap [overflow-wrap:anywhere] text-foreground">
          {text}
        </pre>
      )}
    </div>
  );
}

function BoardAgentRow({
  host,
  agent,
  finished,
  expanded,
  now,
  language,
  t,
  onToggleExpanded,
  onOpenTerminal,
  onOpenGit,
}: {
  host: string;
  agent: BoardAgent;
  finished: boolean;
  expanded: boolean;
  now: number;
  language: string;
  t: (key: string) => string;
  onToggleExpanded: (id: string | undefined) => void;
  onOpenTerminal: OpenTeamTerminal;
  onOpenGit: (cwd: string) => void;
}) {
  const state = agentState(agent);
  const indicator = agentIndicatorStatus(state);
  const durationText = agentDuration(agent, now);
  const taskNumber =
    agent.plan === undefined
      ? undefined
      : t("Task {number}").replace("{number}", String(agent.plan));
  const difficultyText = agent.difficulty
    ? t("Difficulty {difficulty}").replace(
        "{difficulty}",
        t(difficultyKey(agent.difficulty)),
      )
    : undefined;
  const revisionsText =
    agent.revisions > 0
      ? t("Revisions {count}").replace("{count}", String(agent.revisions))
      : undefined;
  const metaParts = [
    agent.model,
    agent.effort,
    taskNumber,
    difficultyText,
  ].filter(Boolean);
  const canOpen = finished || Boolean(agent.terminalId);

  return (
    <div data-iori-board-agent={agent.id} className="py-3 first:pt-2 last:pb-2">
      <Collapsible
        open={finished && expanded}
        onOpenChange={(open) => onToggleExpanded(open ? agent.id : undefined)}
      >
        <div className="flex min-w-0 items-start gap-2.5">
          <span className="mt-1 shrink-0">
            <StatusIndicator
              status={indicator}
              animated={indicator === "running"}
              label={t(state)}
            />
          </span>
          <div className="min-w-0 flex-1">
            {/* Row 1: Role + Title + Status + Elapsed */}
            <button
              type="button"
              aria-expanded={finished ? expanded : undefined}
              disabled={!canOpen}
              onClick={() =>
                finished
                  ? onToggleExpanded(expanded ? undefined : agent.id)
                  : agent.terminalId && onOpenTerminal(agent.terminalId)
              }
              className="group flex w-full min-w-0 cursor-pointer flex-col gap-0.5 rounded-xs text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40 disabled:cursor-default [@media(pointer:coarse)]:min-h-10"
            >
              <span className="flex w-full min-w-0 items-baseline justify-between gap-2">
                <span className="flex min-w-0 flex-wrap items-baseline gap-x-1.5 gap-y-0.5">
                  {agent.role && (
                    <strong className="shrink-0 text-xs font-medium text-foreground">
                      {agent.role}
                    </strong>
                  )}
                  <span className="min-w-0 text-sm text-foreground group-hover:underline group-hover:underline-offset-3 [overflow-wrap:anywhere]">
                    {agent.title}
                  </span>
                </span>
                <span className="flex shrink-0 items-center gap-1.5">
                  {agent.state !== "failed" && (
                    <CurrentOperation
                      agent={agent}
                      language={language}
                      now={now}
                      t={t}
                    />
                  )}
                  {durationText && (
                    <time className="text-2xs tabular-nums text-muted-foreground">
                      {durationText}
                    </time>
                  )}
                  {finished &&
                    (expanded ? (
                      <ChevronDown
                        className="size-3.5 text-muted-foreground"
                        aria-hidden="true"
                      />
                    ) : (
                      <ChevronRight
                        className="size-3.5 text-muted-foreground"
                        aria-hidden="true"
                      />
                    ))}
                </span>
              </span>
            </button>

            {agent.state === "failed" && (
              <AgentFailureDetail failure={agent.failure} t={t} />
            )}

            {/* Row 2: CLI/model/task/difficulty + ChangeAmount + Tokens + Orchestrator verdict */}
            <div className="mt-1.5 flex min-w-0 flex-wrap items-center justify-between gap-x-3 gap-y-1 text-2xs tabular-nums text-muted-foreground">
              <div className="flex min-w-0 flex-wrap items-center gap-x-1.5 gap-y-0.5">
                {agent.cli && (
                  <span className="inline-flex items-center gap-1 text-foreground/85">
                    <CliIcon cli={agent.cli} size={12} hostKey={host} />
                    <span>{agent.cli.name}</span>
                  </span>
                )}
                {metaParts.map((part, index) => (
                  <Fragment key={`${part}-${index}`}>
                    {(agent.cli || index > 0) && (
                      <span aria-hidden="true">·</span>
                    )}
                    <span className="min-w-0 [overflow-wrap:anywhere]">
                      {part}
                    </span>
                  </Fragment>
                ))}
              </div>
              <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1">
                {agent.changes && (
                  <ChangeAmount
                    changes={agent.changes}
                    language={language}
                    onClick={
                      agent.cwd && !agent.worktreeRemoved
                        ? () => onOpenGit(agent.cwd!)
                        : undefined
                    }
                  />
                )}
                {agent.tokens && (
                  <span data-iori-agent-tokens="known">
                    {t("{count} tokens").replace(
                      "{count}",
                      compactNumber(agent.tokens.input + agent.tokens.output),
                    )}
                  </span>
                )}
                <span>
                  Orchestrator:{" "}
                  {t(
                    agent.decision
                      ? agent.decision === "accept"
                        ? "Accepted"
                        : "Rejected"
                      : "Pending",
                  )}
                  {revisionsText && ` · ${revisionsText}`}
                </span>
              </div>
            </div>

            {finished && (
              <CollapsibleContent className="mt-2">
                <TaskHistory
                  host={host}
                  task={agent.task}
                  t={t}
                  language={language}
                  onOpenTerminal={onOpenTerminal}
                />
              </CollapsibleContent>
            )}
          </div>
        </div>
      </Collapsible>
    </div>
  );
}

export function BoardAgents({
  host,
  conversationId,
  agents,
  roles,
  usage,
  now,
  language,
  t,
  className,
  onOpenTerminal,
  onOpenGit,
}: {
  host: string;
  conversationId: string;
  agents: BoardAgent[];
  roles: BoardData["roles"];
  usage: BoardData["usage"];
  now: number;
  language: string;
  t: (key: string) => string;
  className?: string;
  onOpenTerminal: OpenTeamTerminal;
  onOpenGit: (cwd: string) => void;
}) {
  const [showFinished, setShowFinished] = useState(false);
  const [expanded, setExpanded] = useState<string>();

  const ended = agents
    .filter((agent) => ["finished", "stopped"].includes(agent.state))
    .sort(creationOrder);
  const current = agents
    .filter((agent) => !ended.includes(agent))
    .sort(creationOrder);
  const conversationRoles = roles.filter(
    (role) => role.conversation === conversationId,
  );
  const relevantUsage = usage.filter((entry) =>
    agents.some((agent) => agent.cli?.id === entry.cli),
  );

  return (
    <section className={cn("min-w-0 px-4 py-4 @3xl:px-6", className)}>
      <header className="mb-3 flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <Users
            className="size-4 shrink-0 text-muted-foreground"
            aria-hidden="true"
          />
          <h2 className="font-heading text-sm font-semibold text-foreground">
            Agents
          </h2>
        </div>
        <span className="text-xs tabular-nums text-muted-foreground">
          {agents.length}
        </span>
      </header>

      {(conversationRoles.length > 0 || relevantUsage.length > 0) && (
        <div className="mb-2 space-y-1.5 border-b border-border pb-2.5 text-xs tabular-nums text-muted-foreground">
          {conversationRoles.length > 0 && (
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
              {conversationRoles.map((role) => (
                <span key={role.name}>
                  {role.name}{" "}
                  <strong className="font-medium text-foreground">
                    {role.used}
                    {role.limit && `/${role.limit}`}
                  </strong>
                  {role.waiting > 0 &&
                    ` · ${t("{count} Waiting").replace("{count}", String(role.waiting))}`}
                </span>
              ))}
            </div>
          )}
          {relevantUsage.map((entry) => (
            <div key={entry.cli}>
              <Usage
                compact
                cliId={entry.cli}
                usage={entry.usage}
                name={`Usage ${entry.name}`}
              />
            </div>
          ))}
        </div>
      )}

      {!agents.length && (
        <p className="py-4 text-xs text-muted-foreground">
          {t("No agents yet")}
        </p>
      )}

      {current.length > 0 && (
        <div className="divide-y divide-border">
          {current.map((agent) => (
            <BoardAgentRow
              key={agent.id}
              host={host}
              agent={agent}
              finished={false}
              expanded={false}
              now={now}
              language={language}
              t={t}
              onToggleExpanded={setExpanded}
              onOpenTerminal={onOpenTerminal}
              onOpenGit={onOpenGit}
            />
          ))}
        </div>
      )}

      {ended.length > 0 && (
        <Collapsible open={showFinished} onOpenChange={setShowFinished}>
          <CollapsibleTrigger asChild>
            <button
              type="button"
              data-iori-action="board-finished"
              aria-expanded={showFinished}
              className={cn(
                "flex w-full cursor-pointer items-center gap-1.5 py-2.5 text-left text-xs text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40 [@media(pointer:coarse)]:min-h-11",
                current.length > 0 && "mt-1 border-t border-border",
              )}
            >
              {showFinished ? (
                <ChevronDown className="size-3.5" aria-hidden="true" />
              ) : (
                <ChevronRight className="size-3.5" aria-hidden="true" />
              )}
              {t("{count} Finished").replace("{count}", String(ended.length))}
            </button>
          </CollapsibleTrigger>
          <CollapsibleContent>
            <div className="divide-y divide-border-subtle border-t border-border-subtle">
              {ended.map((agent) => (
                <BoardAgentRow
                  key={agent.id}
                  host={host}
                  agent={agent}
                  finished
                  expanded={expanded === agent.id}
                  now={now}
                  language={language}
                  t={t}
                  onToggleExpanded={setExpanded}
                  onOpenTerminal={onOpenTerminal}
                  onOpenGit={onOpenGit}
                />
              ))}
            </div>
          </CollapsibleContent>
        </Collapsible>
      )}
    </section>
  );
}
