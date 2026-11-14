import { test, expect } from "./fixtures/test.ts";

test(
  "Hostを一覧から削除する確認に削除される情報と残る情報を表示する",
  { tag: "@desktop" },
  async ({ page, registeredApp: app }) => {
    await page.goto(app.url);
    await page.getByRole("button", { name: "Settings", exact: true }).click();
    await page.locator('[data-iori-action="open-connection"]').click();
    await page
      .getByRole("button", { name: "Remove from list", exact: true })
      .click();
    const dialog = page.locator('[data-iori-view="host-forget-confirmation"]');
    await expect(dialog).toContainText(
      "This removes only this Client’s list entry and connection information.",
    );
    await expect(dialog).toContainText(
      "Device registrations, data and programs on the Host stay unchanged.",
    );
    await expect(dialog).toContainText(
      "To use this Host again, connect with an invitation.",
    );
  },
);
