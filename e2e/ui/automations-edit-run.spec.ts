import { fileURLToPath } from "node:url";
import { test, expect, type App } from "./fixtures/test.ts";

async function addModel(app: App) {
  const script = fileURLToPath(
    new URL("../../verification/host/scripted-cli.mjs", import.meta.url),
  );
  const result = await app.request("cli.definition.simple", {
    cliId: app.cliId,
    simple: {
      name: app.cliId,
      command: `'${process.execPath}' '${script}'`,
      modelArgument: "",
      models: ["test-model"],
    },
  });
  expect(result).toHaveProperty("cliId", app.cliId);
}

test(
  "Automationを作成して編集し実行結果を開く",
  { tag: "@desktop" },
  async ({ page, registeredApp: app }) => {
    await addModel(app);
    await app.faults.hold("cli.list");
    await page.goto(app.url);
    await page
      .getByRole("button", { name: "AI Agents/Teams", exact: true })
      .click();
    await page
      .getByRole("button", { name: "Automations", exact: true })
      .click();
    await page
      .getByRole("button", { name: "New automation", exact: true })
      .click();
    await app.faults.clear();
    await page.getByRole("combobox", { name: /^CLI and model:/ }).click();
    const model = page.getByRole("option", {
      name: `${app.cliId} › test-model`,
      exact: true,
    });
    await model.click();
    await page
      .getByRole("textbox", { name: "Name", exact: true })
      .fill("Daily work");
    await page
      .getByRole("textbox", { name: "Instructions", exact: true })
      .fill("Perform the work.");
    await page
      .getByRole("textbox", { name: "Folder", exact: true })
      .fill(app.folder);
    await page.getByRole("combobox", { name: "Schedule", exact: true }).click();
    await page.getByRole("option", { name: "Daily", exact: true }).click();
    await page.getByRole("button", { name: "Save", exact: true }).click();
    await expect(
      page.getByRole("button", { name: "Run now", exact: true }),
    ).toBeVisible();
    await page
      .getByRole("textbox", { name: "Instructions", exact: true })
      .fill("Perform the edited work.");
    await page.getByRole("button", { name: "Save", exact: true }).click();
    await expect(
      page.getByRole("button", { name: "Save", exact: true }),
    ).toBeDisabled();
    await page
      .getByRole("button", { name: "Automations", exact: true })
      .last()
      .click();
    const row = page.getByRole("button", { name: /Daily work/ });
    await expect(row).toContainText("Next run:");
    await row.click();
    await expect(
      page.getByRole("textbox", { name: "Instructions", exact: true }),
    ).toHaveValue("Perform the edited work.");
    await page.getByRole("button", { name: "Run now", exact: true }).click();
    await page
      .getByRole("button", { name: "Open conversation", exact: true })
      .click();
    await expect(
      page.locator('[data-iori-view="terminal"][data-iori-displayed="true"]'),
    ).toBeVisible();
  },
);

test(
  "Webhookを有効にしてトークンを再生成する",
  { tag: "@desktop" },
  async ({ page, registeredApp: app }) => {
    await addModel(app);
    await page.goto(app.url);
    await page
      .getByRole("button", { name: "AI Agents/Teams", exact: true })
      .click();
    await page
      .getByRole("button", { name: "Automations", exact: true })
      .click();
    await page
      .getByRole("button", { name: "New automation", exact: true })
      .click();
    await page.getByRole("combobox", { name: /^CLI and model:/ }).click();
    await page
      .getByRole("option", { name: `${app.cliId} › test-model`, exact: true })
      .click();
    await page
      .getByRole("textbox", { name: "Name", exact: true })
      .fill("Webhook work");
    await page
      .getByRole("textbox", { name: "Instructions", exact: true })
      .fill("Perform the work.");
    await page
      .getByRole("textbox", { name: "Folder", exact: true })
      .fill(app.folder);
    await page
      .getByRole("switch", { name: "Run from webhook", exact: true })
      .click();
    await page.getByRole("button", { name: "Save", exact: true }).click();
    await page
      .getByRole("button", { name: "Regenerate token", exact: true })
      .click();
    const dialog = page.getByRole("dialog", { name: "Regenerate the token?" });
    await dialog
      .getByRole("button", { name: "Regenerate", exact: true })
      .click();
    await expect(dialog).toBeHidden();
    await expect(
      page.getByRole("switch", { name: "Run from webhook", exact: true }),
    ).toBeChecked();
  },
);
