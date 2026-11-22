import { launchCandidate, type TeamChild } from "./records.ts";
import {
  belowUsageMinimum,
  type CliUsage,
  limitKey,
  modelProvider,
  type Candidate,
  type CandidateWaitingReason,
  type Difficulty,
  type Role,
  type TeamSettings,
} from "@iori/protocol";

export interface RunningCli {
  cli: string;
  model?: string;
  conversation?: string;
  role?: string;
}
/** A resumed session retains the candidate and usage minimum of its original role. */
export function assignmentRole(
  child: TeamChild,
  current?: Role,
): Role | undefined {
  if (child.resumeFile && child.role && child.candidate) {
    const assigned = child.candidate;
    const original = Object.values(child.role.candidates)
      .flat()
      .find((candidate) => candidate.id === assigned.id);
    return {
      ...child.role,
      split: false,
      candidates: {
        high: [],
        medium: [
          {
            ...launchCandidate(assigned),
            minimum: original?.minimum ?? "",
            minimumWindow: original?.minimumWindow,
          },
        ],
        low: [],
      },
    };
  }
  return current;
}
export function roleCandidates(
  role: Role,
  difficulty: Difficulty,
  parent?: Candidate,
): Candidate[] {
  const candidates = role.candidates[role.split ? difficulty : "medium"];
  return candidates.length || !parent?.cli
    ? candidates
    : [{ ...parent, minimum: "", minimumWindow: undefined }];
}
export function chooseCandidate(
  role: Role,
  difficulty: Difficulty,
  available: ReadonlySet<string>,
  running: readonly RunningCli[],
  settings: TeamSettings,
  conversation: string,
  usage: ReadonlyMap<string, CliUsage> = new Map(),
  // Candidate IDs that failed with a CLI error earlier in this task.
  failed: ReadonlySet<string> = new Set(),
  initialUsagePending: ReadonlySet<string> = new Set(),
  parent?: Candidate,
): {
  candidate?: Candidate;
  waiting?: "capacity" | "candidates";
  waitingReasons?: CandidateWaitingReason[];
} {
  const under = (count: number, limit: string | undefined) =>
    !limit || BigInt(count) < BigInt(limit);
  const candidates: Candidate[] = [];
  const waitingReasons: CandidateWaitingReason[] = [];
  for (const candidate of roleCandidates(role, difficulty, parent)) {
    const { cli, minimum, model, minimumWindow } = candidate;
    if (!available.has(cli))
      waitingReasons.push({ cli, reason: "not_installed" });
    else if (
      (minimum !== "" && initialUsagePending.has(cli)) ||
      belowUsageMinimum(minimum, usage.get(cli), model, minimumWindow)
    )
      waitingReasons.push({ cli, reason: "usage", minimum });
    else if (failed.has(candidate.id))
      waitingReasons.push({ cli, reason: "failed" });
    else candidates.push(candidate);
  }
  if (!candidates.length) {
    if (!waitingReasons.length)
      waitingReasons.push({ reason: "no_candidates" });
    return { waiting: "candidates", waitingReasons };
  }
  if (
    !under(
      running.filter(
        (c) => c.conversation === conversation && c.role === role.id,
      ).length,
      role.limit,
    )
  )
    return { waiting: "capacity", waitingReasons };
  const candidate = candidates.find((c) => {
    const sameCli = running.filter((p) => p.cli === c.cli);
    const provider = modelProvider(c.model);
    return (
      under(sameCli.length, settings.limits[limitKey(c.cli, "cli")]) &&
      (!provider ||
        under(
          sameCli.filter((p) => p.model && modelProvider(p.model) === provider)
            .length,
          settings.limits[limitKey(c.cli, "provider", provider)],
        )) &&
      under(
        sameCli.filter((p) => p.model === c.model).length,
        settings.limits[limitKey(c.cli, "model", c.model)],
      )
    );
  });
  return candidate ? { candidate } : { waiting: "capacity", waitingReasons };
}
