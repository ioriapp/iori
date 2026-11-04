import { http, pages } from "./forgejo.ts";
import { ForgeReadError } from "./failure.ts";
import { array, object } from "./response.ts";
import {
  ISSUE_PAGE_SIZE,
  byName,
  issueComment,
  issueDetail,
  issueLabel,
  latestLabelEvent,
  issueMarksForListing,
  issueSummaries,
  oldestFirst,
  type IssueReader,
  type IssueTarget,
} from "./issues.ts";

const repository = ({ owner, repo }: IssueTarget) =>
  `/api/v1/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}`;

/**
 * An Issue's own read: a 404 while the repository reads with the same token
 * means the Issue was removed or moved.
 */
async function issueItem<T>(
  target: IssueTarget,
  signal: AbortSignal | undefined,
  read: () => Promise<T>,
): Promise<T | undefined> {
  try {
    return await read();
  } catch (error) {
    if (!(error instanceof ForgeReadError && error.status === 404)) throw error;
    const readable = await http(`${target.origin}${repository(target)}`, signal)
      .then(() => true)
      .catch(() => false);
    signal?.throwIfAborted();
    if (!readable) throw error;
    return undefined;
  }
}

export const forgejoIssues: IssueReader = {
  async enabled(target, { signal }) {
    const value = object(
      (await http(`${target.origin}${repository(target)}`, signal)).value,
    ).has_issues;
    if (typeof value !== "boolean") throw new Error("Invalid Forge response");
    return value;
  },
  async list(target, { state, labels, page }, { signal }) {
    // type=issues leaves Pull requests out on the Forge itself.
    const query = new URLSearchParams({
      state,
      type: "issues",
      limit: String(ISSUE_PAGE_SIZE),
      page: String(page),
    });
    // Forgejo's labels filter keeps Issues that have all of them.
    if (labels.length) query.set("labels", labels.join(","));
    const response = await http(
      `${target.origin}${repository(target)}/issues?${query}`,
      signal,
    );
    return {
      issues: issueSummaries(target, array(response.value)),
      hasMore: /rel="next"/u.test(response.link ?? ""),
    };
  },
  issue: (target, number, { signal }) =>
    issueItem(target, signal, async () =>
      issueDetail(
        target,
        (
          await http(
            `${target.origin}${repository(target)}/issues/${number}`,
            signal,
          )
        ).value,
      ),
    ),
  comments: (target, number, { signal }) =>
    issueItem(target, signal, async () =>
      (
        await pages(
          target.origin,
          `${repository(target)}/issues/${number}/comments`,
          signal,
        )
      )
        .flatMap(array)
        .map(issueComment)
        .sort(oldestFirst),
    ),
  async labels(target, { signal }) {
    return (
      await pages(
        target.origin,
        `${repository(target)}/labels?limit=${ISSUE_PAGE_SIZE}`,
        signal,
      )
    )
      .flatMap(array)
      .map(issueLabel)
      .sort(byName);
  },
  async issueMarks(target, label, { signal }, cache) {
    const query = new URLSearchParams({
      state: "open",
      type: "issues",
      labels: label,
      limit: String(ISSUE_PAGE_SIZE),
    });
    const issues = (
      await pages(
        target.origin,
        `${repository(target)}/issues?${query}`,
        signal,
      )
    )
      .flatMap(array)
      .flatMap((value) => issueSummaries(target, [value]));
    const account = object(
      (await http(`${target.origin}/api/v1/user`, signal)).value,
    ).login;
    if (typeof account !== "string") throw new Error("Invalid Forge response");
    return issueMarksForListing(issues, label, account, cache, async (number) =>
      latestLabelEvent(
        (
          await pages(
            target.origin,
            `${repository(target)}/issues/${number}/timeline?limit=${ISSUE_PAGE_SIZE}`,
            signal,
          )
        ).flatMap(array),
        label,
        "forgejo",
      ),
    );
  },
  issuesUrl: ({ origin, owner, repo }, state) =>
    `${origin}/${owner}/${repo}/issues${state ? `?state=${state}` : ""}`,
};
