import type {
  ForgeIssueMethod,
  ForgeIssueRepository,
  ForgeIssueResults,
  Request,
  Response,
} from "@iori/protocol";
import type { HostStore } from "./store.ts";
import type { ForgeDetection } from "./forge/adapters.ts";
import { collectGit } from "./git-process.ts";
import { parseRemoteUrl } from "./forge-remote.ts";
import { repositoryMainPath } from "./repository-git-settings.ts";
import { githubIssues } from "./forge/github-issues.ts";
import { forgejoIssues } from "./forge/forgejo-issues.ts";
import { forgeReadFailure } from "./forge/failure.ts";
import type { IssueContext, IssueReader, IssueTarget } from "./forge/issues.ts";

const readers: Record<string, IssueReader | undefined> = {
  github: githubIssues,
  forgejo: forgejoIssues,
};

async function git(
  path: string,
  args: string[],
  signal?: AbortSignal,
  accepted: number[] = [0],
) {
  return (await collectGit(path, args, signal, accepted)).stdout
    .toString("utf8")
    .trim();
}

/** The remote `git push` without arguments uses in this worktree, by Git's rules. */
async function pushRemote(path: string, signal?: AbortSignal) {
  const branch = await git(
    path,
    ["symbolic-ref", "--quiet", "HEAD"],
    signal,
    [0, 1],
  );
  // branch.<name>.pushRemote, remote.pushDefault, then branch.<name>.remote.
  const configured = branch
    ? (
        await git(
          path,
          ["for-each-ref", "--format=%(refname)%00%(push:remotename)", branch],
          signal,
        )
      )
        .split("\n")
        .map((line) => line.split("\0"))
        .find(([name]) => name === branch)?.[1]
    : await git(
        path,
        ["config", "--get", "remote.pushDefault"],
        signal,
        [0, 1],
      );
  if (configured) return configured;
  // Otherwise Git pushes to the only remote, or else to origin.
  const remotes = (await git(path, ["remote"], signal))
    .split("\n")
    .filter(Boolean);
  return remotes.length === 1
    ? remotes[0]
    : remotes.includes("origin")
      ? "origin"
      : undefined;
}

export type RepositoryIssues = {
  reader: IssueReader;
  target: IssueTarget;
  context: IssueContext;
  repository: ForgeIssueRepository;
};

/**
 * The Forge repository whose Issues a folder of a repository shows: the push
 * remote of its main worktree, so every worktree shows the same Issues. The
 * remote's host and Web URL follow the workspace's Git settings, as the marks do.
 */
export async function repositoryIssues(
  path: string,
  store: HostStore,
  detection: ForgeDetection,
  signal?: AbortSignal,
  redetect = false,
  reportDetectionFailure = false,
): Promise<RepositoryIssues | undefined> {
  const mainPath = await repositoryMainPath(path);
  const remote = await pushRemote(mainPath, signal);
  if (!remote) return undefined;
  const location = parseRemoteUrl(
    await git(mainPath, ["remote", "get-url", "--push", remote], signal),
  );
  if (
    !location ||
    location.parts.length !== 2 ||
    location.parts.some((part) => !part)
  )
    return undefined;
  const mapping = store.forgeMapping(location.remoteHost);
  const origin = mapping ? new URL(mapping.webUrl).origin : location.origin;
  const adapter = await detection.resolve(
    origin,
    signal,
    redetect,
    reportDetectionFailure,
  );
  const reader = adapter ? readers[adapter.id] : undefined;
  if (!adapter || !reader) return undefined;
  const [owner, repo] = location.parts as [string, string];
  return {
    reader,
    target: { origin, owner, repo },
    context: { store, mainPath, signal },
    repository: {
      forge: { id: adapter.id, label: adapter.label },
      owner,
      repo,
      url: reader.issuesUrl({ origin, owner, repo }),
    },
  };
}

async function read(
  request: Request,
  issues: RepositoryIssues | undefined,
): Promise<ForgeIssueResults[ForgeIssueMethod]> {
  if (request.kind !== "request") throw new Error("Not an Issues request");
  if (request.method === "forge.issues.repository")
    return issues ? { repository: issues.repository } : {};
  if (!issues) throw new Error("Forge unavailable");
  const { reader, target, context, repository } = issues;
  switch (request.method) {
    case "forge.issues.list": {
      const { state, labels, page } = request.params;
      const listing = reader.list(target, { state, labels, page }, context);
      // A repository without Issues may refuse the list itself.
      listing.catch(() => undefined);
      const enabled = page === 1 ? await reader.enabled(target, context) : true;
      const list = enabled ? await listing : { issues: [], hasMore: false };
      return {
        repository,
        url: reader.issuesUrl(target, state),
        enabled,
        ...list,
      };
    }
    case "forge.issues.labels":
      return { labels: await reader.labels(target, context) };
    case "forge.issues.show": {
      const { number } = request.params;
      const [issue, thread] = await Promise.all([
        reader.issue(target, number, context),
        reader.comments(target, number, context),
      ]);
      // A removed or moved Issue: the repository reads, the Issue does not.
      return issue && thread ? { issue: { ...issue, thread } } : {};
    }
    default:
      throw new Error("Not an Issues request");
  }
}

/**
 * Answers a Client's Issues request. A failed read of the Forge says why in
 * the common shape (forge.md「失敗の示し方」); nothing the Forge or gh wrote
 * is passed on.
 */
export async function answerForgeIssues(
  request: Request,
  store: HostStore,
  detection: ForgeDetection,
  signal?: AbortSignal,
): Promise<Response<unknown>> {
  let issues: RepositoryIssues | undefined;
  try {
    if (request.kind !== "request") throw new Error("Not an Issues request");
    switch (request.method) {
      case "forge.issues.repository":
      case "forge.issues.list":
      case "forge.issues.labels":
      case "forge.issues.show":
        issues = await repositoryIssues(
          request.params.path,
          store,
          detection,
          signal,
        );
        return { ok: true, result: await read(request, issues) };
      default:
        throw new Error("Not an Issues request");
    }
  } catch (error) {
    signal?.throwIfAborted();
    const { target } = issues ?? {};
    return {
      ok: false,
      error: {
        code: "read_failed",
        ...(target
          ? {
              forge: forgeReadFailure(
                error,
                target.origin,
                `${target.owner}/${target.repo}`,
              ),
            }
          : {}),
      },
    };
  }
}
