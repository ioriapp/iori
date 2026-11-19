import { test, expect } from "./fixtures/test.ts";

test.use({ locale: "ja-JP" });

test(
  "役割の順番を保存すると開き直した木と履歴に反映される",
  { tag: "@desktop" },
  async ({ page, registeredApp: app }) => {
    const { saved } = await app.request("teams.create", {
      template: "development",
      language: "ja",
    });
    const openTeam = async () => {
      await page
        .getByRole("button", { name: "AI Agents/Teams", exact: true })
        .click();
      await page.getByRole("button", { name: "Teams", exact: true }).click();
      await page
        .locator(`.team-list-open[data-iori-team-id="${saved.id}"]`)
        .click();
    };
    await app.open(page);
    await openTeam();
    const [first, second, ...rest] = saved.roles;
    await page
      .getByRole("button", {
        name: `ドラッグして並べ替え ${second!.name}`,
        exact: true,
      })
      .press("ArrowUp");
    const save = page.getByRole("button", { name: "保存", exact: true });
    await save.click();
    await expect(save).toBeDisabled();

    await page.reload();
    await openTeam();
    await expect(
      page.locator('[data-iori-action="team-role"] > span'),
    ).toHaveText([second!, first!, ...rest].map((role) => role.name));
    await page.getByRole("button", { name: "履歴", exact: true }).click();
    await expect(
      page
        .getByRole("dialog")
        .getByText("役割の順番を変更しました", { exact: true }),
    ).toBeVisible();
  },
);
