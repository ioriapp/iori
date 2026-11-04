import type {
  ForgeCiJob,
  ForgeCiLog,
  ForgeCiResult,
  ForgeCiRun,
  ForgeCiStatus,
  ForgeCiStatusOf,
} from "@iori/protocol";
import { forgejoRequest, http, pages } from "./forgejo.ts";
import { ForgeReadError } from "./failure.ts";
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
  LOG_PART_BYTES,
  type ForgeCiRead,
} from "./ci.ts";

type Json = Record<string, unknown>;

const runStatuses = new Map<string, ForgeCiStatus>([
  ["success", "passed"],
  ["failure", "failed"],
  ["cancelled", "cancelled"],
  ["skipped", "skipped"],
  ["running", "running"],
  ["waiting", "waiting"],
  ["blocked", "blocked"],
  // A job Forgejo has not scheduled yet.
  ["unknown", "waiting"],
]);

const base = ({ owner, repo }: ForgeTarget) =>
  `/api/v1/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}`;

type CommitStatus = ForgeCiStatusOf & {
  context: string;
  description?: string;
  url?: string;
};
async function commitStatusList(target: ForgeTarget, signal?: AbortSignal) {
  const values = (
    await pages(
      target.origin,
      `${base(target)}/commits/${encodeURIComponent(target.sha)}/status`,
      signal,
    )
  ).flatMap((page) => {
    // A commit without statuses has null in place of the list.
    const values = object(page).statuses;
    return values === null ? [] : array(values);
  });
  // A context's later results replace its earlier ones; the newest comes first.
  const seen = new Set<string>();
  const statuses: CommitStatus[] = [];
  for (const value of values) {
    const item = object(value);
    const context = string(item.context);
    if (seen.has(context)) continue;
    seen.add(context);
    statuses.push({
      context,
      ...ciStatus(commitStatusWords, item.status ?? item.state),
      description:
        typeof item.description === "string" && item.description
          ? item.description
          : undefined,
      url: forgeUrl(target.origin, item.target_url),
    });
  }
  return statuses;
}

// The site has no such API, or does not let this request use it (Gitea asks
// for a token): the list is made from the commit statuses instead.
const unusable = (error: unknown) =>
  error instanceof ForgeReadError &&
  [401, 403, 404].includes(error.status ?? 0);

/** Forgejo's runs of the commit, or undefined when the site has no such API. */
async function runList(
  target: ForgeTarget,
  signal?: AbortSignal,
): Promise<Json[] | undefined> {
  const runs: Json[] = [];
  for (let page = 1; ; page += 1) {
    let value: Json;
    try {
      value = object(
        (
          await http(
            `${target.origin}${base(target)}/actions/runs?head_sha=${encodeURIComponent(target.sha)}&limit=50&page=${page}`,
            signal,
          )
        ).value,
      );
    } catch (error) {
      if (unusable(error)) return undefined;
      throw error;
    }
    // Another shape (Gitea's) or a list that ignores the commit is not this API.
    const list = Array.isArray(value.workflow_runs)
      ? value.workflow_runs.map(object)
      : undefined;
    if (
      !list ||
      typeof value.total_count !== "number" ||
      list.some(
        (run) =>
          run.commit_sha !== target.sha ||
          !Number.isSafeInteger(run.id) ||
          !Number.isSafeInteger(run.index_in_repo),
      )
    )
      return undefined;
    runs.push(...list);
    if (!list.length || runs.length >= value.total_count) return runs;
  }
}

async function jobList(
  target: ForgeTarget,
  run: Json,
  signal?: AbortSignal,
): Promise<Json[] | undefined> {
  try {
    return array(
      (
        await http(
          `${target.origin}${base(target)}/actions/runs/${Number(run.id)}/jobs`,
          signal,
        )
      ).value,
    ).map(object);
  } catch (error) {
    if (unusable(error)) return undefined;
    throw error;
  }
}

export async function readForgejoCi(
  target: ForgeTarget,
  signal?: AbortSignal,
): Promise<ForgeCiRead> {
  const statuses = await commitStatusList(target, signal);
  const result = (item: CommitStatus): ForgeCiResult => ({
    id: `status:${item.context}`,
    name: item.context,
    status: item.status,
    ...(item.word ? { word: item.word } : {}),
    ...(item.description ? { description: item.description } : {}),
    ...(item.url ? { url: item.url } : {}),
  });
  const plain = (): ForgeCiRead => ({
    logs: false,
    runs: [],
    results: sortResults(statuses.map(result)),
  });
  const runValues = await runList(target, signal);
  if (!runValues) return plain();
  const matched = new Set<CommitStatus>();
  const runs: ForgeCiRun[] = [];
  for (const run of runValues) {
    const jobValues = await jobList(target, run, signal);
    if (!jobValues) return plain();
    const runUrl = forgeUrl(target.origin, run.html_url);
    const event =
      typeof run.event === "string" && run.event ? run.event : undefined;
    let workflow: string | undefined;
    const jobs = jobValues.map((job, index): ForgeCiJob => {
      if (!Number.isSafeInteger(job.id))
        throw new Error("Invalid Forge response");
      const name = string(job.name);
      // Forgejo reports each job as a commit status "<workflow> / <job> (<event>)".
      const suffix = ` / ${name} (${event ?? ""})`;
      const own = statuses.find(
        (item) =>
          !matched.has(item) &&
          runUrl !== undefined &&
          item.url?.startsWith(`${runUrl}/jobs/`) &&
          item.context.endsWith(suffix),
      );
      if (own) {
        matched.add(own);
        workflow ??= own.context.slice(0, -suffix.length);
      }
      const url = own?.url ?? (runUrl ? `${runUrl}/jobs/${index}` : undefined);
      return {
        id: String(job.id),
        name,
        ...ciStatus(runStatuses, job.status),
        ...(url ? { url } : {}),
      };
    });
    const startedAt = ciTime(run.started);
    const completedAt = ciTime(run.stopped);
    runs.push({
      id: String(run.id),
      name: workflow || string(run.workflow_id),
      ...(event ? { event } : {}),
      ...ciStatus(runStatuses, run.status),
      ...(startedAt ? { startedAt } : {}),
      ...(completedAt && startedAt && completedAt >= startedAt
        ? { completedAt }
        : {}),
      ...(runUrl ? { url: runUrl } : {}),
      jobs,
    });
  }
  return {
    logs: true,
    runs: sortRuns(runs),
    results: sortResults(
      statuses.filter((item) => !matched.has(item)).map(result),
    ),
  };
}

export async function readForgejoCiLog(
  target: ForgeTarget,
  job: string,
  before: number | undefined,
  signal?: AbortSignal,
): Promise<ForgeCiLog> {
  const range =
    before === undefined
      ? `bytes=-${LOG_PART_BYTES}`
      : `bytes=${Math.max(0, before - LOG_PART_BYTES)}-${before - 1}`;
  let response: Response;
  try {
    response = await forgejoRequest(
      `${target.origin}${base(target)}/actions/jobs/${job}/logs`,
      signal,
      // No byte of an empty log can be served.
      { headers: { Range: range }, answers: [416] },
    );
  } catch (error) {
    if (!(error instanceof ForgeReadError && error.status === 404)) throw error;
    // The repository reads with the same token: the job has no log.
    const readable = await http(`${target.origin}${base(target)}`, signal)
      .then(() => true)
      .catch(() => false);
    signal?.throwIfAborted();
    if (!readable) throw error;
    return { start: 0, end: 0, size: 0, text: "" };
  }
  if (response.status === 416) {
    await response.body?.cancel().catch(() => undefined);
    return { start: 0, end: 0, size: 0, text: "" };
  }
  const bytes = new Uint8Array(await response.arrayBuffer());
  const served = /^bytes (\d+)-\d+\/(\d+)$/u.exec(
    response.headers.get("content-range") ?? "",
  );
  if (response.status === 206 && served)
    return logPart(bytes, Number(served[1]), Number(served[2]));
  // The site sent the whole log; only the part asked for crosses to the Client.
  const { start, end } = logRange(before, bytes.length);
  return logPart(bytes.subarray(start, end), start, bytes.length);
}
