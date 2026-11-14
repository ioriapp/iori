import { test, expect } from "./fixtures/test.ts";
import { hostSettings } from "./fixtures/journeys.ts";

test(
  "招待したデバイスの追加を確認し登録を解除する",
  { tag: "@desktop" },
  async ({ page, registeredApp: app }) => {
    await page.goto(app.url);
    await hostSettings(page, app.hostKey, "open-devices");
    await page
      .getByRole("button", { name: "Invite a new device", exact: true })
      .click();
    const invitation = await page
      .getByRole("textbox", { name: "Invitation", exact: true })
      .inputValue();
    const device = await app.addDevice({ register: false });
    await device.page.goto(device.app.url);
    await device.page
      .getByRole("textbox", { name: "Invitation", exact: true })
      .fill(invitation);
    await device.page
      .getByRole("button", { name: "Continue", exact: true })
      .click();
    await device.page
      .locator('[data-iori-field="device-name"]')
      .fill("Invited device");
    await device.page
      .getByRole("button", { name: "Register", exact: true })
      .click();
    await expect(
      page.locator('[data-iori-state="device-registered"]'),
    ).toContainText("Invited device");
    await page.getByRole("button", { name: "Revoke", exact: true }).click();
    await page
      .getByRole("dialog")
      .getByRole("button", { name: "Revoke registration", exact: true })
      .click();
    await expect(
      device.page.locator('[data-iori-view="revoked"]'),
    ).toBeVisible();
    await expect(
      device.page.getByRole("button", { name: "Add folder", exact: true }),
    ).toHaveCount(0);
  },
);
