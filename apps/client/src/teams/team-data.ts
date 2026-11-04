import type {
  Candidate,
  Role,
  Team,
  TeamRecord as SavedRecord,
  TeamSettings,
} from "@iori/protocol";
export type { Candidate, Role, Team, Difficulty } from "@iori/protocol";
export type TeamRecord = SavedRecord & { draft: Team };
export type HostTeams = TeamSettings & { teams: TeamRecord[] };
export const clone = <T>(value: T): T => structuredClone(value);
export const candidate = (
  cli: string,
  model: string,
  cliName?: string,
): Candidate => ({
  id: crypto.randomUUID(),
  cli,
  cliName,
  model,
  tools: [],
  minimum: "",
});
export function role(name: string, request: string, report: string): Role {
  return {
    id: crypto.randomUUID(),
    name,
    when: "",
    limit: "",
    reuse: true,
    split: false,
    candidates: { high: [], medium: [], low: [] },
    instruction: "",
    request,
    report,
  };
}

/** Picker visibility is separate from saved definitions and existing settings. */
export function pickerTeams<T extends { hidden?: boolean }>(teams: T[]): T[] {
  return teams.filter((team) => !team.hidden);
}
