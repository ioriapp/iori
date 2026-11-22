import type {
  Candidate,
  CliModels,
  CliSummary,
  Difficulty,
  TeamRecord as SavedRecord,
} from "@iori/protocol";
import type { HostTeams, TeamRecord } from "../team-data.ts";

export type Selection =
  | { page: "agents" | "teams" | "records" | "automations" }
  | { page: "team"; teamId: string; detail: "overview" | "parent" | string };

export type EditableTeamRecord = TeamRecord & {
  conversationCount?: number;
};

export type EditableHostTeams = Omit<HostTeams, "teams"> & {
  teams: EditableTeamRecord[];
};

export type LeaveGuard = (action: () => void) => void;

export type WorkingAction = "save" | "create" | "restore" | "copy";

export type SaveConflictState = {
  current: SavedRecord | null;
  editedFrom: number;
};

export type ConfirmationState = {
  title: string;
  text: string;
  action: () => void | Promise<boolean>;
};

export const DIFFICULTY_LEVELS: Difficulty[] = ["high", "medium", "low"];

export const DIFFICULTY_LABELS: Record<Difficulty, string> = {
  high: "High",
  medium: "Medium",
  low: "Low",
};

export function isTeamDirty(record?: TeamRecord): boolean {
  return (
    !!record && JSON.stringify(record.saved) !== JSON.stringify(record.draft)
  );
}

export function modelError(error?: string): string {
  return error === "unsupported"
    ? "This CLI does not expose a model list. Team editing can continue."
    : error === "not_found"
      ? "CLI not found on this Host. Install it and retry."
      : error === "invalid_output"
        ? "Could not read the model list returned by this CLI. Retry."
        : "The model list command failed. Check this CLI on the Host and retry.";
}

const modelErrorKeys = new WeakMap<object, number>();
let nextModelErrorKey = 0;

export function modelErrorKey(catalog: object): number {
  const existing = modelErrorKeys.get(catalog);
  if (existing !== undefined) return existing;
  const key = nextModelErrorKey++;
  modelErrorKeys.set(catalog, key);
  return key;
}

export function hasEffortOption(
  item: Candidate,
  catalogs: Record<string, CliModels>,
  clis: CliSummary[],
): boolean {
  const usageCli = clis.find((cli) => cli.id === item.cli);
  const model = catalogs[item.cli]?.models.find(
    (entry) => entry.name === item.model,
  );
  return (
    usageCli?.launchEffort !== false && (!model || model.efforts.length > 0)
  );
}
