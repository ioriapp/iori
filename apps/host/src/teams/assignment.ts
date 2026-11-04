import {
  belowUsageMinimum,
  type CliUsage,
  limitKey,
  modelProvider,
  type Candidate,
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
): { candidate?: Candidate; waiting?: "capacity" | "candidates" } {
  const under = (count: number, limit: string | undefined) =>
    !limit || BigInt(count) < BigInt(limit);
  const candidates = role.candidates[role.split ? difficulty : "medium"].filter(
    (c) =>
      available.has(c.cli) &&
      !belowUsageMinimum(c.minimum, usage.get(c.cli), c.model) &&
      !failed.has(c.id),
  );
  if (!candidates.length) return { waiting: "candidates" };
  if (
    !under(
      running.filter(
        (c) => c.conversation === conversation && c.role === role.id,
      ).length,
      role.limit,
    )
  )
    return { waiting: "capacity" };
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
  return candidate ? { candidate } : { waiting: "capacity" };
}
