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
iori issue show N [--comments-offset K] [--comments-limit M]
iori ci list
iori ci log [JOB_ID] [--before N]
iori pr create --title TITLE [--body TEXT | --body - | --file PATH] [--issue N]`;

export type ForgeCommand =
  | {
      kind: "issue-list";
      state: ForgeIssueState | "all";
      labels: string[];
      limit: number;
    }
  | {
      kind: "issue-show";
      number: number;
      commentsOffset?: number;
      commentsLimit?: number;
    }
  | { kind: "ci-list" }
  | { kind: "ci-log"; job?: string; before?: number }
  | ({ kind: "pr-create" } & PullRequestInput);

type Answer = { ok: boolean; text: string; data?: unknown };

// gh issue list shows 30 Issues unless --limit asks for another number.
const DEFAULT_ISSUE_LIMIT = 30;
const MAX_COMMAND_TEXT_BYTES = 64 * 1024;

// OSC, DCS/SOS/PM/APC, CSI, other ESC sequences, and stray C0/C1 controls.
// Both the ESC-prefixed and single-character encodings can occur in log text.
const terminalControls = new RegExp(
  [
    String.raw`(?:\x1b\]|\x9d)(?:[^\x07\x18\x1a\x1b\x9c]|\x1b(?!\\))*(?:\x07|\x18|\x1a|\x1b\\|\x9c|$)`,
    String.raw`(?:\x1b[PX^_]|[\x90\x98\x9e\x9f])(?:[^\x18\x1a\x1b\x9c]|\x1b(?!\\))*(?:\x18|\x1a|\x1b\\|\x9c|$)`,
    String.raw`(?:\x1b\[|\x9b)[0-?]*[ -/]*(?:[@-~]|$)`,
    String.raw`\x1b[ -/]*[0-~]`,
    String.raw`[\x00-\x08\x0b-\x1f\x7f-\x9f]`,
  ].join("|"),
  "gu",
);

function plainText(text: string, start = 0): string {
  if (!start) return text.replace(terminalControls, "");
  // Scan from the beginning even when taking the tail, so a cut inside a
  // control string does not show part of its payload.
  const parts: string[] = [];
  for (const { index, 0: control } of text.matchAll(terminalControls)) {
    const end = index + control.length;
    if (end <= start) continue;
    if (index > start) parts.push(text.slice(start, index));
    start = end;
  }
  return parts.join("") + text.slice(start);
}

const bytes = (text: string) => Buffer.byteLength(text, "utf8");

function textPrefix(text: string, limit: number): string {
  if (limit <= 0) return "";
  if (bytes(text) <= limit) return text;
  const utf8 = Buffer.from(text);
  while ((utf8[limit]! & 0xc0) === 0x80) limit--;
  return utf8.toString("utf8", 0, limit);
}

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
  const count = (
    value: string | undefined,
    name: string,
    allowZero = false,
  ) => {
    const number = Number(value);
    if (
      (!(allowZero && value === "0") && !/^[1-9][0-9]*$/u.test(value ?? "")) ||
      !Number.isSafeInteger(number)
    )
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
  if (group === "issue" && action === "show") {
    const { values, positionals } = parse(() =>
      parseArgs({
        args,
        allowPositionals: true,
        options: {
          "comments-offset": { type: "string" },
          "comments-limit": { type: "string" },
        },
      }),
    );
    if (positionals.length !== 1) throw usage();
    return {
      kind: "issue-show",
      number: count(positionals[0], "N"),
      commentsOffset:
        values["comments-offset"] === undefined
          ? undefined
          : count(values["comments-offset"], "--comments-offset", true),
      commentsLimit:
        values["comments-limit"] === undefined
          ? undefined
          : count(values["comments-limit"], "--comments-limit"),
    };
  }
  if (group === "ci" && action === "list") {
    if (args.length) throw usage();
    return { kind: "ci-list" };
  }
  if (group === "ci" && action === "log") {
    const { values, positionals } = parse(() =>
      parseArgs({
        args,
        allowPositionals: true,
        options: { before: { type: "string" } },
      }),
    );
    if (positionals.length > 1) throw usage();
    const job = positionals[0];
    // The job ID goes into the Forge's API path; both Forges use numbers.
    if (job !== undefined && !/^\d{1,20}$/u.test(job))
      throw new Error("Expected a job ID from iori ci list.");
    return {
      kind: "ci-log",
      job,
      before:
        values.before === undefined
          ? undefined
          : count(values.before, "--before"),
    };
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
const noRemote = failed(
  "This repository has no remote. Add a remote with git remote add, then try again.",
);
// The site did not answer as GitHub, Forgejo or Gitea, or did not answer.
const noForge = failed(
  "iori did not find this worktree's remote on GitHub, Forgejo or Gitea. Check the remote and its Web site in iori: the workspace's Git settings, then try again.",
);

function issueRow(issue: ForgeIssueSummary) {
  return {
    number: issue.number,
    state: issue.state,
    title: plainText(issue.title),
    labels: issue.labels.map((label) => plainText(label.name)),
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
  {
    number,
    commentsOffset,
    commentsLimit,
  }: Extract<ForgeCommand, { kind: "issue-show" }>,
): Promise<Answer> {
  const [issue, thread] = await Promise.all([
    reader.issue(target, number, context),
    reader.comments(target, number, context),
  ]);
  const name = `${repository.owner}/${repository.repo}`;
  // A removed or moved Issue: the repository reads, the Issue does not.
  if (!issue || !thread)
    return failed(`Issue #${number} was not found in ${name}.`);
  const continuation = (offset: number) =>
    `\n\nMore comments; run \`iori issue show ${number} --comments-offset ${offset}\` to read them.`;
  const truncatedNotice =
    "\n\nContent truncated. Open the Issue on the Forge to read it in full.";
  const limit =
    MAX_COMMAND_TEXT_BYTES -
    bytes(truncatedNotice) -
    (thread.length ? bytes(continuation(thread.length)) : 0);
  const title = plainText(issue.title);
  const author = plainText(issue.author);
  const labels = issue.labels.map((label) => plainText(label.name));
  const createdAt = time(issue.createdAt);
  const heading = `#${issue.number} ${title}\n${issue.state} · opened${by(author)} on ${createdAt}${labels.length ? ` · labels: ${labels.join(", ")}` : ""} · ${thread.length} comments`;
  let text = textPrefix(heading, limit);
  let truncated = text !== heading;
  // A comment page can use the budget even when the Issue body fills it.
  if (truncated && commentsOffset !== undefined) text = `#${issue.number}`;
  const bodyText = commentsOffset === undefined ? plainText(issue.body) : "";
  const body = textPrefix(bodyText, limit - bytes(text) - 2);
  if (body) text += `\n\n${body}`;
  if (body !== bodyText) truncated = true;

  const comments = [];
  let remaining = limit - bytes(text);
  let next = commentsOffset ?? 0;
  const end = Math.min(thread.length, next + (commentsLimit ?? thread.length));
  for (; next < end; next++) {
    const comment = thread[next]!;
    const author = plainText(comment.author);
    const createdAt = time(comment.createdAt);
    const header = `\n\n--- comment${by(author)} on ${createdAt} ---\n`;
    const commentText = plainText(comment.body);
    if (
      bytes(header) + bytes(commentText) > remaining &&
      (comments.length || commentsOffset === undefined)
    )
      break;
    const prefix = textPrefix(header, remaining);
    const commentBody = textPrefix(commentText, remaining - bytes(prefix));
    const section = prefix + commentBody;
    text += section;
    remaining -= bytes(section);
    comments.push({ author, createdAt, body: commentBody });
    if (prefix !== header || commentBody !== commentText) truncated = true;
  }
  if (truncated) text += truncatedNotice;
  const more = next < thread.length;
  if (more) text += continuation(next);
  return {
    ok: true,
    text,
    data: {
      repository,
      issue: {
        number: issue.number,
        title,
        state: issue.state,
        author,
        labels,
        createdAt,
        body,
        comments,
      },
      ...(more ? { nextCommentsOffset: next } : {}),
    },
  };
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
    const resolved = await repositoryIssues(
      path,
      store,
      detection,
      undefined,
      true,
    );
    if (!resolved.ok)
      return resolved.reason === "no-remote" ? noRemote : noForge;
    issues = resolved.issues;
    return command.kind === "issue-list"
      ? await listIssues(issues, command)
      : await showIssue(issues, command);
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

function logText(job: string, log: ForgeCiLog): string {
  if (log.availableWhenDone)
    return `GitHub gives the log of job ${job} only after the job finishes. Try again when it is done.`;
  if (log.notRun) return `Job ${job} did not run.`;
  return log.text || `Job ${job} has no log.`;
}

const logContinuation = (job: string, start: number) =>
  `\n\nEarlier output omitted; run \`iori ci log ${job} --before ${start}\` to read earlier log.`;

function logPage(job: string, log: ForgeCiLog, budget: number) {
  let start = log.start;
  let limit = budget;
  let offset = 0;
  if (start > 0 || bytes(log.text) > limit) {
    limit -= bytes(logContinuation(job, log.end));
    const utf8 = Buffer.from(log.text);
    let skip = Math.max(0, utf8.length - limit);
    if (skip) {
      while ((utf8[skip]! & 0xc0) === 0x80) skip++;
      offset = log.text.length - utf8.subarray(skip).toString("utf8").length;
      // Count from the page's end so an incomplete character already decoded
      // at the start of the Forge's window cannot shift the continuation.
      start = log.end - (utf8.length - skip);
    }
  }
  const page = { ...log, text: plainText(log.text, offset) };
  return {
    text:
      textPrefix(logText(job, page), limit) +
      (start > 0 ? logContinuation(job, start) : ""),
    data: { ...logData(page), ...(start > 0 ? { before: start } : {}) },
  };
}

async function readCi(
  path: string,
  command: Extract<ForgeCommand, { kind: "ci-list" | "ci-log" }>,
  store: HostStore,
  detection: ForgeDetection,
): Promise<Answer> {
  const log = (job: string, before: number | undefined, redetect = false) =>
    readForgeCiLog(
      path,
      job,
      before,
      store,
      detection,
      undefined,
      undefined,
      redetect,
    );
  try {
    // Every command asks the site again which Forge it is, as a reload does.
    if (command.kind === "ci-log" && command.job) {
      const page = logPage(
        command.job,
        await log(command.job, command.before, true),
        MAX_COMMAND_TEXT_BYTES,
      );
      return {
        ok: true,
        text: page.text,
        data: { jobs: [{ id: command.job, ...page.data }] },
      };
    }
    const ci = await readForgeCi(path, store, detection, undefined, true);
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
      const moreNotice =
        "\n\nMore job logs omitted; run `iori ci list` to find job IDs and `iori ci log <JOB_ID>` to read them.";
      let remaining = MAX_COMMAND_TEXT_BYTES - bytes(moreNotice);
      const parts: string[] = [];
      const reads = [];
      const omittedJobs: string[] = [];
      let moreJobs = false;
      for (const [index, { run, job }] of jobs.entries()) {
        const separator = parts.length ? "\n\n" : "";
        const name = plainText(job.name);
        const jobStatus = plainText(status(job));
        const heading = `${separator}=== log of job ${job.id} "${name}" (${jobStatus}) in "${plainText(run.name)}" ===\n`;
        const budget =
          Math.floor(remaining / (jobs.length - index)) - bytes(heading);
        if (budget <= bytes(logContinuation(job.id, Number.MAX_SAFE_INTEGER))) {
          const omitted = `${separator}Log of job ${job.id} omitted; run \`iori ci log ${job.id}\` to read it.`;
          if (bytes(omitted) > remaining) {
            moreJobs = true;
            break;
          }
          parts.push(omitted);
          remaining -= bytes(omitted);
          omittedJobs.push(job.id);
          continue;
        }
        const page = logPage(job.id, await log(job.id, command.before), budget);
        const entry = heading + page.text;
        parts.push(entry);
        remaining -= bytes(entry);
        reads.push({ id: job.id, name, status: jobStatus, ...page.data });
      }
      return {
        ok: true,
        text: parts.join("") + (moreJobs ? moreNotice : ""),
        data: {
          commit,
          jobs: reads,
          ...(omittedJobs.length ? { omittedJobs } : {}),
          ...(moreJobs ? { moreJobs } : {}),
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
    if (error instanceof ForgeCiFailure && error.noPushTarget)
      return {
        ok: true,
        text: "This branch has no push target. Push it to see the CI of its commit.",
        data: { runs: [], results: [] },
      };
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
  const answer =
    command.kind === "issue-list" || command.kind === "issue-show"
      ? readIssues(path, command, store, detection)
      : readCi(path, command, store, detection);
  return answer.then((result) => ({
    ...result,
    text: textPrefix(plainText(result.text), MAX_COMMAND_TEXT_BYTES),
  }));
}
