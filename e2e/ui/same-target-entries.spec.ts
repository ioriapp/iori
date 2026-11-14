import {
  test,
  expect,
  openFolder,
  visibleTerminal,
  terminalId,
} from "./fixtures/test.ts";

test(
  "サイドバーとタブから同じCLIへ戻り入力を続ける",
  { tag: "@desktop" },
  async ({ page, registeredApp: app }) => {
    await page.goto(app.url);
    await openFolder(page, app);
    await page.getByRole("button", { name: "New tab", exact: true }).click();
    await page
      .getByRole("dialog")
      .getByRole("button", { name: app.cliId, exact: true })
      .click();
    const terminal = visibleTerminal(page);
    const id = await terminalId(terminal);
    await app.terminalText(id, "ACTOR_READY");
    await terminal
      .getByRole("textbox")
      .pressSequentially(
        JSON.stringify({ id: "draft", hook: "UserPromptSubmit" }),
      );
    await page.getByRole("button", { name: "New tab", exact: true }).click();
    await page.locator('[data-iori-action="workspace-open-files"]').click();
    await page.locator(`[data-iori-terminal-row="${id}"]`).click();
    await expect(visibleTerminal(page)).toHaveAttribute(
      "data-iori-terminal-id",
      id,
    );
    await visibleTerminal(page).getByRole("textbox").press("Enter");
    await app.terminalText(id, "ACTOR_HOOK:draft");
    await page.locator('[data-iori-tab-kind="files"]').click();
    await page.locator(`[data-iori-tab-cli="${app.cliId}"]`).click();
    await expect(visibleTerminal(page)).toHaveAttribute(
      "data-iori-terminal-id",
      id,
    );
    await expect(
      page.locator(`[data-iori-tab-cli="${app.cliId}"]`),
    ).toHaveCount(1);
  },
);

test(
  "サイドバーとタブから同じTerminalへ戻る",
  { tag: "@desktop" },
  async ({ page, registeredApp: app }) => {
    await page.goto(app.url);
    await openFolder(page, app);
    await page.getByRole("button", { name: "New tab", exact: true }).click();
    await page
      .getByRole("dialog")
      .getByRole("button", { name: "Bash", exact: true })
      .click();
    const id = await terminalId(visibleTerminal(page));
    await page.locator('[data-iori-tab-kind="files"]').click();
    await page.locator(`[data-iori-terminal-row="${id}"]`).click();
    await expect(visibleTerminal(page)).toHaveAttribute(
      "data-iori-terminal-id",
      id,
    );
    await page.locator('[data-iori-tab-kind="files"]').click();
    const tab = page
      .getByRole("tab", { name: "Bash", exact: true })
      .and(page.locator('[data-iori-tab-kind="terminal"]'));
    await tab.click();
    await expect(visibleTerminal(page)).toHaveAttribute(
      "data-iori-terminal-id",
      id,
    );
    await expect(tab).toHaveCount(1);
  },
);
