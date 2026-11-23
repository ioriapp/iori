import * as v from "valibot";
import {
  schema,
  fail,
  integer,
  identifier,
  decoded,
  record,
} from "./primitives.ts";
import type { CliSummary, CliStatus } from "./cli.ts";
export type ChildSummary = {
  id: string;
  createdAt: number;
  conversation: string;
  parentTerminalId: string;
  parentCwd: string;
  teamId: string;
  role?: string;
  title: string;
  terminalId?: string;
  cwd?: string;
  createdWorktree?: boolean;
  worktreeRemoved?: boolean;
  repositoryName?: string;
  branch?: string;
  cli?: CliSummary;
  model?: string;
  cliStatus?: CliStatus;
  state:
    | "waiting"
    | "starting"
    | "running"
    | "reported"
    | "question"
    | "stopped"
    | "failed"
    | "finished";
  waiting?: "capacity" | "candidates";
  stoppedBy?: "parent" | "user" | "host_restart" | "parent_exit";
  decision?: "accept" | "reject";
  reason?: string;
  failure?: string;
  startedAt?: number;
  elapsedMs?: number;
  notified?: boolean;
};
/** Work a team child is doing that stopping it would lose. */
export type ChildWorkState = "running" | "approval" | "question";
/**
 * What the sidebar shows for a child as work in progress, from the same rules
 * as its status: a CLI that keeps running after the report is still working.
 */
export function childWorkState(
  child: Pick<ChildSummary, "state" | "cliStatus">,
): ChildWorkState | undefined {
  if (
    child.state === "finished" ||
    child.state === "stopped" ||
    child.state === "failed" ||
    child.state === "waiting" ||
    child.state === "starting"
  )
    return undefined;
  if (child.cliStatus?.state === "waiting")
    return child.cliStatus.attention?.kind === "question"
      ? "question"
      : "approval";
  if (
    child.cliStatus?.state === "active" &&
    (child.state === "reported" || child.state === "question")
  )
    return "running";
  if (child.state === "question") return "question";
  if (child.state === "reported") return undefined;
  return "running";
}
/** Work that stopping a CLI would interrupt, shared by removal confirmations. */
export function cliWorkState(
  status: CliStatus | undefined,
  child?: Pick<ChildSummary, "state">,
): ChildWorkState | undefined {
  if (child) return childWorkState({ ...child, cliStatus: status });
  if (status?.state === "active") return "running";
  if (status?.state !== "waiting") return undefined;
  return status.attention?.kind === "question" ? "question" : "approval";
}

/** Teams are Host-owned; CLI values retain their own names. */
export type Difficulty = "high" | "medium" | "low";
/** Default for `TeamDefinition.backgroundWakeMinutes`. */
export const defaultBackgroundWakeMinutes = 15;
/** Largest minutes value for team intervals (one day). */
export const maxTeamIntervalMinutes = 1440;
export type Team = TeamDefinition & {
  id: string;
  version: number;
  updated: string;
};
export type TeamChange = {
  item: string;
  name?: string;
  action: "added" | "removed" | "changed";
};
export type TeamHistory = {
  team: Team;
  summary: string;
  changes?: TeamChange[];
  restoredFrom?: number;
  overwrote?: number;
  memo?: string;
};
export type TeamRecord = {
  saved: Team;
  history: TeamHistory[];
  hidden?: boolean;
};
export type TeamList = TeamSettings & {
  teams: (TeamRecord & { hidden: boolean; conversationCount?: number })[];
  templates: Record<string, TeamDefinition>;
  cliNames: Record<string, string>;
  usageClis?: string[];
};
export type CliModel = { name: string; label?: string; efforts: string[] };
export type PermissionField = {
  key: "permission" | "sandbox" | "tools";
  label: string;
  options: string[];
  multiple?: boolean;
};
export type CliModels = {
  models: CliModel[];
  permissions: PermissionField[];
  permissionNote?: string;
  errorDetail?: string;
  error?: "command_failed" | "unsupported" | "invalid_output" | "not_found";
};

const candidateFields = {
  id: identifier,
  cli: identifier,
  cliName: v.optional(v.string()),
  model: v.string(),
  effort: v.optional(v.string()),
  permission: v.optional(v.string()),
  sandbox: v.optional(v.string()),
  tools: v.array(v.string()),
  minimum: v.pipe(
    v.string(),
    v.check(
      (text) =>
        text === "" || (/^\d+(?:\.\d+)?$/u.test(text) && Number(text) <= 100),
    ),
  ),
  minimumWindow: v.optional(
    v.object({
      minutes: v.pipe(
        v.number(),
        v.finite(),
        v.check((n) => n > 0),
      ),
      name: v.optional(identifier),
    }),
  ),
};
export const candidate = v.object(candidateFields);
export type Candidate = v.InferOutput<typeof candidate>;
export const parseCandidate = schema(candidate).parse;

const limit = v.pipe(v.string(), v.regex(/^(?:[1-9][0-9]*)?$/u));
const candidates = v.array(candidate);
const role = v.object({
  id: identifier,
  name: identifier,
  when: v.string(),
  limit,
  reuse: v.boolean(),
  split: v.boolean(),
  candidates: v.object({
    high: candidates,
    medium: candidates,
    low: candidates,
  }),
  instruction: v.string(),
  request: v.string(),
  report: v.string(),
});
export type Role = v.InferOutput<typeof role>;
export const teamDefinition = v.pipe(
  v.object({
    name: identifier,
    description: v.string(),
    parent: v.object({ ...candidateFields, cli: v.string() }),
    instruction: v.string(),
    roles: v.array(role),
    parentInput: v.optional(v.unknown()),
    // An absent check interval is off. Background checks default to 15 minutes,
    // and an explicit zero turns them off.
    checkMinutes: v.optional(integer(1, maxTeamIntervalMinutes)),
    backgroundWakeMinutes: v.optional(integer(0, maxTeamIntervalMinutes)),
  }),
  v.check(({ parent, roles }) => {
    const ids = [
      parent.id,
      ...roles.flatMap((role) => [
        role.id,
        ...Object.values(role.candidates)
          .flat()
          .map((c) => c.id),
      ]),
    ];
    return (
      new Set(ids).size === ids.length &&
      roles.every((role) => role.id !== "overview" && role.id !== "parent")
    );
  }),
  v.transform(({ parentInput, ...team }) => ({
    ...team,
    ...(parentInput === true ? { parentInput: true } : {}),
  })),
);
export type TeamDefinition = v.InferOutput<typeof teamDefinition>;
export const parseTeamDefinition = schema(teamDefinition).parse;

const concurrencyScope = schema(
  v.tuple([identifier, v.picklist(["cli", "provider", "model"]), v.string()]),
);
const concurrencyLimit = schema(limit);
export const teamSettings = v.object({
  defaultTeam: v.string(),
  limits: decoded((value) =>
    Object.fromEntries(
      Object.entries(record(value)).map(([key, maximum]) => {
        const [cli, kind, name] = concurrencyScope.parse(JSON.parse(key));
        if (kind === "cli" ? name !== "" : !name)
          return fail("Expected a concurrency scope");
        return [
          limitKey(cli, kind, name),
          concurrencyLimit.parse(maximum),
        ] as const;
      }),
    ),
  ),
});
export type TeamSettings = v.InferOutput<typeof teamSettings>;
export const parseTeamSettings = schema(teamSettings).parse;
export function modelProvider(model: string): string {
  const slash = model.indexOf("/");
  return slash > 0 ? model.slice(0, slash) : "";
}
export function groupModels(models: string[]): Record<string, string[]> {
  const groups = new Map<string, string[]>();
  for (const model of models) {
    const provider = modelProvider(model);
    const values = groups.get(provider) ?? [];
    values.push(model);
    groups.set(provider, values);
  }
  return Object.fromEntries(groups);
}

export type ConcurrencyLimitTarget = {
  cli: string;
  kind: "cli" | "provider" | "model";
  name: string;
};
export function limitKey(
  cli: string,
  kind: ConcurrencyLimitTarget["kind"],
  name = "",
): string {
  return JSON.stringify([cli, kind, name]);
}
export function limitTarget(key: string): ConcurrencyLimitTarget {
  const [cli, kind, name] = JSON.parse(key) as [
    string,
    ConcurrencyLimitTarget["kind"],
    string,
  ];
  return { cli, kind, name };
}
