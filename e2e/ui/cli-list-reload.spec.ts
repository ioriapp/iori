import { expect, openFolder, test, type App } from "./fixtures/test.ts";

const addedCli = "installed-cli";

async function addCli(app: App) {
  const saved = await app.request("cli.definition.save", {
    definition: JSON.stringify({
      schema: 1,
      id: addedCli,
      name: addedCli,
      command: process.execPath,
    }),
  });
  expect(saved).toHaveProperty("cliId", addedCli);
}

test(
  "「＋」を開くとHostに追加したCLIが選択肢に出る",
  { tag: "@desktop" },
  async ({ page, registeredApp: app }) => {
    await app.open(page);
    await openFolder(page, app);
    await expect(
      page.getByRole("button", { name: app.cliId, exact: true }),
    ).toBeVisible();
    await addCli(app);
    await page.getByRole("button", { name: "New tab", exact: true }).click();
    await expect(
      page
        .getByRole("dialog")
        .getByRole("button", { name: addedCli, exact: true }),
    ).toBeVisible();
  },
);

test(
  "AIエージェントで再読み込みするとHostに追加したCLIが一覧に出る",
  { tag: "@desktop" },
  async ({ page, registeredApp: app }) => {
    await app.open(page);
    await page
      .getByRole("button", { name: "AI Agents/Teams", exact: true })
      .click();
    await expect(
      page.locator(`[data-iori-cli-row="${app.cliId}"]`),
    ).toBeVisible();
    await addCli(app);
    await page.getByRole("button", { name: "Reload", exact: true }).click();
    await expect(
      page.locator(`[data-iori-cli-row="${addedCli}"]`),
    ).toBeVisible();
  },
);
