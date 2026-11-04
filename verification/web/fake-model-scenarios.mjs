import { readmeScripts } from "../../e2e/fake-model/readme-shots.mjs";
import { automationIssueScripts } from "../../e2e/fake-model/automation-issue.mjs";
import { automationsScripts } from "../../e2e/fake-model/automations.mjs";
import { automationWebhookScripts } from "../../e2e/fake-model/automation-webhook.mjs";
import { webRecoveryScripts } from "../../e2e/fake-model/web-recovery.mjs";
import { forgeIssueStartScripts } from "../../e2e/fake-model/forge-issue-start.mjs";
import { hostUpdateScripts } from "../../e2e/fake-model/host-update.mjs";
import { hostUninstallScripts } from "../../e2e/fake-model/host-uninstall.mjs";
import { mobileBatchInputScripts } from "../../e2e/fake-model/mobile-batch-input.mjs";
import { mobileImagesScripts } from "../../e2e/fake-model/mobile-images.mjs";
import { cliDefinitionPluginScripts } from "../../e2e/fake-model/cli-definition-plugin.mjs";
import { clipboardScripts } from "../../e2e/fake-model/clipboard.mjs";
import { cliOmpScripts } from "../../e2e/fake-model/cli-omp.mjs";
import { opencodeDelegationScripts } from "../../e2e/fake-model/opencode-delegation.mjs";
import { cliStatusScripts } from "../../e2e/fake-model/cli-status.mjs";
import { teamDelegationScripts } from "../../e2e/fake-model/team-delegation.mjs";
import { boardActivityScripts } from "../../e2e/fake-model/board-activity.mjs";

import { cliDefinitionScripts } from "../../e2e/fake-model/cli-definition.mjs";
import { terminalDaemonScripts } from "../../e2e/fake-model/terminal-daemon.mjs";

import { childCliFailureScripts } from "../../e2e/fake-model/child-cli-failure.mjs";

export const fakeModelScenarios = {
  "readme-shots": { clis: ["claude", "codex"], scripts: readmeScripts },
  "child-cli-failure": {
    clis: ["claude", "codex"],
    scripts: childCliFailureScripts,
    codexAccount: true,
  },
  "automation-issue": { clis: ["codex"], scripts: automationIssueScripts },
  automations: { clis: ["claude", "codex"], scripts: automationsScripts },
  "automation-webhook": { clis: ["codex"], scripts: automationWebhookScripts },
  "web-recovery": { clis: ["codex"], scripts: webRecoveryScripts },
  "forge-issue-start": { clis: ["claude"], scripts: forgeIssueStartScripts },
  "host-update": { clis: ["claude"], scripts: hostUpdateScripts },
  "host-uninstall": { clis: ["claude"], scripts: hostUninstallScripts },
  "mobile-batch-input": { clis: ["claude"], scripts: mobileBatchInputScripts },
  "mobile-images": { clis: ["claude"], scripts: mobileImagesScripts },
  "cli-definition-plugin": {
    clis: ["pi", "claude"],
    scripts: cliDefinitionPluginScripts,
  },
  clipboard: { clis: ["claude", "codex", "pi"], scripts: clipboardScripts },
  "clipboard-image": { clis: ["claude"], scripts: clipboardScripts },
  "clipboard-image:claude": { clis: ["claude"], scripts: clipboardScripts },
  "clipboard-image:codex": { clis: ["codex"], scripts: clipboardScripts },
  "clipboard-image:pi": { clis: ["pi"], scripts: clipboardScripts },
  "cli-omp": { clis: ["omp", "claude"], scripts: cliOmpScripts },
  "opencode-delegation": {
    clis: ["opencode", "claude", "codex"],
    scripts: opencodeDelegationScripts,
    codexAccount: true,
  },
  "web-cli": { clis: ["claude", "codex", "pi"], scripts: cliStatusScripts },
  "claude-status": { clis: ["claude"], scripts: cliStatusScripts },
  "long-approval": { clis: ["claude"], scripts: cliStatusScripts },
  "child-lifecycle": {
    clis: ["claude", "codex"],
    scripts: teamDelegationScripts,
    codexAccount: true,
  },
  "repo-delegation": {
    clis: ["claude", "codex"],
    scripts: teamDelegationScripts,
    codexAccount: true,
  },
  "cli-definition": { clis: ["claude"], scripts: cliDefinitionScripts },
  "terminal-daemon": { clis: ["claude"], scripts: terminalDaemonScripts },
  "team-delegation": {
    clis: ["claude", "codex"],
    scripts: teamDelegationScripts,
    codexAccount: true,
  },
  "board-activity": {
    clis: ["claude", "codex"],
    scripts: boardActivityScripts,
    codexAccount: true,
  },
};
