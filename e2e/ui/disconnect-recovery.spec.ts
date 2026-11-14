import {
  test,
  expect,
  visibleTerminal,
  terminalId,
  sendLine,
} from "./fixtures/test.ts";
import { openPath, launch } from "./fixtures/journeys.ts";

test(
  "Hostの切断とCLIの終了を区別し入力を二重に送らない",
  { tag: "@desktop" },
  async ({ page, registeredApp: app }) => {
    await page.goto(app.url);
    await openPath(page, app.folder, app.hostKey);
    await launch(page, app.cliId);
    const id = await terminalId(visibleTerminal(page));
    await app.terminalText(id, "ACTOR_READY");
    await app.host.stop();
    await expect(
      page.getByRole("img", { name: "Reconnecting…", exact: true }),
    ).toBeVisible();
    await expect(
      page.locator('[data-iori-state="cli-resume-pending"]'),
    ).toHaveCount(0);
    await app.host.start();
    await expect(page.locator('[data-iori-state="disconnected"]')).toHaveCount(
      0,
    );
    await sendLine(
      visibleTerminal(page),
      JSON.stringify({ id: "once", hook: "UserPromptSubmit" }),
    );
    const output = await app.terminalText(id, "ACTOR_HOOK:once");
    expect(output.match(/ACTOR_HOOK:once/g)).toHaveLength(1);
    await app.host.restart({ stopDaemon: true });
    await expect(
      page.locator('[data-iori-state="cli-resume-pending"]'),
    ).toBeVisible();
    await expect(page.locator('[data-iori-state="disconnected"]')).toHaveCount(
      0,
    );
  },
);
