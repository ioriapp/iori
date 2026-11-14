import {
  test,
  expect,
  visibleTerminal,
  terminalId,
  sendLine,
} from "./fixtures/test.ts";
import { openPath, launch } from "./fixtures/journeys.ts";

test(
  "切断から戻ったTerminalを別のデバイスで続ける",
  { tag: "@desktop" },
  async ({ page, registeredApp: app }) => {
    await page.goto(app.url);
    await openPath(page, app.folder, app.hostKey);
    await launch(page, "Bash");
    const id = await terminalId(visibleTerminal(page));
    await sendLine(visibleTerminal(page), "printf 'FIRST:%s\\n' $$");
    const first = await app.terminalText(id, /FIRST:\d+\r?\n/);
    const pid = first.match(/FIRST:(\d+)/)![1];
    await app.setOffline(true);
    await expect(
      page.getByRole("img", { name: "Disconnected", exact: true }),
    ).toBeVisible();
    await app.setOffline(false);
    await expect(
      page
        .locator(`[data-iori-host-key="${app.hostKey}"][aria-expanded]`)
        .getByRole("img", { name: "Connected", exact: true }),
    ).toBeVisible();
    await sendLine(visibleTerminal(page), "printf 'RESTORED:%s\\n' $$");
    await app.terminalText(id, `RESTORED:${pid}`);
    const device = await app.addDevice();
    await device.page.setViewportSize({ width: 1100, height: 700 });
    await device.page.goto(device.app.url);
    await openPath(device.page, app.folder, app.hostKey);
    await device.page.locator(`[data-iori-terminal-row="${id}"]`).click();
    await sendLine(visibleTerminal(device.page), "printf 'SECOND:%s\\n' $$");
    await device.app.terminalText(id, `SECOND:${pid}`);
    await app.terminalText(id, `SECOND:${pid}`);
    await expect(page.locator('[data-iori-state="disconnected"]')).toHaveCount(
      0,
    );
  },
);
