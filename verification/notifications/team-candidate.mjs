import { openWorkspaceView } from "../workspace/interaction.mjs";
import assert from "node:assert/strict";
import { waitFor } from "../ui.mjs";
import { windowsDesktop } from "../native/windows-desktop.mjs";
import { sh } from "../native/remote.mjs";
import { verificationConfig } from "../config.mjs";
const action = (name) => `[data-iori-action="${name}"]`;
export async function verifyTeamCandidateNotification({
  win,
  state,
  workspace,
  fixture,
  asUser,
  emit,
  evaluate,
  observed,
  result,
  save,
  shot,
  record,
}) {
  result.windowsNotificationPermission = await evaluate(
    win,
    "window.__TAURI__.core.invoke('native_notification_permission')",
  );
  assert.equal(
    result.windowsNotificationPermission,
    "granted",
    "検証ClientのOS通知許可が無いため、通知試験を開始できません",
  );
  const candidate = (id, cli) => ({
    id,
    cli,
    model: "",
    tools: [],
    minimum: "",
  });
  const definition = {
    name: "Notification team",
    description: "Candidate availability",
    parent: candidate("parent", "codex"),
    instruction: "",
    roles: [
      {
        id: "worker",
        name: "Worker",
        when: "Verification",
        limit: "",
        reuse: true,
        split: false,
        instruction: "",
        request: "",
        report: "",
        candidates: {
          high: [],
          medium: [candidate("absent", "absent-verification-cli")],
          low: [],
        },
      },
    ],
  };
  const request = async (method, params) =>
    evaluate(
      win,
      `(async()=>{const result=JSON.parse(await window.__TAURI__.core.invoke('native_request',{connectionId:window.__ioriNotificationConnectionId,json:JSON.stringify({kind:'request',method:${JSON.stringify(method)},operationId:crypto.randomUUID(),params:${JSON.stringify(params)}})}));if(!result.ok)throw new Error('Host fixture request failed');return result.result;})()`,
    );
  const team = await request("teams.create", { definition });
  await request("teams.settings", {
    enabled: true,
    defaultTeam: team.saved.id,
    limits: {},
  });
  const parent = await request("team.launch", {
    teamId: team.saved.id,
    cwd: workspace,
  });
  await win.screen.click(`[data-iori-terminal-row="${parent.terminal.id}"]`);
  await win.screen.wait(
    `[data-iori-terminal-id="${parent.terminal.id}"][data-iori-stream-state="ready"]`,
  );
  await observed(win, "iori notification fixture ready");
  await openWorkspaceView(win.screen, "files");
  await emit({ delegation: true });
  const delegation = await waitFor(
    () =>
      asUser(
        `if test -f ${sh(fixture + "/delegation-error.json")}; then cat ${sh(fixture + "/delegation-error.json")}; elif test -f ${sh(fixture + "/delegation.json")}; then cat ${sh(fixture + "/delegation.json")}; fi`,
      ),
    Boolean,
  );
  const delegationResult = JSON.parse(delegation);
  if (delegationResult.failed) {
    result.delegationFailure = delegationResult;
    await save();
    throw new Error(
      `iori delegate failed: ${JSON.stringify(delegationResult)}`,
    );
  }
  const childId = delegationResult.data.child;
  const notification = await waitFor(
    async () => {
      const identity = await windowsDesktop(state, "identity");
      result.windowsLastIdentity = identity;
      result.windowsNativeNotifications = await evaluate(
        win,
        "window.__ioriNativeNotifications",
      );
      await save();
      return identity;
    },
    (value) =>
      value.notifications.some(
        (item) => item.tag === childId && item.kind === "candidate",
      ),
  );
  result.windowsCandidateNotification = {
    childId,
    teamId: team.saved.id,
    osNotificationFound: true,
    matching: notification.notifications.filter((item) => item.tag === childId)
      .length,
  };
  assert.equal(result.windowsCandidateNotification.matching, 1);
  const hostKey = await evaluate(
    win,
    "window.__TAURI__.core.invoke('native_initial_state').then(state=>state.hosts[0].publicKey)",
  );
  const scheme = verificationConfig.plugins["deep-link"].desktop.schemes[0];
  await windowsDesktop(state, "protocol-open", {
    activationUrl: `${scheme}://cli?host=${hostKey}&terminal=${childId}&team=${team.saved.id}`,
  });
  await win.screen.wait(
    `.team-surface:not([hidden]) .team-save-header[data-iori-team-id="${team.saved.id}"]`,
  );
  result.windowsCandidateNotification.editorOpened = true;
  await shot(win, "windows-team-candidate-editor");
  await record(
    "Windows: 候補が無い委譲のOS通知を既存の経路で表示し、対象チームの編集へ移動",
  );
}
