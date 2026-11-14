import {
  test,
  expect,
  openFolder,
  visibleTerminal,
  terminalId,
  sendLine,
} from "./fixtures/test.ts";

test(
  "招待から登録し最初のCLIへ入力して作業中と完了を確認する",
  { tag: "@desktop" },
  async ({ page, app }, info) => {
    const started = performance.now();
    await page.goto(app.url);
    await page
      .getByRole("textbox", { name: "Invitation", exact: true })
      .fill(app.inviteText);
    await page.getByRole("button", { name: "Continue", exact: true }).click();
    await expect(page.locator('[data-iori-value="host-name"]')).toHaveText(
      app.hostName,
    );
    await page.getByRole("button", { name: "Register", exact: true }).click();
    await expect(
      page.getByRole("button", { name: "Add folder", exact: true }),
    ).toBeVisible();
    info.annotations.push({
      type: "registrationMs",
      description: String(performance.now() - started),
    });
    await openFolder(page, app);
    await page.getByRole("button", { name: "New tab", exact: true }).click();
    await page
      .getByRole("dialog")
      .getByRole("button", { name: app.cliId, exact: true })
      .click();
    const terminal = visibleTerminal(page);
    const id = await terminalId(terminal);
    await app.terminalText(id, "ACTOR_READY");
    await sendLine(
      terminal,
      JSON.stringify({ id: "active", hook: "UserPromptSubmit" }),
    );
    const tab = page.locator(`[data-iori-tab-cli="${app.cliId}"]`);
    await expect(
      tab.getByRole("img", { name: "Running", exact: true }),
    ).toBeVisible();
    await app.terminalText(id, "ACTOR_HOOK:active");
    // Finish after moving away, since viewing the completed CLI clears its badge.
    await page.getByRole("button", { name: "New tab", exact: true }).click();
    await page.locator('[data-iori-action="workspace-open-files"]').click();
    // Keep the CLI's real input in flight while the Files tab is selected.
    await app.input(id, JSON.stringify({ id: "done", hook: "Stop" }) + "\r");
    await expect(
      tab.getByRole("img", { name: "Done", exact: true }),
    ).toBeVisible();
    await tab.click();
    await app.terminalText(id, "ACTOR_HOOK:done");
    await expect(
      tab.getByRole("img", { name: "Done", exact: true }),
    ).toHaveCount(0);
  },
);
