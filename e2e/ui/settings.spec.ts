import { test, expect } from "./fixtures/test.ts";

test.describe("日本語の連携設定", () => {
  test.use({ locale: "ja-JP" });

  test(
    "既存サイトのトークン欄を日本語で読み上げる",
    { tag: "@desktop" },
    async ({ page, registeredApp: app }) => {
      const { origin, token } = await app.host.forge();
      await app.request("forge.token.set", { origin, token });
      await app.open(page);
      await page.getByRole("button", { name: "設定", exact: true }).click();
      await page.getByRole("button", { name: "連携", exact: true }).click();
      await page
        .getByRole("button", { name: "トークンを変更", exact: true })
        .click();
      await expect(
        page.locator('[data-iori-field="site-token"]'),
      ).toHaveAccessibleName("トークン");
    },
  );
});

test(
  "連携でトークンの登録と削除、無効なトークンの失敗を表示する",
  { tag: "@desktop" },
  async ({ page, registeredApp: app }) => {
    const forge = await app.host.forge();
    await app.open(page);
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
    await app.open(page);
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
    await app.open(page);
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

test(
  "表示の文字サイズを12pxから24pxのステッパーで変更・リセットし再読込後も保つ",
  { tag: "@desktop" },
  async ({ page, registeredApp: app }) => {
    await app.open(page);
    await page.getByRole("button", { name: "Settings", exact: true }).click();
    await page.getByRole("button", { name: "Display", exact: true }).click();

    const html = page.locator("html");
    const value = page.locator('[data-iori-value="display-text-size"]');
    const decrease = page.locator(
      '[data-iori-action="display-text-size-decrease"]',
    );
    const increase = page.locator(
      '[data-iori-action="display-text-size-increase"]',
    );
    const reset = page.locator('[data-iori-action="display-text-size-reset"]');

    await expect(html).toHaveCSS("font-size", "16px");
    await expect(value).toHaveText("16px (100%)");
    await expect(reset).toBeHidden();

    for (let i = 0; i < 8; i++) {
      await increase.click();
    }
    await expect(value).toHaveText("24px (150%)");
    await expect(html).toHaveCSS("font-size", "24px");
    await expect(increase).toBeDisabled();
    await expect(reset).toBeVisible();

    await page.reload();
    await expect(html).toHaveCSS("font-size", "24px");
    await page.getByRole("button", { name: "Settings", exact: true }).click();
    await page.getByRole("button", { name: "Display", exact: true }).click();
    await expect(value).toHaveText("24px (150%)");

    await reset.click();
    await expect(value).toHaveText("16px (100%)");
    await expect(html).toHaveCSS("font-size", "16px");
    await expect(reset).toBeHidden();

    for (let i = 0; i < 4; i++) {
      await decrease.click();
    }
    await expect(value).toHaveText("12px (75%)");
    await expect(html).toHaveCSS("font-size", "12px");
    await expect(decrease).toBeDisabled();
  },
);

test(
  "PCのCtrl+/-/0ショートカットで文字サイズを変更・リセットし保存する",
  { tag: "@desktop" },
  async ({ page, registeredApp: app }) => {
    await app.open(page);
    const html = page.locator("html");
    await expect(html).toHaveCSS("font-size", "16px");

    await page.keyboard.press("Control+Equal");
    await expect(html).toHaveCSS("font-size", "17px");
    await page.keyboard.press("Control+Equal");
    await expect(html).toHaveCSS("font-size", "18px");

    await page.reload();
    await expect(html).toHaveCSS("font-size", "18px");

    await page.keyboard.press("Control+Minus");
    await expect(html).toHaveCSS("font-size", "17px");

    await page.keyboard.press("Control+0");
    await expect(html).toHaveCSS("font-size", "16px");
  },
);

test(
  "設定の未保存確認ダイアログで保存すると成功時のみ移動し失敗時は留まる",
  { tag: "@desktop" },
  async ({ page, registeredApp: app }) => {
    await app.open(page);
    await page.getByRole("button", { name: "Settings", exact: true }).click();
    await page.getByRole("button", { name: "Connection", exact: true }).click();
    const relayUrl = page.locator('[data-iori-field="relay-url"]');
    await relayUrl.fill("https://relay.example.test");

    await app.faults.fail("host.relay.set");
    await page.getByRole("button", { name: "Display", exact: true }).click();
    const confirm = page.locator(
      '[data-iori-view="settings-discard-confirmation"]',
    );
    await expect(confirm).toBeVisible();
    await confirm.getByRole("button", { name: "Save", exact: true }).click();
    await expect(confirm).toBeHidden();
    await expect(relayUrl).toBeVisible();
    await expect(
      page.locator('[data-iori-view="relay"]').getByRole("alert"),
    ).toBeVisible();

    await app.faults.clear();
    await page.getByRole("button", { name: "Display", exact: true }).click();
    await expect(confirm).toBeVisible();
    await confirm.getByRole("button", { name: "Save", exact: true }).click();
    await expect(confirm).toBeHidden();
    await expect(
      page.locator('[data-iori-value="display-text-size"]'),
    ).toBeVisible();
  },
);
