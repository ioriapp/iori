import {
  command,
  githubPages,
  GhRepositoryUnreadable,
  GhWriteFailure,
  GhUnavailable,
  withGitHubAccount,
} from "./github.ts";
import {
  currentPull,
  prDetail,
  inlineComment,
  positiveId,
} from "./pr-detail.ts";
import type { ForgeRepository } from "./types.ts";
import type { IssueTarget } from "./issues.ts";
import { array, object, pullRequestUrl, string } from "./response.ts";
import {
  PullRequestFailure,
  pullRequestBody,
  type PullRequestWriter,
} from "./pull-requests.ts";

function repositoryEndpoint(target: IssueTarget) {
  return `/repos/${encodeURIComponent(target.owner)}/${encodeURIComponent(target.repo)}`;
}

async function list(
  path: string,
  env: NodeJS.ProcessEnv,
  signal?: AbortSignal,
) {
  return (await githubPages(path, env, signal)).flatMap(array);
}

export function readGitHubPrBranches(
  target: IssueTarget,
  repository: ForgeRepository,
  signal?: AbortSignal,
) {
  const endpoint = repositoryEndpoint(target);
  return withGitHubAccount(
    repository,
    target.owner,
    async (env) => {
      const repo = object(
        JSON.parse(
          await command(
            ["api", "--hostname", "github.com", endpoint],
            signal,
            env,
          ),
        ),
      );
      const branches = await list(
        `${endpoint}/branches?per_page=100`,
        env,
        signal,
      );
      return {
        defaultBranch: string(repo.default_branch),
        branches: branches.map((row) => string(object(row).name)),
      };
    },
    signal,
  );
}

export function readGitHubPrDetail(
  target: IssueTarget,
  branch: string,
  repository?: ForgeRepository,
  signal?: AbortSignal,
) {
  const endpoint = repositoryEndpoint(target);
  const read = async (env: NodeJS.ProcessEnv) => {
    const query = new URLSearchParams({
      state: "all",
      head: `${target.owner}:${branch}`,
      sort: "updated",
      direction: "desc",
      per_page: "10",
    });
    const pull = currentPull(
      await list(`${endpoint}/pulls?${query}`, env, signal),
      target,
      branch,
    );
    if (!pull) return undefined;
    const n = positiveId(pull.number);
    const items = (path: string) =>
      list(`${endpoint}/${path}?per_page=100`, env, signal);
    const [files, discussion, inline, reviews] = await Promise.all([
      items(`pulls/${n}/files`),
      items(`issues/${n}/comments`),
      items(`pulls/${n}/comments`),
      items(`pulls/${n}/reviews`),
    ]);
    const comments = inline
      .map(object)
      .map((row) =>
        inlineComment(
          target.origin,
          row,
          row.line ?? row.original_line,
          row.side === "LEFT"
            ? "old"
            : row.side === "RIGHT"
              ? "new"
              : undefined,
        ),
      );
    return prDetail(target.origin, pull, files, discussion, comments, reviews);
  };
  return repository
    ? withGitHubAccount(repository, target.owner, read, signal)
    : read(process.env);
}

/** Select the usual gh account order, requiring write access for this operation. */
export const githubPullRequests: PullRequestWriter = async (
  target,
  context,
) => {
  const endpoint = repositoryEndpoint(target);
  const value = async (
    path: string,
    env: NodeJS.ProcessEnv,
    fields: string[] = [],
  ) =>
    JSON.parse(
      await command(
        ["api", "--hostname", "github.com", path, ...fields],
        context.signal,
        env,
        fields.includes("POST"),
      ),
    ) as unknown;
  const { env, defaultBranch } = await withGitHubAccount(
    context,
    target.owner,
    async (env) => {
      const repository = object(await value(endpoint, env));
      if (object(repository.permissions).push !== true)
        throw new GhRepositoryUnreadable(false, "insufficient-scope");
      return { env, defaultBranch: string(repository.default_branch) };
    },
    context.signal,
  );
  // The account is chosen. Do not try another account after a write failure.
  const read = async (path: string, fields?: string[]) => {
    try {
      return await value(path, env, fields);
    } catch (error) {
      if (error instanceof GhWriteFailure)
        throw new PullRequestFailure(error.message);
      if (error instanceof GhRepositoryUnreadable)
        throw new GhUnavailable(error.missing, error.reason);
      throw error;
    }
  };
  const url = (value: unknown) => pullRequestUrl(target.origin, value);
  return {
    defaultBranch,
    async existing(branch) {
      const query = new URLSearchParams({
        state: "open",
        head: `${target.owner}:${branch}`,
      });
      const pulls = array(await read(`${endpoint}/pulls?${query}`));
      return pulls.length ? url(pulls[0]) : undefined;
    },
    async create(branch, { title, body, issue, base, draft }) {
      return url(
        await read(`${endpoint}/pulls`, [
          "--method",
          "POST",
          "--raw-field",
          `title=${title}`,
          "--raw-field",
          `body=${pullRequestBody(body, issue)}`,
          "--raw-field",
          `head=${branch}`,
          "--raw-field",
          `base=${base ?? defaultBranch}`,
          "--field",
          `draft=${draft !== false}`,
        ]),
      );
    },
  };
};
