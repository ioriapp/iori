// The former default web run is split at user workflows. Each selection starts
// with its own invitation, folder and (when needed) real Terminal.
export const basicWebScenarios = {
  "usage-status": { clis: [], modelClis: [] },
  "cli-order": { clis: [], modelClis: [] },
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
  "new-worktree-layout": { clis: ["pi"], modelClis: [] },
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

// Full and scoped acceptance share a queue. Idle runners take the next scenario
// in this order, starting the long scenarios first.
export const fullScenarioOrder = [
  "web-cli",
  ...childLifecycleScenarios,
  ...teamWebScenarios,
  "terminal-preferences",
  "terminal-daemon",
  "child-cli-failure",
  "web-recovery",
  "automations",
  "automation-webhook",
  "automation-issue",
  "child-running",
  ...cliDefinitionScenarios,
  "host-update",
  "clipboard",
  "sidebar-order",
  "opencode-delegation",
  "terminal-width-handoff",
  "host-uninstall",
  "worktree-removal",
  "files-transfer",
  "cli-definition-plugin",
  "board-activity",
  "client-host-update",
  "terminal-clipboard",
  "web-terminal",
  "teams",
  "terminal-file-links",
  "worktree-create",
  "child-rows",
  "team-notifications",
  "mobile-batch-input",
  "mobile-images",
  "client-update",
  "mobile-key-band",
  "forge-token",
  "cli-resize",
  "forge-issue-start",
  "reading-responsiveness",
  "forge-commands",
  "forge-status",
  "model-failure",
  "forge-issues",
  "web-workspace",
  "host-invitation-switch",
  "host-update-mark",
  "reading-worktrees",
  "git-image-diff",
  "reading-text-copy",
  "terminal-image-restart",
];

// Names accepted by verification/web/run.mjs --only and e2e/web/scenario.mjs.
export const scenarioNames = new Set([
  ...fullScenarioOrder,
  "usage-status",
  "cli-order",
  "repo-delegation",
  "host-forget",
  "terminal-size-ownership",
  "sidebar-width",
  "pane-resize",
  "pane-actions",
  "pane-maximize",
  "clipboard-transfer",
  "clipboard-image",
  "clipboard-image:claude",
  "clipboard-image:codex",
  "clipboard-image:pi",
  "cli-launcher",
  "cli-omp",
  "cli-settings",
  "terminal-retention",
  "event-tolerance",
  "long-approval",
  "claude-status",
  "terminal-fit",
  "terminal-send",
  "readme-shots",
]);

// A selected child also runs every independently selectable workflow that contains it.
export const scenarioParents = {
  "terminal-retention": ["web-terminal"],
  "event-tolerance": ["web-terminal"],
  "terminal-size-ownership": ["web-terminal"],
  "pane-resize": ["web-terminal"],
  "pane-actions": ["web-terminal"],
  "pane-maximize": ["web-cli"],
  "cli-settings": ["web-cli"],
  "cli-resize": ["web-cli"],
  "claude-status": ["web-cli"],
  "cli-launcher": ["web-cli"],
  "long-approval": ["web-cli"],
  "clipboard-transfer": ["clipboard"],
  "clipboard-image": ["clipboard"],
  "clipboard-image:claude": ["clipboard"],
  "clipboard-image:codex": ["clipboard"],
  "clipboard-image:pi": ["clipboard"],
};

export function releaseScenarios(args) {
  const option = args.find((arg) => arg.startsWith("--scenarios="));
  if (option === undefined) {
    if (args.includes("--scenarios"))
      throw new Error("--scenarios=<操作列,…> を指定してください");
    return undefined;
  }
  const scenarios = [
    ...new Set(option.slice("--scenarios=".length).split(",")),
  ];
  const unknown = scenarios.filter((name) => !scenarioNames.has(name));
  if (unknown.length)
    throw new Error(
      `存在しない操作列: ${unknown.map((name) => JSON.stringify(name)).join(", ")}。verification/web/run.mjs --only の操作列名を指定してください`,
    );
  for (const scenario of scenarios)
    for (const parent of scenarioParents[scenario] ?? [])
      if (!scenarios.includes(parent)) scenarios.push(parent);
  return scenarios;
}
