import { creationOrder } from "@iori/protocol";
import { useEffect, useState } from "react";
import {
  Activity,
  ListTodo,
  Users,
  ChevronDown,
  ChevronRight,
  MessageSquare,
  Check,
  X,
} from "lucide-react";
import type { BoardData, BoardAgent, Changes } from "@iori/protocol";
import { connection } from "../connection.ts";
import { StatusDot } from "../components/StatusDot.tsx";
import { Button } from "../components/ui/button.tsx";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "../components/ui/collapsible.tsx";
import { Tabs, TabsList, TabsTrigger } from "../components/ui/tabs.tsx";
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
} from "../components/ui/select.tsx";
import { TaskHistory, type OpenTeamTerminal } from "./TaskHistory.tsx";
import { Usage } from "./Usage.tsx";
import {
  boardTranslator,
  compactNumber,
  elapsedTime,
  timeOf,
} from "./board-i18n.ts";
import { TextShimmer } from "./TextShimmer.tsx";
import { useBoardActivity } from "./use-board-activity.ts";
import { childRank, childStatus } from "./children.ts";
import "./board.css";
export function ChangeAmount({
  changes,
  language,
  onClick,
}: {
  changes: Changes;
  language: string;
  onClick?: () => void;
}) {
  const files =
    changes.files === undefined
      ? undefined
      : language.toLowerCase().startsWith("ja")
        ? `${changes.files}ファイル`
        : `${changes.files} ${changes.files === 1 ? "file" : "files"}`;
  const content = (
    <>
      {changes.added !== undefined && (
        <span className="diff-add">+{changes.added}</span>
      )}
      {changes.removed !== undefined && (
        <span className="diff-del">−{changes.removed}</span>
      )}
      {files !== undefined && <span>· {files}</span>}
    </>
  );
  return onClick ? (
    <button type="button" className="agent-diff" onClick={onClick}>
      {content}
    </button>
  ) : (
    <span className="agent-diff">{content}</span>
  );
}
function agentState(agent: BoardAgent) {
  if (agent.state === "starting") return "Starting";
  if (agent.state === "finished") return "Finished";
  if (agent.state === "failed") return "Failed";
  if (agent.state === "stopped") return "Stopped";
  if (agent.cliStatus?.attention)
    return agent.cliStatus.attention.kind === "question"
      ? "Question"
      : "Approval";
  if (
    agent.cliStatus?.state === "active" &&
    (agent.state === "reported" || agent.state === "question")
  )
    return "Running";
  if (agent.state === "reported") return "Reported";
  if (agent.state === "question") return "Question";
  return agent.state === "waiting" ? "Waiting" : "Running";
}
function waitingDescription(agent: BoardAgent, language: string): string {
  const japanese = language.toLowerCase().startsWith("ja");
  return (
    agent.waitingReasons
      ?.map((entry) =>
        entry.reason === "not_installed"
          ? `${entry.cli}: ${japanese ? "このHostにCLIが見つかりません" : "CLI not installed"}`
          : entry.reason === "usage"
            ? `${entry.cli}: ${japanese ? `残量が下限${entry.minimum}%未満` : `Usage below ${entry.minimum}% minimum`}`
            : entry.reason === "failed"
              ? `${entry.cli}: ${japanese ? "このタスクで失敗" : "Failed in this task"}`
              : entry.reason === "role_removed"
                ? japanese
                  ? "役割が削除されました"
                  : "Role removed"
                : japanese
                  ? "候補が設定されていません"
                  : "No candidates configured",
      )
      .join(" · ") ?? ""
  );
}
function CurrentOperation({
  agent,
  language,
  t,
}: {
  agent: BoardAgent;
  language: string;
  t: (key: string) => string;
}) {
  const activity = useBoardActivity(
    agentState(agent) === "Running" && agent.cliStatus?.state === "active",
    agent.cliStatus?.activity,
    ["Approval", "Question"].includes(agentState(agent)),
  );
  const label =
    activity?.kind === "tool"
      ? [activity.tool, activity.summary].filter(Boolean).join(" ")
      : t(activity?.kind === "thinking" ? "Thinking" : agentState(agent));
  const detail =
    agent.state === "waiting"
      ? agent.waiting === "capacity"
        ? `${t("Capacity")} (${agent.role})`
        : waitingDescription(agent, language)
      : agent.state === "reported"
        ? t("Awaiting parent decision")
        : agent.state === "question"
          ? t("Awaiting the parent's answer")
          : agent.state === "failed"
            ? agent.failure
            : agent.state === "stopped"
              ? t(childStatus(agent).description ?? "")
              : undefined;
  const description = detail ? `${label} · ${detail}` : label;
  return (
    <span
      className={`agent-current${agent.state === "failed" ? " agent-failure" : ""}`}
      title={description}
    >
      {description}
    </span>
  );
}
export function Board({
  host,
  cwd,
  visible,
  t: translate,
  language,
  onOpenTerminal,
  onOpenGit,
  onEditTeam,
  viewState,
  onViewState,
}: {
  host: string;
  cwd: string;
  visible: boolean;
  t: (key: string) => string;
  language: string;
  onOpenTerminal: OpenTeamTerminal;
  onOpenGit: (cwd: string) => void;
  onEditTeam: (id: string, roleId?: string) => void;
  viewState?: unknown;
  onViewState: (value: unknown) => void;
}) {
  const t = boardTranslator(translate, language);
  const [data, setData] = useState<BoardData>();
  const [failed, setFailed] = useState(false);
  const [selected, setSelected] = useState(
    typeof viewState === "string" ? viewState : "",
  );
  const [section, setSection] = useState("plan"),
    [showGoal, setShowGoal] = useState(false),
    [showActivity, setShowActivity] = useState(false),
    [showFinished, setShowFinished] = useState(false),
    [showCancelled, setShowCancelled] = useState(false),
    [expanded, setExpanded] = useState<string>();
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    if (!visible) return;
    let active = true,
      fetching = false;
    const load = async () => {
      if (fetching) return;
      fetching = true;
      try {
        const result = await connection.requestHost(host, "teams.board", {
          cwd,
        });
        if (active) {
          if (result?.ok) {
            setData(result.result);
            setSelected((current) =>
              result.result.conversations.some((entry) => entry.id === current)
                ? current
                : (result.result.defaultConversation ?? ""),
            );
            setFailed(false);
            setNow(Date.now());
          } else setFailed(true);
        }
      } catch {
        if (active) setFailed(true);
      } finally {
        fetching = false;
      }
    };
    const unsubscribe = connection.subscribeHostEvents((eventHost, event) => {
      if (eventHost !== host || event.type !== "terminal.updated") return;
      setData(
        (current) =>
          current && {
            ...current,
            agents: current.agents.map((agent) =>
              agent.terminalId === event.terminal.id
                ? { ...agent, cliStatus: event.terminal.cliStatus }
                : agent,
            ),
          },
      );
    });
    void load();
    const timer = setInterval(() => void load(), 5000);
    return () => {
      active = false;
      unsubscribe();
      clearInterval(timer);
    };
  }, [host, cwd, visible]);
  const conversation =
    data?.conversations.find((item) => item.id === selected) ??
    data?.conversations.find((item) => item.id === data.defaultConversation);
  const teamId = conversation?.teamId;
  const [team, setTeam] = useState<{
    host: string;
    id: string;
    name: string;
  }>();
  useEffect(() => {
    if (!visible || !teamId) return;
    let active = true;
    void connection
      .requestHost(host, "teams.read", { teamId })
      .then((result) => {
        if (active)
          setTeam(
            result?.ok
              ? { host, id: teamId, name: result.result.saved.name }
              : undefined,
          );
      })
      .catch(() => {
        if (active) setTeam(undefined);
      });
    return () => {
      active = false;
    };
  }, [host, teamId, visible]);
  const teamName = team?.host === host && team.id === teamId ? team.name : "";
  const agents =
    data?.agents.filter((agent) => agent.conversation === conversation?.id) ??
    [];
  const plan = conversation?.plan;
  const tasks = plan?.tasks.filter((task) => task.state !== "cancelled") ?? [];
  const completed = tasks.filter((task) => task.state === "done").length;
  const goalUpdate = plan?.activity
    .slice()
    .reverse()
    .find((entry) => entry.kind === "goal" && entry.request);
  const turns = agents.flatMap((agent) =>
    agent.cliStatus?.attention
      ? [
          {
            owner: "You",
            kind:
              agent.cliStatus.attention.kind === "question"
                ? "Question"
                : "Approval",
            agent,
            at: agent.cliStatus.since,
            detail: [
              agent.cliStatus.attention.tool,
              agent.cliStatus.attention.summary,
            ]
              .filter(Boolean)
              .join(": "),
          },
        ]
      : agent.waiting === "candidates" && agent.state === "waiting"
        ? [
            {
              owner: "You",
              kind: "No candidate",
              agent,
              at: agent.createdAt,
              detail: waitingDescription(agent, language),
            },
          ]
        : [],
  );
  const ended = agents
    .filter((agent) => ["finished", "stopped"].includes(agent.state))
    .sort(creationOrder);
  const current = agents
    .filter((agent) => !ended.includes(agent))
    .sort((a, b) => childRank(a) - childRank(b) || creationOrder(a, b));
  const measured = agents.filter((agent) => agent.tokens !== undefined);
  const changes = [
    ...new Map(
      agents
        .filter((agent) => agent.changes)
        .map((agent) => [agent.cwd, agent.changes!]),
    ).values(),
  ];
  const changeTotal = changes.length
    ? changes.reduce<Changes>((sum, value) => {
        for (const key of ["added", "removed", "files"] as const)
          if (value[key] !== undefined) sum[key] = (sum[key] ?? 0) + value[key];
        return sum;
      }, {})
    : undefined;
  const duration = (agent: BoardAgent) =>
    agent.elapsedMs === undefined && agent.startedAt === undefined
      ? ""
      : elapsedTime(
          (agent.elapsedMs ?? 0) +
            (agent.startedAt === undefined ? 0 : now - agent.startedAt),
        );
  const roleLabel = (agent: BoardAgent) =>
    [
      agent.role,
      agent.difficulty &&
        agent.difficulty[0]!.toUpperCase() + agent.difficulty.slice(1),
    ]
      .filter(Boolean)
      .join(" · ");
  const agentRow = (agent: BoardAgent, finished = false) => (
    <div
      className="board-agent-row"
      key={agent.id}
      data-iori-board-agent={agent.id}
    >
      <StatusDot
        state={
          ["Running", "Starting"].includes(agentState(agent))
            ? "active"
            : ["Approval", "Question"].includes(agentState(agent))
              ? "waiting"
              : agent.state === "failed"
                ? "failed"
                : agent.state === "finished" || agent.state === "reported"
                  ? "done"
                  : "stopped"
        }
      />
      <Collapsible
        asChild
        open={finished && expanded === agent.id}
        onOpenChange={(open) => setExpanded(open ? agent.id : undefined)}
      >
        <div className="board-agent-copy">
          <button
            type="button"
            className="agent-main"
            aria-expanded={finished ? expanded === agent.id : undefined}
            onClick={() =>
              finished
                ? setExpanded(expanded === agent.id ? undefined : agent.id)
                : agent.terminalId && onOpenTerminal(agent.terminalId)
            }
          >
            <span className="agent-heading">
              <strong>{roleLabel(agent)}</strong>
              <time>{duration(agent)}</time>
            </span>
            <span className="agent-title">{agent.title}</span>
            <small>
              {[
                agent.cli?.name,
                agent.model,
                agent.effort,
                agent.plan === undefined ? undefined : `Task ${agent.plan}`,
              ]
                .filter(Boolean)
                .join(" · ")}
            </small>
            <CurrentOperation agent={agent} language={language} t={t} />
          </button>
          <div className="agent-metrics">
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
                {compactNumber(agent.tokens.input + agent.tokens.output)} tokens
              </span>
            )}
          </div>
          <small className="parent-verdict">
            Parent:{" "}
            {agent.decision
              ? agent.decision === "accept"
                ? "Accepted"
                : "Rejected"
              : "Pending"}
            {agent.revisions > 0 && ` · Revisions ${agent.revisions}`}
          </small>
          {finished && (
            <CollapsibleContent>
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
      </Collapsible>
    </div>
  );
  return (
    <div className="board" data-iori-view="board">
      {conversation && (
        <div className="mx-auto mb-3 flex max-w-[1200px] flex-wrap items-center gap-2">
          {data && data.conversations.length > 1 && (
            <Select
              value={conversation?.id}
              onValueChange={(id) => {
                setSelected(id);
                onViewState(id);
              }}
            >
              <SelectTrigger aria-label={t("Conversation")}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {data.conversations.map((item) => (
                  <SelectItem key={item.id} value={item.id}>
                    {item.name && `${item.name} · `}
                    {new Date(item.createdAt).toLocaleString(language, {
                      year: "numeric",
                      month: "2-digit",
                      day: "2-digit",
                      hour: "2-digit",
                      minute: "2-digit",
                    })}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
          <Button
            variant="outline"
            size="sm"
            data-iori-action="board-open-conversation"
            onClick={() => onOpenTerminal(conversation.terminalId)}
          >
            <MessageSquare size={14} />
            {t("Open conversation")}
          </Button>
          {teamName && (
            <Button
              variant="ghost"
              size="sm"
              className="min-w-0 max-w-full"
              data-iori-action="board-edit-team"
              aria-label={`${t("Edit team")}: ${teamName}`}
              onClick={() => onEditTeam(conversation.teamId)}
            >
              <Users size={14} />
              <span className="truncate">{teamName}</span>
            </Button>
          )}
        </div>
      )}
      {failed && <p role="alert">{t("Could not load Board")}</p>}
      {data && !conversation && <p>{t("No team conversation")}</p>}
      {turns.length > 0 && (
        <section className="board-turns" aria-label="Attention">
          <header className="todo-header">
            <h2>Attention</h2>
          </header>
          {turns.map((turn) => (
            <div
              className="board-turn-row"
              key={turn.agent.id}
              data-iori-board-attention={turn.kind
                .toLowerCase()
                .replaceAll(" ", "-")}
            >
              <span className="turn-owner">{turn.owner}</span>
              <button
                type="button"
                className="turn-main"
                onClick={() =>
                  turn.kind === "No candidate"
                    ? onEditTeam(conversation!.teamId, turn.agent.roleId)
                    : turn.agent.terminalId &&
                      onOpenTerminal(turn.agent.terminalId)
                }
              >
                <span>
                  <strong>{turn.kind}</strong> · {turn.agent.role} ·{" "}
                  {turn.agent.title}
                </span>
                {turn.detail && <small>{turn.detail}</small>}
              </button>
              {turn.kind === "No candidate" && (
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() =>
                    onEditTeam(conversation!.teamId, turn.agent.roleId)
                  }
                >
                  {t("Edit team")}
                </Button>
              )}
              {turn.at !== undefined && (
                <time>{elapsedTime(now - turn.at)}</time>
              )}
            </div>
          ))}
        </section>
      )}
      <Tabs value={section} onValueChange={setSection} className="board-tabs">
        <TabsList aria-label="Board">
          <TabsTrigger value="plan">Plan</TabsTrigger>
          <TabsTrigger value="agents">Agents</TabsTrigger>
        </TabsList>
      </Tabs>
      <div className="board-grid" data-mobile-section={section}>
        <section className="board-section plan-section">
          <header className="todo-header">
            <ListTodo size={17} />
            <h2>
              Plan{" "}
              {tasks.length > 0 && (
                <span>
                  {completed} of {tasks.length} done
                </span>
              )}
            </h2>
          </header>
          {plan?.goal ? (
            <div className="plan-goal">
              <strong>Goal</strong>
              <p>{plan.goal}</p>
              {plan.updatedAt !== undefined && (
                <small>
                  {language.toLowerCase().startsWith("ja")
                    ? `${Math.max(0, Math.floor((now - plan.updatedAt) / 1000)) < 60 ? `${Math.max(0, Math.floor((now - plan.updatedAt) / 1000))}秒` : Math.floor((now - plan.updatedAt) / 60000) < 60 ? `${Math.floor((now - plan.updatedAt) / 60000)}分` : `${Math.floor((now - plan.updatedAt) / 3600000)}時間`}前に更新`
                    : `Updated ${elapsedTime(now - plan.updatedAt)} ago`}
                </small>
              )}
              {goalUpdate && (
                <Collapsible
                  className="goal-history-group"
                  open={showGoal}
                  onOpenChange={setShowGoal}
                >
                  <br />
                  <CollapsibleTrigger asChild>
                    <button
                      type="button"
                      className="goal-history"
                      aria-expanded={showGoal}
                    >
                      {t("Goal updated after your request")} ·{" "}
                      {timeOf(goalUpdate.at, language)}
                    </button>
                  </CollapsibleTrigger>
                  {goalUpdate.previousGoal && (
                    <CollapsibleContent>
                      <p className="goal-old">
                        {t("Previous goal")} · {goalUpdate.previousGoal}
                      </p>
                    </CollapsibleContent>
                  )}
                </Collapsible>
              )}
            </div>
          ) : (
            <p className="board-empty">{t("No plan yet")}</p>
          )}
          {tasks.length > 0 && (
            <div
              className="plan-progress"
              role="progressbar"
              aria-label="Plan"
              aria-valuemin={0}
              aria-valuemax={tasks.length}
              aria-valuenow={completed}
            >
              <span
                style={{
                  transform: `scaleX(${tasks.length ? completed / tasks.length : 0})`,
                }}
              />
            </div>
          )}
          <div className="todo-list">
            {tasks.map((task) => {
              const assigned = agents.filter(
                (agent) => agent.plan === task.number,
              );
              const latest = assigned.reduce<BoardAgent | undefined>(
                (newest, agent) =>
                  !newest || agent.createdAt > newest.createdAt
                    ? agent
                    : newest,
                undefined,
              );
              const blocked = assigned.some(
                (agent) =>
                  agent.cliStatus?.attention ||
                  (agent.state === "waiting" && agent.waiting === "candidates"),
              );
              const failed = latest?.state === "failed";
              const state =
                task.state === "done"
                  ? "done"
                  : blocked
                    ? "blocked"
                    : failed
                      ? "failed"
                      : task.state;
              return (
                <button
                  type="button"
                  key={task.number}
                  className="todo-item"
                  data-iori-plan-task={task.number}
                  onClick={() =>
                    onOpenTerminal(
                      latest?.terminalId ?? conversation!.terminalId,
                    )
                  }
                >
                  <span className={`todo-status ${state}`}>
                    {state === "done" ? (
                      <Check size={14} />
                    ) : state === "failed" ? (
                      <X size={14} />
                    ) : null}
                  </span>
                  <span className="todo-copy">
                    <span className="todo-titleline">
                      {state === "in_progress" ? (
                        <TextShimmer className="todo-title">
                          {task.title}
                        </TextShimmer>
                      ) : (
                        <span className="todo-title">{task.title}</span>
                      )}
                      {task.added && <span className="todo-added">Added</span>}
                    </span>
                    <span className="todo-assignee">
                      {assigned.length
                        ? assigned
                            .map((agent) =>
                              [roleLabel(agent), agent.cli?.name, agent.model]
                                .filter(Boolean)
                                .join(" · "),
                            )
                            .join(" / ")
                        : "Parent"}
                      {` · Task ${task.number}`}
                    </span>
                    {task.checkpoint && (
                      <span className="todo-checkpoint">{task.checkpoint}</span>
                    )}
                    {assigned.some(
                      (agent) => agent.revisions || agent.decision,
                    ) && (
                      <span className="todo-verdict">
                        {latest &&
                          latest.revisions > 0 &&
                          `Revisions ${latest.revisions} `}
                        {assigned
                          .filter((agent) => agent.decision)
                          .map((agent) =>
                            agent.decision === "accept"
                              ? "Accepted"
                              : "Rejected",
                          )
                          .join(" · ")}
                      </span>
                    )}
                  </span>
                  <time>{latest ? duration(latest) : ""}</time>
                </button>
              );
            })}
          </div>
          {plan?.tasks.some((task) => task.state === "cancelled") && (
            <Collapsible open={showCancelled} onOpenChange={setShowCancelled}>
              <CollapsibleTrigger asChild>
                <button
                  type="button"
                  className="cancelled-fold"
                  aria-expanded={showCancelled}
                >
                  {showCancelled ? (
                    <ChevronDown size={12} />
                  ) : (
                    <ChevronRight size={12} />
                  )}{" "}
                  {
                    plan.tasks.filter((task) => task.state === "cancelled")
                      .length
                  }{" "}
                  Cancelled
                </button>
              </CollapsibleTrigger>
              <CollapsibleContent>
                {plan.tasks
                  .filter((task) => task.state === "cancelled")
                  .map((task) => (
                    <p className="cancelled-task" key={task.number}>
                      {task.title} · {task.reason}
                    </p>
                  ))}
              </CollapsibleContent>
            </Collapsible>
          )}
          {plan && (
            <Collapsible
              asChild
              open={showActivity}
              onOpenChange={setShowActivity}
            >
              <section className="activity">
                <div className="section-label">
                  <Activity size={14} />
                  Activity
                  <CollapsibleTrigger asChild>
                    <button type="button">
                      {t(showActivity ? "Show less" : "Show all")}
                    </button>
                  </CollapsibleTrigger>
                </div>
                {[...plan.activity]
                  .reverse()
                  .slice(0, 5)
                  .map((event, index) => (
                    <p key={index}>
                      <time>{timeOf(event.at, language)}</time>
                      <span>
                        {t(
                          event.request
                            ? "Plan updated after your request"
                            : "Parent updated the plan",
                        )}
                        {event.task !== undefined && ` · Task ${event.task}`} ·{" "}
                        {event.text}
                      </span>
                    </p>
                  ))}
                <CollapsibleContent>
                  {[...plan.activity]
                    .reverse()
                    .slice(5)
                    .map((event, index) => (
                      <p key={index}>
                        <time>{timeOf(event.at, language)}</time>
                        <span>
                          {t(
                            event.request
                              ? "Plan updated after your request"
                              : "Parent updated the plan",
                          )}
                          {event.task !== undefined && ` · Task ${event.task}`}{" "}
                          · {event.text}
                        </span>
                      </p>
                    ))}
                </CollapsibleContent>
              </section>
            </Collapsible>
          )}
        </section>
        <section className="board-section agents-section">
          <header className="todo-header">
            <Users size={17} />
            <h2>Agents</h2>
          </header>
          <p className="agent-summary">
            Agents {agents.length}
            {changeTotal && (
              <>
                {" "}
                · <ChangeAmount changes={changeTotal} language={language} />
              </>
            )}
            {measured.length > 0 && (
              <>
                {" "}
                · {t("Tokens (input + output)")}{" "}
                {compactNumber(
                  measured.reduce(
                    (sum, agent) =>
                      sum + agent.tokens!.input + agent.tokens!.output,
                    0,
                  ),
                )}
                {measured.length < agents.length &&
                  (language.toLowerCase().startsWith("ja")
                    ? `（${measured.length}人分）`
                    : ` (${measured.length} agents)`)}
              </>
            )}
          </p>
          <div className="agent-usage">
            {data?.roles
              .filter((role) => role.conversation === conversation?.id)
              .map((role) => (
                <span key={role.name}>
                  {role.name}{" "}
                  <b>
                    {role.used}
                    {role.limit && `/${role.limit}`}
                  </b>
                  {role.waiting > 0 && ` · ${role.waiting} Waiting`}
                </span>
              ))}
          </div>
          {data?.usage
            .filter((entry) =>
              agents.some((agent) => agent.cli?.id === entry.cli),
            )
            .map((entry) => (
              <div className="agent-quota" key={entry.cli}>
                <Usage
                  compact
                  cliId={entry.cli}
                  usage={entry.usage}
                  name={`Usage ${entry.name}`}
                />
              </div>
            ))}
          <div className="agent-list">
            {current.map((agent) => agentRow(agent))}
          </div>
          {!agents.length && (
            <p className="board-empty">{t("No agents yet")}</p>
          )}
          {ended.length > 0 && (
            <Collapsible open={showFinished} onOpenChange={setShowFinished}>
              <CollapsibleTrigger asChild>
                <button
                  type="button"
                  className="finished-fold"
                  data-iori-action="board-finished"
                  aria-expanded={showFinished}
                >
                  {showFinished ? (
                    <ChevronDown size={12} />
                  ) : (
                    <ChevronRight size={12} />
                  )}{" "}
                  {ended.length} Finished
                </button>
              </CollapsibleTrigger>
              <CollapsibleContent>
                {ended.map((agent) => agentRow(agent, true))}
              </CollapsibleContent>
            </Collapsible>
          )}
        </section>
      </div>
    </div>
  );
}
