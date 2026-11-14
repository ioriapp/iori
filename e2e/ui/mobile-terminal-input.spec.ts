import { swipeToEarlierOutput } from "./fixtures/browser.ts";
import {
  test,
  expect,
  openFolder,
  visibleTerminal,
  terminalId,
  sendLine,
} from "./fixtures/test.ts";

test(
  "スマホのまとめて入力とキーの帯からCLIへ送る",
  { tag: "@phone" },
  async ({ page, registeredApp: app }) => {
    await page.goto(app.url);
    await openFolder(page, app, true);
    await page.getByRole("button", { name: "New tab", exact: true }).tap();
    await page
      .getByRole("dialog")
      .getByRole("button", { name: app.cliId, exact: true })
      .tap();
    const terminal = visibleTerminal(page);
    const id = await terminalId(terminal);
    await app.terminalText(id, "ACTOR_READY");
    const input = page.getByRole("textbox", {
      name: "Type a command…",
      exact: true,
    });
    const message = JSON.stringify({ id: "batch", hook: "UserPromptSubmit" });
    await input.fill(message);
    await page.getByRole("button", { name: "Expand input", exact: true }).tap();
    const expanded = page
      .getByRole("dialog")
      .getByRole("textbox", { name: "Type a command…", exact: true });
    await expect(expanded).toHaveValue(message);
    await page
      .getByRole("dialog")
      .getByRole("button", { name: "Close", exact: true })
      .tap();
    await expect(input).toHaveValue(message);
    await page.getByRole("button", { name: "Send", exact: true }).tap();
    await expect(input).toHaveValue("");
    await app.terminalText(id, "ACTOR_HOOK:batch");
    await app.input(id, JSON.stringify({ id: "band", hook: "Stop" }));
    await terminal.locator('[data-iori-key="enter"]').tap();
    await app.terminalText(id, "ACTOR_HOOK:band");
  },
);

test(
  "スマホでTerminalの過去の出力をスワイプし最新へ戻る",
  { tag: "@phone" },
  async ({ page, registeredApp: app }) => {
    await page.goto(app.url);
    await openFolder(page, app, true);
    await page.getByRole("button", { name: "New tab", exact: true }).tap();
    await page
      .getByRole("dialog")
      .getByRole("button", { name: "Bash", exact: true })
      .tap();
    const terminal = visibleTerminal(page);
    const id = await terminalId(terminal);
    await app.terminalText(id, /[$#] /);
    await sendLine(
      terminal,
      "for i in {1..100}; do printf 'PAST_OUTPUT_%s\\n' \"$i\"; done; printf 'LATEST_OUTPUT\\n'",
    );
    await app.terminalText(id, /LATEST_OUTPUT\r?\n/);
    const latest = page.getByRole("button", {
      name: "Jump to latest",
      exact: true,
    });
    await expect(latest).toHaveCount(0);
    await swipeToEarlierOutput(
      terminal.locator('[data-iori-part="terminal-screen"]'),
    );
    await expect(latest).toBeVisible();
    await latest.tap();
    await expect(latest).toHaveCount(0);
  },
);
