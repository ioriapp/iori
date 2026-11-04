import type {
  ForgeCi,
  ForgeCiLog,
  ForgeReadFailure,
  Request,
  Response,
} from "@iori/protocol";
import type { HostStore } from "./store.ts";
import type { ForgeDetection } from "./forge/adapters.ts";
import type { ForgeAdapter, ForgeRepository } from "./forge/types.ts";
import type { ForgeTarget } from "./forge/response.ts";
import { ciBrowserUrl, type CiLogKeep } from "./forge/ci.ts";
import { readPushTarget } from "./forge-remote.ts";
import { collectGit } from "./git-process.ts";
import { repositoryMainPath } from "./repository-git-settings.ts";
import { forgeReadFailure } from "./forge/failure.ts";

/**
 * The CI of a worktree is that of its branch's push target, decided as for the
 * sidebar marks. The screen and `iori ci` read through these.
 */
type Located = {
  target: ForgeTarget;
  adapter?: ForgeAdapter;
  repository?: ForgeRepository;
};
async function locate(
  path: string,
  store: HostStore,
  detection: ForgeDetection,
  signal?: AbortSignal,
  redetect = false,
): Promise<Located | undefined> {
  const pushed = await readPushTarget(path, signal);
  if (!pushed) return undefined;
  const mapping = store.forgeMapping(pushed.remoteHost);
  const target = {
    ...pushed,
    origin: mapping ? new URL(mapping.webUrl).origin : pushed.origin,
  };
  // A site found unreachable or not a Forge is asked again on a retry.
  const adapter = await detection.resolve(target.origin, signal, redetect);
  const mainPath = await repositoryMainPath(path).catch(() => undefined);
  return {
    target,
    ...(adapter?.readCi && adapter.readCiLog ? { adapter } : {}),
    repository: mainPath ? { store, mainPath } : undefined,
  };
}

async function readCi(
  path: string,
  located: Located | undefined,
  signal?: AbortSignal,
): Promise<ForgeCi> {
  if (!located) return { logs: false, runs: [], results: [] };
  const { target, adapter, repository } = located;
  if (!adapter) throw new Error("Forge unavailable");
  const read = await adapter.readCi!(target, repository, signal);
  const subject = (
    await collectGit(
      path,
      ["log", "-1", "--format=%s", target.sha],
      signal,
    ).catch(() => undefined)
  )?.stdout
    .toString("utf8")
    .trim();
  const commitUrl = adapter.checkUrl(target);
  return {
    commit: {
      sha: target.sha,
      ...(subject ? { subject } : {}),
      url: commitUrl,
    },
    url: ciBrowserUrl(read, commitUrl),
    ...read,
  };
}

/**
 * A failed read of a worktree's CI, with the reason when the site is known,
 * and whether the site did not answer as a Forge whose CI iori reads.
 */
export class ForgeCiFailure extends Error {
  readonly forge?: ForgeReadFailure;
  readonly unknownForge: boolean;
  constructor(forge?: ForgeReadFailure, unknownForge = false) {
    super("Forge unavailable");
    this.forge = forge;
    this.unknownForge = unknownForge;
  }
}

function failure(error: unknown, located: Located | undefined) {
  const { target } = located ?? {};
  return new ForgeCiFailure(
    target
      ? forgeReadFailure(error, target.origin, `${target.owner}/${target.repo}`)
      : undefined,
    Boolean(located && !located.adapter),
  );
}

/**
 * The CI of the worktree at `path`, for the screen and `iori ci`. A failed
 * read throws a ForgeCiFailure: the common reason (forge.md「失敗の示し方」),
 * with nothing the Forge or gh wrote.
 */
export async function readForgeCi(
  path: string,
  store: HostStore,
  detection: ForgeDetection,
  signal?: AbortSignal,
  redetect = false,
): Promise<ForgeCi> {
  let located: Located | undefined;
  try {
    located = await locate(path, store, detection, signal, redetect);
    return await readCi(path, located, signal);
  } catch (error) {
    signal?.throwIfAborted();
    throw failure(error, located);
  }
}

/** A part of a job's log of the worktree's CI; fails as readForgeCi does. */
export async function readForgeCiLog(
  path: string,
  job: string,
  before: number | undefined,
  store: HostStore,
  detection: ForgeDetection,
  signal?: AbortSignal,
  keep?: CiLogKeep,
  redetect = false,
): Promise<ForgeCiLog> {
  let located: Located | undefined;
  try {
    located = await locate(path, store, detection, signal, redetect);
    if (!located?.adapter) throw new Error("Forge unavailable");
    const { target, adapter, repository } = located;
    return await adapter.readCiLog!(
      target,
      job,
      before,
      repository,
      signal,
      keep,
    );
  } catch (error) {
    signal?.throwIfAborted();
    throw failure(error, located);
  }
}

/** Answers a Client's CI request. */
export async function answerForgeCi(
  request: Request,
  store: HostStore,
  detection: ForgeDetection,
  signal?: AbortSignal,
  keep?: CiLogKeep,
): Promise<Response<unknown>> {
  try {
    if (request.kind !== "request") throw new Error("Not a CI request");
    switch (request.method) {
      case "forge.ci": {
        const { path, redetect } = request.params;
        return {
          ok: true,
          result: await readForgeCi(path, store, detection, signal, redetect),
        };
      }
      case "forge.ci.log": {
        const { path, job, before } = request.params;
        return {
          ok: true,
          result: await readForgeCiLog(
            path,
            job,
            before,
            store,
            detection,
            signal,
            keep,
          ),
        };
      }
      default:
        throw new Error("Not a CI request");
    }
  } catch (error) {
    signal?.throwIfAborted();
    const forge = error instanceof ForgeCiFailure ? error.forge : undefined;
    return {
      ok: false,
      error: { code: "read_failed", ...(forge ? { forge } : {}) },
    };
  }
}
