import { randomUUID } from "node:crypto";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { Page } from "@playwright/test";
import { test, expect, openFolder, type App } from "./fixtures/test.ts";

async function journey(page: Page, app: App, mobile: boolean) {
  await app.open(page);
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

test(
  "スマホで戻る操作が利用枠のポップオーバーだけを閉じる",
  { tag: "@phone" },
  async ({ page, registeredApp: app }) => {
    const usage = await journey(page, app, true);
    const heading = page.getByRole("heading", {
      name: "Usage test",
      exact: true,
    });
    // After the reload, the phone shows the first screen, which has no
    // earlier view: Android would leave the app on this back.
    const firstScreen = page.getByRole("region", { name: /^Boards/ });
    await expect(heading).toBeVisible();
    await expect(firstScreen).toBeVisible();
    await app.back(page);
    await expect(heading).toBeHidden();
    await expect(usage).toBeVisible();
    await expect(firstScreen).toBeVisible();
  },
);

test(
  "使用0%の利用枠をステータスバーのグラフに出さず、ポップオーバーには出す",
  { tag: "@desktop" },
  async ({ page, registeredApp: app }) => {
    await page.goto(app.url);
    await openFolder(page, app, false);
    const uploadId = randomUUID();
    const script = `console.log(JSON.stringify({
      windows: [
        { name: "Gemini", remaining: 75, minutes: 300 },
        { name: "Gemini", remaining: 40, minutes: 10080 },
        { name: "Claude", remaining: 100, minutes: 300 },
        { name: "Claude", remaining: 100, minutes: 10080 },
        { name: "Argon", remaining: 100, minutes: 10080 }
      ]
    }));`;
    await app.request("cli.definition.file.write", {
      uploadId,
      first: true,
      data: Buffer.from(script).toString("base64"),
    });
    await app.request("cli.definition.save", {
      definition: JSON.stringify({
        schema: 1,
        id: "usage-filter-test",
        name: "Usage filter",
        command: { shell: "node --version" },
        usage: { script: "usage.mjs" },
      }),
      files: [{ name: "usage.mjs", uploadId }],
    });
    await page.reload();
    const usage = page.getByRole("button", { name: /Usage filter usage/ });
    await expect(usage).toBeVisible();
    await expect(usage.locator(".usage-mini-graphs > *")).toHaveCount(2);
    await usage.click();
    await expect(
      page.getByRole("heading", { name: "Usage filter", exact: true }),
    ).toBeVisible();
    await expect(page.getByText(/Gemini 5h/)).toBeVisible();
    await expect(page.getByText(/Gemini 7d/)).toBeVisible();
    await expect(page.getByText(/Claude 5h/)).toBeVisible();
    await expect(page.getByText(/Claude 7d/)).toBeVisible();
    await expect(page.getByText(/Argon 7d/)).toBeVisible();
  },
);

test(
  "ポップオーバーからステータスバーに表示する利用枠を選び再読み込み後も維持する",
  { tag: "@desktop" },
  async ({ page, registeredApp: app }) => {
    await app.open(page);
    await openFolder(page, app, false);
    const uploadId = randomUUID();
    const script = `console.log(JSON.stringify({
      windows: [
        { remaining: 25, minutes: 300 },
        { remaining: 80, minutes: 10080 },
        { name: "Sonnet", remaining: 100, minutes: 10080 }
      ]
    }));`;
    await app.request("cli.definition.file.write", {
      uploadId,
      first: true,
      data: Buffer.from(script).toString("base64"),
    });
    await app.request("cli.definition.save", {
      definition: JSON.stringify({
        schema: 1,
        id: "usage-select-test",
        name: "Usage select",
        command: { shell: "node --version" },
        usage: { script: "usage.mjs" },
      }),
      files: [{ name: "usage.mjs", uploadId }],
    });
    await page.reload();

    const usage = page.getByRole("button", { name: /Usage select usage/ });
    await expect(usage).toBeVisible();
    await expect(usage).toHaveAccessibleName(/75%/);
    await expect(usage.locator(".usage-mini-graphs > *")).toHaveCount(2);

    await usage.click();
    const heading = page.getByRole("heading", {
      name: "Usage select",
      exact: true,
    });
    await expect(heading).toBeVisible();

    const picker = page.getByRole("button", {
      name: "Window in status bar",
      exact: true,
    });
    await picker.click();
    await page.getByRole("menuitemradio", { name: "7d", exact: true }).click();

    await expect(page.getByRole("menu")).toBeHidden();
    await expect(heading).toBeVisible();
    await expect(usage).toHaveAccessibleName(/20%/);

    await page.reload();
    await expect(usage).toBeVisible();
    await expect(usage).toHaveAccessibleName(/20%/);

    await usage.click();
    await expect(heading).toBeVisible();
    await picker.click();
    await page
      .getByRole("menuitemradio", { name: "Sonnet 7d", exact: true })
      .click();

    await expect(page.getByRole("menu")).toBeHidden();
    await expect(heading).toBeVisible();
    await expect(usage).toHaveAccessibleName(/0%/);
    await expect(usage.locator(".usage-mini-graphs > *")).toHaveCount(3);

    await picker.click();
    await page
      .getByRole("menuitemradio", {
        name: "Auto (lowest remaining)",
        exact: true,
      })
      .click();

    await expect(page.getByRole("menu")).toBeHidden();
    await expect(heading).toBeVisible();
    await expect(usage).toHaveAccessibleName(/75%/);
    await expect(usage.locator(".usage-mini-graphs > *")).toHaveCount(2);
  },
);
