import type { Candidate, TeamDefinition, TeamChange } from "@iori/protocol";
const same = (before: unknown, after: unknown) =>
  JSON.stringify(before) === JSON.stringify(after);
// Compare the definition's fields in one order, including received and saved data.
const execution = ({
  cli,
  model,
  effort,
  permission,
  sandbox,
  tools,
  minimum,
}: Candidate) => ({ cli, model, effort, permission, sandbox, tools, minimum });

export function teamChanges(
  before: TeamDefinition,
  after: TeamDefinition,
): TeamChange[] {
  const changes: TeamChange[] = [];
  const changed = (item: string, name?: string) =>
    changes.push({ item, name, action: "changed" });
  if (before.name !== after.name) changed("Name");
  if (before.description !== after.description) changed("Description");
  if (!same(execution(before.parent), execution(after.parent)))
    changed("Execution settings", "Parent");
  if (before.instruction !== after.instruction)
    changed("Instructions", "Parent");
  for (const current of after.roles) {
    const previous = before.roles.find((role) => role.id === current.id);
    if (!previous) {
      changes.push({ item: current.name, action: "added" });
      continue;
    }
    for (const [key, item] of [
      ["name", "Name"],
      ["when", "When to call"],
      ["limit", "Concurrency limit"],
      ["reuse", "Reuse child sessions"],
      ["instruction", "Instructions"],
    ] as const) {
      if (previous[key] !== current[key]) changed(item, current.name);
    }
    if (
      previous.request !== current.request ||
      previous.report !== current.report
    )
      changed("Request and report", current.name);
    const oldCandidates = Object.values(previous.candidates).flat();
    const newCandidates = Object.values(current.candidates).flat();
    const added = newCandidates.some(
      (candidate) => !oldCandidates.some((old) => old.id === candidate.id),
    );
    const removed = oldCandidates.some(
      (candidate) => !newCandidates.some((next) => next.id === candidate.id),
    );
    if (added)
      changes.push({ item: "Candidates", name: current.name, action: "added" });
    if (removed)
      changes.push({
        item: "Candidates",
        name: current.name,
        action: "removed",
      });
    const retained = (candidates: typeof current.candidates) =>
      Object.fromEntries(
        (["high", "medium", "low"] as const).map((level) => [
          level,
          candidates[level]
            .filter(
              (candidate) =>
                oldCandidates.some((old) => old.id === candidate.id) &&
                newCandidates.some((next) => next.id === candidate.id),
            )
            .map((candidate) => ({
              id: candidate.id,
              ...execution(candidate),
            })),
        ]),
      );
    if (
      previous.split !== current.split ||
      !same(retained(previous.candidates), retained(current.candidates))
    )
      changed("Candidates", current.name);
  }
  for (const previous of before.roles)
    if (!after.roles.some((role) => role.id === previous.id))
      changes.push({ item: previous.name, action: "removed" });
  return changes;
}
