import {
  waitForOperation,
  operationFailure,
} from "../../verification/web/operation.mjs";
import assert from "node:assert/strict";
import { waitFor } from "../../verification/ui.mjs";
import { openSidebar, openSettingsSection } from "../connection/scenario.mjs";
const action = (name) => `[data-iori-action="${name}"]`;
export async function clientUpdate({
  client,
  distribution,
  record,
  shot,
  mobile,
  desktop,
  reload,
}) {
  const screen = client.screen;
  await waitFor(
    () => distribution.checks,
    (checks) => checks > 0,
  );
  await screen.click(action("settings-open"));
  await screen.click(action("settings-general"));
  await screen.wait('[data-iori-view="client-update"]');
  await screen.wait(action("update-check") + ":not(:disabled)");
  assert.equal(await screen.visible('[data-iori-state="update-error"]'), false);
  assert.equal(
    await screen.visible('[data-iori-state="update-available"]'),
    false,
  );
  await record("自動確認で配布元が503でもエラーと更新の印を出さない");
  await screen.click(action("update-check"));
  await screen.wait('[data-iori-state="update-error"]');
  await record("手動の更新確認で配布元への接続失敗を示す");
  distribution.publish();
  await screen.click(action("update-check"));
  await screen.wait('[data-iori-state="update-version"]');
  assert.equal(
    await screen.text('[data-iori-state="update-version"]'),
    distribution.nextVersion,
  );
  assert.equal(await screen.visible('[data-iori-state="update-error"]'), false);
  const development = action("receive-development-versions");
  assert.equal(await screen.attribute(development, "data-state"), "unchecked");
  // Stand in for Android's installer permission while keeping the real update
  // controls and preference change in the Client.
  await screen.evaluate(`(async()=>{
    const {native}=await import('/src/native.ts');
    window.__permissionResume=[];
    native.updateDownload=async()=>{};
    native.updateInstall=async(resume)=>{
      window.__permissionResume.push(resume);
      return resume ? 'installing' : 'permission';
    };
  })()`);
  await screen.click(action("update-install"));
  await waitFor(() =>
    screen.evaluate(
      `document.querySelector('[data-iori-view="client-update"]')?.textContent.includes('Android')`,
    ),
  );
  await screen.click(development);
  await waitFor(
    () => screen.attribute(development, "data-state"),
    (value) => value === "checked",
  );
  await screen.evaluate(
    `document.dispatchEvent(new Event('visibilitychange'))`,
  );
  await waitFor(() =>
    screen.evaluate("window.__permissionResume.includes(true)"),
  );
  await record(
    "Androidのインストール許可待ちに開発版の設定を変えても復帰時に再開",
  );
  await reload();
  await screen.wait(action("settings-open"));
  await openSettingsSection(screen, "settings-general");
  await screen.click(development);
  await waitFor(
    () => screen.attribute(development, "data-state"),
    (value) => value === "unchecked",
  );
  await screen.click(development);
  await waitFor(
    () => screen.text('[data-iori-state="update-version"]'),
    (value) => value === distribution.developmentVersion,
  );
  await reload();
  await screen.wait(action("settings-open"));
  await openSettingsSection(screen, "settings-general");
  assert.equal(await screen.attribute(development, "data-state"), "checked");
  await waitFor(
    () => screen.text('[data-iori-state="update-version"]'),
    (value) => value === distribution.developmentVersion,
  );
  distribution.makeStableOlder();
  await screen.click(development);
  await screen.wait(action("update-check") + ":not(:disabled)");
  await screen.click(action("update-check"));
  await waitFor(() =>
    screen.evaluate(`(() => {
      const text = document.querySelector('[data-iori-view="client-update"]')?.textContent ?? '';
      return text.includes('You are up to date') || text.includes('最新のバージョンです');
    })()`),
  );
  assert.equal(
    await screen.visible('[data-iori-state="update-version"]'),
    false,
  );
  await record(
    "開発版の設定と再起動後の保持、古い安定版への更新を提示しないことを確認",
  );
  await shot("update-desktop");
  distribution.restoreStable();
  await screen.click(action("update-check"));
  await screen.wait('[data-iori-state="update-version"]');
  await screen.click(action("settings-close"));
  await screen.wait('[data-iori-state="update-available"]');
  await mobile();
  // Reload can return to Mobile Home, whose gear has no update mark. Observe
  // the mobile layout, then open the sidebar to use the marked settings entry.
  await waitFor(
    async () =>
      (await screen.visible('[data-iori-view="mobile-home"]')) ||
      (await screen.visible('[data-iori-part="mobile-location"]')),
  );
  await openSidebar(screen);
  // Changing viewport reloads the page; wait for this launch's update check.
  await screen.wait('[data-iori-state="update-available"]');
  await openSettingsSection(screen, "settings-general");
  await screen.wait(action("update-install"));
  await shot("update-mobile");
  await screen.click(action("settings-close"));
  await desktop();
  await record("更新確認から入口の印と更新欄をPC・Mobile幅で確認");
}

// The bridge substitutes the Client's OS installer only; both Hosts use the
// real signed distribution and systemd update path.
export async function clientHostUpdate({
  client,
  distribution,
  additionalHost,
  stopAdditionalUpdateHost,
  repository,
  reload,
  record,
  shot,
}) {
  const { register } = await import("../connection/scenario.mjs");
  const screen = client.screen;
  await register(screen, await additionalHost(), "更新確認用Chromium");
  await screen.key("Escape");
  const { openFolder, folderConnectionScenario } =
    await import("../workspace/scenario.mjs");
  const { create, observe, typeTerminal, observed } =
    await import("../terminal/scenario.mjs");
  await register(
    screen,
    await additionalHost({ interruptions: true }),
    "中断確認用Chromium",
  );
  const workingHostKey = await screen.attribute(
    action("settings-host-select"),
    "data-iori-host-key",
  );
  await screen.key("Escape");
  await openFolder(screen, repository, false, undefined, workingHostKey);
  await observe(client, "(await import('/src/native-platform-web.ts')).listen");
  await create(client);
  await typeTerminal(
    client,
    `node -e "console.log('update-work-ready');setInterval(()=>{},1000)"\r`,
  );
  await observed(client, "update-work-ready");
  await screen.key("Escape");
  distribution.publish();
  await openSidebar(screen);
  await openSettingsSection(screen, "settings-general");
  await screen.click(action("update-check"));
  const checkbox = '[data-iori-field="update-connected-hosts"]';
  await screen.wait(checkbox);
  await waitFor(
    () => screen.text(`.field-row:has(${checkbox})`),
    (text) => text?.includes("3"),
  );
  assert.equal(await screen.attribute(checkbox, "data-state"), "checked");
  await updatePictures(client, shot, "connected-hosts-update-setting");
  await screen.click(action("update-install"));
  await waitForOperation(
    "client-update: Clientの更新を導入",
    () => distribution.installs,
    (value) => value === 1,
    operationFailure(screen, '[data-iori-view="client-update"] [role="alert"]'),
  );
  await stopAdditionalUpdateHost();
  await reload();
  const dialog = '[data-iori-view="connected-host-updates"]';
  await screen.wait(dialog);
  assert.equal(
    await screen.evaluate(`document.querySelectorAll('${dialog}').length`),
    1,
  );
  await waitFor(
    () =>
      screen.evaluate(
        `document.querySelectorAll('[data-iori-update-host]').length`,
      ),
    (count) => count === 3,
  );
  await screen.wait('[data-iori-state="host-disconnected"]');
  const offlineKey = await screen.attribute(
    '[data-iori-state="host-disconnected"]',
    "data-iori-update-host",
    "[data-iori-update-host]",
  );
  assert.equal(
    (await screen.text('[data-iori-state="host-disconnected"]')).includes(
      "Hostに接続できませんでした。",
    ),
    true,
  );
  const workingRow = `[data-iori-update-host=${JSON.stringify(workingHostKey)}]`;
  await screen.wait(`${workingRow} ${action("connected-hosts-confirm")}`);
  assert.equal(
    await screen.visible(`${workingRow} [data-iori-state="host-succeeded"]`),
    false,
  );
  // One Host updates automatically even while another is stopped and a third
  // awaits explicit permission to interrupt its real Terminal command.
  await waitForOperation(
    "client-update: 中断の無いHostが操作なしで更新される",
    () =>
      screen.evaluate(
        `document.querySelectorAll('${dialog} [data-iori-state="host-succeeded"]').length`,
      ),
    (count) => count === 1,
    operationFailure(
      screen,
      `${dialog} [data-iori-state="host-maintenance-error"]`,
    ),
  );
  assert.equal(
    await screen.evaluate(
      `document.querySelectorAll('${dialog} [data-iori-maintenance-working]').length`,
    ),
    1,
  );
  await updatePictures(client, shot, "d");
  await record(
    "停止中のHostが接続失敗を示しても、中断の無いHostは押さずに更新され、中断されるHostだけ確認を待つ",
  );
  const offlineRow = `[data-iori-update-host=${JSON.stringify(offlineKey)}]`;
  await screen.evaluate(`(async () => {
    const { connection } = await import('/src/connection.ts');
    const request = connection.requestHost;
    const observation = window.__reconnectedUpdate = { requests: 0, checking: false };
    connection.requestHost = function(hostKey, method, ...args) {
      if (hostKey === ${JSON.stringify(offlineKey)} && method === 'host.update') observation.requests++;
      return request.call(this, hostKey, method, ...args);
    };
    observation.stop = () => { connection.requestHost = request; observer.disconnect(); };
    const observer = new MutationObserver(() => {
      if (document.querySelector(${JSON.stringify(offlineRow)} + ' [data-iori-state="host-checking"]')) observation.checking = true;
    });
    observer.observe(document.querySelector(${JSON.stringify(offlineRow)}), { childList: true, subtree: true, attributes: true });
  })()`);
  await stopAdditionalUpdateHost(true);
  await waitFor(() => screen.evaluate("window.__reconnectedUpdate.checking"));
  await waitForOperation(
    "client-update: 再接続したHostが更新される",
    () => screen.visible(`${offlineRow} [data-iori-state="host-succeeded"]`),
    Boolean,
    operationFailure(
      screen,
      `${offlineRow} [data-iori-state="host-maintenance-error"]`,
    ),
  );
  assert.equal(
    await screen.text(`${offlineRow} [data-iori-state="host-succeeded"]`),
    "iori Hostを更新しました",
  );
  assert.deepEqual(
    await screen.evaluate(`(() => {
      const { requests, checking, stop } = window.__reconnectedUpdate;
      stop();
      return { requests, checking };
    })()`),
    { requests: 1, checking: true },
  );
  await record("開いた画面で再接続したHostを確認後に一度だけ更新");
  await screen.click(`${workingRow} ${action("connected-hosts-confirm")}`);
  assert.equal(
    await screen.visible(`${workingRow} [data-iori-state="host-succeeded"]`),
    false,
  );
  await screen.key("Escape");
  await waitFor(async () => !(await screen.visible(dialog)));
  await openSettingsSection(screen, "open-host-version");
  assert.equal(
    await screen.attribute(
      action("settings-host-select"),
      "data-iori-host-key",
    ),
    workingHostKey,
  );
  await waitForOperation(
    "client-update: 閉じた後も確認したHostの更新が続く",
    () =>
      screen.visible(
        '[data-iori-view="host-version"] [data-iori-state="host-succeeded"]',
      ),
    Boolean,
    operationFailure(
      screen,
      '[data-iori-view="host-version"] [data-iori-state="host-maintenance-error"]',
    ),
  );
  await updatePictures(client, shot, "host-update-after-close");
  await record(
    "停止して更新する操作の後だけ中断対象Hostを更新し、ダイアログを閉じた後も署名付き更新・再接続が成功",
  );
  await reload();
  await screen.wait(action("settings-open"));
  assert.equal(await screen.visible(dialog), false);
  await record("更新後にもう一度開いてもHost更新の確認を繰り返さない");
  await stopAdditionalUpdateHost();
  await screen.evaluate(`(async () => {
    const { native } = await import('/src/native.ts');
    const { version } = await native.updateOptions();
    await native.saveView('client-update-hosts', { version, hostKeys: [${JSON.stringify(offlineKey)}] });
  })()`);
  await reload();
  await screen.wait('[data-iori-state="host-disconnected"]');
  await screen.evaluate(`(async () => {
    const { connection } = await import('/src/connection.ts');
    const request = connection.requestHost;
    connection.requestHost = async function(hostKey, method, ...args) {
      const reply = await request.call(this, hostKey, method, ...args);
      if (hostKey === ${JSON.stringify(offlineKey)} && method === 'host.info' && reply?.ok) {
        const { version, ...result } = reply.result;
        return { ...reply, result };
      }
      return reply;
    };
    window.__restoreHostInfo = () => { connection.requestHost = request; };
  })()`);
  await stopAdditionalUpdateHost(true);
  await waitFor(
    () => screen.text(dialog),
    (text) =>
      text?.includes(
        "iori Hostのバージョンを確認できませんでした。設定の「バージョン」から更新をお試しください。",
      ),
  );
  assert.equal(await screen.visible('[data-iori-state="host-current"]'), false);
  await screen.evaluate("window.__restoreHostInfo()");
  await screen.key("Escape");
  await record(
    "バージョンを返さないHostを最新と表示せず、設定からの更新を案内する",
  );
  await stopAdditionalUpdateHost();
  await folderConnectionScenario({
    client,
    offlineKey,
    record,
    pictures: (name) => updatePictures(client, shot, name),
  });
}

async function updatePictures(client, shot, name) {
  const { screen } = client;
  const dark = await screen.evaluate(
    "document.documentElement.classList.contains('dark')",
  );
  for (const [device, width, height] of [
    ["1440", 1440, 1000],
    ["390", 390, 844],
  ]) {
    await client.browser.viewport({ width, height });
    for (const theme of ["dark", "light"]) {
      await screen.evaluate(
        `document.documentElement.classList.toggle('dark', ${theme === "dark"})`,
      );
      await shot(`${name}-${device}-${theme}`);
    }
  }
  await client.browser.viewport({ width: 1440, height: 1000 });
  await screen.evaluate(
    `document.documentElement.classList.toggle('dark', ${dark})`,
  );
}
