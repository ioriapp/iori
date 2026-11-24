import type { ForgeReadFailure } from "@iori/protocol";
import type { HostStore } from "../store.ts";
import { collectGit, startGit } from "../git-process.ts";
import { parseRemoteUrl } from "../forge-remote.ts";
import { repositoryMainPath } from "../repository-git-settings.ts";
import type { ForgeDetection } from "./adapters.ts";
import type { IssueContext, IssueTarget } from "./issues.ts";
import { forgeReadFailure } from "./failure.ts";

export type PullRequestInput = {
  title: string;
  body: string;
  issue?: number;
  base?: string;
  draft?: boolean;
};
export type PullRequestSession = {
  defaultBranch: string;
  existing(branch: string): Promise<string | undefined>;
  create(branch: string, input: PullRequestInput): Promise<string>;
};
export type PullRequestWriter = (
  target: IssueTarget,
  context: IssueContext,
) => Promise<PullRequestSession>;

/** Forgejo/Gitea use the Forge's work-in-progress title prefix. */
export function draftTitle(title: string): string {
  return /^WIP:/iu.test(title) ? title : `WIP: ${title}`;
}

export function pullRequestBody(body: string, issue?: number): string {
  return issue === undefined
    ? body
    : `${body}${body ? "\n\n" : ""}Closes #${issue}`;
}

export class PullRequestFailure extends Error {
  readonly forge?: ForgeReadFailure;
  readonly unknownForge: boolean;
  constructor(message: string, forge?: ForgeReadFailure, unknownForge = false) {
    super(message);
    this.forge = forge;
    this.unknownForge = unknownForge;
  }
}

async function git(
  path: string,
  args: string[],
  signal?: AbortSignal,
  accepted = [0],
) {
  return (await collectGit(path, args, signal, accepted)).stdout
    .toString("utf8")
    .trim();
}

/** Git's push destination, including a branch that has never been pushed. */
export async function pullRequestDestination(
  path: string,
  store: HostStore,
  signal?: AbortSignal,
) {
  const branch = await git(
    path,
    ["symbolic-ref", "--quiet", "HEAD"],
    signal,
    [0, 1],
  );
  if (!branch) return { reason: "detached_head" } as const;
  const row = (
    await collectGit(
      path,
      [
        "for-each-ref",
        "--format=%(refname)%00%(push:remotename)%00%(push:remoteref)",
        branch,
      ],
      signal,
    )
  ).stdout
    .toString("utf8")
    .split("\n")
    .map((line) => line.split("\0"))
    .find(([ref]) => ref === branch);
  const name = branch.slice("refs/heads/".length);
  let remote: string | undefined =
    (await git(
      path,
      ["config", "--get", `branch.${name}.pushRemote`],
      signal,
      [0, 1],
    )) ||
    (await git(
      path,
      ["config", "--get", "remote.pushDefault"],
      signal,
      [0, 1],
    )) ||
    (await git(
      path,
      ["config", "--get", `branch.${name}.remote`],
      signal,
      [0, 1],
    ));
  if (!remote) {
    const remotes = (await git(path, ["remote"], signal))
      .split("\n")
      .filter(Boolean);
    remote =
      remotes.length === 1 ? remotes[0] : remotes.find((r) => r === "origin");
  }
  if (!remote)
    return {
      reason: "no_push_target",
      currentBranch: name,
      message:
        "This branch has no push remote. Configure its Git push remote, then try again.",
    } as const;
  const ref = row?.[2] || branch;
  const remoteBranch = ref.slice("refs/heads/".length);
  if (
    !ref.startsWith("refs/heads/") ||
    !remoteBranch ||
    (await git(
      path,
      ["check-ref-format", "--branch", remoteBranch],
      signal,
      [0, 128],
    )) !== remoteBranch
  )
    return {
      reason: "no_push_target",
      currentBranch: name,
      message:
        "The Git push destination must be a valid branch. Check this branch's push mapping, then try again.",
    } as const;
  const location = parseRemoteUrl(
    await git(path, ["remote", "get-url", "--push", remote], signal),
  );
  if (
    !location ||
    location.parts.length !== 2 ||
    location.parts.some((part) => !part)
  )
    return { reason: "unsupported", currentBranch: name } as const;
  const mapping = store.forgeMapping(location.remoteHost);
  const target = {
    origin: mapping ? new URL(mapping.webUrl).origin : location.origin,
    remoteHost: location.remoteHost,
    owner: location.parts[0]!,
    repo: location.parts[1]!,
    branch: remoteBranch,
    sha: await git(path, ["rev-parse", "--verify", "HEAD"], signal),
  };
  return { remote, ref, branch, target, currentBranch: name } as const;
}

/** Keep Git's rejection reason, without remote URLs or credentials. */
export function pushFailureText(stdout: string, stderr: string): string {
  const rejected = stdout
    .split(/\r?\n/u)
    .filter((line) => line.startsWith("!\t"))
    .map((line) => line.split("\t").slice(2).join("\t"));
  const reasons = rejected.length
    ? rejected
    : stderr
        .split(/\r?\n/u)
        .filter((line) => /^(fatal:|error:|remote:)/u.test(line));
  const text = reasons
    .join("\n")
    .replace(/(?:https?|ssh|git):\/\/[^\s'"<>]+/giu, "[remote]")
    .replace(/\b[^\s@]+@[^\s:]+:[^\s]+/gu, "[remote]");
  return `Git push failed.${text ? `\n${text}` : " Check this Host's Git authentication and push remote, then try again."}`;
}

async function push(
  path: string,
  remote: string,
  branch: string,
  ref: string,
  signal?: AbortSignal,
) {
  // Use the Host's ordinary Git/SSH credentials, never the Forge API token.
  const process = startGit(
    path,
    [
      "push",
      "--porcelain",
      "--set-upstream",
      "--no-force",
      "--no-follow-tags",
      "--",
      remote,
      `${branch}:${ref}`,
    ],
    signal,
  );
  const chunks: Buffer[] = [];
  for await (const chunk of process.child.stdout) chunks.push(chunk as Buffer);
  const { code } = await process.closed;
  process.dispose();
  signal?.throwIfAborted();
  if (process.spawnError || code !== 0)
    throw new PullRequestFailure(
      pushFailureText(Buffer.concat(chunks).toString("utf8"), process.stderr()),
    );
}

/** A local refusal with a message that is safe to send to the screen. */
export class PullRequestInputFailure extends PullRequestFailure {}

export async function createPullRequestWithResult(
  path: string,
  input: PullRequestInput,
  store: HostStore,
  detection: ForgeDetection,
  signal?: AbortSignal,
): Promise<{ url: string; created: boolean }> {
  const destination = await pullRequestDestination(path, store, signal);
  switch (destination.reason) {
    case "detached_head":
      throw new PullRequestInputFailure(
        "This worktree has a detached HEAD. Switch to a branch before creating a Pull request.",
      );
    case "no_push_target":
      throw new PullRequestInputFailure(destination.message);
    case "unsupported":
      throw new PullRequestFailure("Forge unavailable", undefined, true);
  }
  const {
    remote,
    ref,
    branch,
    target,
    currentBranch: localBranch,
  } = destination;
  const remoteBranch = target.branch;
  if (input.base !== undefined) {
    if (
      !input.base ||
      (await git(
        path,
        ["check-ref-format", "--branch", input.base],
        signal,
        [0, 128],
      )) !== input.base
    )
      throw new PullRequestInputFailure(
        "The base branch must be a valid branch name.",
      );
    if (input.base === localBranch || input.base === remoteBranch)
      throw new PullRequestInputFailure(
        "Choose a base branch different from the work branch.",
      );
  }
  try {
    const adapter = await detection.resolve(target.origin, signal, true, true);
    if (!adapter?.pullRequests)
      throw new PullRequestFailure("Forge unavailable", undefined, true);
    const session = await adapter.pullRequests(target, {
      store,
      mainPath: await repositoryMainPath(path),
      signal,
    });
    if (
      localBranch === session.defaultBranch ||
      remoteBranch === session.defaultBranch
    )
      throw new PullRequestInputFailure(
        `Cannot create a Pull request from the default branch (${session.defaultBranch}). Switch to a work branch, then try again.`,
      );
    await push(path, remote, branch, ref, signal);
    const existing = await session.existing(remoteBranch);
    if (existing) return { url: existing, created: false };
    return { url: await session.create(remoteBranch, input), created: true };
  } catch (error) {
    if (error instanceof PullRequestFailure) throw error;
    throw new PullRequestFailure(
      "Forge unavailable",
      forgeReadFailure(error, target.origin, `${target.owner}/${target.repo}`),
    );
  }
}

export async function createPullRequest(
  path: string,
  input: PullRequestInput,
  store: HostStore,
  detection: ForgeDetection,
): Promise<string> {
  return (await createPullRequestWithResult(path, input, store, detection)).url;
}
