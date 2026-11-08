import { openWorkspaceView } from "../../verification/workspace/interaction.mjs";
import { openSidebar } from "../connection/scenario.mjs";
import { childRunningScenario } from "./child-running.mjs";
import assert from "node:assert/strict";
import { waitFor } from "../../verification/ui.mjs";
import { submitToCli } from "../cli-screen/input.mjs";
import { focusTerminal } from "../cli-screen/scenario.mjs";
import { returnToWorktree } from "./agents-navigation.mjs";
export async function teamNotificationsScenario({
  client,
  worktree,
  repository,
  notificationHook,
  notificationCommand,
  notificationBeforeChildrenSnapshot,
  notificationSourceFault,
  childDisplayFixture,
  childRunningOnly = false,
  record,
  desktop,
  mobile,
  shot,
  childrenOnly = false,
}) {
  const screen = client.screen;
  const request = (method, params) =>
    screen.evaluate(
      `(async()=>{const {connection}=await import('/src/connection.ts');const result=await connection.requestHost(connection.getSnapshot().host.publicKey,${JSON.stringify(method)},${JSON.stringify(params)});if(!result.ok)throw new Error('notification fixture request failed');return result.result;})()`,
    );

  if (notificationHook) {
    await desktop();
    await waitFor(
      async () =>
        (await screen.visible('[data-iori-cli-id="opencode"]')) ||
        (await screen.visible('[data-iori-action="workspace-add-tab"]')),
    );
    if (!(await screen.visible('[data-iori-cli-id="opencode"]')))
      await screen.click('[data-iori-action="workspace-add-tab"]');
    await screen.click('[data-iori-cli-id="opencode"]');
    await screen.wait('[data-iori-tab-cli="opencode"]');
    const id = (
      await screen.attribute(
        '[data-iori-tab-cli="opencode"]',
        "data-iori-tab-id",
      )
    ).replace(/^terminal:/, "");
    const row = `[data-iori-terminal-row="${id}"]`;
    await notificationHook({
      hook_event_name: "session.status",
      status: { type: "busy" },
    });
    await screen.wait(`${row} [data-status="active"]`);
    await openWorkspaceView(screen, "files");
    await waitFor(
      () => screen.text(`${row} .cli-elapsed`),
      (value) => parseInt(value, 10) >= 2,
    );
    const activeSince = (await request("terminal.list", {})).terminals.find(
      (entry) => entry.id === id,
    ).cliStatus.since;
    await screen.evaluate(`(()=>{
      window.__waitNotices=[]; window.__waitSeen=[]; window.__elapsedReset=false;
      window.addEventListener('iori:notification-request', e=>window.__waitNotices.push(e.detail));
      const sample=()=>{if(document.querySelector('${row} .cli-elapsed')?.textContent.trim()==='0s')window.__elapsedReset=true;if(document.querySelector('${row} [data-status="waiting"], [data-iori-tab-id="terminal:${id}"] [data-status="waiting"]') || Number(document.querySelector('[data-iori-attention-count]')?.getAttribute('data-iori-attention-count'))>0)window.__waitSeen.push(Date.now());};
      window.__waitObserver=new MutationObserver(sample); window.__waitObserver.observe(document.body,{subtree:true,attributes:true,childList:true});
    })()`);
    const asked = (summary) =>
      notificationHook({
        hook_event_name: "permission.asked",
        id: "read",
        permission: "read",
        patterns: [summary],
        waiting: 1,
      });
    const replied = () =>
      notificationHook({
        hook_event_name: "permission.replied",
        requestID: "read",
        waiting: 0,
      });
    await asked("automatic read");
    await new Promise((resolve) => setTimeout(resolve, 100));
    await replied();
    await new Promise((resolve) => setTimeout(resolve, 1100));
    assert.deepEqual(
      await screen.evaluate("window.__waitSeen"),
      [],
      "自動回答された待ちはAttention・サイドバー・タブへ出ない",
    );
    assert.deepEqual(
      await screen.evaluate("window.__waitNotices"),
      [],
      "自動回答された待ちは通知しない",
    );
    assert.equal(
      await screen.evaluate("window.__elapsedReset"),
      false,
      "自動回答された待ちでサイドバーの経過時間が0sに戻らない",
    );
    assert.equal(
      (await request("terminal.list", {})).terminals.find(
        (entry) => entry.id === id,
      ).cliStatus.since,
      activeSince,
      "見せなかった待ちの前後で開始時刻を保つ",
    );
    await record(
      "自動回答された待ちの前後でサイドバーの経過時間と開始時刻を保つ",
    );
    const started = Date.now();
    await asked("first read");
    await new Promise((resolve) => setTimeout(resolve, 100));
    await asked("latest read");
    assert.equal(
      (await request("terminal.list", {})).terminals.find(
        (entry) => entry.id === id,
      ).cliStatus.state,
      "active",
      "一覧の再取得でも保留中の待ちを出さない",
    );
    await screen.wait(`${row} [data-status="waiting"]`);
    assert.ok(Date.now() - started >= 1000, "承認待ちは1秒続いた後で表示");
    const notices = await waitFor(
      () => screen.evaluate("window.__waitNotices"),
      (values) => values.length > 0,
    );
    assert.equal(notices.length, 1);
    assert.ok(notices[0].body.includes("latest read"));
    await replied();
    await screen.wait(`${row} [data-status="active"]`);
    await screen.evaluate("window.__waitObserver.disconnect()");
    await record(
      "本物のOpenCode hooks受信口で0.1秒の待ちは表示・通知せず、続く待ちは1秒後に最新の内容で1回通知（モデルなし）",
    );
    await screen.contextMenu(row);
    await screen.click('[data-iori-action="terminal-close"]');
    await screen.wait('[data-iori-dialog="terminal-close-confirmation"]');
    await screen.click('[data-iori-action="terminal-confirm-close"]');
  }

  // CLIs added by name and command.
  const addCli = (name, command = notificationCommand) =>
    request("cli.definition.simple", {
      simple: { name, command, modelArgument: "" },
    });
  const parent = await addCli("Notification parent");
  if (childRunningOnly)
    for (const name of [
      "Sidebar A",
      "Sidebar B",
      "Sidebar C",
      "Sidebar D",
      "Sidebar E",
      "Sidebar F",
    ])
      await addCli(name);
  const candidate = (id, cli) => ({
    id,
    cli,
    model: "",
    tools: [],
    minimum: "",
  });
  const definition = {
    name: "Notification team",
    description: "Actual queued delegation",
    parent: candidate("parent", parent.cliId),
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
          low: [],
          medium: [candidate("missing", "absent-notification-cli")],
        },
      },
    ],
  };
  const saved = await request("teams.create", { definition });
  await screen.click('[data-iori-action="open-agents-teams"]');
  await screen.click('[data-iori-action="teams-list"]');
  await screen.wait('.team-surface:not([hidden]) [role="switch"]');
  if (
    (await screen.attribute(
      '.team-surface:not([hidden]) [role="switch"]',
      "aria-checked",
    )) !== "true"
  )
    await screen.click('.team-surface:not([hidden]) [role="switch"]');
  await returnToWorktree(screen);
  await desktop();
  await screen.evaluate(
    `(()=>{window.__candidateNotifications=[];window.addEventListener('iori:notification-request',event=>window.__candidateNotifications.push(event.detail));})()`,
  );
  const launcherTeam = `[data-iori-team-id="${saved.saved.id}"]`;
  // Reload can still be rendering either the empty-worktree launcher or tabs.
  await waitFor(
    async () =>
      (await screen.visible(launcherTeam)) ||
      (await screen.visible('[data-iori-action="workspace-add-tab"]')),
  );
  if (!(await screen.visible(launcherTeam)))
    await screen.click('[data-iori-action="workspace-add-tab"]');
  await screen.click(launcherTeam);
  const notificationTerminal = await waitFor(async () =>
    (await request("terminal.list", {})).terminals.find(
      (entry) => entry.cli?.id === parent.cliId,
    ),
  );
  const parentId = notificationTerminal.id;
  await screen.click(`[data-iori-terminal-row="${parentId}"]`);
  await focusTerminal(client, parentId);
  await submitToCli(client, "DELEGATE", undefined, "candidate-notification");
  const notices = await waitFor(
    () => screen.evaluate("window.__candidateNotifications"),
    (values) => values.length > 0,
    30000,
    "候補が無い委譲の通知要求",
  );
  assert.equal(notices.length, 1);
  assert.equal(notices[0].target.teamId, saved.saved.id);
  await record("使える候補が無い委譲は既存の通知入口へ一度だけ通知を渡す");
  if (childrenOnly) {
    await screen.wait("[data-iori-child-id] .nav-child-button");
    await shot("pc-children-queued");
    await mobile({ width: 390, height: 844 });
    await screen.wait('[data-iori-view="workspace"]');
    await openSidebar(screen);
    await screen.wait("[data-iori-child-id] .nav-child-button");
    await shot("mobile-children-queued");
    await desktop();
    await screen.wait("[data-iori-child-id] .nav-child-button");
    await record(
      "モデルを呼ばない委譲でもPC・Mobileの子の行の開始位置・字下げ・2段の内容を確認",
    );
    return;
  }
  await screen.evaluate(
    `window.dispatchEvent(new CustomEvent('iori:notification-click',{detail:window.__candidateNotifications[0].target}))`,
  );
  await screen.wait(
    `.team-surface:not([hidden]) .team-save-header[data-iori-team-id="${saved.saved.id}"]`,
  );
  await returnToWorktree(screen);
  await screen.click('[data-iori-action="open-agents-teams"]');
  await screen.wait(".team-surface:not([hidden]) .team-agents-page h1");
  assert.equal(
    await screen.text(".team-surface:not([hidden]) .team-agents-page h1"),
    "AI Agents",
  );
  await record(
    "候補なし通知で対象チームへ移り、次の入口はAIエージェントを開く",
  );
  await returnToWorktree(screen);
  if (childRunningOnly) {
    await childRunningScenario({
      screen,
      worktree,
      repository,
      request,
      childDisplayFixture,
      mobile,
      desktop,
      shot,
      record,
    });
    return;
  }
  // E2E cannot normally control the ordering of a Host response and event.
  // Hold the first snapshot across reload while a real delegation is created.
  await notificationBeforeChildrenSnapshot(parentId);
  const earlyNotices = await waitFor(
    () => screen.evaluate("window.__candidateNotifications"),
    (values) => values.length > 0,
    30000,
    "最初の子の一覧より先に届いた候補なしの通知",
  );
  assert.equal(earlyNotices.length, 1, "一覧に元からある待ちは通知しない");
  assert.ok(earlyNotices[0].title.includes("Early candidate notification"));
  await record(
    "初回一覧より先の候補なし更新だけを通知し、一覧に元からある待ちは通知しない",
  );
  await request("teams.settings", {
    enabled: true,
    defaultTeam: saved.saved.id,
    limits: {},
  });
  const after = await request("teams.children", {});
  assert.equal(
    (await screen.evaluate("window.__candidateNotifications")).length,
    1,
  );
  const terminal = (await request("terminal.list", {})).terminals.find(
    (entry) => entry.cli?.id === parent.cliId,
  );
  assert.ok(terminal);
  notificationSourceFault(true, terminal);
  await desktop();
  await screen.wait(`[data-iori-terminal-row="${terminal.id}"]`);
  // Hide its CLI pane so the normal foreground suppression does not apply.
  await openWorkspaceView(screen, "files");
  await screen.evaluate("window.__candidateNotifications=[]");
  for (const state of ["waiting", "done"]) {
    notificationSourceFault(true, terminal, state);
    await waitFor(
      () => screen.evaluate("window.__candidateNotifications"),
      (values) =>
        values.some(
          (entry) =>
            !entry.target.teamId &&
            entry.title.includes(state === "waiting" ? "承認待ち" : "完了"),
        ),
      30000,
      "子の一覧を取れなくても既存CLIの通知を出す",
    );
    if (state === "waiting") {
      // Use the existing Host-event fixture boundary: the full Client receives
      // successive CLI hook states while the user keeps its pane hidden.
      const row = `[data-iori-terminal-row="${terminal.id}"]`;
      const noticesForCli = () =>
        screen.evaluate(
          `window.__candidateNotifications.filter(entry=>entry.target.terminalId===${JSON.stringify(terminal.id)})`,
        );
      const transition = async (state, kind, summary) => {
        childDisplayFixture(undefined, undefined, {
          ...terminal,
          title: summary,
          cliStatus: {
            state,
            since: Date.now(),
            ...(kind ? { attention: { kind, summary } } : {}),
          },
        });
        await waitFor(
          () => screen.text(`${row} .nav-session-title`),
          (value) => value === summary,
          30000,
          "通知を増やさず最新のCLI状態を表示",
        );
        await screen.wait(`${row} [data-status="${state}"]`);
      };
      for (const [kind, summary] of [
        ["approval", "Next approval"],
        ["question", "Next question"],
        ["approval", "Another approval"],
      ]) {
        await transition("waiting", kind, summary);
        assert.equal(
          (await noticesForCli()).length,
          1,
          "同じ会話で判断待ちが続く間は通知を鳴らし直さない",
        );
      }
      await transition("active", undefined, "Approval answered");
      await transition("waiting", "approval", "Approval after working");
      const resumed = await waitFor(
        noticesForCli,
        (values) => values.length === 2,
        30000,
        "作業中を経て再び承認待ちになったら通知",
      );
      assert.equal(resumed[1].body, "Approval after working");
      assert.equal(resumed[1].id, resumed[0].id);
      await record(
        "同じ会話の承認→承認→質問→承認は最新の表示へ変わっても通知1回、作業中を経た次の承認は再通知（Client判断の通信fixture）",
      );
    }
  }
  assert.ok(notificationSourceFault(false, terminal) > 0);
  // A later CLI event retries the failed child list without changing the team.
  notificationSourceFault(false, terminal, "done");
  await screen.wait("[data-iori-child-id]");
  await record(
    "子の一覧取得失敗中も承認待ち・完了通知を出し、次の出来事で子の行を取得し直す（Client判断の通信fixture）",
  );
  await screen.contextMenu(`[data-iori-terminal-row="${terminal.id}"]`);
  await screen.click('[data-iori-action="terminal-close"]');
  await waitFor(
    () =>
      screen.evaluate(
        `document.querySelectorAll('[data-iori-child-id]').length`,
      ),
    (value) => value === 0,
    30000,
    "親の会話を閉じると子の行も外れる",
  );
  assert.equal(
    (
      await request("teams.children", {
        conversation: after.children[0].conversation,
      })
    ).children.length,
    after.children.filter(
      (child) => child.conversation === after.children[0].conversation,
    ).length,
  );
  await record("親の会話を閉じて子の行を外し、Hostの記録は保持");
  assert.equal(
    await screen.attribute(
      "[data-iori-current-worktree-path]",
      "data-iori-current-worktree-path",
    ),
    worktree,
  );
}
