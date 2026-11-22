import type { BoardAgent } from "@iori/protocol";
import type { IndicatorStatus } from "../../components/StatusIndicator.tsx";
import { isStalledCliStatus } from "../../CliStatus.tsx";
import { difficultyKey, elapsedTime } from "../board-i18n.ts";

export type AgentStateKey =
  | "Running"
  | "Starting"
  | "Approval"
  | "Question"
  | "Not responding"
  | "Waiting"
  | "Reported"
  | "Failed"
  | "Finished"
  | "Stopped";

export const AGENT_STATE_ORDER: readonly AgentStateKey[] = [
  "Running",
  "Starting",
  "Approval",
  "Question",
  "Not responding",
  "Waiting",
  "Reported",
  "Failed",
  "Finished",
  "Stopped",
];

export function agentState(agent: BoardAgent): AgentStateKey {
  if (agent.state === "starting") return "Starting";
  if (agent.state === "finished") return "Finished";
  if (agent.state === "failed") return "Failed";
  if (agent.state === "stopped") return "Stopped";
  if (agent.cliStatus?.attention) {
    return agent.cliStatus.attention.kind === "question"
      ? "Question"
      : "Approval";
  }
  if (agent.state === "waiting") return "Waiting";
  if (isStalledCliStatus(agent.cliStatus)) return "Not responding";
  if (
    agent.cliStatus?.state === "active" &&
    (agent.state === "reported" || agent.state === "question")
  ) {
    return "Running";
  }
  if (agent.state === "reported") return "Reported";
  if (agent.state === "question") return "Question";
  return "Running";
}

export function agentIndicatorStatus(state: AgentStateKey): IndicatorStatus {
  switch (state) {
    case "Running":
    case "Starting":
      return "running";
    case "Approval":
    case "Question":
    case "Not responding":
      return "waiting";
    case "Failed":
      return "failed";
    case "Finished":
    case "Reported":
      return "done";
    case "Waiting":
      return "idle";
    case "Stopped":
      return "stopped";
  }
}

export function summarizeAgentStates(
  agents: BoardAgent[],
): { state: AgentStateKey; count: number }[] {
  const counts = new Map<AgentStateKey, number>();
  for (const agent of agents) {
    const state = agentState(agent);
    counts.set(state, (counts.get(state) ?? 0) + 1);
  }
  return AGENT_STATE_ORDER.flatMap((state) => {
    const count = counts.get(state) ?? 0;
    return count > 0 ? [{ state, count }] : [];
  });
}

export function waitingDescription(
  agent: BoardAgent,
  language: string,
): string {
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

export function agentDuration(agent: BoardAgent, now: number): string {
  if (agent.elapsedMs === undefined && agent.startedAt === undefined) return "";
  return elapsedTime(
    (agent.elapsedMs ?? 0) +
      (agent.startedAt === undefined ? 0 : now - agent.startedAt),
  );
}

export function formatRoleLabel(
  agent: BoardAgent,
  t: (key: string) => string,
): string {
  return [agent.role, agent.difficulty && t(difficultyKey(agent.difficulty))]
    .filter(Boolean)
    .join(" · ");
}

export function formatUpdatedAgo(elapsedMs: number, language: string): string {
  if (language.toLowerCase().startsWith("ja")) {
    const seconds = Math.max(0, Math.floor(elapsedMs / 1000));
    if (seconds < 60) return `${seconds}秒前に更新`;
    const minutes = Math.floor(elapsedMs / 60000);
    if (minutes < 60) return `${minutes}分前に更新`;
    return `${Math.floor(elapsedMs / 3600000)}時間前に更新`;
  }
  return `Updated ${elapsedTime(elapsedMs)} ago`;
}
