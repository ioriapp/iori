import { test, expect } from "./fixtures/test.ts";
import { unifiedPushAndroid } from "./fixtures/browser.ts";

// AC-07: Androidの設定から取得した宛先を本物のHostへ登録できる。
test(
  "Pushの宛先登録に失敗しても次の機会に再送する",
  { tag: ["@phone", "@web-only"] },
  async ({ page, registeredApp: app }) => {
    const second = await app.addHost();
    await app.registerHost(second);
    const android = await unifiedPushAndroid(page, app);
    await app.open(page);
    await page.getByRole("button", { name: "Settings", exact: true }).click();
    await page
      .getByRole("button", { name: "Notifications", exact: true })
      .click();
    await app.faults.fail("notifications.push.set");
    await page.getByRole("radio", { name: "UnifiedPush", exact: true }).check();
    await expect(
      page.getByRole("radio", { name: "UnifiedPush", exact: true }),
    ).toBeChecked();
    await android.expectRegistrationFailure();
    await app.faults.clear();
    await second.stop();
    await android.expectRegistered();
  },
);

test(
  "AndroidでUnifiedPushを選び通知の宛先をHostへ登録する",
  { tag: ["@phone", "@web-only"] },
  async ({ page, registeredApp: app }) => {
    const android = await unifiedPushAndroid(page, app);
    await app.open(page);
    await page.getByRole("button", { name: "Settings", exact: true }).click();
    await page
      .getByRole("button", { name: "Notifications", exact: true })
      .click();
    await page.getByRole("radio", { name: "UnifiedPush", exact: true }).check();
    await expect(
      page.getByRole("combobox", { name: "UnifiedPush app", exact: true }),
    ).toHaveText("ntfy");
    await android.expectRegistered();
    android.background();
    await android.expectDisconnected();
  },
);

test(
  "接続中のHostを一覧から削除するとPushの宛先も解除する",
  { tag: ["@phone", "@web-only"] },
  async ({ page, registeredApp: app }) => {
    const android = await unifiedPushAndroid(page, app);
    await app.open(page);
    await page.getByRole("button", { name: "Settings", exact: true }).click();
    await page
      .getByRole("button", { name: "Notifications", exact: true })
      .click();
    await page.getByRole("radio", { name: "UnifiedPush", exact: true }).check();
    await android.expectRegistered();
    await page.getByRole("button", { name: "Settings", exact: true }).click();
    await page.locator('[data-iori-action="open-connection"]').click();
    await page
      .getByRole("button", { name: "Remove from list", exact: true })
      .click();
    await page.locator('[data-iori-action="host-forget-confirm"]').click();
    await expect(
      page.locator('[data-iori-view="host-forget-confirmation"]'),
    ).toBeHidden();
    await android.expectUnregistered();
  },
);
