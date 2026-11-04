import type { ForgeAdapter } from "./types.ts";
import { readForgejoCi, readForgejoCiLog } from "./forgejo-ci.ts";
import {
  object,
  string,
  array,
  forgeUrl,
  commitChecks,
  checksStatus,
  pullStatus,
  SIGN_IN_ONLY_MESSAGE,
} from "./response.ts";
import { ForgeReadError, forgejoFailure } from "./failure.ts";
import { forgeSites } from "./sites.ts";

/**
 * Every read of a Forgejo or Gitea site goes through here (registering a
 * token checks the site in sites.ts). The site's own token goes only to its
 * origin: a redirect fails instead of carrying it elsewhere. Each answer is
 * the site's last read on the Integrations list. A status in `answers` is an
 * answer, not a failure (416 for an empty log).
 */
export async function forgejoRequest(
  url: string,
  signal?: AbortSignal,
  {
    headers,
    authorize = true,
    answers = [],
  }: {
    headers?: Record<string, string>;
    authorize?: boolean;
    answers?: number[];
  } = {},
): Promise<Response> {
  const { origin, pathname } = new URL(url);
  const sites = forgeSites();
  const token = authorize ? await sites?.token(origin) : undefined;
  let response: Response;
  try {
    response = await fetch(url, {
      signal,
      redirect: "error",
      credentials: "omit",
      headers: {
        ...headers,
        ...(token ? { authorization: `token ${token}` } : {}),
      },
    });
  } catch {
    signal?.throwIfAborted();
    const failure = { reason: "unreachable" as const, site: origin };
    sites?.recordRead(origin, pathname, failure, Boolean(token));
    throw new ForgeReadError(failure);
  }
  if (!response.ok && !answers.includes(response.status)) {
    // Only a 403's message is read (for the missing scope); a 401's echoes the token.
    let message = "";
    if (response.status === 403)
      message = await response
        .json()
        .then((body: { message?: unknown }) => String(body?.message ?? ""))
        .catch(() => "");
    else await response.body?.cancel().catch(() => undefined);
    const failure = forgejoFailure(
      origin,
      response.status,
      message,
      response.headers,
      Boolean(token),
    );
    sites?.recordRead(origin, pathname, failure, Boolean(token));
    throw new ForgeReadError(
      failure,
      !token && response.status === 403 && message === SIGN_IN_ONLY_MESSAGE,
      response.status,
    );
  }
  sites?.recordRead(origin, pathname, undefined, Boolean(token));
  return response;
}

/** A JSON answer of the API and its link to the next page. */
export async function http(
  url: string,
  signal?: AbortSignal,
  authorize = true,
) {
  const response = await forgejoRequest(url, signal, { authorize });
  return {
    value: (await response.json()) as unknown,
    link: response.headers.get("link"),
  };
}
export async function pages(
  origin: string,
  endpoint: string,
  signal?: AbortSignal,
): Promise<unknown[]> {
  const result: unknown[] = [];
  let url: string | undefined = `${origin}${endpoint}`;
  while (url) {
    const response = await http(url, signal);
    result.push(response.value);
    const next = /<([^>]+)>;\s*rel="next"/u.exec(response.link ?? "")?.[1];
    url = next ? forgeUrl(origin, next) : undefined;
  }
  return result;
}

export const forgejo: ForgeAdapter = {
  id: "forgejo",
  label: "Forgejo",
  async detect(origin, signal) {
    try {
      // Identify the site before any token is sent to it.
      string(
        object((await http(`${origin}/api/v1/version`, signal, false)).value)
          .version,
      );
    } catch (error) {
      if (!(error instanceof ForgeReadError && error.signInOnly)) throw error;
    }
    return true;
  },
  checkUrl: ({ origin, owner, repo, sha }) =>
    `${origin}/${owner}/${repo}/commit/${sha}`,
  readCi: (target, _repository, signal) => readForgejoCi(target, signal),
  readCiLog: (target, job, before, _repository, signal) =>
    readForgejoCiLog(target, job, before, signal),
  async readChecks(target, signal) {
    const { origin, owner, repo, sha } = target;
    const statuses = await pages(
      origin,
      `/api/v1/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/commits/${encodeURIComponent(sha)}/status`,
      signal,
    );
    return checksStatus(
      origin,
      commitChecks(
        origin,
        statuses.flatMap((page) => array(object(page).statuses)),
      ),
      forgejo.checkUrl(target).slice(origin.length),
    );
  },
  async readPullRequest(target, signal) {
    const { origin, owner, repo, branch } = target;
    const pulls = await pages(
      origin,
      `/api/v1/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/pulls?state=all&head=${encodeURIComponent(branch)}`,
      signal,
    );
    return pullStatus(target, pulls.flatMap(array));
  },
};
