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
    await app.open(page);
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
    await app.open(page);
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

test(
  "CLI一覧の到着前に新しいAutomationを開いても保存できる",
  { tag: "@desktop" },
  async ({ page, registeredApp: app }) => {
    await addModel(app);
    await app.faults.hold("cli.list");
    await app.open(page);
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
    await expect(
      page.getByRole("combobox", { name: /^CLI and model:/ }),
    ).toContainText("›");
    await page
      .getByRole("textbox", { name: "Name", exact: true })
      .fill("Delayed CLI work");
    await page
      .getByRole("textbox", { name: "Instructions", exact: true })
      .fill("Perform the work.");
    await page
      .getByRole("textbox", { name: "Folder", exact: true })
      .fill(app.folder);
    await page.getByRole("button", { name: "Save", exact: true }).click();
    await expect(
      page.getByRole("button", { name: "Run now", exact: true }),
    ).toBeVisible();
  },
);

test(
  "受信内容の読み込みに失敗した回を再試行して本文を開く",
  { tag: "@desktop" },
  async ({ page, registeredApp: app }) => {
    await addModel(app);
    const { automation } = await app.request("automation.save", {
      definition: {
        name: "Webhook history",
        instruction: "Read the webhook.",
        cwd: app.folder,
        target: {
          kind: "cli",
          candidate: {
            id: app.cliId,
            cli: app.cliId,
            model: "test-model",
            tools: [],
            minimum: "",
          },
        },
        schedule: { kind: "manual" },
        webhook: { scope: "local" },
        missed: "skip",
        enabled: false,
      },
    });
    const { webhook } = await app.request("automation.list", {});
    const body = "Sample webhook delivery";
    const delivery = await fetch(
      `http://127.0.0.1:${webhook?.port}/hooks/${automation.id}`,
      {
        method: "POST",
        headers: { Authorization: `Bearer ${automation.webhookToken}` },
        body,
      },
    );
    expect(delivery.status).toBe(202);

    await app.open(page);
    await page
      .getByRole("button", { name: "AI Agents/Teams", exact: true })
      .click();
    await page
      .getByRole("button", { name: "Automations", exact: true })
      .click();
    await page.getByRole("button", { name: /Webhook history/ }).click();
    await app.faults.fail("automation.received");
    await page
      .getByRole("button", { name: "Received content", exact: true })
      .click();
    const alert = page
      .getByRole("alert")
      .filter({ hasText: "The Host could not complete this operation." });
    await expect(alert).toBeVisible();
    await app.faults.clear();
    await alert.getByRole("button", { name: "Retry", exact: true }).click();
    await expect(
      page.getByRole("dialog", { name: "Received content" }).getByText(body),
    ).toBeVisible();
  },
);

test(
  "履歴の取得失敗で未実行表示を出さず再試行で0件表示へ回復する",
  { tag: "@desktop" },
  async ({ page, registeredApp: app }) => {
    await addModel(app);
    await app.request("automation.save", {
      definition: {
        name: "History error check",
        instruction: "Check history state.",
        cwd: app.folder,
        target: {
          kind: "cli",
          candidate: {
            id: app.cliId,
            cli: app.cliId,
            model: "test-model",
            tools: [],
            minimum: "",
          },
        },
        schedule: { kind: "manual" },
        missed: "skip",
        enabled: true,
      },
    });
    await app.open(page);
    await page
      .getByRole("button", { name: "AI Agents/Teams", exact: true })
      .click();
    await page
      .getByRole("button", { name: "Automations", exact: true })
      .click();
    await app.faults.fail("automation.history");
    await page.getByRole("button", { name: /History error check/ }).click();
    const historySection = page.locator(
      '[data-iori-view="automation-history"]',
    );
    const errorAlert = historySection.getByRole("alert");
    await expect(errorAlert).toContainText(
      "Could not load automation history. Retry.",
    );
    await expect(historySection.getByText("Not run yet.")).toHaveCount(0);
    await app.faults.clear();
    await errorAlert
      .getByRole("button", { name: "Retry", exact: true })
      .click();
    await expect(
      historySection.getByText("Not run yet.", { exact: true }),
    ).toBeVisible();
  },
);
