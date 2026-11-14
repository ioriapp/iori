import {
  test,
  expect,
  openFolder,
  terminalId,
  visibleTerminal,
} from "./fixtures/test.ts";
import { notificationRequests } from "./fixtures/browser.ts";
import { launch } from "./fixtures/journeys.ts";

test(
  "見ていないCLIの完了をnativeの境界へ要求し設定で切ると要求しない（OS表示は対象外）",
  { tag: "@desktop" },
  async ({ page, registeredApp: app }) => {
    const notifications = await notificationRequests(page);
    await page.goto(app.url);
    await openFolder(page, app);
    await launch(page, app.cliId);
    const id = await terminalId(visibleTerminal(page));
    await app.terminalText(id, "ACTOR_READY");
    await page.getByRole("button", { name: "New tab", exact: true }).click();
    await page.locator('[data-iori-action="workspace-open-files"]').click();
    const row = page.locator(`[data-iori-terminal-row="${id}"]`);
    const done = row.getByRole("img", { name: "Done", exact: true });
    const active = row.getByRole("img", { name: "Running", exact: true });
    const work = async (name: string) => {
      await app.input(
        id,
        JSON.stringify({ id: name, hook: "UserPromptSubmit" }) + "\r",
      );
      await expect(active).toBeVisible();
    };
    const complete = async (name: string) => {
      await app.input(
        id,
        JSON.stringify({
          id: name,
          hook: "Stop",
        }) + "\r",
      );
      await expect(done).toBeVisible();
    };
    const toggleNotifications = async () => {
      await page.getByRole("button", { name: "Settings", exact: true }).click();
      await page
        .getByRole("button", { name: "Notifications", exact: true })
        .click();
      await page
        .getByRole("switch", { name: "Completion notifications", exact: true })
        .click();
      await page
        .getByRole("dialog")
        .getByRole("button", { name: "Close", exact: true })
        .click();
    };
    await work("first");
    await complete("First completion");
    const first = {
      title: `project - ${app.cliId} Done`,
      body: app.cliId,
      target: { hostKey: app.hostKey, terminalId: id },
    };
    await notifications.expectRequests([first]);
    await toggleNotifications();
    await work("disabled");
    await complete("Disabled completion");
    // The next delivered notification confirms processing continued after the disabled one.
    await toggleNotifications();
    await work("enabled");
    await complete("Enabled completion");
    await notifications.expectRequests([first, first]);
  },
);
