import { http, pages } from "./forgejo.ts";
import { ForgeReadError, forgejoFailure } from "./failure.ts";
import { forgeSites } from "./sites.ts";
import { array, object, pullRequestUrl, string } from "./response.ts";
import {
  PullRequestFailure,
  draftTitle,
  pullRequestBody,
  type PullRequestWriter,
} from "./pull-requests.ts";

/** Forgejo/Gitea's single allowed write; the token stays inside the Host. */
async function create(
  origin: string,
  path: string,
  body: unknown,
  signal?: AbortSignal,
) {
  const sites = forgeSites();
  const token = await sites?.token(origin);
  if (!token)
    throw new ForgeReadError({ reason: "token-missing", site: origin });
  let response: Response;
  try {
    response = await fetch(`${origin}${path}`, {
      method: "POST",
      signal,
      redirect: "error",
      credentials: "omit",
      headers: {
        authorization: `token ${token}`,
        "content-type": "application/json",
      },
      body: JSON.stringify(body),
    });
  } catch {
    signal?.throwIfAborted();
    const failure = { reason: "unreachable" as const, site: origin };
    sites?.recordRead(origin, path, failure);
    throw new ForgeReadError(failure);
  }
  if (!response.ok) {
    if (response.status === 409 || response.status === 422) {
      const body = (await response.json().catch(() => undefined)) as
        { message?: unknown } | undefined;
      if (typeof body?.message === "string" && body.message.trim())
        throw new PullRequestFailure(
          body.message.replaceAll(token, "[redacted]").slice(0, 1000),
        );
    }
    // A 401 can echo the token. Only a 403 is read, for its missing scope.
    const message =
      response.status === 403
        ? await response
            .json()
            .then((value: { message?: unknown }) =>
              String(value?.message ?? ""),
            )
            .catch(() => "")
        : "";
    if (response.status !== 403)
      await response.body?.cancel().catch(() => undefined);
    const failure = forgejoFailure(
      origin,
      response.status,
      message,
      response.headers,
      true,
    );
    if (failure.reason === "insufficient-scope" && !failure.scope)
      failure.scope = "write:repository";
    sites?.recordRead(origin, path, failure);
    throw new ForgeReadError(failure, false, response.status);
  }
  sites?.recordRead(origin, path);
  return (await response.json()) as unknown;
}

export const forgejoPullRequests: PullRequestWriter = async (
  target,
  { signal },
) => {
  const endpoint = `/api/v1/repos/${encodeURIComponent(target.owner)}/${encodeURIComponent(target.repo)}`;
  const defaultBranch = string(
    object((await http(`${target.origin}${endpoint}`, signal)).value)
      .default_branch,
  );
  const url = (value: unknown) => pullRequestUrl(target.origin, value);
  return {
    defaultBranch,
    async existing(branch) {
      const query = new URLSearchParams({ state: "open", head: branch });
      const pulls = (
        await pages(target.origin, `${endpoint}/pulls?${query}`, signal)
      ).flatMap(array);
      // Match the head repository too: a fork can use the same branch name.
      const pull = pulls.find((value) => {
        const head = object(object(value).head);
        const repo = object(head.repo);
        return (
          head.ref === branch &&
          repo.full_name === `${target.owner}/${target.repo}`
        );
      });
      return pull ? url(pull) : undefined;
    },
    async create(branch, { title, body, issue }) {
      return url(
        await create(
          target.origin,
          `${endpoint}/pulls`,
          {
            title: draftTitle(title),
            body: pullRequestBody(body, issue),
            head: branch,
            base: defaultBranch,
          },
          signal,
        ),
      );
    },
  };
};
