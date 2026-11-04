import {
  command,
  GhRepositoryUnreadable,
  GhWriteFailure,
  GhUnavailable,
  withGitHubAccount,
} from "./github.ts";
import { array, forgeUrl, object, string } from "./response.ts";
import {
  PullRequestFailure,
  pullRequestBody,
  type PullRequestWriter,
} from "./pull-requests.ts";

/** Select the usual gh account order, requiring write access for this operation. */
export const githubPullRequests: PullRequestWriter = async (
  target,
  context,
) => {
  const endpoint = `/repos/${encodeURIComponent(target.owner)}/${encodeURIComponent(target.repo)}`;
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
  const url = (value: unknown) => {
    const url = forgeUrl(target.origin, object(value).html_url);
    if (!url) throw new Error("Invalid Forge response");
    return url;
  };
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
    async create(branch, { title, body, issue }) {
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
          `base=${defaultBranch}`,
          "--field",
          "draft=true",
        ]),
      );
    },
  };
};
