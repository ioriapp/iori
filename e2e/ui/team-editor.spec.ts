import { fileURLToPath } from "node:url";
import { createTeam } from "./fixtures/journeys.ts";
import { test, expect } from "./fixtures/test.ts";

test(
  "チームを編集して保存し保存の競合を解決する",
  { tag: "@desktop" },
  async ({ page, registeredApp: app }) => {
    const saved = await createTeam(app, {
      name: "Editor team",
      roles: [],
      makeDefault: false,
    });
    await app.open(page);
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

test(
  "モデルの一覧が無い CLI を『既定』で候補に追加して保存する",
  { tag: "@desktop" },
  async ({ page, registeredApp: app }) => {
    const script = fileURLToPath(
      new URL("../../verification/host/scripted-cli.mjs", import.meta.url),
    );
    await app.request("cli.definition.simple", {
      simple: {
        name: "no-models-cli",
        command: `'${process.execPath}' '${script}'`,
        modelArgument: "",
        models: [],
      },
    });
    const saved = await createTeam(app, {
      name: "Default model team",
      roles: [{ name: "Worker" }],
      makeDefault: false,
    });
    await app.open(page);
    await page
      .getByRole("button", { name: "AI Agents/Teams", exact: true })
      .click();
    await page.getByRole("button", { name: "Teams", exact: true }).click();
    await page
      .getByRole("button", { name: /Default model team Version/ })
      .click();
    await page.getByRole("button", { name: "Worker", exact: true }).click();
    await page
      .getByRole("button", { name: "Add candidate", exact: true })
      .click();
    await page
      .getByRole("option", { name: "no-models-cli › Default", exact: true })
      .click();
    await expect(
      page.getByRole("combobox", {
        name: "CLI and model: no-models-cli › Default",
        exact: true,
      }),
    ).toBeVisible();
    await page.getByRole("button", { name: "Save", exact: true }).click();
    await expect(
      page.getByRole("button", { name: "Save", exact: true }),
    ).toBeDisabled();
    const current = await app.request("teams.read", { teamId: saved.id });
    expect(
      current.saved.roles[0].candidates.medium.some(
        (candidate) =>
          candidate.cli === "no-models-cli" && candidate.model === "",
      ),
    ).toBe(true);
  },
);
