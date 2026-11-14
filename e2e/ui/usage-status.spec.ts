import { randomUUID } from "node:crypto";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { Page } from "@playwright/test";
import { test, expect, openFolder, type App } from "./fixtures/test.ts";

async function journey(page: Page, app: App, mobile: boolean) {
  await page.goto(app.url);
  await openFolder(page, app, mobile);
  await expect(
    page.getByRole("button", { name: app.cliId, exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: new RegExp(`${app.cliId} usage`) }),
  ).toHaveCount(0);
  const usage = page.getByRole("button", { name: /Usage test usage/ });
  await expect(usage).toHaveCount(0);
  const uploadId = randomUUID();
  const value = join(app.folder, "usage-value");
  await writeFile(value, "25");
  const script = `import { readFileSync } from "node:fs";
const remaining = Number(readFileSync(${JSON.stringify(value)}, "utf8"));
console.log(JSON.stringify({ windows: [{ remaining, minutes: 300 }] }));`;
  await app.request("cli.definition.file.write", {
    uploadId,
    first: true,
    data: Buffer.from(script).toString("base64"),
  });
  const saved = await app.request("cli.definition.save", {
    definition: JSON.stringify({
      schema: 1,
      id: "usage-test",
      name: "Usage test",
      command: { shell: "node --version" },
      usage: { script: "usage.mjs" },
    }),
    files: [{ name: "usage.mjs", uploadId }],
  });
  expect(saved).toHaveProperty("cliId", "usage-test");
  await page.reload();
  await expect(usage).toBeVisible();
  await expect(usage).toHaveAccessibleName(/75%/);
  await usage.click();
  await expect(
    page.getByRole("heading", { name: "Usage test", exact: true }),
  ).toBeVisible();
  await expect(page.getByText(/5h/).first()).toBeVisible();
  await writeFile(value, "50");
  await page
    .getByRole("button", { name: "Refresh usage", exact: true })
    .click();
  await expect(usage).toHaveAccessibleName(/50%/);
  return usage;
}

test(
  "PCで利用枠の表示と詳細を開き再取得する",
  { tag: "@desktop" },
  async ({ page, registeredApp: app }) => {
    await expect(await journey(page, app, false)).toBeVisible();
  },
);

test(
  "スマホで利用枠の表示と詳細を開き再取得する",
  { tag: "@phone" },
  async ({ page, registeredApp: app }) => {
    await expect(await journey(page, app, true)).toBeVisible();
  },
);
