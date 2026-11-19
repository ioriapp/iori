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

test(
  "スマホの通知設定は許可済みの時だけOSの通知を許可を出さず未許可で案内のダイアログを開く",
  { tag: ["@phone", "@web-only"] },
  async ({ page, registeredApp: app }) => {
    let permission = "granted";
    let foreground: ((value: boolean) => void) | undefined;
    await page.routeWebSocket(
      new URL(app.url).searchParams.get("iori-bridge")!,
      (route) => {
        foreground = (value) =>
          route.send(
            JSON.stringify({
              event: "native://foreground",
              payload: { foreground: value },
            }),
          );
        const server = route.connectToServer();
        route.onMessage((data) => {
          const request = JSON.parse(String(data)) as {
            id: number;
            command: string;
          };
          if (request.command === "native_notification_permission") {
            route.send(JSON.stringify({ id: request.id, result: permission }));
            return;
          }
          server.send(data);
        });
        server.onMessage((data) => {
          route.send(data);
        });
      },
    );
    await app.open(page);
    await page.getByRole("button", { name: "Settings", exact: true }).click();
    await page
      .getByRole("button", { name: "Notifications", exact: true })
      .click();
    const allowButton = page.getByRole("button", {
      name: "Allow OS notifications",
      exact: true,
    });
    await expect(allowButton).toBeHidden();
    permission = "denied";
    foreground?.(true);
    await expect(allowButton).toBeVisible();
    await allowButton.click();
    await expect(
      page.getByRole("dialog", { name: "Receive notifications", exact: true }),
    ).toBeVisible();
  },
);
