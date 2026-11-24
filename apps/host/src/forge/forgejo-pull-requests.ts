import { forgejoRequest, http, pages } from "./forgejo.ts";
import { ForgeReadError, forgejoFailure } from "./failure.ts";
import { forgeSites } from "./sites.ts";
import {
  currentPull,
  matchingHead,
  inlineComment,
  prDetail,
  positiveId,
} from "./pr-detail.ts";
import type { IssueTarget } from "./issues.ts";
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

function repositoryEndpoint(target: IssueTarget) {
  return `/api/v1/repos/${encodeURIComponent(target.owner)}/${encodeURIComponent(target.repo)}`;
}

async function list(target: IssueTarget, path: string, signal?: AbortSignal) {
  return (
    await pages(target.origin, `${repositoryEndpoint(target)}${path}`, signal)
  ).flatMap(array);
}

async function readDefaultBranch(target: IssueTarget, signal?: AbortSignal) {
  return string(
    object(
      (await http(`${target.origin}${repositoryEndpoint(target)}`, signal))
        .value,
    ).default_branch,
  );
}

export async function readForgejoPrBranches(
  target: IssueTarget,
  signal?: AbortSignal,
) {
  const [defaultBranch, branches] = await Promise.all([
    readDefaultBranch(target, signal),
    list(target, "/branches", signal),
  ]);
  return {
    defaultBranch,
    branches: branches.map((row) => string(object(row).name)),
  };
}

export async function readForgejoPrDetail(
  target: IssueTarget,
  branch: string,
  signal?: AbortSignal,
) {
  // Older servers ignore head. Follow every page so PRs against a custom base are included.
  const query = new URLSearchParams({ state: "all", head: branch });
  const pull = currentPull(
    await list(target, `/pulls?${query}`, signal),
    target,
    branch,
  );
  if (!pull) return undefined;
  const n = positiveId(pull.number);
  const [files, discussion, reviews] = await Promise.all([
    list(target, `/pulls/${n}/files`, signal),
    list(target, `/issues/${n}/comments`, signal),
    list(target, `/pulls/${n}/reviews`, signal),
  ]);
  const comments = [];
  for (const review of reviews.map(object)) {
    if (review.comments_count === 0) continue;
    const response = await forgejoRequest(
      `${target.origin}${repositoryEndpoint(target)}/pulls/${n}/reviews/${positiveId(review.id)}/comments`,
      signal,
      { answers: [404] },
    );
    if (response.status === 404) {
      await response.body?.cancel();
      continue;
    }
    for (const row of array(await response.json()).map(object)) {
      const old =
        typeof row.original_position === "number" && row.original_position > 0;
      comments.push(
        inlineComment(
          target.origin,
          row,
          old ? row.original_position : row.position,
          old ? "old" : "new",
        ),
      );
    }
  }
  return prDetail(target.origin, pull, files, discussion, comments, reviews);
}

export const forgejoPullRequests: PullRequestWriter = async (
  target,
  { signal },
) => {
  const endpoint = repositoryEndpoint(target);
  const defaultBranch = await readDefaultBranch(target, signal);
  const url = (value: unknown) => pullRequestUrl(target.origin, value);
  return {
    defaultBranch,
    async existing(branch) {
      const query = new URLSearchParams({ state: "open", head: branch });
      const pulls = await list(target, `/pulls?${query}`, signal);
      // Match the head repository too: a fork can use the same branch name.
      const pull = pulls
        .map(object)
        .find(
          (value) =>
            value.state === "open" && matchingHead(value, target, branch),
        );
      return pull ? url(pull) : undefined;
    },
    async create(branch, { title, body, issue, base, draft }) {
      return url(
        await create(
          target.origin,
          `${endpoint}/pulls`,
          {
            title: draft === false ? title : draftTitle(title),
            body: pullRequestBody(body, issue),
            head: branch,
            base: base ?? defaultBranch,
          },
          signal,
        ),
      );
    },
  };
};
