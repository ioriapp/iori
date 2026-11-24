import type {
  ForgePrComment,
  ForgePrDetail,
  ForgePrFile,
  ForgePrReviewState,
} from "@iori/protocol";
import { issueComment, issueLabel, type IssueTarget } from "./issues.ts";
import { array, object, string, forgeUrl, pullRequestUrl } from "./response.ts";

type Row = Record<string, unknown>;

export function positiveId(value: unknown): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 1)
    throw new Error("Invalid Forge response");
  return value;
}

function timestamp(value: unknown): number {
  const time = Date.parse(string(value));
  if (!Number.isFinite(time)) throw new Error("Invalid Forge response");
  return time;
}

function login(user: unknown): string {
  return user == null ? "" : string(object(user).login);
}

export function matchingHead(pull: Row, target: IssueTarget, branch: string) {
  const head = object(pull.head);
  return (
    head.ref === branch &&
    head.repo != null &&
    string(object(head.repo).full_name).toLowerCase() ===
      `${target.owner}/${target.repo}`.toLowerCase()
  );
}

export function currentPull(
  pulls: unknown[],
  target: IssueTarget,
  branch: string,
) {
  const matches = pulls
    .map(object)
    .filter((pull) => matchingHead(pull, target, branch))
    .sort((a, b) => timestamp(b.updated_at) - timestamp(a.updated_at));
  return matches.find((pull) => pull.state === "open") ?? matches[0];
}

function file(value: unknown): ForgePrFile {
  const row = object(value);
  let status: ForgePrFile["status"];
  switch (row.status) {
    case "added":
    case "copied":
      status = "added";
      break;
    case "removed":
    case "deleted":
      status = "deleted";
      break;
    case "renamed":
      status = "renamed";
      break;
    default:
      status = "modified";
  }
  return {
    path: string(row.filename),
    status,
    oldPath:
      typeof row.previous_filename === "string"
        ? row.previous_filename
        : undefined,
    additions: typeof row.additions === "number" ? row.additions : undefined,
    deletions: typeof row.deletions === "number" ? row.deletions : undefined,
  };
}

function reviewState(value: unknown): ForgePrReviewState | undefined {
  switch (value) {
    case "APPROVED":
      return "approved";
    case "REQUEST_CHANGES":
    case "CHANGES_REQUESTED":
      return "changes_requested";
    case "COMMENT":
    case "COMMENTED":
      return "commented";
    case "PENDING":
    case "REQUEST_REVIEW":
      return "pending";
    default:
      return undefined;
  }
}

export function prDetail(
  origin: string,
  pull: Row,
  files: unknown[],
  conversation: unknown[],
  inline: ForgePrComment[],
  reviews: unknown[],
): ForgePrDetail {
  const reviewers = new Map<string, ForgePrReviewState | undefined>();
  const comments: ForgePrComment[] = conversation.map(object).map((row) => ({
    ...issueComment(row),
    id: `issue-${positiveId(row.id)}`,
    url: forgeUrl(origin, row.html_url),
  }));
  for (const row of reviews.map(object)) {
    const author = login(row.user);
    const state = row.dismissed === true ? undefined : reviewState(row.state);
    if (author && (state !== "commented" || !reviewers.get(author)))
      reviewers.set(author, state);
    if (row.body && row.submitted_at) {
      comments.push({
        id: `review-${positiveId(row.id)}`,
        body: string(row.body),
        author,
        createdAt: timestamp(row.submitted_at),
        url: forgeUrl(origin, row.html_url),
      });
    }
  }
  for (const reviewer of array(pull.requested_reviewers ?? [])) {
    const author = login(reviewer);
    if (author) reviewers.set(author, "pending");
  }
  if (pull.state !== "closed" && pull.state !== "open")
    throw new Error("Invalid Forge response");
  return {
    number: positiveId(pull.number),
    title: string(pull.title),
    state:
      pull.merged === true || pull.merged_at
        ? "merged"
        : pull.state === "closed"
          ? "closed"
          : pull.draft === true
            ? "draft"
            : "open",
    author: login(pull.user),
    body: string(pull.body ?? ""),
    url: pullRequestUrl(origin, pull),
    baseBranch: string(object(pull.base).ref),
    headBranch: string(object(pull.head).ref),
    createdAt: timestamp(pull.created_at),
    updatedAt: timestamp(pull.updated_at),
    labels: array(pull.labels ?? []).map(issueLabel),
    reviewers: Array.from(reviewers, ([login, state]) => ({ login, state })),
    files: files.map(file),
    comments: comments.concat(inline).sort((a, b) => a.createdAt - b.createdAt),
  };
}

export function inlineComment(
  origin: string,
  row: Row,
  line: unknown,
  side?: "old" | "new",
): ForgePrComment {
  return {
    ...issueComment(row),
    url: forgeUrl(origin, row.html_url),
    path: string(row.path),
    line: typeof line === "number" && line > 0 ? line : undefined,
    side,
    diffHunk: typeof row.diff_hunk === "string" ? row.diff_hunk : undefined,
    inReplyToId:
      row.in_reply_to_id == null
        ? undefined
        : String(positiveId(row.in_reply_to_id)),
  };
}
