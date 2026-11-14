import {
  test,
  expect,
  visibleTerminal,
  terminalId,
  openFolder,
} from "./fixtures/test.ts";
import { openPath, launch } from "./fixtures/journeys.ts";
import type { Page } from "@playwright/test";
import type { App } from "./fixtures/test.ts";

function readingJourney(restart: boolean) {
  return async ({
    page,
    registeredApp: app,
  }: {
    page: Page;
    registeredApp: App;
  }) => {
    await app.files({
      "reading.txt": Array.from(
        { length: 150 },
        (_, n) => `Reading line ${n + 1}`,
      ).join("\n"),
    });
    await page.goto(app.url);
    await openPath(page, app.folder, app.hostKey);
    await launch(page, "Bash");
    const id = await terminalId(visibleTerminal(page));
    await page
      .getByRole("button", { name: "Split right", exact: true })
      .click();
    await page
      .getByRole("button", { name: "New tab", exact: true })
      .last()
      .click();
    await page
      .getByRole("dialog")
      .getByRole("button", { name: "Files", exact: true })
      .click();
    await page.getByText("reading.txt", { exact: true }).click();
    await page.getByText("Reading line 1", { exact: true }).click();
    await page.keyboard.press("Control+g");
    await page
      .getByRole("textbox", { name: "Go to line", exact: true })
      .fill("80");
    await page
      .getByRole("textbox", { name: "Go to line", exact: true })
      .press("Enter");
    const line = page.locator('[data-iori-line="80"]');
    await expect(line).toBeInViewport();
    await page.reload();
    await expect(line).toBeInViewport();
    if (restart) {
      await app.host.restart();
      await expect(
        page.locator('[data-iori-state="disconnected"]'),
      ).toHaveCount(0);
    }
    await expect(line).toBeInViewport();
    await page.getByRole("tab", { name: "Bash", exact: true }).first().click();
    await expect(visibleTerminal(page)).toHaveAttribute(
      "data-iori-terminal-id",
      id,
    );
    await expect(
      page.getByRole("button", { name: "New tab", exact: true }),
    ).toHaveCount(2);
  };
}

function draftJourney(restart: boolean) {
  return async ({
    page,
    registeredApp: app,
  }: {
    page: Page;
    registeredApp: App;
  }) => {
    await page.goto(app.url);
    await openFolder(page, app, true);
    await page.getByRole("button", { name: "New tab", exact: true }).tap();
    await page
      .getByRole("dialog")
      .getByRole("button", { name: "Bash", exact: true })
      .tap();
    const id = await terminalId(visibleTerminal(page));
    await page
      .getByRole("button", { name: "Switch to batch input", exact: true })
      .tap();
    const input = page.getByRole("textbox", {
      name: "Type a command…",
      exact: true,
    });
    await input.fill("printf 'DRAFT:%s\\n' retained");
    await page.reload();
    await page.getByRole("button", { name: /project/ }).tap();
    await expect(input).toHaveValue("printf 'DRAFT:%s\\n' retained");
    if (restart) {
      await app.host.restart();
      await expect(
        page.getByRole("img", { name: "Connected", exact: true }),
      ).toBeVisible();
      await expect(input).toHaveValue("printf 'DRAFT:%s\\n' retained");
    }
    await page.getByRole("button", { name: "Send", exact: true }).tap();
    await app.terminalText(id, "DRAFT:retained");
  };
}

test(
  "読み位置と分割配置を再読込の後も保つ",
  { tag: "@desktop" },
  readingJourney(false),
);
test(
  "読み位置と分割配置をHost再起動の後も保つ",
  { tag: "@desktop" },
  readingJourney(true),
);
test(
  "スマホの下書きを再読込の後も保つ",
  { tag: "@phone" },
  draftJourney(false),
);
test(
  "スマホの下書きをHost再起動の後も保つ",
  { tag: "@phone" },
  draftJourney(true),
);
