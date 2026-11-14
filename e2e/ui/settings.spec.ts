import { test, expect } from "./fixtures/test.ts";

test(
  "連携でトークンの登録と削除、無効なトークンの失敗を表示する",
  { tag: "@desktop" },
  async ({ page, registeredApp: app }) => {
    const forge = await app.host.forge();
    await page.goto(app.url);
    await page.getByRole("button", { name: "Settings", exact: true }).click();
    await page
      .getByRole("button", { name: "Integrations", exact: true })
      .click();
    await page.getByRole("button", { name: "Add site", exact: true }).click();
    await page.getByLabel("Site URL", { exact: true }).fill(forge.origin);
    const token = page.getByLabel("Token for the site to add", { exact: true });
    await token.fill("invalid-token");
    await page.getByRole("button", { name: "Add", exact: true }).click();
    await expect(
      page.getByText("The site did not accept this token.", { exact: true }),
    ).toBeVisible();
    await token.fill(forge.token);
    await page.getByRole("button", { name: "Add", exact: true }).click();
    const site = page.locator(`[data-iori-forge-site="${forge.origin}"]`);
    await expect(
      site.getByText("Registered as owner", { exact: true }),
    ).toBeVisible();
    await site.getByRole("button", { name: "Remove", exact: true }).click();
    await page
      .getByRole("dialog", { name: `Remove the token for ${forge.origin}?` })
      .getByRole("button", { name: "Remove", exact: true })
      .click();
    await expect(site).toBeHidden();
  },
);

test(
  "文字と通知の設定を保存して再読込後も反映する",
  { tag: "@desktop" },
  async ({ page, registeredApp: app }) => {
    await page.goto(app.url);
    await page.getByRole("button", { name: "Settings", exact: true }).click();
    await page.getByRole("button", { name: "Display", exact: true }).click();
    const font = page.locator('[data-iori-field="terminal-font-family"]');
    await font.fill("monospace");
    await page.locator('[data-iori-action="save-terminal-font"]').click();
    await expect(
      page.locator('[data-iori-state="terminal-font-saved"]'),
    ).toBeVisible();
    await page
      .getByRole("button", { name: "Notifications", exact: true })
      .click();
    const notifications = page.getByRole("switch", {
      name: "Completion notifications",
      exact: true,
    });
    await notifications.uncheck();
    await expect(notifications).not.toBeChecked();
    await page.reload();
    await page.getByRole("button", { name: "Settings", exact: true }).click();
    await page
      .getByRole("button", { name: "Notifications", exact: true })
      .click();
    await expect(notifications).not.toBeChecked();
    await page.getByRole("button", { name: "Display", exact: true }).click();
    await expect(font).toHaveValue("monospace");
  },
);

test(
  "Hostの接続先を保存して再読込後も表示する",
  { tag: "@desktop" },
  async ({ page, registeredApp: app }) => {
    await page.goto(app.url);
    await page.getByRole("button", { name: "Settings", exact: true }).click();
    await page.getByRole("button", { name: "Connection", exact: true }).click();
    const address = page.locator('[data-iori-field="address"]');
    const original = await address.inputValue();
    const updated = `${original}\n127.0.0.1:49001`;
    await address.fill(updated);
    await page.locator('[data-iori-action="save-address"]').click();
    await expect(
      page.getByText("Settings saved", { exact: true }),
    ).toBeVisible();
    await page.reload();
    await page.getByRole("button", { name: "Settings", exact: true }).click();
    await page.getByRole("button", { name: "Connection", exact: true }).click();
    await expect(address).toHaveValue(updated);
  },
);
