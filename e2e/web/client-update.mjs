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
  reload,
  record,
  shot,
}) {
  const { register } = await import("../connection/scenario.mjs");
  const screen = client.screen;
  await register(screen, await additionalHost(), "更新確認用Chromium");
  await screen.key("Escape");
  distribution.publish();
  await openSidebar(screen);
  await openSettingsSection(screen, "settings-general");
  await screen.click(action("update-check"));
  const checkbox = '[data-iori-field="update-connected-hosts"]';
  await screen.wait(checkbox);
  await waitFor(
    () => screen.text(`.field-row:has(${checkbox})`),
    (text) => text?.includes("2"),
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
    (count) => count === 2,
  );
  assert.equal(
    await screen.visible('[data-iori-state="host-succeeded"]'),
    false,
  );
  await updatePictures(client, shot, "connected-hosts-confirmation");
  await screen.click(action("connected-hosts-confirm"));
  await waitForOperation(
    "client-update: 接続先2台のHostの更新が成功",
    () =>
      screen.evaluate(
        `document.querySelectorAll('${dialog} [data-iori-state="host-succeeded"]').length`,
      ),
    (count) => count === 2,
    operationFailure(screen, `${dialog} [role="alert"]`),
  );
  assert.equal(await screen.visible(action("connected-hosts-confirm")), false);
  await shot("connected-hosts-updated");
  await record(
    "接続中の古いHost2台を選んだClient更新・再読込後、1つの確認から両Hostの署名付き更新・再接続が成功",
  );
  await reload();
  await screen.wait(action("settings-open"));
  assert.equal(await screen.visible(dialog), false);
  await record("更新後にもう一度開いてもHost更新の確認を繰り返さない");
}

async function updatePictures(client, shot, name) {
  const { screen } = client;
  const dark = await screen.evaluate(
    "document.documentElement.classList.contains('dark')",
  );
  for (const [device, width, height] of [
    ["pc", 1440, 1000],
    ["mobile", 390, 844],
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
