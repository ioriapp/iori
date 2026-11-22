import type { Automation, AutomationList, AutomationRun } from "@iori/protocol";

export type AutomationDraft = {
  draft: Automation;
  onceInput: string;
  saved?: Automation;
};

export type WebhookScope = "lan" | "local";

export type HistoryState =
  | { status: "idle"; runs: AutomationRun[] }
  | { status: "loading"; runs: AutomationRun[] }
  | { status: "error"; runs: AutomationRun[]; message: string }
  | { status: "ready"; runs: AutomationRun[] };

export function editableAutomation(
  value: AutomationList["automations"][number],
): Automation {
  const {
    lastRun: _lastRun,
    issueError: _issueError,
    webhookToken: _webhookToken,
    ...automation
  } = value;
  return automation;
}

export const SAVE_ERRORS = new Set([
  "Enter a name.",
  "Enter instructions.",
  "Choose a folder.",
  "Choose a CLI.",
  "Choose a team.",
  "Could not save the automation. Check its fields and retry.",
]);

export function missingFieldError(draft: Automation): string | undefined {
  if (!draft.name.trim()) return "Enter a name.";
  if (!draft.instruction.trim()) return "Enter instructions.";
  if (!draft.cwd.trim()) return "Choose a folder.";
  if (draft.target.kind === "cli" && !draft.target.candidate.cli.trim())
    return "Choose a CLI.";
  if (draft.target.kind === "team" && !draft.target.teamId.trim())
    return "Choose a team.";
  return undefined;
}

export function formatRunReason(
  value: AutomationRun,
  t: (key: string) => string,
): string {
  return value.launchError
    ? t(value.launchError)
    : value.reason === "busy"
      ? t("Skipped: previous conversation is working")
      : value.reason === "offline"
        ? t("Skipped: Host was stopped or asleep")
        : value.reason === "disabled"
          ? t("Skipped: automation was disabled")
          : "";
}
