import {
  test,
  expect,
  visibleTerminal,
  terminalId,
  sendLine,
} from "./fixtures/test.ts";
import { openPath, launch, hostSettings } from "./fixtures/journeys.ts";

test(
  "選んだHost更新の停止対象と進行と検証失敗を表示する",
  { tag: "@desktop" },
  async ({ page, registeredApp: app }) => {
    const host = await app.addHost({ updates: true });
    await app.registerHost(host);
    await page.goto(app.url);
    await openPath(page, host.folder, host.hostKey);
    await launch(page, host.cliId);
    const id = await terminalId(visibleTerminal(page));
    await app.terminalText(id, "ACTOR_READY");
    await sendLine(
      visibleTerminal(page),
      JSON.stringify({ id: "active", hook: "UserPromptSubmit" }),
    );
    await app.terminalText(id, "ACTOR_HOOK:active");
    await hostSettings(page, host.hostKey, "open-host-version");
    await page
      .getByRole("button", { name: "Update iori Host", exact: true })
      .click();
    const confirm = page.getByRole("dialog", {
      name: "Update iori Host",
      exact: true,
    });
    await expect(confirm.locator("[data-iori-maintenance-open]")).toBeVisible();
    await expect(confirm.locator("[data-iori-maintenance-work]")).toContainText(
      host.cliId,
    );
    await confirm
      .getByRole("button", { name: "Stop and update", exact: true })
      .click();
    await expect(
      page.getByRole("progressbar", {
        name: "Downloading the Host update",
        exact: true,
      }),
    ).toBeVisible();
    await host.releaseAsset();
    await expect(page.locator('[data-iori-state="host-failed"]')).toContainText(
      "Could not update iori Host",
    );
  },
);
