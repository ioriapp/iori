import type { HostStore } from "../store.ts";
import type { ForgeCiLog, ForgeStatus, ForgePrDetail } from "@iori/protocol";
import type { ForgeTarget } from "./response.ts";
import type { CiLogKeep, ForgeCiRead } from "./ci.ts";
import type { IssueReader } from "./issues.ts";
import type { PullRequestWriter } from "./pull-requests.ts";

/** The Host's settings for one repository, such as its GitHub account. */
export type ForgeRepository = { store: HostStore; mainPath: string };
export type ForgeStatusRepository = ForgeRepository & {
  onSettingsChange(): void;
};

export interface ForgeAdapter {
  id: string;
  label: string;
  detect(origin: string, signal?: AbortSignal): Promise<boolean>;
  status(
    target: ForgeTarget,
    signal?: AbortSignal,
    repository?: ForgeStatusRepository,
  ): Promise<ForgeStatus>;
  checkUrl(target: ForgeTarget): string;
  ci?: {
    /** The runs, jobs and other results of the target's commit. */
    read(
      target: ForgeTarget,
      repository?: ForgeRepository,
      signal?: AbortSignal,
    ): Promise<ForgeCiRead>;
    /** A part of a job's log: its end, or the part before `before`. */
    log(
      target: ForgeTarget,
      job: string,
      before: number | undefined,
      repository?: ForgeRepository,
      signal?: AbortSignal,
      keep?: CiLogKeep,
    ): Promise<ForgeCiLog>;
    rerun?(
      target: ForgeTarget,
      runId: string,
      failedOnly: boolean,
      repository?: ForgeRepository,
      signal?: AbortSignal,
    ): Promise<void>;
    cancel?(
      target: ForgeTarget,
      runId: string,
      repository?: ForgeRepository,
      signal?: AbortSignal,
    ): Promise<void>;
  };
  issues?: IssueReader;
  prDetail?: (
    target: ForgeTarget,
    branch: string,
    repository?: ForgeRepository,
    signal?: AbortSignal,
  ) => Promise<ForgePrDetail | undefined>;
  prBranches?: (
    target: ForgeTarget,
    repository: ForgeRepository,
    signal?: AbortSignal,
  ) => Promise<{ defaultBranch: string; branches: string[] }>;
  pullRequests?: PullRequestWriter;
}
