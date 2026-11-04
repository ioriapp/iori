import {
  GhRepositoryUnreadable,
  GhUnavailable,
  command,
  githubPages,
  withGitHubAccount,
} from "./github.ts";
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
  type IssueContext,
  type IssueReader,
  type IssueTarget,
} from "./issues.ts";

const repository = ({ owner, repo }: IssueTarget) =>
  `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}`;

/** One page of a GitHub API answer. */
async function githubValue(
  endpoint: string,
  env: NodeJS.ProcessEnv,
  signal?: AbortSignal,
): Promise<unknown> {
  try {
    return JSON.parse(
      await command(["api", "--hostname", "github.com", endpoint], signal, env),
    );
  } catch (error) {
    if (error instanceof GhRepositoryUnreadable) throw error;
    throw new GhUnavailable(
      false,
      error instanceof GhUnavailable ? error.reason : undefined,
    );
  }
}

/**
 * An Issue's own read: a 404 with an account that reads the repository means
 * the Issue was removed or moved, so no other account is tried for it.
 */
async function issueItem<T>(
  target: IssueTarget,
  env: NodeJS.ProcessEnv,
  signal: AbortSignal | undefined,
  read: () => Promise<T>,
): Promise<T | undefined> {
  try {
    return await read();
  } catch (error) {
    if (!(error instanceof GhRepositoryUnreadable)) throw error;
    // Unreadable here too: the account cannot read the repository.
    await githubValue(repository(target), env, signal);
    return undefined;
  }
}

/** Every Issues read uses the account the PR・CI marks would use. */
const withAccount = <T>(
  target: IssueTarget,
  context: IssueContext,
  read: (env: NodeJS.ProcessEnv) => Promise<T>,
) => withGitHubAccount(context, target.owner, read, context.signal);

export const githubIssues: IssueReader = {
  enabled: (target, context) =>
    withAccount(target, context, async (env) => {
      const value = object(
        await githubValue(repository(target), env, context.signal),
      ).has_issues;
      if (typeof value !== "boolean") throw new Error("Invalid Forge response");
      return value;
    }),
  list: (target, { state, labels, page }, context) =>
    withAccount(target, context, async (env) => {
      const query = new URLSearchParams({
        state,
        sort: "created",
        direction: "desc",
        per_page: String(ISSUE_PAGE_SIZE),
        page: String(page),
      });
      // GitHub's labels filter keeps Issues that have all of them.
      if (labels.length) query.set("labels", labels.join(","));
      const values = array(
        await githubValue(
          `${repository(target)}/issues?${query}`,
          env,
          context.signal,
        ),
      );
      return {
        issues: issueSummaries(target, values),
        // The page counts Pull requests too, so a full page may have more.
        hasMore: values.length === ISSUE_PAGE_SIZE,
      };
    }),
  issue: (target, number, context) =>
    withAccount(target, context, (env) =>
      issueItem(target, env, context.signal, async () =>
        issueDetail(
          target,
          await githubValue(
            `${repository(target)}/issues/${number}`,
            env,
            context.signal,
          ),
        ),
      ),
    ),
  comments: (target, number, context) =>
    withAccount(target, context, (env) =>
      issueItem(target, env, context.signal, async () =>
        (
          await githubPages(
            `${repository(target)}/issues/${number}/comments?per_page=100`,
            env,
            context.signal,
          )
        )
          .flatMap(array)
          .map(issueComment)
          .sort(oldestFirst),
      ),
    ),
  labels: (target, context) =>
    withAccount(target, context, async (env) =>
      (
        await githubPages(
          `${repository(target)}/labels?per_page=100`,
          env,
          context.signal,
        )
      )
        .flatMap(array)
        .map(issueLabel)
        .sort(byName),
    ),
  issueMarks: (target, label, context, cache) =>
    withAccount(target, context, async (env) => {
      const query = new URLSearchParams({
        state: "open",
        labels: label,
        per_page: "100",
      });
      const issues = (
        await githubPages(
          `${repository(target)}/issues?${query}`,
          env,
          context.signal,
        )
      )
        .flatMap(array)
        .filter((value) => !object(value).pull_request)
        .map((value) => issueSummaries(target, [value])[0]!);
      const account = object(
        await githubValue("/user", env, context.signal),
      ).login;
      if (typeof account !== "string")
        throw new Error("Invalid Forge response");
      return issueMarksForListing(
        issues,
        label,
        account,
        cache,
        async (number) =>
          latestLabelEvent(
            (
              await githubPages(
                `${repository(target)}/issues/${number}/events?per_page=100`,
                env,
                context.signal,
              )
            ).flatMap(array),
            label,
            "github",
          ),
      );
    }),
  issuesUrl: ({ origin, owner, repo }, state) =>
    `${origin}/${owner}/${repo}/issues${
      state
        ? `?q=${encodeURIComponent(
            state === "all" ? "is:issue" : `is:issue state:${state}`,
          )}`
        : ""
    }`,
};
