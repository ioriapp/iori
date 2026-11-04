// The CI of a worktree's push target as its Forge reports it: runs, their jobs,
// results without jobs, and one job's log (forge.md「CIの詳細」).

/** The Forge's state of a run, job, step or result, in one vocabulary for GitHub and Forgejo. */
export type ForgeCiStatus =
  | "passed"
  | "neutral"
  | "failed"
  | "error"
  | "warning"
  | "cancelled"
  | "timed_out"
  | "startup_failure"
  | "action_required"
  | "stale"
  | "running"
  | "queued"
  | "waiting"
  | "pending"
  | "blocked"
  | "skipped"
  /** A word iori does not know; the item keeps it in `word` as it came. */
  | "other";

/** The group of a status: its mark (the same as the sidebar's CI mark) and its place in the list. */
export type ForgeCiState =
  "failed" | "running" | "passed" | "skipped" | "other";

export function forgeCiState(status: ForgeCiStatus): ForgeCiState {
  switch (status) {
    case "passed":
    case "neutral":
      return "passed";
    case "running":
    case "queued":
    case "waiting":
    case "pending":
    case "blocked":
      return "running";
    case "skipped":
      return "skipped";
    case "other":
      return "other";
    default:
      return "failed";
  }
}

/** Failed first, then running, then passed; skipped, then words iori does not know, last. */
export const forgeCiStateOrder: ForgeCiState[] = [
  "failed",
  "running",
  "passed",
  "skipped",
  "other",
];

type Timing = { startedAt?: number; completedAt?: number };
/** The state, and for a word iori does not know (`other`) the Forge's word. */
export type ForgeCiStatusOf = { status: ForgeCiStatus; word?: string };
export type ForgeCiStep = Timing & ForgeCiStatusOf & { name: string };
export type ForgeCiJob = Timing &
  ForgeCiStatusOf & {
    id: string;
    name: string;
    url?: string;
  };
export type ForgeCiRun = Timing &
  ForgeCiStatusOf & {
    id: string;
    /** The workflow's name. */
    name: string;
    event?: string;
    url?: string;
    /** In the order the Forge lists them. */
    jobs: ForgeCiJob[];
  };
/** A commit status or a check run of another service: it has no job or log. */
export type ForgeCiResult = ForgeCiStatusOf & {
  id: string;
  name: string;
  description?: string;
  url?: string;
};
export type ForgeCi = {
  /**
   * The latest commit of the push target and its CI page on the Forge;
   * absent when the branch has no push target.
   */
  commit?: { sha: string; subject?: string; url: string };
  /** What "Open in browser" opens: a failing run, else a running one, else the commit's CI. */
  url?: string;
  /** Whether this Forge lets iori read runs, jobs and their logs. */
  logs: boolean;
  /** Failed, running, then passed, by workflow name within each. */
  runs: ForgeCiRun[];
  results: ForgeCiResult[];
};
/** One part of a job's log, as the Forge returns it. */
export type ForgeCiLog = {
  /** Byte offset of the first line of `text` in the whole log. */
  start: number;
  /** Byte offset just past `text`. */
  end: number;
  /** The size of the log the Forge has so far. */
  size: number;
  text: string;
  /** The job's steps, when the Forge lists them (GitHub) and the end was read. */
  steps?: ForgeCiStep[];
  /** The Forge gives this job's log only once the job is done (GitHub). */
  availableWhenDone?: true;
  /** The job finished before its first step (GitHub): it has no log. */
  notRun?: true;
};

export interface ForgeCiParams {
  /** `redetect`: the reader's retry also asks again which Forge the site is. */
  "forge.ci": { path: string; redetect?: true };
  /** The end of the log, or the part just before `before`. */
  "forge.ci.log": { path: string; job: string; before?: number };
}
export interface ForgeCiResults {
  "forge.ci": ForgeCi;
  "forge.ci.log": ForgeCiLog;
}
export type ForgeCiMethod = keyof ForgeCiParams;
const methods: ForgeCiMethod[] = ["forge.ci", "forge.ci.log"];
export function isForgeCiMethod(value: unknown): value is ForgeCiMethod {
  return methods.includes(value as ForgeCiMethod);
}

function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error("Expected an object");
  return value as Record<string, unknown>;
}
function path(value: unknown): string {
  if (
    typeof value !== "string" ||
    value.includes("\0") ||
    (!value.startsWith("/") &&
      !/^[A-Za-z]:[\\/]/u.test(value) &&
      !/^(?:\\\\|\/\/)[^\\/]+[\\/][^\\/]+/u.test(value))
  )
    throw new Error("Expected an absolute path");
  return value;
}
export function parseForgeCiParams<M extends ForgeCiMethod>(
  method: M,
  value: unknown,
): ForgeCiParams[M] {
  const v = object(value);
  if (method === "forge.ci")
    return {
      path: path(v.path),
      ...(v.redetect === true ? { redetect: true } : {}),
    } as ForgeCiParams[M];
  // The job ID goes into the Forge's API path; both Forges use numbers.
  if (typeof v.job !== "string" || !/^\d{1,20}$/u.test(v.job))
    throw new Error("Expected a job");
  if (
    v.before !== undefined &&
    (typeof v.before !== "number" ||
      !Number.isSafeInteger(v.before) ||
      v.before < 1)
  )
    throw new Error("Expected a log position");
  return {
    path: path(v.path),
    job: v.job,
    ...(v.before === undefined ? {} : { before: v.before }),
  } as ForgeCiParams[M];
}
// Responses are the Host's own reads; only requests cross a trust boundary.
export const forgeCiResultSchemas = Object.fromEntries(
  methods.map((method) => [method, { parse: (value: unknown) => value }]),
) as {
  [M in ForgeCiMethod]: { parse: (value: unknown) => ForgeCiResults[M] };
};
