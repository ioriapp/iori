import type {
  ForgePrMethod,
  ForgePrResults,
  ForgePrView,
  Request,
  Response,
} from "@iori/protocol";
import type { HostStore } from "./store.ts";
import type { ForgeDetection } from "./forge/adapters.ts";
import { forgeReadFailure } from "./forge/failure.ts";
import {
  createPullRequestWithResult,
  pullRequestDestination,
  PullRequestFailure,
  PullRequestInputFailure,
} from "./forge/pull-requests.ts";
import { repositoryMainPath } from "./repository-git-settings.ts";

async function readPr(
  path: string,
  redetect: boolean,
  store: HostStore,
  detection: ForgeDetection,
  signal?: AbortSignal,
): Promise<ForgePrView> {
  const destination = await pullRequestDestination(path, store, signal);
  const { currentBranch } = destination;
  if (destination.reason)
    return { canCreate: false, currentBranch, reason: destination.reason };
  const { target } = destination;
  try {
    const adapter = await detection.resolve(
      target.origin,
      signal,
      redetect,
      true,
    );
    if (!adapter?.prDetail || !adapter.prBranches)
      return { canCreate: false, currentBranch, reason: "unsupported" };
    const repository = { store, mainPath: await repositoryMainPath(path) };
    const pr = await adapter.prDetail(
      target,
      target.branch,
      repository,
      signal,
    );
    if (pr?.state === "open" || pr?.state === "draft")
      return { pr, currentBranch, canCreate: false };
    const { defaultBranch, branches } = await adapter.prBranches(
      target,
      repository,
      signal,
    );
    const isDefault =
      currentBranch === defaultBranch || target.branch === defaultBranch;
    return {
      pr,
      currentBranch,
      defaultBranch,
      branches: branches.filter(
        (branch) => branch !== currentBranch && branch !== target.branch,
      ),
      canCreate: !isDefault && Boolean(adapter.pullRequests),
      reason: isDefault ? "default_branch" : undefined,
    };
  } catch (error) {
    throw new PullRequestFailure(
      "Forge unavailable",
      forgeReadFailure(error, target.origin, `${target.owner}/${target.repo}`),
    );
  }
}

export async function answerForgePr(
  request: Extract<Request, { method: ForgePrMethod }>,
  store: HostStore,
  detection: ForgeDetection,
  signal?: AbortSignal,
): Promise<Response<ForgePrResults[ForgePrMethod]>> {
  try {
    if (request.method === "forge.pr") {
      const { path, redetect } = request.params;
      return {
        ok: true,
        result: await readPr(path, redetect ?? false, store, detection, signal),
      };
    }
    const { path, ...input } = request.params;
    return {
      ok: true,
      result: await createPullRequestWithResult(
        path,
        input,
        store,
        detection,
        signal,
      ),
    };
  } catch (error) {
    signal?.throwIfAborted();
    if (error instanceof PullRequestFailure && error.forge)
      return { ok: false, error: { code: "read_failed", forge: error.forge } };
    if (request.method === "forge.pr")
      return { ok: false, error: { code: "read_failed" } };
    // Git and Forge write failures may contain remote messages or credentials;
    // PullRequestFailure messages are already stripped of credentials (same as `iori pr create`).
    const message =
      error instanceof PullRequestInputFailure ||
      error instanceof PullRequestFailure
        ? error.message
        : "Could not create the Pull request. Check the push remote and Forge access.";
    return { ok: false, error: { code: "git_failed", message } };
  }
}
