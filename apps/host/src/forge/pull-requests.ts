import type { ForgeReadFailure } from "@iori/protocol";
import type { HostStore } from "../store.ts";
import { collectGit, startGit } from "../git-process.ts";
import { parseRemoteUrl } from "../forge-remote.ts";
import { repositoryMainPath } from "../repository-git-settings.ts";
import type { ForgeDetection } from "./adapters.ts";
import type { IssueContext, IssueTarget } from "./issues.ts";
import { forgeReadFailure } from "./failure.ts";
import { githubPullRequests } from "./github-pull-requests.ts";
import { forgejoPullRequests } from "./forgejo-pull-requests.ts";

export type PullRequestInput = { title: string; body: string; issue?: number };
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

async function git(path: string, args: string[], accepted = [0]) {
  return (await collectGit(path, args, undefined, accepted)).stdout
    .toString("utf8")
    .trim();
}

/** Git's push destination, including a branch that has never been pushed. */
async function destination(path: string, branch: string) {
  const row = (
    await git(path, [
      "for-each-ref",
      "--format=%(refname)%00%(push:remotename)%00%(push:remoteref)",
      branch,
    ])
  )
    .split("\n")
    .map((line) => line.split("\0"))
    .find(([ref]) => ref === branch);
  const name = branch.slice("refs/heads/".length);
  let remote: string | undefined =
    (await git(
      path,
      ["config", "--get", `branch.${name}.pushRemote`],
      [0, 1],
    )) ||
    (await git(path, ["config", "--get", "remote.pushDefault"], [0, 1])) ||
    (await git(path, ["config", "--get", `branch.${name}.remote`], [0, 1]));
  if (!remote) {
    const remotes = (await git(path, ["remote"])).split("\n").filter(Boolean);
    remote =
      remotes.length === 1 ? remotes[0] : remotes.find((r) => r === "origin");
  }
  if (!remote)
    throw new PullRequestFailure(
      "This branch has no push remote. Configure its Git push remote, then try again.",
    );
  const ref = row?.[2] || branch;
  const location = parseRemoteUrl(
    await git(path, ["remote", "get-url", "--push", remote]),
  );
  return { remote, ref, location };
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

async function push(path: string, remote: string, branch: string, ref: string) {
  // Use the Host's ordinary Git/SSH credentials, never the Forge API token.
  const process = startGit(path, [
    "push",
    "--porcelain",
    "--set-upstream",
    "--no-force",
    "--no-follow-tags",
    "--",
    remote,
    `${branch}:${ref}`,
  ]);
  const chunks: Buffer[] = [];
  for await (const chunk of process.child.stdout) chunks.push(chunk as Buffer);
  const { code } = await process.closed;
  process.dispose();
  if (process.spawnError || code !== 0)
    throw new PullRequestFailure(
      pushFailureText(Buffer.concat(chunks).toString("utf8"), process.stderr()),
    );
}

/** Push only this worktree's branch, then create (or find) its draft PR. */
export async function createPullRequest(
  path: string,
  input: PullRequestInput,
  store: HostStore,
  detection: ForgeDetection,
): Promise<string> {
  const branch = await git(path, ["symbolic-ref", "--quiet", "HEAD"], [0, 1]);
  if (!branch)
    throw new PullRequestFailure(
      "This worktree has a detached HEAD. Switch to a branch before creating a Pull request.",
    );
  const { remote, ref, location } = await destination(path, branch);
  if (
    !location ||
    location.parts.length !== 2 ||
    location.parts.some((p) => !p)
  )
    throw new PullRequestFailure("Forge unavailable", undefined, true);
  const mapping = store.forgeMapping(location.remoteHost);
  const target = {
    origin: mapping ? new URL(mapping.webUrl).origin : location.origin,
    owner: location.parts[0]!,
    repo: location.parts[1]!,
  };
  const adapter = await detection.resolve(target.origin, undefined, true);
  const writer =
    adapter?.id === "github"
      ? githubPullRequests
      : adapter?.id === "forgejo"
        ? forgejoPullRequests
        : undefined;
  if (!writer)
    throw new PullRequestFailure("Forge unavailable", undefined, true);
  try {
    const session = await writer(target, {
      store,
      mainPath: await repositoryMainPath(path),
    });
    const localBranch = branch.slice("refs/heads/".length);
    const remoteBranch = ref.slice("refs/heads/".length);
    if (
      localBranch === session.defaultBranch ||
      remoteBranch === session.defaultBranch
    )
      throw new PullRequestFailure(
        `Cannot create a Pull request from the default branch (${session.defaultBranch}). Switch to a work branch, then try again.`,
      );
    await push(path, remote, branch, ref);
    return (
      (await session.existing(remoteBranch)) ??
      (await session.create(remoteBranch, input))
    );
  } catch (error) {
    if (error instanceof PullRequestFailure) throw error;
    throw new PullRequestFailure(
      "Forge unavailable",
      forgeReadFailure(error, target.origin, `${target.owner}/${target.repo}`),
    );
  }
}
