import { inviteToText } from "../../packages/protocol/src/index.ts";
import {
  test,
  expect,
  openFolder,
  visibleTerminal,
  terminalId,
  sendLine,
} from "./fixtures/test.ts";

test(
  "Hostを一覧から削除して再登録しTerminalを使う",
  { tag: "@desktop" },
  async ({ page, registeredApp: app }) => {
    const { invite } = await app.request("invite.create", {});
    await page.goto(app.url);
    await page.getByRole("button", { name: "Settings", exact: true }).click();
    await page.locator('[data-iori-action="open-connection"]').click();
    await page
      .getByRole("button", { name: "Remove from list", exact: true })
      .click();
    await page.locator('[data-iori-action="host-forget-confirm"]').click();
    await page.locator('[data-iori-action="settings-close"]').click();
    await page
      .getByRole("textbox", { name: "Invitation", exact: true })
      .fill(inviteToText(invite));
    await page.getByRole("button", { name: "Continue", exact: true }).click();
    await expect(page.locator('[data-iori-value="host-name"]')).toHaveText(
      app.hostName,
    );
    await page.getByRole("button", { name: "Register", exact: true }).click();
    await openFolder(page, app);
    await page.getByRole("button", { name: "New tab", exact: true }).click();
    await page
      .getByRole("dialog")
      .getByRole("button", { name: "Bash", exact: true })
      .click();
    const terminal = visibleTerminal(page);
    const id = await terminalId(terminal);
    await sendLine(terminal, "printf 'RERE%s\\n' GISTERED");
    await app.terminalText(id, "REREGISTERED");
  },
);
