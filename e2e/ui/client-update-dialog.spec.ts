import { test, expect } from "./fixtures/test.ts";

test.use({ clientUpdates: true });

test(
  "Client更新の確認と進行と失敗を表示し設定を保持する",
  { tag: "@desktop" },
  async ({ page, registeredApp: app }) => {
    await page.goto(app.url);
    await page.getByRole("button", { name: "Settings", exact: true }).click();
    await page.locator('[data-iori-action="settings-general"]').click();
    const updates = page.locator('[data-iori-view="client-update"]');
    await updates
      .getByRole("button", { name: "Check for updates", exact: true })
      .click();
    await expect(updates.getByRole("alert")).toBeVisible();
    await app.updates.publish();
    await updates
      .getByRole("button", { name: "Check for updates", exact: true })
      .click();
    await expect(
      updates.locator('[data-iori-state="update-version"]'),
    ).toHaveText(app.clientReleaseVersion!);
    const development = page.locator(
      '[data-iori-action="receive-development-versions"]',
    );
    await development.click();
    await expect(development).toBeChecked();
    await page.reload();
    await page.getByRole("button", { name: "Settings", exact: true }).click();
    await page.locator('[data-iori-action="settings-general"]').click();
    await expect(development).toBeChecked();
    await updates
      .getByRole("button", { name: "Download and install", exact: true })
      .click();
    await expect(
      updates.getByRole("button", { name: "Downloading update", exact: true }),
    ).toBeDisabled();
    await app.updates.failDownload();
    await expect(updates.getByRole("alert")).toBeVisible();
    await expect(
      updates.getByRole("button", {
        name: "Download and install",
        exact: true,
      }),
    ).toBeEnabled();
  },
);
