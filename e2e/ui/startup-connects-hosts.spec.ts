import { test, expect } from "./fixtures/test.ts";
import { sidebar } from "./fixtures/journeys.ts";
import type { Page } from "@playwright/test";
import type { App } from "./fixtures/test.ts";

function journey(mobile: boolean) {
  return async ({
    page,
    registeredApp: app,
  }: {
    page: Page;
    registeredApp: App;
  }) => {
    const second = await app.addHost();
    await app.registerHost(second);
    await page.goto(app.url);
    await sidebar(page, mobile);
    for (const hostKey of [app.hostKey, second.hostKey]) {
      const host = page
        .getByRole("button")
        .and(page.locator(`[data-iori-host-key="${hostKey}"][aria-expanded]`));
      await expect(
        host.getByRole("img", { name: "Connected", exact: true }),
      ).toBeVisible();
    }
  };
}
test("起動時に登録済みの全Hostへ接続する", { tag: "@desktop" }, journey(false));
test(
  "スマホで起動時に登録済みの全Hostへ接続する",
  { tag: "@phone" },
  journey(true),
);
