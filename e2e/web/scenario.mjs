import { newWorktreeLayout } from "./new-worktree-layout.mjs";
import { sidebarWidth } from "./sidebar-width.mjs";
import { terminalSend } from "./terminal-send.mjs";
import { filesTransfer } from "./files-transfer.mjs";
import { openWorkspaceView } from "../../verification/workspace/interaction.mjs";
import { automationsScenario } from "./automations.mjs";
import { automationIssueScenario } from "./automation-issue.mjs";
import { automationWebhookScenario } from "./automation-webhook.mjs";
import { terminalFileLinks } from "./terminal-file-links.mjs";
import {
  forgeStatusScenario,
  forgeSettingsWithoutWorkspace,
} from "./forge-status.mjs";
import { forgeCiScenario } from "./forge-ci.mjs";
import { forgeTokenScenario } from "./forge-token.mjs";
import { forgeIssuesScenario } from "./forge-issues.mjs";
import { forgeIssueStartScenario } from "./forge-issue-start.mjs";
import { forgeCommandsScenario } from "./forge-commands.mjs";
import { worktreeRemoval } from "./worktree-removal.mjs";
import { worktreeCreate } from "./worktree-create.mjs";
import { sidebarOrderScenario } from "./sidebar-order.mjs";
import { mobileKeyBand } from "./mobile-key-band.mjs";
import { mobileImages } from "./mobile-images.mjs";
import { mobileBatchInput } from "./mobile-batch-input.mjs";
import { openSidebar } from "../connection/scenario.mjs";
import { terminalClipboard } from "./terminal-clipboard.mjs";
import { readingResponsiveness } from "./reading-responsiveness.mjs";
import { clientUpdate, clientHostUpdate } from "./client-update.mjs";
import {
  clipboardImageRestartScenario,
  clipboardImageScenario,
  clipboardScenarios,
  clipboardTransferScenario,
} from "./clipboard-image.mjs";
import { gitImageDiff } from "./git-image-diff.mjs";
import { readingWorktrees, readingSurfaces } from "./reading-worktrees.mjs";
import { readingTextCopy } from "./reading-text-copy.mjs";
import { filesReading } from "./files-reading.mjs";
import {
  terminalFitScenario,
  terminalFont,
  terminalRightClick,
  mobileTerminalTouch,
  mobileCliSelection,
} from "./terminal-preferences.mjs";
import { teamNotificationsScenario } from "./team-notifications.mjs";
import { prepareTeamScenario } from "./team-fixture.mjs";
import { teamCommandRouteScenario } from "./team-command-route.mjs";
import { teamChildTabsScenario } from "./team-child-tabs.mjs";
import { teamMessagesScenario } from "./team-messages.mjs";
import { teamBoardScenario } from "./team-board.mjs";
import { teamRecordsScenario } from "./team-records.mjs";
import {
  teamWebScenarios,
  childLifecycleScenarios,
  cliDefinitionScenarios,
} from "../../verification/web/scenarios.mjs";
import { teamSaveConflictScenario } from "./team-save-conflict.mjs";
import { teamsScenario } from "./teams.mjs";
import { terminalRetention, eventTolerance } from "./terminal-recovery.mjs";
import { longApproval } from "../cli-screen/claude-status.mjs";
import { cliResumeScenario } from "./cli-resume.mjs";
import { claudeStatusScenario } from "../cli-screen/claude-status.mjs";
import { commitReconnection } from "./commit-reconnection.mjs";
import { terminalSizeOwnership } from "./terminal-size-ownership.mjs";
import { terminalWidthHandoff } from "./terminal-width-handoff.mjs";
import { cliStatusScenario } from "../cli-screen/status.mjs";
import {
  cliScenario,
  cliFirstOpen,
  cliSettings,
  modelFailureScenario,
} from "../cli-screen/scenario.mjs";
import { cliLauncherScenario } from "./cli-launcher.mjs";
import { cliDefinitionScenario } from "./cli-definition.mjs";
import { cliDefinitionPluginScenario } from "./cli-definition-plugin.mjs";
import { usageStatusScenario } from "./usage-status.mjs";
import { cliOrderScenario } from "./cli-order.mjs";
import { cliOmpScenario } from "./cli-omp.mjs";
import {
  paneSplit,
  paneFileDrop,
  paneExit,
  paneResize,
  paneMaximize,
} from "./panes.mjs";
import assert from "node:assert/strict";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { waitFor } from "../../verification/ui.mjs";
import { register, forgetHostFromSettings } from "../connection/scenario.mjs";
import { openFolder, selectWorktree } from "../workspace/scenario.mjs";
import {
  observe,
  observed,
  create,
  typeTerminal,
  observeTerminalInstances,
} from "../terminal/scenario.mjs";

const action = (name) => `[data-iori-action="${name}"]`;

export async function webScenario({
  client,
  invitation,
  repository,
  secondRepository,
  worktree,
  mobile,
  desktop,
  shot,
  record,
  finishBackgroundTerminal,
  disconnectedReads,
  phone,
  commits,
  verifyUnusedHooks,
  preventHookInstall,
  restartPreservingHost,
  automationDatabase,
  ptyDimensions,
  restartHostLosingTerminals,
  resumeScreenEvidence,
  session,
  assistantReply,
  hooksReady,
  only,
  forgeFixture,
  forgeTokenFixture,
  hostData,
  updates,
  notificationHook,
  notificationCommand,
  childListFault,
  notificationBeforeChildrenSnapshot,
  notificationPids,
  notificationSourceFault,
  childDisplayFixture,
  teamRecords,
  teamDelivery,
  teamCommand,
  withConnectionOffline,
  releaseRetentionOutput,
  malformedEvent,
  oversizedAttention,
  replayCliUpdate,
  clipboardFiles,
  fakeModelRequests,
  changeReadingFile,
  additionalHost,
  stopAdditionalUpdateHost,
  createPlainFolder,
  reload,
  missedWaiting,
}) {
  const screen = client.screen;
  await register(screen, invitation, "開発用Chromium");
  await screen.key("Escape");
  await record("招待で登録");
  if (only === "usage-status")
    return usageStatusScenario({
      client,
      repository,
      worktree,
      hostData,
      mobile,
      record,
    });
  if (only === "cli-order")
    return cliOrderScenario({
      client,
      repository,
      worktree,
      phone,
      restartHostLosingTerminals,
      reload,
      record,
    });
  if (
    [
      ...teamWebScenarios,
      ...childLifecycleScenarios,
      ...cliDefinitionScenarios,
      "repo-delegation",
      "child-cli-failure",
      "opencode-delegation",
      "board-activity",
    ].includes(only)
  ) {
    await openFolder(screen, repository, false);
    await screen.click(
      `button[data-iori-worktree-path=${JSON.stringify(worktree)}]`,
    );
    const options = {
      fakeModelRequests,
      client,
      hostData,
      session,
      teamCommand,
      teamRecords,
      teamDelivery,
      restartHostLosingTerminals,
      restartPreservingHost,
      reload,
      secondRepository,
      worktree,
      record,
      shot,
      desktop,
      mobile,
      phone,
      workflow: only,
    };
    if (cliDefinitionScenarios.includes(only))
      return cliDefinitionScenario(options);
    const scenarios = {
      "team-command-route": teamCommandRouteScenario,
      "team-child-tabs": teamChildTabsScenario,
      "team-messages": teamMessagesScenario,
      "team-board": teamBoardScenario,
      "team-records": teamRecordsScenario,
    };
    if (scenarios[only]) return scenarios[only](options);
    return prepareTeamScenario({
      ...options,
      lifecycleOnly: childLifecycleScenarios.includes(only),
      lifecycleWorkflow: only,
      failureOnly: only === "child-cli-failure",
      repoOnly: only === "repo-delegation",
      activityOnly: only === "board-activity",
      opencodeOnly: only === "opencode-delegation",
    });
  }
  if (only === "new-worktree-layout")
    return newWorktreeLayout({ client, repository, shot, record });
  if (only === "git-image-diff")
    return gitImageDiff({
      client,
      screen,
      repository,
      desktop,
      mobile,
      shot,
      record,
    });
  if (only === "client-host-update")
    return clientHostUpdate({
      client,
      distribution: updates,
      additionalHost,
      stopAdditionalUpdateHost,
      repository,
      reload,
      record,
      shot,
    });
  if (only === "forge-status")
    await forgeSettingsWithoutWorkspace(screen, record);
  if (only === "forge-status")
    return forgeStatusScenario({
      client,
      fixture: forgeFixture,
      reload,
      mobile,
      desktop,
      shot,
      record,
    });
  if (only === "forge-ci")
    return forgeCiScenario({
      client,
      fixture: forgeFixture,
      mobile,
      desktop,
      shot,
      record,
    });
  if (
    [
      "automation-draft",
      "automation-run",
      "automation-schedule",
      "automation-recovery",
      "automation-webhook-setup",
      "automation-webhook-receive",
    ].includes(only)
  ) {
    await openFolder(screen, repository, false);
    await screen.click(
      `button[data-iori-worktree-path=${JSON.stringify(worktree)}]`,
    );
    const options = {
      fakeModelRequests,
      client,
      worktree,
      record,
      desktop,
      mobile,
      session,
      assistantReply,
      restartPreservingHost,
      automationDatabase,
      ptyDimensions,
      workflow: only,
    };
    return only.startsWith("automation-webhook-")
      ? automationWebhookScenario(options)
      : automationsScenario(options);
  }
  if (only === "automation-issue")
    return automationIssueScenario({
      client,
      fixture: forgeTokenFixture,
      record,
      shot,
      desktop,
      session,
      fakeModelRequests,
    });
  if (only === "forge-token")
    return forgeTokenScenario({
      client,
      fixture: forgeTokenFixture,
      hostData,
      mobile,
      desktop,
      shot,
      record,
    });
  if (only === "forge-issues")
    return forgeIssuesScenario({
      client,
      fixture: forgeFixture,
      reload,
      mobile,
      desktop,
      shot,
      record,
    });
  if (only === "forge-issue-start")
    return forgeIssueStartScenario({
      client,
      fixture: forgeFixture,
      repository,
      hostData,
      session,
      mobile,
      desktop,
      shot,
      record,
    });
  if (only === "forge-commands")
    return forgeCommandsScenario({
      client,
      tokenFixture: forgeTokenFixture,
      mobile,
      desktop,
      shot,
      record,
    });
  if (
    [
      "sidebar-worktree-state",
      "sidebar-workspace-order",
      "sidebar-host-order",
    ].includes(only)
  )
    return sidebarOrderScenario({
      workflow: only,
      client,
      repository,
      worktree,
      phone,
      desktop,
      restartHostLosingTerminals,
      additionalHost,
      createPlainFolder,
      reload,
      record,
    });
  await openFolder(screen, repository, false);
  await screen.click(
    `button[data-iori-worktree-path=${JSON.stringify(worktree)}]`,
  );
  await waitFor(
    () =>
      screen.attribute(
        "[data-iori-current-worktree-path]",
        "data-iori-current-worktree-path",
      ),
    (value) => value === worktree,
  );
  if (
    [
      "terminal-nerd-font",
      "terminal-retention",
      "event-tolerance",
      "terminal-size-ownership",
      "pane-resize",
      "pane-split",
      "pane-file-drop",
      "pane-exit",
      "terminal-send",
      "terminal-fit",
      "terminal-font",
      "terminal-right-click",
      "mobile-terminal-touch",
      "mobile-cli-selection",
    ].includes(only)
  ) {
    await observe(
      client,
      "(await import('/src/native-platform-web.ts')).listen",
    );
    await observeTerminalInstances(client);
    await create(client);
    await screen.wait(
      '[data-iori-view="terminal"][data-iori-stream-state="ready"]',
    );
    const terminalId = await screen.attribute(
      '[data-iori-view="terminal"]',
      "data-iori-terminal-id",
    );
    if (only === "terminal-nerd-font") {
      await typeTerminal(
        client,
        "printf '\\357\\220\\230 \\356\\227\\277 \\357\\201\\273\\n'\r",
      );
      await observed(client, "\uf418 \ue5ff \uf07b");
      await waitFor(() =>
        screen.evaluate(`(() => {
        const font = '14px "Symbols Nerd Font Mono"';
        const text = "\uf418 \ue5ff \uf07b";
        return [...document.fonts].some(face => face.family === "Symbols Nerd Font Mono" && face.status === "loaded") && document.fonts.check(font, text);
      })()`),
      );
      const fontFamily = await screen.evaluate(
        `document.querySelector('[data-iori-view="terminal"][data-iori-displayed="true"] [data-iori-part="terminal-screen"]').__e2eTerminal.options.fontFamily`,
      );
      assert.ok(fontFamily.includes('"Symbols Nerd Font Mono"'));
      await record("TerminalのNerd Fontの記号とフォントの読込");
      return;
    }
    if (only === "terminal-size-ownership") {
      await terminalSizeOwnership({
        desktop: client,
        phone: await phone(),
        worktree,
        terminalId,
        record,
      });
      return;
    }
    if (
      [
        "terminal-fit",
        "terminal-send",
        "terminal-font",
        "terminal-right-click",
        "mobile-terminal-touch",
        "mobile-cli-selection",
      ].includes(only)
    ) {
      await {
        "terminal-fit": terminalFitScenario,
        "terminal-send": terminalSend,
        "terminal-font": terminalFont,
        "terminal-right-click": terminalRightClick,
        "mobile-terminal-touch": mobileTerminalTouch,
        "mobile-cli-selection": mobileCliSelection,
      }[only]({
        client,
        record,
        shot,
        worktree,
        mobile,
        desktop,
        clipboardFiles,
        reload,
      });
      return;
    }
    if (only === "terminal-retention")
      await terminalRetention({
        client,
        terminalId,
        withConnectionOffline,
        releaseRetentionOutput,
        record,
      });
    if (only === "event-tolerance")
      await eventTolerance({ client, terminalId, malformedEvent, record });
    if (
      ["pane-resize", "pane-split", "pane-file-drop", "pane-exit"].includes(
        only,
      )
    ) {
      await {
        "pane-resize": paneResize,
        "pane-split": paneSplit,
        "pane-file-drop": paneFileDrop,
        "pane-exit": paneExit,
      }[only]({ client, terminalId, record, finishBackgroundTerminal });
    }
    return;
  }
  const initialKinds = () =>
    screen.evaluate(
      `Array.from(document.querySelectorAll('button[data-iori-tab-kind]'), tab => tab.dataset.ioriTabKind)`,
    );
  await screen.wait('button[data-iori-tab-kind="start"][data-state="active"]');
  assert.deepEqual(await initialKinds(), ["start", "files", "git"]);
  assert.equal(
    await screen.attribute('button[data-iori-tab-kind="files"]', "data-state"),
    "inactive",
  );
  assert.equal(
    await screen.attribute('button[data-iori-tab-kind="git"]', "data-state"),
    "inactive",
  );
  await openWorkspaceView(screen, "files");
  await screen.click(
    '.dock-tab-header:has([data-iori-tab-kind="files"]) [data-iori-action="workspace-close-tab"]',
  );
  await screen.click(action("workspace-add-tab"));
  await screen.click(action("workspace-open-files"));
  await screen.wait('button[data-iori-tab-kind="files"][data-state="active"]');
  await screen.click(
    '.dock-tab-header:has([data-iori-tab-kind="files"]) [data-iori-action="workspace-close-tab"]',
  );
  await screen.click('button[data-iori-tab-kind="start"]');
  await reload();
  await screen.wait('button[data-iori-tab-kind="start"][data-state="active"]');
  assert.deepEqual(await initialKinds(), ["start", "git"]);
  await openSidebar(screen);
  const plain = await createPlainFolder();
  await openFolder(screen, plain, false);
  await screen.wait('button[data-iori-tab-kind="start"][data-state="active"]');
  assert.deepEqual(await initialKinds(), ["start", "files"]);
  // Close the auxiliary view first: its asynchronous state saves must not
  // accidentally save the new Terminal for this operation.
  await openWorkspaceView(screen, "files");
  await screen.click(
    '.dock-tab-header:has([data-iori-tab-kind="files"]) [data-iori-action="workspace-close-tab"]',
  );
  await screen.wait('button[data-iori-tab-kind="start"][data-state="active"]');
  const closingStartId = await screen.attribute(
    'button[data-iori-tab-kind="start"]',
    "data-iori-tab-id",
  );
  await screen.click(
    '.dock-tab-header:has([data-iori-tab-kind="start"]) [data-iori-action="workspace-close-tab"]',
  );
  await screen.wait('button[data-iori-tab-kind="start"][data-state="active"]');
  assert.deepEqual(await initialKinds(), ["start"]);
  assert.notEqual(
    await screen.attribute(
      'button[data-iori-tab-kind="start"]',
      "data-iori-tab-id",
    ),
    closingStartId,
  );
  for (const name of ["add-tab", "split-right", "split-below", "maximize"])
    assert.equal(await screen.visible(action(`workspace-${name}`)), true);
  await record("全てのタブを閉じると始めるタブが1つ開き、タブ列の操作が残る");
  await screen.click(
    '[data-iori-view="workspace-start"] button[data-iori-shell-id="bash"]',
  );
  await screen.wait(
    'button[data-iori-tab-kind="terminal"][data-state="active"]',
  );
  const startedTab = await screen.attribute(
    'button[data-iori-tab-kind="terminal"]',
    "data-iori-tab-id",
  );
  await selectWorktree(screen, worktree, false);
  await screen.wait('button[data-iori-tab-kind="start"][data-state="active"]');
  await selectWorktree(screen, plain, false);
  await screen.wait(
    `button[data-iori-tab-id="${startedTab}"][data-state="active"]`,
  );
  assert.deepEqual(await initialKinds(), ["terminal"]);
  await record(
    "始めるでTerminalを選び、ほかのタブを触らずworktreeを往復しても会話が残る",
  );
  await openSidebar(screen);
  await screen.click(
    `button[data-iori-worktree-path=${JSON.stringify(worktree)}]`,
  );
  await screen.wait('button[data-iori-tab-kind="start"][data-state="active"]');
  assert.deepEqual(await initialKinds(), ["start", "git"]);
  await record(
    "初回は始める・Files・Git（非GitはFiles）のタブを表示し、Filesを＋から開き直せる。保存した配置へタブを足さない",
  );
  await record("Hostのworktreeを開く");
  assert.equal(
    await screen.visible(action("mobile-home")),
    false,
    "PCにホームは出さない",
  );
  assert.equal(
    await screen.visible(action("host-settings-open")),
    true,
    "Hostの行から設定を開ける",
  );
  const hostKey = await screen.attribute(
    '[data-iori-action="host-settings-open"]',
    "data-iori-host-key",
  );
  await screen.click(action("host-settings-open"));
  await screen.wait('[data-iori-view="settings"]');
  assert.equal(
    await screen.attribute(
      action("settings-host-select"),
      "data-iori-host-key",
    ),
    hostKey,
  );
  await screen.wait(action("open-connection") + '[aria-current="page"]');
  await screen.click(action("settings-close"));
  await shot("desktop-sidebar-host-settings");
  await record(
    "Hostの行の歯車でそのHostの設定の接続を開き、PCにホームは出さない",
  );
  if (only === "web-workspace" || only === "host-forget") {
    if (only === "host-forget") {
      await mobile();
      await openSidebar(screen);
      await screen.click(action("settings-open"));
      await screen.click(action("open-connection"));
      await screen.click(action("host-forget"));
      await screen.wait('[data-iori-view="host-forget-confirmation"]');
      await screen.key("Alt+ArrowLeft");
      assert.equal(
        await screen.visible('[data-iori-view="host-forget-confirmation"]'),
        false,
      );
      assert.equal(await screen.visible(action("host-forget")), true);
      await screen.click(action("settings-close"));
      await record(
        "端末の戻る操作でHost削除の確認だけを閉じ、接続の詳細を保つ",
      );
    }
    await forgetHostFromSettings(screen, { record, shot });
    await openFolder(screen, repository, false);
    await observe(
      client,
      "(await import('/src/native-platform-web.ts')).listen",
    );
    await create(client);
    await typeTerminal(client, "echo IORI_RECONNECTED_'TERMINAL'\r");
    await observed(client, "IORI_RECONNECTED_TERMINAL");
    await record("再登録後にTerminalを開いてコマンドを実行");
    return;
  }
  if (only === "reading-responsiveness") {
    await readingResponsiveness({
      screen,
      record,
      changeFile: changeReadingFile,
    });
    return;
  }
  if (only === "client-update") {
    await clientUpdate({
      client,
      distribution: updates,
      record,
      shot,
      mobile,
      desktop,
      reload,
    });
    return;
  }
  if (
    [
      "removal-indicators",
      "removal-single",
      "removal-cleanup",
      "removal-mobile",
      "removal-parent-child",
    ].includes(only)
  ) {
    await worktreeRemoval({
      scenario: only,
      client,
      createPlainFolder,
      repository,
      desktop,
      mobile,
      phone,
      shot,
      record,
      notificationCommand,
      notificationPids,
    });
    return;
  }
  if (only === "worktree-create") {
    await worktreeCreate({
      createPlainFolder,
      client,
      repository,
      desktop,
      mobile,
      shot,
      record,
    });
    return;
  }
  if (["files-upload", "files-download"].includes(only)) {
    await filesTransfer({
      scenario: only,
      client,
      screen,
      repository,
      worktree,
      mobile,
      desktop,
      shot,
      record,
    });
    return;
  }
  if (only === "reading-text-copy") {
    await readingTextCopy({
      client,
      screen,
      repository,
      worktree,
      mobile,
      desktop,
      record,
      shot,
    });
    return;
  }
  if (only === "reading-worktree-switch") {
    await readingWorktrees({
      client,
      screen,
      repository,
      worktree,
      desktop,
      mobile,
      shot,
      record,
    });
    return;
  }
  if (only === "reading-surfaces") {
    await readingSurfaces({
      client,
      screen,
      worktree,
      desktop,
      mobile,
      shot,
      record,
    });
    return;
  }
  if (only === "files-reading") {
    await filesReading({
      client,
      screen,
      repository,
      worktree,
      desktop,
      mobile,
      shot,
      record,
    });
    return;
  }
  if (only === "cli-definition-plugin")
    return cliDefinitionPluginScenario({
      client,
      hostData,
      teamCommand,
      record,
    });
  if (only === "cli-omp")
    return cliOmpScenario({
      fakeModelRequests,
      client,
      session,
      teamCommand,
      teamRecords,
      restartHostLosingTerminals,
      record,
      shot,
    });
  if (
    [
      "team-notifications",
      "child-board",
      "child-board-mobile",
      "child-sidebar-navigation",
      "child-rows",
    ].includes(only)
  ) {
    await teamNotificationsScenario({
      client,
      worktree,
      repository,
      notificationHook,
      notificationCommand,
      childListFault,
      notificationBeforeChildrenSnapshot,
      notificationSourceFault,
      childDisplayFixture,
      childRunningOnly: [
        "child-board",
        "child-board-mobile",
        "child-sidebar-navigation",
      ].includes(only)
        ? only
        : false,
      childrenOnly: only === "child-rows",
      mobile,
      shot,
      restartHostLosingTerminals,
      record,
      desktop,
    });
    return;
  }

  if (only === "model-failure") {
    await modelFailureScenario({ client, record });
    return;
  }
  if (only === "team-save-conflict") {
    await teamSaveConflictScenario({ client, phone, record, shot });
    return;
  }
  if (only === "teams") {
    await teamsScenario({
      client,
      restartHostLosingTerminals,
      record,
      shot,
      desktop,
      mobile,
    });
    return;
  }
  await observe(client, "(await import('/src/native-platform-web.ts')).listen");
  await observeTerminalInstances(client);
  await create(client);
  await screen.wait(
    '[data-iori-view="terminal"][data-iori-stream-state="ready"]',
  );
  let terminalId = await screen.attribute(
    '[data-iori-view="terminal"]',
    "data-iori-terminal-id",
  );
  // The contiguous result is not in the typed command, so command echo cannot pass.
  await typeTerminal(client, "printf '%s%s\\n' '日本語の' '実行結果'\r");
  await observed(client, "日本語の実行結果");
  await record("本物のPTYへ日本語入力し実行結果を受信");
  await shot("desktop-terminal");
  if (only === "sidebar-width") {
    await sidebarWidth({ client, terminalId, record, reload });
    return;
  }
  if (only === "terminal-file-links") {
    await terminalFileLinks({
      worktree,
      client,
      terminalId,
      createPlainFolder,
      desktop,
      mobile,
      record,
      shot,
    });
    return;
  }
  if (only === "terminal-width-handoff") {
    await terminalWidthHandoff({
      desktop: client,
      phone,
      worktree,
      terminalId,
      record,
      restartHostLosingTerminals,
    });
    return;
  }
  if (only === "mobile-key-band") {
    await mobileKeyBand({ client, mobile, record, shot });
    return;
  }
  if (only === "mobile-batch-input") {
    await mobileBatchInput({
      client,
      mobile,
      fakeModelRequests,
      record,
      shot,
      withConnectionOffline,
    });
    return;
  }
  if (only === "pane-maximize") {
    await paneMaximize({ client, terminalId, record });
    return;
  }
  if (only === "terminal-clipboard") {
    await terminalClipboard({ client, record });
    return;
  }
  if (only === "mobile-images") {
    await mobileImages({
      client,
      mobile,
      clipboardFiles,
      fakeModelRequests,
      record,
      shot,
    });
    return;
  }
  if (only === "terminal-image-restart") {
    await clipboardImageRestartScenario({
      client,
      clipboardFiles,
      restartHostLosingTerminals,
      record,
    });
    return;
  }
  if (only === "clipboard") {
    await clipboardScenarios({
      client,
      clipboardFiles,
      fakeModelRequests,
      record,
      shot,
    });
    return;
  }
  if (only === "clipboard-transfer") {
    await clipboardTransferScenario({
      client,
      terminalId,
      clipboardFiles,
      record,
    });
    return;
  }
  if (only?.startsWith("clipboard-image")) {
    await clipboardImageScenario({
      client,
      clipboardFiles,
      fakeModelRequests,
      record,
      shot,
      cliId: only.split(":")[1] ?? "claude",
    });
    return;
  }
  if (only === "cli-launcher") {
    await verifyUnusedHooks();
    await cliLauncherScenario({
      client,
      terminalId,
      replayCliUpdate,
      record,
      shot,
      mobile,
      desktop,
      firstUse: true,
    });
    return;
  }
  if (only === "claude-status") {
    await verifyUnusedHooks();
    await claudeStatusScenario({ client, record, preventHookInstall });
    return;
  }
  if (only === "long-approval")
    await longApproval({ client, record, oversizedAttention });
  if (only === "cli-settings") await cliSettings({ client, record });
  if (only === "cli-resize")
    await cliScenario({
      client,
      record,
      cliId: "codex",
      registrationCommand: "codex",
      settings: false,
      resize: true,
      resizeOnly: true,
    });
  if (only === "cli-first-open") {
    await cliFirstOpen({ client, record, verifyUnusedHooks });
    return;
  }
  if (only === "cli-status") {
    await cliStatusScenario({
      client,
      record,
      mobile,
      desktop,
      firstUse: true,
      notifications: true,
      missedWaiting,
    });
    return;
  }
  if (only !== "web-recovery") return;
  await cliResumeScenario({
    fakeModelRequests,
    client,
    restartHostLosingTerminals,
    resumeScreenEvidence,
    session,
    assistantReply,
    warmup: hooksReady,
    record,
    shot,
  });
  await screen.click(`[data-iori-tab-id="terminal:${terminalId}"]`);
  await openWorkspaceView(screen, "files");
  await screen.click('[data-iori-file="sample.txt"]');
  await waitFor(async () =>
    (await screen.text('[data-iori-view="files"] .reading-body')).includes(
      "ブラウザーからファイルを読む",
    ),
  );
  await record("FilesでHostのファイル本文を読む");
  await shot("desktop-files");
  await writeFile(
    join(worktree, "recovery-lines.txt"),
    Array.from(
      { length: 500 },
      (_, index) => `recovery line ${index + 1}`,
    ).join("\n"),
  );
  const filesBack =
    '[data-iori-view="files"] [data-iori-action="reading-back"]';
  if (await screen.visible(filesBack)) await screen.click(filesBack);
  await screen.wait('[data-iori-file="recovery-lines.txt"]');
  await screen.click('[data-iori-file="recovery-lines.txt"]');
  await screen.wait('[data-iori-view="files"] [data-iori-line="1"]');
  await disconnectedReads(async () => {
    await screen.scroll('[data-iori-view="files"] .reading-lines', {
      top: "end",
    });
    assert.equal(
      await screen.visible('[data-iori-view="files"] [role="alert"]'),
      false,
    );
  });
  await screen.wait('[data-iori-view="files"] [data-iori-line="500"]');
  await record("切断中に本文の未読部分へ移動しても再接続後に続きを読める");
  // CLI split operations can leave Files narrow and showing only the detail.
  // Return through its normal Back control before testing an unread folder.
  if (await screen.visible(filesBack)) await screen.click(filesBack);
  await screen.wait('[data-iori-file="offline-folder"]');
  // 通信断で読み取りが空回りしないこと: request an unloaded directory
  // while the real Host is stopped, then read its changed listing after reconnect.
  await disconnectedReads(() =>
    screen.click('[data-iori-file="offline-folder"]'),
  );
  await screen.wait('[data-iori-file="offline-folder/reconnected.txt"]');
  await record("通信断で読み取りが空回りせず、再接続後にFilesの一覧が読める");
  await disconnectedReads(async () => {
    await screen.click('[data-iori-field="files-worktree"]');
    await screen.click(
      `[data-iori-worktree-choice=${JSON.stringify(repository)}]`,
    );
    await screen.click('[data-iori-field="files-worktree"]');
    await screen.click(
      `[data-iori-worktree-choice=${JSON.stringify(worktree)}]`,
    );
  });
  await screen.wait('[data-iori-file="offline-folder/reconnected.txt"]');
  await record("切断中に保存済みのフォルダーへ戻っても再接続後に展開を復元");
  await openWorkspaceView(screen, "git");
  await screen.click(
    '[data-iori-action="git-change-select"][data-path="sample.txt"]',
  );
  await waitFor(async () => {
    const diff = await screen.text(
      '[data-iori-view="git"] [data-iori-scroll="git-diff"]',
    );
    return (
      diff.includes("変更前の行") &&
      diff.includes("ブラウザーからファイルを読む")
    );
  });
  await record("Gitで同じファイルの変更前と変更後を読む");
  await shot("desktop-git");
  await commitReconnection({ screen, commits, disconnectedReads, record });

  // Reload at phone width: the bridge keeps the same device identity and saved Host.
  // This tests the browser/mobile UI, not Android's native APIs or IME.
  await mobile();
  await screen.wait('[data-iori-view="workspace"]');
  await openSidebar(screen);
  await screen.wait('[data-sidebar="sidebar"][data-mobile="true"]');
  await screen.click(
    `button[data-iori-worktree-path=${JSON.stringify(worktree)}]`,
  );
  await waitFor(
    () =>
      screen.attribute(
        "[data-iori-current-worktree-path]",
        "data-iori-current-worktree-path",
      ),
    (value) => value === worktree,
  );
  await shot("mobile-drawer");
  // Selecting a worktree can leave the drawer open; select its Files entry there.
  if (!(await screen.visible(action("sidebar-open-files"))))
    await openSidebar(screen);
  await openWorkspaceView(screen, "files");
  await screen.wait('[data-iori-mobile-view-kind="files"]:not([hidden])');
  await screen.wait(
    '[data-iori-view="files"] .reading-split[data-narrow="true"]',
  );
  if (await screen.visible('[data-iori-view="files"] .reading-detail'))
    await screen.key("Alt+ArrowLeft");
  await screen.click('[data-iori-file="sample.txt"]');
  await waitFor(async () =>
    (await screen.text('[data-iori-view="files"] .reading-body')).includes(
      "ブラウザーからファイルを読む",
    ),
  );
  await shot("mobile-files");
  await openSidebar(screen);
  await openWorkspaceView(screen, "git");
  await screen.wait('[data-iori-mobile-view-kind="git"]:not([hidden])');
  await screen.wait(
    '[data-iori-view="git"] .reading-split[data-narrow="true"]',
  );
  if (await screen.visible('[data-iori-view="git"] .reading-detail'))
    await screen.key("Alt+ArrowLeft");
  await screen.click(
    '[data-iori-action="git-change-select"][data-path="sample.txt"]',
  );
  await waitFor(async () =>
    (
      await screen.text('[data-iori-view="git"] [data-iori-scroll="git-diff"]')
    ).includes("ブラウザーからファイルを読む"),
  );
  await shot("mobile-git");
  await openSidebar(screen);
  await screen.click(`[data-iori-terminal-row=${JSON.stringify(terminalId)}]`);
  await screen.wait('[data-iori-mobile-view-kind="terminal"]:not([hidden])');
  assert.equal(
    await screen.attribute(
      '[data-iori-view="terminal"]',
      "data-iori-terminal-id",
    ),
    terminalId,
  );
  await record(
    "400×900のドロワーで同じworktreeのFiles・Git・同じTerminalを往復",
  );
  await shot("mobile-terminal");
  await desktop();
}
