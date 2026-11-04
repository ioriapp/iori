import type { HostStore } from "../store.ts";
import type { ForgeCiLog, ForgeStatus } from "@iori/protocol";
import type { ForgeTarget } from "./response.ts";
import type { CiLogKeep, ForgeCiRead } from "./ci.ts";

/** The Host's settings for one repository, such as its GitHub account. */
export type ForgeRepository = { store: HostStore; mainPath: string };

export interface ForgeAdapter {
  id: string;
  label: string;
  detect(origin: string, signal?: AbortSignal): Promise<boolean>;
  readChecks(
    target: ForgeTarget,
    signal?: AbortSignal,
  ): Promise<ForgeStatus["checks"]>;
  readPullRequest(
    target: ForgeTarget,
    signal?: AbortSignal,
  ): Promise<ForgeStatus["pullRequest"]>;
  checkUrl(target: ForgeTarget): string;
  /** The runs, jobs and other results of the target's commit. */
  readCi?(
    target: ForgeTarget,
    repository?: ForgeRepository,
    signal?: AbortSignal,
  ): Promise<ForgeCiRead>;
  /** A part of a job's log: its end, or the part before `before`. */
  readCiLog?(
    target: ForgeTarget,
    job: string,
    before: number | undefined,
    repository?: ForgeRepository,
    signal?: AbortSignal,
    keep?: CiLogKeep,
  ): Promise<ForgeCiLog>;
  readStatus?(target: ForgeTarget, signal?: AbortSignal): Promise<ForgeStatus>;
  forRepository?(
    store: HostStore,
    mainPath: string,
    onSettingsChange: () => void,
  ): ForgeAdapter;
}
