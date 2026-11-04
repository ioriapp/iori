import type {
  ForgeIssue,
  ForgeIssueComment,
  ForgeIssueLabel,
  ForgeIssueSummary,
} from "@iori/protocol";
import type { HostStore } from "../store.ts";
import { array, forgeUrl, object, string } from "./response.ts";

export type IssueTarget = { origin: string; owner: string; repo: string };
export type IssueQuery = {
  state: "open" | "closed" | "all";
  labels: string[];
  page: number;
};
/** The repository is identified by its main worktree, as in its Git settings. */
export type IssueContext = {
  store: HostStore;
  mainPath: string;
  signal?: AbortSignal;
};
export type IssuePage = { issues: ForgeIssueSummary[]; hasMore: boolean };
export type IssueMark = { at: number; login: string };
export type IssueMarkCache = Map<
  number,
  { updatedAt: number; event?: IssueMark }
>;

/** One Forge's way to read Issues; GitHub and Forgejo/Gitea each have one. */
export interface IssueReader {
  /** Whether the repository uses the Forge's Issues. */
  enabled(target: IssueTarget, context: IssueContext): Promise<boolean>;
  /** Newest first, without Pull requests. */
  list(
    target: IssueTarget,
    query: IssueQuery,
    context: IssueContext,
  ): Promise<IssuePage>;
  /** Undefined when the repository reads but the Issue is not there. */
  issue(
    target: IssueTarget,
    number: number,
    context: IssueContext,
  ): Promise<Omit<ForgeIssue, "thread"> | undefined>;
  /** Undefined when the repository reads but the Issue is not there. */
  comments(
    target: IssueTarget,
    number: number,
    context: IssueContext,
  ): Promise<ForgeIssueComment[] | undefined>;
  labels(
    target: IssueTarget,
    context: IssueContext,
  ): Promise<ForgeIssueLabel[]>;
  /** Read the login and latest label event with the same credentials. */
  issueMarks(
    target: IssueTarget,
    label: string,
    context: IssueContext,
    cache: IssueMarkCache,
  ): Promise<{
    marks: {
      issue: ForgeIssueSummary;
      at: number;
      login: string;
      account: string;
    }[];
    cache: IssueMarkCache;
  }>;
  /** The Forge's own page of the repository's Issues, in a state if given. */
  issuesUrl(target: IssueTarget, state?: IssueQuery["state"]): string;
}

// Forgejo and Gitea answer at most 50 items a page by default
// (MAX_RESPONSE_ITEMS); GitHub allows 100. One size serves both.
export const ISSUE_PAGE_SIZE = 50;

function invalid(): never {
  throw new Error("Invalid Forge response");
}

function time(value: unknown): number {
  const at = Date.parse(string(value));
  return Number.isFinite(at) ? at : invalid();
}

// A deleted account can leave an Issue or comment without its author.
function login(value: unknown): string {
  return value === null || value === undefined
    ? ""
    : string(object(value).login);
}

function text(value: unknown): string {
  return value === null || value === undefined ? "" : string(value);
}

export function issueLabel(value: unknown): ForgeIssueLabel {
  const label = object(value);
  const color =
    typeof label.color === "string" && /^#?[0-9a-f]{6}$/iu.test(label.color)
      ? `#${label.color.replace(/^#/u, "").toLowerCase()}`
      : undefined;
  return { name: string(label.name), ...(color ? { color } : {}) };
}

export function issueSummary(
  target: IssueTarget,
  value: unknown,
): ForgeIssueSummary {
  const issue = object(value);
  const { number, state, comments } = issue;
  if (typeof number !== "number" || !Number.isSafeInteger(number) || number < 1)
    invalid();
  if (state !== "open" && state !== "closed") invalid();
  if (
    typeof comments !== "number" ||
    !Number.isSafeInteger(comments) ||
    comments < 0
  )
    invalid();
  return {
    number,
    title: string(issue.title),
    state,
    author: login(issue.user),
    labels:
      issue.labels === null || issue.labels === undefined
        ? []
        : array(issue.labels).map(issueLabel),
    comments,
    createdAt: time(issue.created_at),
    updatedAt: time(issue.updated_at),
    // Only the Forge's own pages may be opened from here.
    url:
      forgeUrl(target.origin, issue.html_url) ??
      `${target.origin}/${target.owner}/${target.repo}/issues/${number}`,
  };
}

/** GitHub lists Pull requests among Issues; they are left out. */
export function issueSummaries(
  target: IssueTarget,
  values: unknown[],
): ForgeIssueSummary[] {
  return values
    .filter((value) => {
      const pull = object(value).pull_request;
      return pull === null || pull === undefined;
    })
    .map((value) => issueSummary(target, value));
}

export function issueDetail(
  target: IssueTarget,
  value: unknown,
): Omit<ForgeIssue, "thread"> {
  const issue = object(value);
  return {
    ...issueSummary(target, issue),
    body: text(issue.body),
    assignees:
      issue.assignees === null || issue.assignees === undefined
        ? []
        : array(issue.assignees).map(login).filter(Boolean),
  };
}

export function issueComment(value: unknown): ForgeIssueComment {
  const comment = object(value);
  if (typeof comment.id !== "number" || !Number.isSafeInteger(comment.id))
    invalid();
  return {
    id: String(comment.id),
    author: login(comment.user),
    createdAt: time(comment.created_at),
    body: text(comment.body),
  };
}

export const byName = (a: ForgeIssueLabel, b: ForgeIssueLabel) =>
  a.name.localeCompare(b.name);

export const oldestFirst = (a: ForgeIssueComment, b: ForgeIssueComment) =>
  a.createdAt - b.createdAt || Number(a.id) - Number(b.id);

/** Latest matching label addition from the Forge event record. */
export function latestLabelEvent(
  values: unknown[],
  label: string,
  forge: "github" | "forgejo",
): { at: number; login: string } | undefined {
  let latest: { at: number; login: string; id: number } | undefined;
  for (const value of values) {
    const event = object(value);
    if (
      (forge === "github"
        ? event.event !== "labeled"
        : event.type !== "label" || event.body !== "1") ||
      !event.label ||
      string(object(event.label).name).toLowerCase() !== label.toLowerCase()
    )
      continue;
    const at = time(event.created_at);
    const id = typeof event.id === "number" ? event.id : 0;
    if (!latest || at > latest.at || (at === latest.at && id > latest.id))
      latest = {
        at,
        login: login(forge === "github" ? event.actor : event.user),
        id,
      };
  }
  return latest;
}

/** Reuse only events read at the same Issue update time. */
export async function issueMarksForListing(
  issues: ForgeIssueSummary[],
  label: string,
  account: string,
  previous: IssueMarkCache,
  read: (number: number) => Promise<IssueMark | undefined>,
): Promise<{
  marks: {
    issue: ForgeIssueSummary;
    at: number;
    login: string;
    account: string;
  }[];
  cache: IssueMarkCache;
}> {
  const cache: IssueMarkCache = new Map();
  const marks = [];
  for (const issue of issues) {
    if (
      !issue.labels.some(
        (item) => item.name.toLowerCase() === label.toLowerCase(),
      )
    )
      continue;
    const saved = previous.get(issue.number);
    const event =
      saved?.updatedAt === issue.updatedAt
        ? saved.event
        : await read(issue.number);
    cache.set(issue.number, { updatedAt: issue.updatedAt, event });
    if (event) marks.push({ issue, ...event, account });
  }
  return { marks, cache };
}
