import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { Page } from "@playwright/test";
import { test, expect, type App } from "./fixtures/test.ts";

const cliName = "CLI with Usage";
const original = 'console.log("original usage");';
const updated = 'console.log("updated usage");';

async function openDefinition(page: Page, app: App) {
  const command = join(app.folder, "usage-cli");
  const actor = new URL(
    "../../verification/host/scripted-cli.mjs",
    import.meta.url,
  );
  await writeFile(
    command,
    `#!${process.execPath}\nimport ${JSON.stringify(actor.href)};\n`,
    { mode: 0o755 },
  );
  const uploadId = crypto.randomUUID();
  await app.request("cli.definition.file.write", {
    uploadId,
    first: true,
    data: Buffer.from(original).toString("base64"),
  });
  const definition = JSON.stringify({
    schema: 1,
    id: "scripted-usage",
    name: cliName,
    command,
    usage: { script: "usage.mjs" },
  });
  const saved = await app.request("cli.definition.save", {
    definition,
    files: [{ name: "usage.mjs", uploadId }],
  });
  expect(saved).toHaveProperty("cliId", "scripted-usage");
  await app.open(page);
  await page
    .getByRole("button", { name: "AI Agents/Teams", exact: true })
    .click();
  await page
    .getByRole("button", { name: `${cliName} User definition`, exact: true })
    .click();
  return definition;
}

test(
  "定義の詳細でUsageのスクリプトを読み取り専用で開く",
  { tag: "@desktop" },
  async ({ page, registeredApp: app }) => {
    await openDefinition(page, app);
    const file = page.getByRole("button", { name: "usage.mjs Usage script" });
    await file.click();
    await expect(file).toHaveAttribute("aria-expanded", "true");
    const contents = page.getByRole("region", { name: "usage.mjs" });
    await expect(contents).toHaveText(original);
    await expect(contents).not.toHaveAttribute("contenteditable", "true");
  },
);

test(
  "詳細を開いた後の外部の変更を編集時に読み直す",
  { tag: "@desktop" },
  async ({ page, registeredApp: app }) => {
    const definition = await openDefinition(page, app);
    await page.getByRole("button", { name: "usage.mjs Usage script" }).click();
    await expect(page.getByRole("region", { name: "usage.mjs" })).toHaveText(
      original,
    );
    const uploadId = crypto.randomUUID();
    await app.request("cli.definition.file.write", {
      uploadId,
      first: true,
      data: Buffer.from(updated).toString("base64"),
    });
    const saved = await app.request("cli.definition.save", {
      cliId: "scripted-usage",
      definition,
      files: [{ name: "usage.mjs", uploadId }],
    });
    expect(saved).toHaveProperty("cliId", "scripted-usage");
    await page.getByRole("button", { name: "Edit definition" }).click();
    await expect(
      page.getByRole("textbox", { name: "Usage script" }),
    ).toHaveValue(updated);
  },
);

test(
  "Usageのスクリプトだけを編集し確認して保存する",
  { tag: "@desktop" },
  async ({ page, registeredApp: app }) => {
    await openDefinition(page, app);
    await page.getByRole("button", { name: "Edit definition" }).click();
    await page.getByRole("tab", { name: "usage.mjs" }).click();
    const script = page.getByRole("textbox", { name: "Usage script" });
    await expect(script).toHaveValue(original);
    await script.fill(updated);
    await page.getByRole("tab", { name: "definition.json" }).click();
    await page.getByRole("tab", { name: "usage.mjs Unsaved changes" }).click();
    await expect(script).toHaveValue(updated);
    await page
      .locator('[data-iori-view="cli-definition-editor"]')
      .getByRole("button", { name: "Save", exact: true })
      .click();
    const confirmation = page.getByRole("dialog", {
      name: `Save the definition of ${cliName}?`,
    });
    await confirmation
      .getByRole("button", { name: "Save", exact: true })
      .click();
    await page.getByRole("button", { name: "usage.mjs Usage script" }).click();
    await expect(page.getByRole("region", { name: "usage.mjs" })).toHaveText(
      updated,
    );
  },
);

test(
  "定義のファイルを読み込めなかったときに再試行する",
  { tag: "@desktop" },
  async ({ page, registeredApp: app }) => {
    await openDefinition(page, app);
    await app.faults.fail("cli.definition.file.read");
    await page.getByRole("button", { name: "usage.mjs Usage script" }).click();
    const error = page
      .getByRole("alert")
      .filter({ hasText: "Could not load the file." });
    await expect(error).toBeVisible();
    await app.faults.clear();
    await error.getByRole("button", { name: "Retry", exact: true }).click();
    await expect(page.getByRole("region", { name: "usage.mjs" })).toHaveText(
      original,
    );
  },
);
