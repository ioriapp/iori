import type {
  BoardData,
  BoardSummary,
  RecordsData,
  RecordsFilter,
  TaskHistoryData,
} from "./board.ts";
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
export type Candidate = {
  id: string;
  cli: string;
  cliName?: string;
  model: string;
  effort?: string;
  permission?: string;
  sandbox?: string;
  tools: string[];
  minimum: string;
};
export type Role = {
  id: string;
  name: string;
  when: string;
  limit: string;
  reuse: boolean;
  split: boolean;
  candidates: Record<Difficulty, Candidate[]>;
  instruction: string;
  request: string;
  report: string;
};
export type TeamDefinition = {
  name: string;
  description: string;
  parent: Candidate;
  instruction: string;
  roles: Role[];
};
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
  memo?: string;
};
export type TeamRecord = {
  saved: Team;
  history: TeamHistory[];
  hidden?: boolean;
};
export type TeamSettings = {
  enabled: boolean;
  defaultTeam: string;
  limits: Record<string, string>;
};
export type TeamList = TeamSettings & {
  teams: (TeamRecord & { hidden: boolean })[];
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
export interface TeamParamsByMethod {
  "teams.board": { cwd: string };
  "teams.boards": Record<string, never>;
  "teams.records": RecordsFilter;
  "teams.task.history": { taskId: string };
  "teams.children": { conversation?: string; cwd?: string };
  "teams.child.stop": { childId: string };
  "teams.list": Record<string, never>;
  "teams.read": { teamId: string };
  "teams.create": {
    template?: string;
    language?: "en" | "ja";
    sourceId?: string;
    definition?: TeamDefinition;
    name?: string;
  };
  "teams.save": { teamId: string; definition: TeamDefinition };
  "teams.memo": { teamId: string; version: number; memo: string };
  "teams.restore": { teamId: string; version: number };
  "teams.duplicate": { teamId: string; name?: string };
  "teams.hidden.set": { teamId: string; hidden: boolean };
  "teams.delete": { teamId: string };
  "teams.settings": TeamSettings;
  "cli.models": { cliId: string };
  "cli.help": { command: string };
}
export interface TeamResultByMethod {
  "teams.board": BoardData;
  "teams.boards": { boards: BoardSummary[] };
  "teams.records": RecordsData;
  "teams.task.history": TaskHistoryData;
  "teams.children": { children: ChildSummary[] };
  "teams.child.stop": { childId: string };
  "teams.list": TeamList;
  "teams.read": TeamRecord;
  "teams.create": TeamRecord;
  "teams.save": TeamRecord;
  "teams.memo": TeamRecord;
  "teams.restore": TeamRecord;
  "teams.duplicate": TeamRecord;
  "teams.hidden.set": { teamId: string; hidden: boolean };
  "teams.delete": { teamId: string };
  "teams.settings": TeamSettings;
  "cli.models": CliModels;
  /** The model argument that `<command> --help` shows, and that command. */
  "cli.help": { helpCommand?: string; modelArgument?: string };
}
export type TeamMethod = keyof TeamParamsByMethod;
const methods: TeamMethod[] = [
  "teams.board",
  "teams.boards",
  "teams.records",
  "teams.task.history",
  "teams.children",
  "teams.child.stop",
  "teams.list",
  "teams.read",
  "teams.create",
  "teams.save",
  "teams.memo",
  "teams.restore",
  "teams.duplicate",
  "teams.hidden.set",
  "teams.delete",
  "teams.settings",
  "cli.models",
  "cli.help",
];
export function isTeamMethod(value: unknown): value is TeamMethod {
  return typeof value === "string" && methods.includes(value as TeamMethod);
}
function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error("Expected an object");
  return value as Record<string, unknown>;
}
function text(value: unknown): string {
  if (typeof value !== "string") throw new Error("Expected text");
  return value;
}
function id(value: unknown): string {
  const result = text(value);
  if (!result) throw new Error("Expected an identifier");
  return result;
}
function bool(value: unknown): boolean {
  if (typeof value !== "boolean") throw new Error("Expected a boolean");
  return value;
}
function list<T>(value: unknown, parse: (v: unknown) => T): T[] {
  if (!Array.isArray(value)) throw new Error("Expected a list");
  return value.map(parse);
}
/** Decimal text avoids imposing a numeric ceiling on concurrency settings. */
function limit(value: unknown): string {
  const result = text(value);
  if (result !== "" && !/^[1-9][0-9]*$/u.test(result))
    throw new Error("Expected a positive integer or empty limit");
  return result;
}
export function parseCandidate(value: unknown): Candidate {
  return parseTeamCandidate(value, false);
}
function parseTeamCandidate(value: unknown, allowEmptyCli: boolean): Candidate {
  const v = object(value);
  const minimum = text(v.minimum);
  if (
    minimum !== "" &&
    (!/^\d+(?:\.\d+)?$/u.test(minimum) || Number(minimum) > 100)
  )
    throw new Error("Expected a percentage");
  return {
    id: id(v.id),
    cli: allowEmptyCli ? text(v.cli) : id(v.cli),
    ...(v.cliName === undefined ? {} : { cliName: text(v.cliName) }),
    model: text(v.model),
    ...(v.effort === undefined ? {} : { effort: text(v.effort) }),
    ...(v.permission === undefined ? {} : { permission: text(v.permission) }),
    ...(v.sandbox === undefined ? {} : { sandbox: text(v.sandbox) }),
    tools: list(v.tools, text),
    minimum,
  };
}
function role(value: unknown): Role {
  const v = object(value);
  const c = object(v.candidates);
  return {
    id: id(v.id),
    name: id(v.name),
    when: text(v.when),
    limit: limit(v.limit),
    reuse: bool(v.reuse),
    split: bool(v.split),
    candidates: {
      high: list(c.high, parseCandidate),
      medium: list(c.medium, parseCandidate),
      low: list(c.low, parseCandidate),
    },
    instruction: text(v.instruction),
    request: text(v.request),
    report: text(v.report),
  };
}
export function parseTeamDefinition(value: unknown): TeamDefinition {
  const v = object(value);
  const roles = list(v.roles, role);
  const ids = [
    id(object(v.parent).id),
    ...roles.flatMap((r) => [
      r.id,
      ...Object.values(r.candidates)
        .flat()
        .map((c) => c.id),
    ]),
  ];
  if (
    new Set(ids).size !== ids.length ||
    roles.some((r) => r.id === "overview" || r.id === "parent")
  )
    throw new Error("Repeated or reserved identifier");
  return {
    name: id(v.name),
    description: text(v.description),
    parent: parseTeamCandidate(v.parent, true),
    instruction: text(v.instruction),
    roles,
  };
}
export function parseTeamSettings(value: unknown): TeamSettings {
  const v = object(value);
  return {
    enabled: bool(v.enabled),
    defaultTeam: text(v.defaultTeam),
    limits: Object.fromEntries(
      Object.entries(object(v.limits)).map(([key, value]) => [
        (() => {
          const value: unknown = JSON.parse(key);
          if (
            !Array.isArray(value) ||
            typeof value[0] !== "string" ||
            !value[0] ||
            !["cli", "provider", "model"].includes(value[1]) ||
            typeof value[2] !== "string" ||
            (value[1] === "cli" ? value[2] !== "" : !value[2])
          )
            throw new Error("Expected a concurrency scope");
          return limitKey(value[0], value[1], value[2]);
        })(),
        limit(value),
      ]),
    ),
  };
}
export function parseTeamParams<M extends TeamMethod>(
  method: M,
  value: unknown,
): TeamParamsByMethod[M] {
  const v = object(value);
  let result: unknown;
  switch (method) {
    case "teams.board":
      result = { cwd: id(v.cwd) };
      break;
    case "teams.task.history":
      result = { taskId: id(v.taskId) };
      break;
    case "teams.records":
      for (const value of [v.startAt, v.endAt]) {
        if (
          value !== undefined &&
          (typeof value !== "number" || !Number.isFinite(value))
        )
          throw new Error("Expected a finite date");
      }
      if (
        typeof v.startAt === "number" &&
        typeof v.endAt === "number" &&
        v.startAt > v.endAt
      )
        throw new Error("Expected start before end");
      if (
        v.days !== undefined &&
        (typeof v.days !== "number" || ![7, 30, 90].includes(v.days))
      )
        throw new Error("Expected a period");
      if (
        v.version !== undefined &&
        (typeof v.version !== "number" ||
          !Number.isSafeInteger(v.version) ||
          v.version < 1)
      )
        throw new Error("Expected a version");
      if (
        v.difficulty !== undefined &&
        !["high", "medium", "low"].includes(String(v.difficulty))
      )
        throw new Error("Expected a difficulty");
      result = {
        ...(v.days === undefined ? {} : { days: v.days }),
        ...(v.startAt === undefined ? {} : { startAt: v.startAt }),
        ...(v.endAt === undefined ? {} : { endAt: v.endAt }),
        ...(v.teamId === undefined ? {} : { teamId: id(v.teamId) }),
        ...(v.version === undefined ? {} : { version: v.version }),
        ...(v.difficulty === undefined ? {} : { difficulty: v.difficulty }),
      };
      break;
    case "teams.child.stop":
      result = { childId: id(v.childId) };
      break;
    case "teams.children":
      result = {
        ...(v.conversation === undefined
          ? {}
          : { conversation: id(v.conversation) }),
        ...(v.cwd === undefined ? {} : { cwd: id(v.cwd) }),
      };
      break;
    case "teams.boards":
    case "teams.list":
      result = {};
      break;
    case "cli.models":
      result = { cliId: id(v.cliId) };
      break;
    case "cli.help":
      result = { command: id(v.command) };
      break;
    case "teams.hidden.set":
      if (typeof v.hidden !== "boolean") throw new Error("Expected a boolean");
      result = { teamId: id(v.teamId), hidden: v.hidden };
      break;
    case "teams.settings":
      result = parseTeamSettings(v);
      break;
    case "teams.create":
      if (
        v.template !== undefined &&
        v.language !== "en" &&
        v.language !== "ja"
      )
        throw new Error("Expected a display language");
      result = {
        ...(v.template === undefined ? {} : { template: id(v.template) }),
        ...(v.template === undefined ? {} : { language: v.language }),
        ...(v.sourceId === undefined ? {} : { sourceId: id(v.sourceId) }),
        ...(v.definition === undefined
          ? {}
          : { definition: parseTeamDefinition(v.definition) }),
        ...(v.name === undefined ? {} : { name: id(v.name) }),
      };
      if (
        [v.template, v.sourceId, v.definition].filter((x) => x !== undefined)
          .length !== 1
      )
        throw new Error("Select one source");
      break;
    default:
      result = {
        teamId: id(v.teamId),
        ...(method === "teams.save"
          ? { definition: parseTeamDefinition(v.definition) }
          : {}),
        ...(method === "teams.duplicate" && v.name !== undefined
          ? { name: id(v.name) }
          : {}),
      };
      if (method === "teams.memo" || method === "teams.restore") {
        if (
          typeof v.version !== "number" ||
          !Number.isSafeInteger(v.version) ||
          v.version < 1
        )
          throw new Error("Expected a version");
        result = {
          ...object(result),
          version: v.version,
          ...(method === "teams.memo" ? { memo: text(v.memo) } : {}),
        };
      }
  }
  return result as TeamParamsByMethod[M];
}
/** Host responses are already produced by iori; do not reject saved definitions. */
export const teamResultSchemas = Object.fromEntries(
  methods.map((method) => [method, { parse: (value: unknown) => value }]),
) as {
  [M in TeamMethod]: { parse: (value: unknown) => TeamResultByMethod[M] };
};
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
