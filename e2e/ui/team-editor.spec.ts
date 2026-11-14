import { test, expect } from "./fixtures/test.ts";

test(
  "チームを編集して保存し保存の競合を解決する",
  { tag: "@desktop" },
  async ({ page, registeredApp: app }) => {
    const { saved } = await app.request("teams.create", {
      definition: {
        name: "Editor team",
        description: "",
        instruction: "",
        parent: {
          id: "parent",
          cli: app.cliId,
          model: "",
          tools: [],
          minimum: "",
        },
        roles: [],
      },
    });
    await page.goto(app.url);
    await page
      .getByRole("button", { name: "AI Agents/Teams", exact: true })
      .click();
    await page.getByRole("button", { name: "Teams", exact: true }).click();
    await page.getByRole("button", { name: /Editor team Version/ }).click();
    const name = page.getByRole("textbox", { name: "Name", exact: true });
    await name.fill("Edited team");
    await page.getByRole("button", { name: "Save", exact: true }).click();
    await expect(
      page.getByRole("button", { name: "Save", exact: true }),
    ).toBeDisabled();
    await name.fill("My changes");
    const current = await app.request("teams.read", { teamId: saved.id });
    await app.request("teams.save", {
      teamId: saved.id,
      definition: { ...current.saved, name: "Other changes" },
      baseVersion: current.saved.version,
    });
    await page.getByRole("button", { name: "Save", exact: true }).click();
    const dialog = page.getByRole("dialog", {
      name: "This team was changed on another device",
    });
    await expect(dialog).toBeVisible();
    await dialog.getByRole("button", { name: "Reload", exact: true }).click();
    await expect(name).toHaveValue("Other changes");
  },
);
