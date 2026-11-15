import {
  test,
  expect,
  openFolder,
  visibleTerminal,
  terminalId,
  sendLine,
} from "./fixtures/test.ts";

test(
  "スマホで背面から戻ってもTerminalへ入力できる",
  { tag: ["@phone", "@android-only"] },
  async ({ page, registeredApp: app }) => {
    await app.open(page);
    await openFolder(page, app, true);
    await page.getByRole("button", { name: "New tab", exact: true }).tap();
    await page
      .getByRole("dialog")
      .getByRole("button", { name: "Bash", exact: true })
      .tap();
    const terminal = visibleTerminal(page);
    const id = await terminalId(terminal);
    await app.terminalText(id, /[$#] /);
    await sendLine(terminal, "printf 'BEFORE_BG:%s\\n' ok");
    await app.terminalText(id, /BEFORE_BG:ok\r?\n/);

    await app.background(page);
    await app.resume(page);

    await expect(visibleTerminal(page)).toHaveAttribute(
      "data-iori-terminal-id",
      id,
    );
    await sendLine(visibleTerminal(page), "printf 'AFTER_BG:%s\\n' ok");
    const output = await app.terminalText(id, /AFTER_BG:ok\r?\n/);
    expect(output.match(/AFTER_BG:ok/g)).toHaveLength(1);
  },
);
