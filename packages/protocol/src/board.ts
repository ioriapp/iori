import type { ChildSummary, Difficulty } from "./teams.ts";
import type { CliUsage } from "./cli.ts";

export type Changes = { added?: number; removed?: number; files?: number };
export type TokenUsage = {
  input: number;
  output: number;
  cacheRead?: number;
  cacheWrite?: number;
  reasoning?: number;
};
export type RecordedCandidate = {
  cli: string;
  cliName?: string;
  model?: string;
  effort?: string;
};
export type PlanTask = {
  number: number;
  title: string;
  state: "pending" | "in_progress" | "done" | "cancelled";
  checkpoint?: string;
  reason?: string;
  added: boolean;
  updatedAt: number;
};
export type PlanActivity = {
  at: number;
  kind: "goal" | "add" | "update" | "cancel";
  request: boolean;
  task?: number;
  text: string;
  previousGoal?: string;
};
export type ConversationPlan = {
  goal?: string;
  updatedAt?: number;
  tasks: PlanTask[];
  activity: PlanActivity[];
};
export type CandidateWaitingReason = {
  reason:
    "not_installed" | "usage" | "failed" | "role_removed" | "no_candidates";
  cli?: string;
  minimum?: string;
};
export type BoardAgent = ChildSummary & {
  roleId: string;
  difficulty?: Difficulty;
  task: string;
  plan?: number;
  createdAt: number;
  firstStartedAt?: number;
  endedAt?: number;
  reportedAt?: number;
  questionedAt?: number;
  changes?: Changes;
  tokens?: TokenUsage;
  effort?: string;
  revisions: number;
  waitingReasons?: CandidateWaitingReason[];
};
export type BoardConversation = {
  id: string;
  terminalId: string;
  teamId: string;
  name?: string;
  createdAt: number;
  lastActiveAt?: number;
  plan?: ConversationPlan;
};
/** Lightweight home list; excludes plans, diffs, tokens and usage readings. */
export type BoardSummary = {
  createdAt: number;
  cwd: string;
  conversation: string;
  terminalId: string;
  hasActive: boolean;
  lastActivityAt: number;
  children: Pick<
    ChildSummary,
    "state" | "cliStatus" | "waiting" | "stoppedBy"
  >[];
};
export type BoardData = {
  defaultConversation?: string;
  conversations: BoardConversation[];
  agents: BoardAgent[];
  roles: {
    conversation: string;
    name: string;
    limit: string;
    used: number;
    waiting: number;
  }[];
  usage: { cli: string; name: string; usage: CliUsage }[];
};
export type RecordAgent = {
  id: string;
  role?: string;
  candidate?: RecordedCandidate;
  createdAt: number;
  startedAt?: number;
  endedAt?: number;
  elapsedMs?: number;
  workMs?: number;
  tokens?: TokenUsage;
  changes?: Changes;
  terminalId?: string;
  revisions: number;
  teamVersion?: number;
};
export type TaskRecord = {
  id: string;
  conversation: string;
  parentTerminalId?: string;
  title: string;
  teamId: string;
  team?: string;
  version: number;
  role?: string;
  difficulty: Difficulty;
  plan?: number;
  createdAt: number;
  decision?: "accept" | "reject";
  reason?: string;
  decidedAt?: number;
  revisions: number;
  elapsedMs?: number;
  changes?: Changes;
  agents: RecordAgent[];
};
export type RecordsFilter = {
  startAt?: number;
  endAt?: number;
  days?: 7 | 30 | 90;
  teamId?: string;
  version?: number;
  difficulty?: Difficulty;
};
export type RecordsData = {
  tasks: TaskRecord[];
  roleNames: string[];
  teams: { id: string; name?: string; versions: number[] }[];
};
export type TaskHistoryEvent = {
  at: number;
  kind: "Delegated" | "Revise" | "Handoff" | "Accepted" | "Rejected";
  child: string;
  role?: string;
  candidate?: RecordedCandidate;
  difficulty?: Difficulty;
  body?: string;
};
export type TaskHistoryData = {
  events: TaskHistoryEvent[];
  childTerminalId?: string;
  parentTerminalId?: string;
};
