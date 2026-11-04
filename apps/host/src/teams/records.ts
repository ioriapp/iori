import type {
  Candidate,
  Difficulty,
  Role,
  Changes,
  TokenUsage,
  ConversationPlan,
} from "@iori/protocol";
export type AssignedCandidate = {
  id: string;
  cli: string;
  model?: string;
  effort?: string;
  permission?: string;
  sandbox?: string;
  tools?: string[];
};
export function assignedCandidate(candidate: Candidate): AssignedCandidate {
  return {
    id: candidate.id,
    cli: candidate.cli,
    ...(candidate.model ? { model: candidate.model } : {}),
    ...(candidate.effort ? { effort: candidate.effort } : {}),
    ...(candidate.permission ? { permission: candidate.permission } : {}),
    ...(candidate.sandbox ? { sandbox: candidate.sandbox } : {}),
    ...(candidate.tools.length ? { tools: candidate.tools } : {}),
  };
}
/** The same candidate row with the same launch settings. */
export function sameAssignment(
  a: AssignedCandidate,
  b: AssignedCandidate,
): boolean {
  return [...new Set([...Object.keys(a), ...Object.keys(b)])].every(
    (key) =>
      JSON.stringify(a[key as keyof AssignedCandidate]) ===
      JSON.stringify(b[key as keyof AssignedCandidate]),
  );
}
export function launchCandidate(candidate: AssignedCandidate): Candidate {
  return {
    ...candidate,
    model: candidate.model ?? "",
    tools: candidate.tools ?? [],
    minimum: "",
  };
}
export interface TeamConversation {
  id: string;
  terminalId: string;
  teamId: string;
  teamVersion: number;
  cwd: string;
  parent: Candidate;
  instructionFile: string;
  teamName?: string;
  plan?: ConversationPlan;
  lastActiveAt?: number;
}
export interface TeamTask {
  id: string;
  currentChild?: string;
  conversation: string;
  roleId: string;
  difficulty: Difficulty;
  plan?: number;
  decidedAt?: number;
  revisions: {
    child: string;
    candidate?: AssignedCandidate;
    at: number;
    file?: string;
  }[];
  questions: number;
  decision?: "accept" | "reject";
  reason?: string;
  elapsedMs?: number;
  changes?: Changes;
}
export interface TeamChild {
  id: string;
  task: string;
  conversation: string;
  title: string;
  roleId: string;
  roleName?: string;
  difficulty: Difficulty;
  resumeFile?: string;
  messageFiles?: string[];
  pendingMessageFiles?: string[];
  parentNoticePending?: boolean;
  // Startup idle is not a response; every delivered request waits for activity.
  parentResponse?: "pending" | "active" | "unreported";
  role?: Role;
  teamVersion?: number;
  candidate?: AssignedCandidate;
  terminalId?: string;
  cwd?: string;
  baseCommit?: string;
  worktree: string;
  repository?: {
    mainPath: string;
    commonDir: string;
    name: string;
    external: boolean;
  };
  branch?: string;
  createdWorktree?: string;
  worktreeRemoved?: boolean;
  decision?: "accept" | "reject";
  reason?: string;
  changes?: Changes;
  requestFile: string;
  instructionFile?: string;
  reportFiles: string[];
  questionFiles: string[];
  state:
    | "waiting"
    | "running"
    | "reported"
    | "question"
    | "stopped"
    | "failed"
    | "finished";
  waiting?: "capacity" | "candidates";
  notified?: boolean;
  stoppedBy?: "parent" | "user" | "host_restart" | "parent_exit";
  failure?: string;
  // The failure came from the CLI, not setup or exit: new children of this
  // task skip this assignment. Recovery clears it together with failure.
  cliError?: boolean;
  // Continues this child after its CLI error. Startup moves the handed-over
  // text into requestFile and clears this.
  handoffFrom?: string;
  firstStartedAt?: number;
  endedAt?: number;
  reportedAt?: number;
  questionedAt?: number;
  decidedAt?: number;
  tokens?: TokenUsage;
  waitingReasons?: import("@iori/protocol").CandidateWaitingReason[];
  createdAt: number;
  startedAt?: number;
  elapsedMs?: number;
  workMs?: number;
  elapsedUnavailable?: boolean;
  userInput?: boolean;
  quotedReports?: string[];
}
