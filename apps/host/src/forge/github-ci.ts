import type {
  ForgeCiJob,
  ForgeCiLog,
  ForgeCiResult,
  ForgeCiRun,
  ForgeCiStatus,
  ForgeCiStatusOf,
  ForgeCiStep,
} from "@iori/protocol";
import {
  GhRepositoryUnreadable,
  githubPages,
  githubText,
  withGitHubAccount,
} from "./github.ts";
import {
  array,
  object,
  string,
  forgeUrl,
  type ForgeTarget,
} from "./response.ts";
import {
  ciStatus,
  ciTime,
  commitStatusWords,
  logPart,
  logRange,
  sortResults,
  sortRuns,
  type CiLogKeep,
  type ForgeCiRead,
} from "./ci.ts";
import type { ForgeRepository } from "./types.ts";

type Json = Record<string, unknown>;

const unfinished = new Map<string, ForgeCiStatus>([
  ["queued", "queued"],
  ["requested", "queued"],
  ["pending", "queued"],
  ["waiting", "waiting"],
  ["in_progress", "running"],
]);
const conclusions = new Map<string, ForgeCiStatus>([
  ["success", "passed"],
  ["failure", "failed"],
  ["neutral", "neutral"],
  ["cancelled", "cancelled"],
  ["skipped", "skipped"],
  ["timed_out", "timed_out"],
  ["action_required", "action_required"],
  ["stale", "stale"],
  ["startup_failure", "startup_failure"],
]);
/** Runs, check runs and steps share GitHub's status and conclusion. */
export function githubStatus(value: Json): ForgeCiStatusOf {
  return value.status === "completed"
    ? ciStatus(conclusions, value.conclusion)
    : ciStatus(unfinished, value.status);
}

/** CI is read with the account the PR・CI marks would use. */
const withAccount = <T>(
  target: ForgeTarget,
  repository: ForgeRepository | undefined,
  read: (env: NodeJS.ProcessEnv) => Promise<T>,
  signal?: AbortSignal,
) =>
  repository
    ? withGitHubAccount(repository, target.owner, read, signal)
    : read(process.env);

const path = ({ owner, repo }: ForgeTarget) =>
  `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}`;

/**
 * A read inside the repository (a job, its log, a commit's results): its 404
 * with an account that reads the repository means the item is not there, so
 * no other account is tried for it.
 */
async function item<T>(
  target: ForgeTarget,
  env: NodeJS.ProcessEnv,
  signal: AbortSignal | undefined,
  read: () => Promise<T>,
): Promise<T | undefined> {
  try {
    return await read();
  } catch (error) {
    if (!(error instanceof GhRepositoryUnreadable)) throw error;
    // Unreadable here too: the account cannot read the repository.
    await githubPages(path(target), env, signal);
    return undefined;
  }
}

const timing = (startedAt: number | undefined, completedAt?: number) => ({
  ...(startedAt ? { startedAt } : {}),
  ...(startedAt && completedAt && completedAt >= startedAt
    ? { completedAt }
    : {}),
});

export function readGitHubCi(
  target: ForgeTarget,
  repository?: ForgeRepository,
  signal?: AbortSignal,
): Promise<ForgeCiRead> {
  return withAccount(
    target,
    repository,
    (env) => readCi(target, env, signal),
    signal,
  );
}

async function readCi(
  target: ForgeTarget,
  env: NodeJS.ProcessEnv,
  signal?: AbortSignal,
): Promise<ForgeCiRead> {
  const { origin, sha } = target;
  const commit = `${path(target)}/commits/${encodeURIComponent(sha)}`;
  const read = async (endpoint: string, field: string) =>
    (await githubPages(endpoint, env, signal))
      .flatMap((page) => array(object(page)[field]))
      .map(object);
  const runValues = await read(
    `${path(target)}/actions/runs?head_sha=${encodeURIComponent(sha)}&per_page=100`,
    "workflow_runs",
  );
  // Each job of a workflow run is a check run of the run's check suite.
  const checkValues =
    (await item(target, env, signal, () =>
      read(`${commit}/check-runs?per_page=100`, "check_runs"),
    )) ?? [];
  const statusValues =
    (await item(target, env, signal, () =>
      read(`${commit}/status?per_page=100`, "statuses"),
    )) ?? [];

  const suites = new Set(runValues.map((run) => run.check_suite_id));
  const jobsBySuite = new Map<unknown, Json[]>();
  const results: ForgeCiResult[] = [];
  for (const check of checkValues) {
    const suite = check.check_suite ? object(check.check_suite).id : undefined;
    const app = check.app ? object(check.app).slug : undefined;
    if (app === "github-actions" && suites.has(suite)) {
      jobsBySuite.set(suite, [...(jobsBySuite.get(suite) ?? []), check]);
      continue;
    }
    const output = check.output ? object(check.output) : undefined;
    const url =
      forgeUrl(origin, check.html_url) ?? forgeUrl(origin, check.details_url);
    results.push({
      id: `check:${String(check.id)}`,
      name: string(check.name),
      ...githubStatus(check),
      ...(typeof output?.title === "string" && output.title
        ? { description: output.title }
        : {}),
      ...(url ? { url } : {}),
    });
  }
  // A context's later results replace its earlier ones; the newest comes first.
  const contexts = new Set<string>();
  for (const item of statusValues) {
    const context = string(item.context);
    if (contexts.has(context)) continue;
    contexts.add(context);
    const url = forgeUrl(origin, item.target_url);
    results.push({
      id: `status:${context}`,
      name: context,
      ...ciStatus(commitStatusWords, item.state),
      ...(typeof item.description === "string" && item.description
        ? { description: item.description }
        : {}),
      ...(url ? { url } : {}),
    });
  }

  const runs = runValues.map((run): ForgeCiRun => {
    const url = forgeUrl(origin, run.html_url);
    const jobs = (jobsBySuite.get(run.check_suite_id) ?? [])
      // Jobs are created in the workflow's order; their IDs keep it.
      .sort((a, b) => Number(a.id) - Number(b.id))
      .map((job): ForgeCiJob => {
        const jobUrl =
          forgeUrl(origin, job.details_url) ?? forgeUrl(origin, job.html_url);
        if (!Number.isSafeInteger(job.id))
          throw new Error("Invalid Forge response");
        return {
          id: String(job.id),
          name: string(job.name),
          ...githubStatus(job),
          ...timing(ciTime(job.started_at), ciTime(job.completed_at)),
          ...(jobUrl ? { url: jobUrl } : {}),
        };
      });
    return {
      id: String(run.id),
      name:
        typeof run.name === "string" && run.name ? run.name : string(run.path),
      ...(typeof run.event === "string" && run.event
        ? { event: run.event }
        : {}),
      ...githubStatus(run),
      ...timing(
        ciTime(run.run_started_at),
        run.status === "completed" ? ciTime(run.updated_at) : undefined,
      ),
      ...(url ? { url } : {}),
      jobs,
    };
  });
  return { logs: true, runs: sortRuns(runs), results: sortResults(results) };
}

export async function readGitHubCiLog(
  target: ForgeTarget,
  job: string,
  before: number | undefined,
  repository?: ForgeRepository,
  signal?: AbortSignal,
  keep?: CiLogKeep,
): Promise<ForgeCiLog> {
  // gh follows the log's redirect without passing a Range, so the whole log
  // arrives here; only the part asked for crosses to the Client. Earlier parts
  // of the same job come from what this reader kept.
  const key = JSON.stringify([target.origin, target.owner, target.repo, job]);
  const part = (bytes: Uint8Array) => {
    const { start, end } = logRange(before, bytes.length);
    return logPart(bytes.subarray(start, end), start, bytes.length);
  };
  if (before !== undefined && keep?.key === key && keep.bytes)
    return part(keep.bytes);
  // Reading another job's end lets the kept log go.
  if (keep && before === undefined) {
    keep.key = undefined;
    keep.bytes = undefined;
  }
  return withAccount(
    target,
    repository,
    async (env): Promise<ForgeCiLog> => {
      const none: ForgeCiLog = { start: 0, end: 0, size: 0, text: "" };
      let steps: ForgeCiStep[] | undefined;
      if (before === undefined) {
        const value = await item(target, env, signal, async () =>
          object(
            (
              await githubPages(
                `${path(target)}/actions/jobs/${job}`,
                env,
                signal,
              )
            )[0],
          ),
        );
        if (!value) return none;
        steps = array(value.steps)
          .map(object)
          .sort((a, b) => Number(a.number) - Number(b.number))
          .map((step) => ({
            name: string(step.name),
            ...githubStatus(step),
            ...timing(ciTime(step.started_at), ciTime(step.completed_at)),
          }));
        // GitHub answers 404 for the log of a job that is not done.
        if (value.status !== "completed")
          return { ...none, steps, availableWhenDone: true };
        // A job cancelled or skipped before its first step has no log.
        if (!steps.length) return { ...none, steps, notRun: true };
      }
      const text = await item(target, env, signal, () =>
        githubText(`${path(target)}/actions/jobs/${job}/logs`, env, signal),
      );
      if (text === undefined) return { ...none, ...(steps ? { steps } : {}) };
      const bytes = new TextEncoder().encode(text);
      // GitHub gives only a done job's log, so it no longer changes.
      if (keep) {
        keep.key = key;
        keep.bytes = bytes;
      }
      return { ...part(bytes), ...(steps ? { steps } : {}) };
    },
    signal,
  );
}
