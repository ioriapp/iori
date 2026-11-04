import { parseArgs } from "node:util";
import {
  forgeCiState,
  type ForgeCiLog,
  type ForgeCiStatusOf,
  type ForgeIssueState,
  type ForgeIssueSummary,
  type ForgeReadFailure,
} from "@iori/protocol";
import type { HostStore } from "./store.ts";
import type { ForgeDetection } from "./forge/adapters.ts";
import type { CiLogKeep } from "./forge/ci.ts";
import { forgeReadFailure } from "./forge/failure.ts";
import { repositoryIssues, type RepositoryIssues } from "./forge-issues.ts";
import { ForgeCiFailure, readForgeCi, readForgeCiLog } from "./forge-ci.ts";
import {
  createPullRequest,
  PullRequestFailure,
  type PullRequestInput,
} from "./forge/pull-requests.ts";

/** `iori` commands that read the Forge, for every CLI that iori starts (forge.md). */
export const forgeCommandUsage = `iori issue list [--state open|closed|all] [--label NAME]... [--limit N]
iori issue show N
iori ci list
iori ci log [JOB_ID]
iori pr create --title TITLE [--body TEXT | --body - | --file PATH] [--issue N]`;

export type ForgeCommand =
  | {
      kind: "issue-list";
      state: ForgeIssueState | "all";
      labels: string[];
      limit: number;
    }
  | { kind: "issue-show"; number: number }
  | { kind: "ci-list" }
  | { kind: "ci-log"; job?: string }
  | ({ kind: "pr-create" } & PullRequestInput);

type Answer = { ok: boolean; text: string; data?: unknown };

// gh issue list shows 30 Issues unless --limit asks for another number.
const DEFAULT_ISSUE_LIMIT = 30;

/** Undefined when `argv` names no Forge command; throws the usage when it is malformed. */
export function parseForgeCommand(argv: unknown): ForgeCommand | undefined {
  if (!Array.isArray(argv) || argv.some((value) => typeof value !== "string"))
    return undefined;
  const [group, action, ...args] = argv as string[];
  if (group !== "issue" && group !== "ci" && group !== "pr") return undefined;
  const usage = () => new Error(forgeCommandUsage);
  const parse = <T>(read: () => T): T => {
    try {
      return read();
    } catch {
      throw usage();
    }
  };
  const count = (value: string | undefined, name: string) => {
    const number = Number(value);
    if (!/^[1-9][0-9]*$/u.test(value ?? "") || !Number.isSafeInteger(number))
      throw new Error(`Expected a number: ${name}.`);
    return number;
  };
  if (group === "pr" && action === "create") {
    // The Rust command already turns --file and --body - into --body TEXT.
    const { values, positionals } = parse(() =>
      parseArgs({
        args,
        allowPositionals: true,
        options: {
          title: { type: "string" },
          body: { type: "string" },
          issue: { type: "string" },
        },
      }),
    );
    if (positionals.length) throw usage();
    if (!values.title?.trim()) throw new Error("Required: --title.");
    return {
      kind: "pr-create",
      title: values.title,
      body: values.body ?? "",
      ...(values.issue === undefined
        ? {}
        : { issue: count(values.issue, "--issue") }),
    };
  }
  if (group === "issue" && action === "list") {
    const { values, positionals } = parse(() =>
      parseArgs({
        args,
        allowPositionals: true,
        options: {
          state: { type: "string" },
          label: { type: "string", multiple: true },
          limit: { type: "string" },
        },
      }),
    );
    if (positionals.length) throw usage();
    const state = values.state ?? "open";
    if (state !== "open" && state !== "closed" && state !== "all")
      throw new Error("--state: open|closed|all.");
    return {
      kind: "issue-list",
      state,
      labels: values.label ?? [],
      limit:
        values.limit === undefined
          ? DEFAULT_ISSUE_LIMIT
          : count(values.limit, "--limit"),
    };
  }
  const { positionals } = parse(() =>
    parseArgs({ args, allowPositionals: true }),
  );
  if (group === "issue" && action === "show") {
    if (positionals.length !== 1) throw usage();
    return { kind: "issue-show", number: count(positionals[0], "N") };
  }
  if (group === "ci" && action === "list") {
    if (positionals.length) throw usage();
    return { kind: "ci-list" };
  }
  if (group === "ci" && action === "log") {
    if (positionals.length > 1) throw usage();
    const job = positionals[0];
    // The job ID goes into the Forge's API path; both Forges use numbers.
    if (job !== undefined && !/^\d{1,20}$/u.test(job))
      throw new Error("Expected a job ID from iori ci list.");
    return { kind: "ci-log", ...(job === undefined ? {} : { job }) };
  }
  throw usage();
}

const time = (at: number) => new Date(at).toISOString();
const status = ({ status, word }: ForgeCiStatusOf) =>
  status === "other" ? (word ?? "unknown") : status;
const settings = "iori: Settings > Integrations of this Host";

/** A failed read in a short English sentence, with what helps (forge.md「失敗の示し方」). */
function forgeFailureText(failure: ForgeReadFailure, write = false): string {
  // iori reads GitHub at github.com with the Host's gh sign-in.
  const github = failure.site === "https://github.com";
  const signIn = "Run gh auth login in a Terminal on this Host.";
  switch (failure.reason) {
    case "token-missing":
      return github
        ? failure.ghMissing
          ? "gh was not found on this Host. Install gh, then run gh auth login in a Terminal on this Host."
          : `This Host's gh is not signed in to GitHub. ${signIn}`
        : `No token is registered for ${failure.site}. Register one in ${settings}.`;
    case "token-invalid":
      return github
        ? `GitHub does not accept this Host's gh sign-in. ${signIn}`
        : `${failure.site} does not accept the token. Replace it in ${settings}.`;
    case "insufficient-scope":
      return github
        ? `No GitHub account on this Host can ${write ? "write to" : "read"} this repository. Check the accounts in ${settings}.`
        : `The token for ${failure.site} does not have the ${failure.scope ?? "needed"} permission. Replace it in ${settings}.`;
    case "not-found":
      return `The repository${failure.repository ? ` ${failure.repository}` : ""} was not found on ${failure.site}. Check the remote and its Web site in iori: the workspace's Git settings.`;
    case "unreachable":
      return `Cannot connect to ${failure.site}. Try again.`;
    case "rate-limited":
      return failure.resetAt === undefined
        ? `${failure.site} has reached its API rate limit. Try again later.`
        : `${failure.site} has reached its API rate limit. Try again after ${time(failure.resetAt)}.`;
  }
}

const failed = (text: string): Answer => ({ ok: false, text });
// A deleted account can leave an Issue or comment without its author.
const by = (author: string) => (author ? ` by ${author}` : "");
const gitUnreadable = failed(
  "iori could not read this worktree's Git repository.",
);
// The site did not answer as GitHub, Forgejo or Gitea, or did not answer.
const noForge = failed(
  "iori did not find this worktree's remote on GitHub, Forgejo or Gitea. Check the remote and its Web site in iori: the workspace's Git settings, then try again.",
);

function issueRow(issue: ForgeIssueSummary) {
  return {
    number: issue.number,
    state: issue.state,
    title: issue.title,
    labels: issue.labels.map((label) => label.name),
    updatedAt: time(issue.updatedAt),
  };
}

async function listIssues(
  { reader, target, context, repository }: RepositoryIssues,
  { state, labels, limit }: Extract<ForgeCommand, { kind: "issue-list" }>,
): Promise<Answer> {
  const name = `${repository.owner}/${repository.repo}`;
  if (!(await reader.enabled(target, context)))
    return {
      ok: true,
      text: `${name} does not use Issues.`,
      data: { repository, issues: [], more: false },
    };
  // Forgejo drops label names the repository lacks instead of matching
  // nothing; every Issue listed has all the labels asked for, as on GitHub.
  const wanted = labels.map((label) => label.toLowerCase());
  const matches = (issue: ForgeIssueSummary) =>
    wanted.every((label) =>
      issue.labels.some((item) => item.name.toLowerCase() === label),
    );
  // Read on past the limit, so "more" is said only when more exist.
  const issues: ForgeIssueSummary[] = [];
  const seen = new Set<number>();
  for (let page = 1, hasMore = true; hasMore && issues.length <= limit;) {
    const result = await reader.list(target, { state, labels, page }, context);
    // An Issue opened meanwhile moves the rest down a page.
    for (const issue of result.issues)
      if (!seen.has(issue.number) && matches(issue)) {
        seen.add(issue.number);
        issues.push(issue);
      }
    hasMore = result.hasMore;
    page++;
  }
  const more = issues.length > limit;
  const shown = issues.slice(0, limit).map(issueRow);
  const which = `${state === "all" ? "" : `${state} `}Issues`;
  const filter = labels.length
    ? ` with the label${labels.length > 1 ? "s" : ""} ${labels.join(", ")}`
    : "";
  const text = shown.length
    ? [
        `${which[0]!.toUpperCase()}${which.slice(1)} of ${name} (${repository.forge.label})${filter}, newest first:`,
        ...shown.map(
          (issue) =>
            `#${issue.number} ${issue.title}${issue.labels.length ? ` [${issue.labels.join(", ")}]` : ""} · ${issue.state} · updated ${issue.updatedAt}`,
        ),
        ...(more ? ["More Issues exist; use --limit to show more."] : []),
      ].join("\n")
    : `There are no ${which}${filter} in ${name}.`;
  return { ok: true, text, data: { repository, issues: shown, more } };
}

async function showIssue(
  { reader, target, context, repository }: RepositoryIssues,
  number: number,
): Promise<Answer> {
  const [issue, thread] = await Promise.all([
    reader.issue(target, number, context),
    reader.comments(target, number, context),
  ]);
  const name = `${repository.owner}/${repository.repo}`;
  // A removed or moved Issue: the repository reads, the Issue does not.
  if (!issue || !thread)
    return failed(`Issue #${number} was not found in ${name}.`);
  const data = {
    repository,
    issue: {
      number: issue.number,
      title: issue.title,
      state: issue.state,
      author: issue.author,
      labels: issue.labels.map((label) => label.name),
      createdAt: time(issue.createdAt),
      body: issue.body,
      comments: thread.map((comment) => ({
        author: comment.author,
        createdAt: time(comment.createdAt),
        body: comment.body,
      })),
    },
  };
  const { labels, comments } = data.issue;
  // The body and comments are as the Forge returned them.
  const text = [
    `#${issue.number} ${issue.title}`,
    `${issue.state} · opened${by(issue.author)} on ${data.issue.createdAt}${labels.length ? ` · labels: ${labels.join(", ")}` : ""} · ${comments.length} comments`,
    ...(issue.body ? ["", issue.body] : []),
    ...comments.flatMap((comment) => [
      "",
      `--- comment${by(comment.author)} on ${comment.createdAt} ---`,
      comment.body,
    ]),
  ].join("\n");
  return { ok: true, text, data };
}

async function readIssues(
  path: string,
  command: Extract<ForgeCommand, { kind: "issue-list" | "issue-show" }>,
  store: HostStore,
  detection: ForgeDetection,
): Promise<Answer> {
  let issues: RepositoryIssues | undefined;
  try {
    // Every command asks the site again which Forge it is, as a reload does.
    issues = await repositoryIssues(path, store, detection, undefined, true);
    if (!issues) return noForge;
    return command.kind === "issue-list"
      ? await listIssues(issues, command)
      : await showIssue(issues, command.number);
  } catch (error) {
    const { target } = issues ?? {};
    if (!target) return gitUnreadable;
    return failed(
      forgeFailureText(
        forgeReadFailure(
          error,
          target.origin,
          `${target.owner}/${target.repo}`,
        ),
      ),
    );
  }
}

/** The whole log of a job, read from its end as the CI View reads it. */
async function wholeLog(
  read: (before?: number) => Promise<ForgeCiLog>,
): Promise<ForgeCiLog> {
  const end = await read();
  let { start, text } = end;
  while (start > 0) {
    const earlier = await read(start);
    if (earlier.start >= start) break;
    text = earlier.text + text;
    start = earlier.start;
  }
  return { ...end, start, text };
}

function logText(job: string, log: ForgeCiLog): string {
  if (log.availableWhenDone)
    return `GitHub gives the log of job ${job} only after the job finishes. Try again when it is done.`;
  if (log.notRun) return `Job ${job} did not run.`;
  return log.text || `Job ${job} has no log.`;
}

async function readCi(
  path: string,
  command: Extract<ForgeCommand, { kind: "ci-list" | "ci-log" }>,
  store: HostStore,
  detection: ForgeDetection,
): Promise<Answer> {
  // GitHub sends a job's whole log at once; keep it while reading its parts.
  const keep: CiLogKeep = {};
  // Every command asks the site again which Forge it is, as a reload does.
  let redetect = true;
  const log = async (job: string) =>
    wholeLog((before) => {
      const read = readForgeCiLog(
        path,
        job,
        before,
        store,
        detection,
        undefined,
        keep,
        redetect,
      );
      redetect = false;
      return read;
    });
  try {
    if (command.kind === "ci-log" && command.job) {
      const read = await log(command.job);
      return {
        ok: true,
        text: logText(command.job, read),
        data: { jobs: [{ id: command.job, ...logData(read) }] },
      };
    }
    const ci = await readForgeCi(path, store, detection, undefined, redetect);
    redetect = false;
    if (!ci.commit)
      return {
        ok: true,
        text: "This branch has no push target. Push it to see the CI of its commit.",
        data: { runs: [], results: [] },
      };
    const commit = {
      sha: ci.commit.sha,
      ...(ci.commit.subject ? { subject: ci.commit.subject } : {}),
      url: ci.commit.url,
    };
    const short = commit.sha.slice(0, 7);
    if (command.kind === "ci-log") {
      if (!ci.logs)
        return failed(
          `This Forge does not let iori read job logs. Open the CI in a browser: ${ci.url ?? commit.url}`,
        );
      const jobs = ci.runs.flatMap((run) =>
        run.jobs
          .filter((job) => forgeCiState(job.status) === "failed")
          .map((job) => ({ run, job })),
      );
      if (!jobs.length)
        return {
          ok: true,
          text: `No job failed in the CI of commit ${short}. Name a job from iori ci list to read its log.`,
          data: { commit, jobs: [] },
        };
      const reads = [];
      for (const { run, job } of jobs)
        reads.push({ run, job, log: await log(job.id) });
      return {
        ok: true,
        text: reads
          .map(
            ({ run, job, log }) =>
              `=== log of job ${job.id} "${job.name}" (${status(job)}) in "${run.name}" ===\n${logText(job.id, log)}`,
          )
          .join("\n\n"),
        data: {
          commit,
          jobs: reads.map(({ job, log }) => ({
            id: job.id,
            name: job.name,
            status: status(job),
            ...logData(log),
          })),
        },
      };
    }
    const runs = ci.runs.map((run) => ({
      id: run.id,
      name: run.name,
      ...(run.event ? { event: run.event } : {}),
      status: status(run),
      jobs: run.jobs.map((job) => ({
        id: job.id,
        name: job.name,
        status: status(job),
      })),
    }));
    const results = ci.results.map((result) => ({
      name: result.name,
      status: status(result),
      ...(result.description ? { description: result.description } : {}),
    }));
    const text =
      runs.length || results.length
        ? [
            `CI of commit ${short}${commit.subject ? ` "${commit.subject}"` : ""}:`,
            ...runs.flatMap((run) => [
              `${run.status}  ${run.name}${run.event ? ` (${run.event})` : ""} · run ${run.id}`,
              ...run.jobs.map(
                (job) => `  ${job.status}  ${job.name} · job ${job.id}`,
              ),
            ]),
            ...results.map(
              (result) =>
                `${result.status}  ${result.name}${result.description ? `: ${result.description}` : ""} (no job)`,
            ),
            ...(ci.logs
              ? []
              : ["This Forge does not let iori read jobs and their logs."]),
          ].join("\n")
        : `There is no CI for commit ${short}.`;
    return { ok: true, text, data: { commit, runs, results } };
  } catch (error) {
    if (error instanceof ForgeCiFailure && error.unknownForge) return noForge;
    if (error instanceof ForgeCiFailure && error.forge)
      return failed(forgeFailureText(error.forge));
    if (error instanceof ForgeCiFailure) return gitUnreadable;
    throw error;
  }
}

function logData(log: ForgeCiLog) {
  return {
    log: log.text,
    ...(log.steps
      ? {
          steps: log.steps.map((step) => ({
            name: step.name,
            status: status(step),
          })),
        }
      : {}),
    ...(log.availableWhenDone ? { availableWhenDone: true } : {}),
    ...(log.notRun ? { notRun: true } : {}),
  };
}

/** Runs a Forge command for the CLI whose worktree is `path`; each call reads the Forge again. */
export function runForgeCommand(
  command: ForgeCommand,
  path: string,
  store: HostStore,
  detection: ForgeDetection,
): Promise<Answer> {
  if (command.kind === "pr-create")
    return createPullRequest(path, command, store, detection)
      .then((url) => ({ ok: true, text: url, data: { url } }))
      .catch((error: unknown) => {
        if (error instanceof PullRequestFailure) {
          if (error.unknownForge) return noForge;
          if (error.forge) return failed(forgeFailureText(error.forge, true));
          return failed(error.message);
        }
        return gitUnreadable;
      });
  return command.kind === "issue-list" || command.kind === "issue-show"
    ? readIssues(path, command, store, detection)
    : readCi(path, command, store, detection);
}
