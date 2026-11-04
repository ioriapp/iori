import assert from "node:assert/strict";
import { waitFor } from "../../verification/ui.mjs";
export async function openSidebar(screen) {
  // Reload and drawer transitions can replace the trigger. Decide whether to
  // click in the same browser task: a drawer that has opened meanwhile already
  // satisfies this operation, even if its trigger is no longer on screen.
  await waitFor(() =>
    screen.evaluate(`(()=>{
      const visible=e=>{
        const r=e.getBoundingClientRect();
        return r.width>0&&r.height>0&&r.right>0&&r.bottom>0&&r.left<innerWidth&&r.top<innerHeight&&getComputedStyle(e).visibility!=='hidden';
      };
      const open='[data-slot="sidebar"][data-state="expanded"], [data-sidebar="sidebar"][data-mobile="true"][data-state="open"]';
      if([...document.querySelectorAll(open)].some(visible))return true;
      // A closing drawer still covers the trigger until its exit completes.
      if(document.querySelector('[data-sidebar="sidebar"][data-mobile="true"][data-state="closed"]'))return false;
      const trigger=[...document.querySelectorAll('[data-iori-action="sidebar-toggle"]')].find(visible);
      if(!trigger||trigger.disabled)return false;
      const r=trigger.getBoundingClientRect(),hit=document.elementFromPoint(r.left+r.width/2,r.top+r.height/2);
      if(!hit||!trigger.contains(hit))return false;
      trigger.click();
      return true;
    })()`),
  );
  await screen.wait('[data-sidebar="sidebar"]');
  // Touch coordinates must be taken after the drawer's entrance has settled.
  await waitFor(() =>
    screen.evaluate(`(()=>{
    const sidebar=[...document.querySelectorAll('[data-sidebar="sidebar"]')].find(e=>{
      const r=e.getBoundingClientRect();
      return r.width>0&&r.height>0&&r.left>=0&&r.right<=innerWidth&&getComputedStyle(e).visibility!=='hidden';
    });
    if(!sidebar||sidebar.getAnimations().some(a=>a.playState==='running'||a.pending))return false;
    const r=sidebar.getBoundingClientRect(),hit=document.elementFromPoint(r.left+r.width/2,r.top+r.height/2);
    return Boolean(hit&&sidebar.contains(hit));
  })()`),
  );
}
// Compare the actual touch target across Mobile's full-screen surfaces.
export async function mobileSidebarTarget(screen) {
  const target = await screen.evaluate(
    `(()=>{const e=[...document.querySelectorAll('[data-sidebar="trigger"]')].find(e=>e.getBoundingClientRect().width&&e.getBoundingClientRect().height);const {x,y,width,height}=e.getBoundingClientRect();return {x,y,width,height};})()`,
  );
  assert.ok(
    target.width >= 48 && target.height >= 48,
    `サイドバーの押せる範囲は48px以上: ${JSON.stringify(target)}`,
  );
  assert.equal(await screen.visible('[data-iori-action="mobile-back"]'), false);
  return target;
}

export async function mobileHome(screen) {
  await openSidebar(screen);
  await screen.click('[data-iori-action="mobile-home"]');
  await screen.wait('[data-iori-view="mobile-home"]');
  await waitFor(
    async () =>
      !(await screen.visible('[data-sidebar="sidebar"][data-mobile="true"]')),
  );
}

export async function closeSidebar(screen) {
  // Decide and activate in one browser task, as openSidebar does. A drawer
  // transition must not turn a second geometry read into a desktop toggle.
  const mobile = await screen.evaluate(`(()=>{
    const drawer=document.querySelector('[data-sidebar="sidebar"][data-mobile="true"]');
    if(drawer)return drawer.getAttribute('data-state')==='open';
    if(document.querySelector('[data-slot="sidebar"][data-state="expanded"]'))
      document.querySelector('[data-iori-action="sidebar-toggle"]')?.click();
    return false;
  })()`);
  if (mobile) await screen.key("Escape");
  await waitFor(
    async () => !(await screen.visible('[data-sidebar="sidebar"]')),
  );
}
export async function openSettingsSection(screen, section) {
  if (!(await screen.visible('[data-iori-view="settings"]'))) {
    // The settings button is in the sidebar: a phone's full-screen View keeps
    // it in the drawer, and a PC can have the sidebar closed.
    if (!(await screen.visible('[data-iori-action="settings-open"]')))
      await openSidebar(screen);
    // A fresh Android registration can show the notification choice while
    // the drawer opens. Close it through the same UI helper before Settings.
    if (await screen.visible('[data-iori-view="notification-permission"]'))
      await dismissNotificationPrompt({ screen });
    await screen.click('[data-iori-action="settings-open"]');
  }
  // The mobile back action can be above a scrolled settings page. A layout
  // box excludes both the desktop action and a hidden detail; click reveals it.
  if (
    await screen.evaluate(`(()=>{
    const back=document.querySelector('[data-iori-action="settings-back"]');
    return Boolean(back&&back.getClientRects().length);
  })()`)
  )
    await screen.click('[data-iori-action="settings-back"]');
  await screen.click(`[data-iori-action=${JSON.stringify(section)}]`);
}

export async function openWorkspaceSettings(screen, path, beforeSelect) {
  await openSidebar(screen);
  const row = `[data-iori-workspace-path=${JSON.stringify(path)}]`;
  if (await screen.visible('[data-sidebar="sidebar"][data-mobile="true"]'))
    await screen.longPress(row);
  else await screen.contextMenu(row);
  await screen.wait('[data-iori-action="workspace-settings"]');
  if (beforeSelect) await beforeSelect();
  await screen.click('[data-iori-action="workspace-settings"]');
  await waitFor(
    () =>
      screen.attribute(
        '[data-iori-view="settings"] [data-iori-action="open-repository-git"]',
        "aria-current",
      ),
    (value) => value === "page",
  );
}

export async function forgetHostFromSettings(screen, { record, shot }) {
  const invitation = await invite(screen);
  await screen.key("Escape");
  await openSettingsSection(screen, "open-devices");
  const hostKey = await screen.attribute(
    '[data-iori-action="settings-host-select"]',
    "data-iori-host-key",
  );
  const deviceCount = await screen.evaluate(
    "document.querySelectorAll('[data-iori-row=\"device\"]').length",
  );
  await openSettingsSection(screen, "open-connection");
  await screen.click('[data-iori-action="host-forget"]');
  await screen.wait('[data-iori-view="host-forget-confirmation"]');
  await shot("host-forget-confirmation");
  await screen.key("Escape");
  // Escape cancels only the confirmation. The phone shows the connection
  // detail without the Host picker, so check the action that stays on both.
  assert.equal(await screen.visible('[data-iori-action="host-forget"]'), true);
  await screen.click('[data-iori-action="host-forget"]');
  await screen.click('[data-iori-action="host-forget-confirm"]');
  await waitFor(
    async () => !(await screen.visible('[data-iori-action="host-forget"]')),
  );
  await record("設定の接続から確認してHostを一覧から外す");
  await screen.click('[data-iori-action="settings-close"]');
  await register(screen, invitation, "開発用Chromium");
  assert.equal(
    await screen.attribute(
      '[data-iori-action="settings-host-select"]',
      "data-iori-host-key",
    ),
    hostKey,
  );
  const afterDeviceCount = await screen.evaluate(
    "document.querySelectorAll('[data-iori-row=\"device\"]').length",
  );
  assert.equal(afterDeviceCount, deviceCount, "再登録で端末が二重に並ばない");
  await record("同じHostへの再登録後も端末の件数が変わらない", {
    deviceCount,
    afterDeviceCount,
  });
  await screen.click('[data-iori-action="settings-close"]');
}
// A fresh Android verification install may ask about notifications after
// registration or when Settings closes. Dismiss through the UI; changing
// OS permissions would hide this first-use state from notification scenarios.
export async function dismissNotificationPrompt(client) {
  const preferences = await client.screen.evaluate(
    "window.__TAURI__.core.invoke('native_load_client_preferences')",
  );
  if (
    preferences?.notificationPrompted ||
    (preferences?.notifyWaiting === false && preferences?.notifyDone === false)
  )
    return;
  const permission = await client.screen.evaluate(
    "window.__TAURI__.core.invoke('native_notification_permission')",
  );
  if (permission === "granted") return;
  const prompt = '[data-iori-view="notification-permission"]';
  await client.screen.wait(prompt);
  await client.screen.key("Escape");
  await waitFor(async () => !(await client.screen.visible(prompt)));
}
export async function register(screen, invitation, deviceName) {
  // Right after start the Client may not show its first screen yet.
  await waitFor(
    async () =>
      (await screen.visible('[data-iori-action="connect-invitation"]')) ||
      (await screen.visible('[data-iori-action="register-again"]')) ||
      (await screen.visible('[data-iori-field="invitation"]')) ||
      (await screen.visible('[data-iori-view="workspace"]')),
  );
  if (await screen.visible('[data-iori-action="connect-invitation"]'))
    await screen.click('[data-iori-action="connect-invitation"]');
  if (await screen.visible('[data-iori-action="register-again"]'))
    await screen.click('[data-iori-action="register-again"]');
  else if (!(await screen.visible('[data-iori-field="invitation"]'))) {
    await openSettingsSection(screen, "open-connection");
    await screen.click('[data-iori-action="register-new-host"]');
  }
  if (await screen.visible('[data-iori-action="connect-invitation"]'))
    await screen.click('[data-iori-action="connect-invitation"]');
  await screen.input('[data-iori-field="invitation"]', invitation);
  await screen.click('[data-iori-action="continue"]');
  await screen.wait('[data-iori-view="confirm-registration"]');
  assert.equal(
    Boolean(await screen.text('[data-iori-value="host-name"]')),
    true,
  );
  await screen.input('[data-iori-field="device-name"]', deviceName);
  await screen.click('[data-iori-action="register"]');
  await waitFor(
    async () => !(await screen.visible('[data-iori-action="register"]')),
  );
  await screen.wait('[data-iori-view="workspace"]');
  await openSettingsSection(screen, "open-devices");
  await screen.wait('[data-iori-state="connected"]');
  await screen.wait('[data-iori-state="this-device"]');
  assert.equal(
    await screen.evaluate(
      `document.querySelector('[data-iori-list="devices"]').textContent.includes(${JSON.stringify(deviceName)})`,
    ),
    true,
  );
}
export async function invite(screen) {
  await openSettingsSection(screen, "open-devices");
  await screen.click('[data-iori-action="invite"]');
  return waitFor(() => screen.value('[data-iori-field="issued-invitation"]'));
}
export async function rejectUsedInvitation(screen, invitation, deviceName) {
  if (!(await screen.visible('[data-iori-field="invitation"]'))) {
    await openSettingsSection(screen, "open-connection");
    await screen.click('[data-iori-action="register-new-host"]');
  }
  await screen.input('[data-iori-field="invitation"]', invitation);
  await screen.click('[data-iori-action="continue"]');
  await screen.wait('[data-iori-view="confirm-registration"]');
  await screen.input('[data-iori-field="device-name"]', deviceName);
  await screen.click('[data-iori-action="register"]');
  await screen.wait('[data-iori-state="error"]');
  assert.equal(
    /招待|invitation/i.test(await screen.text('[data-iori-state="error"]')),
    true,
  );
  assert.equal(await screen.visible('[data-iori-state="connected"]'), false);
  await screen.click('[data-iori-action="back"]');
}
export async function revoke(screen, deviceName) {
  const selector = '[data-iori-action="revoke-device"]';
  await screen.wait(selector);
  const clicked = await screen.evaluate(
    `(()=>{const row=[...document.querySelectorAll('[data-iori-row="device"]')].find(e=>e.querySelector('[data-iori-value="device-name"]').textContent===${JSON.stringify(deviceName)});const b=row?.querySelector(${JSON.stringify(selector)});if(!b)return false;b.scrollIntoView({block:'center'});b.click();return true;})()`,
  );
  assert.equal(clicked, true);
  await screen.wait('[data-iori-action="confirm-revoke"]');
  await screen.click('[data-iori-action="confirm-revoke"]');
}
export async function registrationNotice(screen, deviceName) {
  await screen.wait('[data-iori-state="device-registered"]');
  assert.equal(
    (await screen.text('[data-iori-state="device-registered"]')).includes(
      deviceName,
    ),
    true,
  );
  await screen.wait('[data-iori-action="undo-registration"]');
}

/** Settings, protected registrations, native dialing, and the real CLI all run normally. */
export async function relayConnection({
  clients,
  relay,
  direct,
  cwd,
  record,
  cli,
  observeRoutes,
  restartClients,
  restartHost,
}) {
  let stage = "Relay設定の保存";
  try {
    const savedRelay = (screen, expected) =>
      waitFor(() =>
        screen.evaluate(`(()=>{
    const url=document.querySelector('[data-iori-field="relay-url"]');
    const token=document.querySelector('[data-iori-field="relay-token"]');
    return url?.value===${JSON.stringify(expected?.url ?? "")} && Boolean(token?.value)===${Boolean(expected?.token)};
  })()`),
      );
    const setRelay = async (screen, settings) => {
      await openSettingsSection(screen, "open-connection");
      await screen.input(
        '[data-iori-field="relay-token"]',
        settings?.token ?? "",
      );
      await screen.input('[data-iori-field="relay-url"]', settings?.url ?? "");
      await screen.evaluate(
        `(()=>{window.__ioriRelayDisconnected=false;const row=document.querySelector('.v9-settings-info-row[data-iori-state]');window.__ioriRelayObserver=new MutationObserver(records=>{if(records.some(record=>record.oldValue==='connected'))window.__ioriRelayDisconnected=true;});window.__ioriRelayObserver.observe(row,{attributes:true,attributeFilter:['data-iori-state'],attributeOldValue:true});})()`,
      );
      await screen.click('[data-iori-field="address"]');
      await screen.click('[data-iori-action="settings-display"]');
      await screen.wait('[data-iori-view="settings-discard-confirmation"]');
      await screen.key("Escape");
      assert.equal(
        await screen.evaluate(
          `(()=>{window.__ioriRelayObserver.disconnect();return window.__ioriRelayDisconnected;})()`,
        ),
        false,
        "Relayの欄から離れただけでは接続を切らない",
      );
      await screen.click('[data-iori-action="save-relay"]');
      await screen.wait('[data-iori-state="relay-saved"]');
      await savedRelay(screen, settings);
      await screen.wait('[data-iori-state="connected"]');
    };
    const screen = clients[0].screen;
    await setRelay(screen, relay);
    stage = "両Clientの設定の受け取り";
    for (const client of clients) {
      await openSettingsSection(client.screen, "open-connection");
      await savedRelay(client.screen, relay);
      await client.screen.wait('[data-iori-state="connected"]');
    }
    await record(
      relay.token
        ? "トークンを求めるRelayの設定を両Clientへ保存"
        : "Hostの接続からRelayを設定し、登録済みの両Clientへ保存",
    );
    direct.block();
    for (const client of clients) {
      // No direct address is required when Relay is present. The verification
      // firewall also blocks addresses learned from the peer during holepunching.
      const name = client.browser.webdriver ? "Windows" : "Android";
      stage = `${name}: 直接の接続先を空にして保存`;
      await client.screen.input('[data-iori-field="address"]', "");
      await client.screen.click('[data-iori-action="save-address"]');
      stage = `${name}: Relayで接続`;
      await client.screen.wait('[data-iori-state="connected"]');
      stage = `${name}: Relayの経路表示`;
      await waitFor(
        () =>
          client.screen.attribute(
            '[data-iori-state="connection-route"]',
            "data-iori-route",
          ),
        (route) => route === "relay",
      );
      assert.equal(
        await client.screen.attribute(
          '[data-iori-field="relay-token"]',
          "type",
        ),
        "password",
      );
      stage = `${name}: CLIの画面を開いて使用`;
      await cli(client, cwd, Boolean(relay.token));
      await openSettingsSection(client.screen, "open-connection");
      await record(
        `${client.browser.webdriver ? "Windows" : "Android"}: 直接のアドレス無しでRelay経由の接続・CLIの画面・経路表示`,
      );
    }
    const connectedThroughRelay = async () => {
      for (const client of clients) {
        await openSettingsSection(client.screen, "open-connection");
        await savedRelay(client.screen, relay);
        await client.screen.wait('[data-iori-state="connected"]');
        await waitFor(
          () =>
            client.screen.attribute(
              '[data-iori-state="connection-route"]',
              "data-iori-route",
            ),
          (route) => route === "relay",
        );
      }
    };
    stage = "Client再起動後のRelay接続";
    await restartClients();
    await connectedThroughRelay();
    await record("両Clientの終了・再起動後、直接を遮断したままRelayで再接続");
    stage = "Host再起動後のRelay接続";
    await observeRoutes?.("before-host-restart");
    await restartHost();
    await connectedThroughRelay();
    await record("Host再起動後、直接を遮断したまま両ClientがRelayで再接続");
    direct.restore();
    stage = "直接への自動切替";
    const startedAt = new Date();
    let routes;
    const changes = [];
    try {
      await waitFor(
        async () => {
          routes = await Promise.all(
            clients.map((client) =>
              client.screen.attribute(
                '[data-iori-state="connection-route"]',
                "data-iori-route",
              ),
            ),
          );
          if (JSON.stringify(routes) !== JSON.stringify(changes.at(-1)?.routes))
            changes.push({ at: new Date().toISOString(), routes });
          return routes;
        },
        (values) => values.every((route) => route === "direct"),
        undefined,
        "直接の経路の観測",
      );
    } catch (error) {
      if (error.message !== "直接の経路の観測が観測期限を超過しました")
        throw error;
    }
    await record("直接への切替の観測", {
      startedAt: startedAt.toISOString(),
      endedAt: new Date().toISOString(),
      elapsedSeconds: (Date.now() - startedAt.getTime()) / 1000,
      changes,
      routes: routes.map((route, index) => ({
        client: clients[index].browser.webdriver ? "Windows" : "Android",
        route,
      })),
    });
    await observeRoutes?.("routes");
    stage = "Relay設定の削除と直接接続への復帰";
    await setRelay(clients[0].screen, undefined);
    for (const client of clients) {
      await savedRelay(client.screen, undefined);
      await client.screen.wait('[data-iori-state="connected"]');
      assert.equal(
        await client.screen.visible('[data-iori-state="connection-route"]'),
        false,
      );
    }
    await record("Relay設定の削除・直接だけの接続へ復帰");
  } catch (error) {
    throw new Error(
      `Relay受入の「${stage}」: ${error instanceof Error ? error.message : "操作を確認できませんでした"}`,
      { cause: error },
    );
  }
}
