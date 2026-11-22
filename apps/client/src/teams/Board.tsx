import { useCallback, useEffect, useRef, useState } from "react";
import { Users } from "lucide-react";
import type { BoardData, Changes } from "@iori/protocol";
import { cn } from "cn";
import { connection } from "../connection.ts";
import { AsyncState, type AsyncViewMode } from "../components/AsyncState.tsx";
import { Button } from "../components/ui/button.tsx";
import { Tabs, TabsList, TabsTrigger } from "../components/ui/tabs.tsx";
import type { OpenTeamTerminal } from "./TaskHistory.tsx";
import { boardTranslator } from "./board-i18n.ts";
import { BoardAgents } from "./board/BoardAgents.tsx";
import {
  BoardAttention,
  type BoardAttentionItem,
} from "./board/BoardAttention.tsx";
import { BoardHeader } from "./board/BoardHeader.tsx";
import { BoardPlan } from "./board/BoardPlan.tsx";
import { waitingDescription } from "./board/board-state.tsx";

export { ChangeAmount } from "./ChangeAmount.tsx";

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
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  const [selected, setSelected] = useState(
    typeof viewState === "string" ? viewState : "",
  );
  const [section, setSection] = useState("plan");
  const [now, setNow] = useState(Date.now);
  const sectionPicked = useRef(false);
  const sectionInitialized = useRef(false);
  const selectedRef = useRef(selected);
  selectedRef.current = selected;
  const scopeRef = useRef(`${host}\0${cwd}`);
  const loadRef = useRef<(() => Promise<void>) | undefined>(undefined);

  useEffect(() => {
    const scope = `${host}\0${cwd}`;
    if (scopeRef.current !== scope) {
      scopeRef.current = scope;
      sectionPicked.current = false;
      sectionInitialized.current = false;
      setData(undefined);
      setFailed(false);
      setLoading(true);
    }
  }, [host, cwd]);

  useEffect(() => {
    if (!visible) return;
    let active = true;
    let fetching = false;
    const load = async () => {
      if (fetching) return;
      fetching = true;
      try {
        const result = await connection.requestHost(host, "teams.board", {
          cwd,
        });
        if (!active) return;
        if (result?.ok) {
          if (!sectionInitialized.current && !sectionPicked.current) {
            sectionInitialized.current = true;
            const initialConversation =
              result.result.conversations.find(
                (entry) => entry.id === selectedRef.current,
              ) ??
              result.result.conversations.find(
                (entry) => entry.id === result.result.defaultConversation,
              );
            const hasTasks =
              initialConversation?.plan?.tasks.some(
                (task) => task.state !== "cancelled",
              ) ?? false;
            setSection(hasTasks ? "plan" : "agents");
          }
          setData(result.result);
          setSelected((current) =>
            result.result.conversations.some((entry) => entry.id === current)
              ? current
              : (result.result.defaultConversation ?? ""),
          );
          setFailed(false);
          setLoading(false);
          setNow(Date.now());
        } else {
          setFailed(true);
          setLoading(false);
        }
      } catch {
        if (active) {
          setFailed(true);
          setLoading(false);
        }
      } finally {
        fetching = false;
      }
    };
    loadRef.current = load;
    const unsubscribe = connection.subscribeHostEvents((eventHost, event) => {
      if (eventHost !== host || event.type !== "terminal.updated") return;
      setNow(Date.now());
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
      loadRef.current = undefined;
      unsubscribe();
      clearInterval(timer);
    };
  }, [host, cwd, visible]);

  const handleRetry = useCallback(() => {
    setFailed(false);
    setLoading(true);
    void loadRef.current?.();
  }, []);

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
        if (active) {
          setTeam(
            result?.ok
              ? { host, id: teamId, name: result.result.saved.name }
              : undefined,
          );
        }
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
  const planTasks = ["done", "in_progress", "pending"].flatMap(
    (state) =>
      conversation?.plan?.tasks.filter((task) => task.state === state) ?? [],
  );
  const completedTasks = planTasks.filter(
    (task) => task.state === "done",
  ).length;
  const turns = agents.flatMap<BoardAttentionItem>((agent) =>
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

  const measuredAgents = agents.filter((agent) => agent.tokens !== undefined);
  const uniqueChanges = [
    ...new Map(
      agents
        .filter((agent) => agent.changes)
        .map((agent) => [agent.cwd, agent.changes!]),
    ).values(),
  ];
  const changeTotal = uniqueChanges.length
    ? uniqueChanges.reduce<Changes>((sum, value) => {
        for (const key of ["added", "removed", "files"] as const) {
          if (value[key] !== undefined) sum[key] = (sum[key] ?? 0) + value[key];
        }
        return sum;
      }, {})
    : undefined;

  const viewMode: AsyncViewMode =
    data === undefined
      ? failed
        ? "error"
        : loading
          ? "loading"
          : "empty"
      : conversation === undefined
        ? "empty"
        : "ready";

  return (
    <div
      data-iori-view="board"
      className="@container flex h-full min-h-0 flex-col overflow-auto bg-background text-foreground [scrollbar-gutter:stable]"
    >
      {failed && data !== undefined && (
        <div
          role="alert"
          className="mx-4 mt-3 flex flex-wrap items-center justify-between gap-2 rounded-md border border-status-failed-border bg-status-failed-bg/35 px-3.5 py-2 text-xs text-foreground @3xl:mx-6"
        >
          <span>{t("Could not load Board")}</span>
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="[@media(pointer:coarse)]:min-h-11"
            onClick={handleRetry}
          >
            {t("Retry")}
          </Button>
        </div>
      )}

      <AsyncState
        mode={viewMode}
        t={t}
        className={cn(
          viewMode === "error" && "m-4 @3xl:m-6",
          viewMode !== "error" && "border-t-0",
        )}
        emptyIcon={<Users className="size-4" aria-hidden="true" />}
        emptyTitle={t("No team conversation")}
        errorTitle={t("Could not load Board")}
        onRetry={handleRetry}
      >
        {conversation && data && (
          <>
            <BoardHeader
              conversations={data.conversations}
              conversation={conversation}
              teamName={teamName}
              agents={agents}
              completedTasks={completedTasks}
              totalTasks={planTasks.length}
              changeTotal={changeTotal}
              measuredAgents={measuredAgents}
              language={language}
              t={t}
              onSelectConversation={(id) => {
                setSelected(id);
                onViewState(id);
              }}
              onOpenConversation={onOpenTerminal}
              onEditTeam={(id) => onEditTeam(id)}
            />

            <BoardAttention
              items={turns}
              teamId={conversation.teamId}
              now={now}
              t={t}
              onOpenTerminal={onOpenTerminal}
              onEditTeam={onEditTeam}
            />

            <Tabs
              value={section}
              onValueChange={(value) => {
                sectionPicked.current = true;
                setSection(value);
              }}
              className="sticky top-0 z-(--z-sticky) bg-background @xl:hidden"
            >
              <TabsList variant="line" aria-label="Board" className="w-full">
                <TabsTrigger value="plan" className="min-h-11">
                  Plan
                </TabsTrigger>
                <TabsTrigger value="agents" className="min-h-11">
                  Agents
                </TabsTrigger>
              </TabsList>
            </Tabs>

            <div
              data-mobile-section={section}
              className="board-grid flex-1 @3xl:grid @3xl:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]"
            >
              <BoardPlan
                conversation={conversation}
                agents={agents}
                now={now}
                language={language}
                t={t}
                onOpenTerminal={onOpenTerminal}
                className={cn(
                  "border-b border-border @3xl:border-b-0",
                  section === "agents" && "hidden @xl:block",
                )}
              />
              <BoardAgents
                host={host}
                conversationId={conversation.id}
                agents={agents}
                roles={data.roles}
                usage={data.usage}
                now={now}
                language={language}
                t={t}
                onOpenTerminal={onOpenTerminal}
                onOpenGit={onOpenGit}
                className={cn(section === "plan" && "hidden @xl:block")}
              />
            </div>
          </>
        )}
      </AsyncState>
    </div>
  );
}
