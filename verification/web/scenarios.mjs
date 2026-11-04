// The former default web run is split at user workflows. Each selection starts
// with its own invitation, folder and (when needed) real Terminal.
export const basicWebScenarios = {
  "sidebar-width": { clis: [], modelClis: [] },
  "web-workspace": { clis: [], modelClis: [] },
  "worktree-removal": {},
  "files-transfer": {},
  "reading-worktrees": {},
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
