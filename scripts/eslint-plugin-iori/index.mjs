import noWebTerminalObservation from "./rules/no-web-terminal-observation.mjs";
import noWorkspaceEntranceClick from "./rules/no-workspace-entrance-click.mjs";
import noTerminalEchoMarker from "./rules/no-terminal-echo-marker.mjs";
import noSshStartProcess from "./rules/no-ssh-start-process.mjs";
import noTransientUpdateHost from "./rules/no-transient-update-host.mjs";
import noCliNameBranch from "./rules/no-cli-name-branch.mjs";
import noFixedTimeoutFailure from "./rules/no-fixed-timeout-failure.mjs";
import noStoredValueRejection from "./rules/no-stored-value-rejection.mjs";
import noUnknownDisplay from "./rules/no-unknown-display.mjs";
import noCliBundledSubmit from "./rules/no-cli-bundled-submit.mjs";
import noClaudeCredentialsLinkCopy from "./rules/no-claude-credentials-link-copy.mjs";
import noWaitForOperationWithoutFailure from "./rules/no-wait-for-operation-without-failure.mjs";

import noSyncDistributionDownload from "./rules/no-sync-distribution-download.mjs";

export default {
  meta: {
    name: "eslint-plugin-iori",
    version: "0.1.0",
  },
  rules: {
    "no-web-terminal-observation": noWebTerminalObservation,
    "no-workspace-entrance-click": noWorkspaceEntranceClick,
    "no-terminal-echo-marker": noTerminalEchoMarker,
    "no-ssh-start-process": noSshStartProcess,
    "no-sync-distribution-download": noSyncDistributionDownload,
    "no-transient-update-host": noTransientUpdateHost,
    "no-cli-name-branch": noCliNameBranch,
    "no-fixed-timeout-failure": noFixedTimeoutFailure,
    "no-stored-value-rejection": noStoredValueRejection,
    "no-unknown-display": noUnknownDisplay,
    "no-cli-bundled-submit": noCliBundledSubmit,
    "no-claude-credentials-link-copy": noClaudeCredentialsLinkCopy,
    "no-wait-for-operation-without-failure": noWaitForOperationWithoutFailure,
  },
};
