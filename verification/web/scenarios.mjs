// The former default web run is split at user workflows. Each selection starts
// with its own invitation, folder and (when needed) real Terminal.
export const basicWebScenarios = {
  "client-host-update": { clis: [], modelClis: [] },
  "host-invitation-switch": { clis: [], modelClis: [] },
  "host-update-mark": { clis: [], modelClis: [] },
  "sidebar-width": { clis: [], modelClis: [] },
  "web-workspace": { clis: [], modelClis: [] },
  "worktree-removal": {},
  "files-transfer": {},
  "reading-worktrees": {},
  "git-image-diff": { clis: [], modelClis: [] },
  "reading-text-copy": { clis: [], modelClis: [] },
  "terminal-image-restart": { clis: [], modelClis: [] },
  "web-terminal": { clis: ["pi"], modelClis: [] },
  "web-cli": {
    clis: ["codex", "pi", "claude"],
    modelClis: ["codex", "pi", "claude"],
  },
  "web-recovery": {
    clis: ["codex"],
    modelClis: ["codex"],
  },
  automations: {},
  "automation-webhook": { clis: ["codex"], modelClis: ["codex"] },
  "automation-issue": { clis: ["codex"], modelClis: ["codex"] },
  teams: {},
  "child-rows": {},
  "worktree-create": {},
  "forge-status": {},
  "forge-issues": {},
};

export const teamWebScenarios = [
  "team-command-route",
  "team-child-tabs",
  "team-messages",
  "team-board",
  "team-records",
];
export const childLifecycleScenarios = [
  "child-read-only",
  "child-cli-exit",
  "child-background",
  "child-claude-resume",
];
export const cliDefinitionScenarios = [
  "cli-definition-editor",
  "cli-definition-session",
  "cli-definition-team",
  "cli-definition-removal",
];
