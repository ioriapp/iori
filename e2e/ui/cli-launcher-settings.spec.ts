import { basename } from "node:path";
import { fileURLToPath } from "node:url";
import {
  test,
  expect,
  openFolder,
  visibleTerminal,
  terminalId,
} from "./fixtures/test.ts";

test(
  "CLIを並べ替え、選択肢から隠して戻す",
  { tag: "@desktop" },
  async ({ page, registeredApp: app }) => {
    const other = "scripted-other";
    const saved = await app.request("cli.definition.save", {
      definition: JSON.stringify({
        schema: 1,
        id: other,
        name: other,
        command: {
          shell: `'${process.execPath}' '${fileURLToPath(new URL("../../verification/host/scripted-cli.mjs", import.meta.url))}'`,
        },
      }),
    });
    expect(saved).toHaveProperty("cliId", other);
    await page.goto(app.url);
    await openFolder(page, app);
    await page
      .getByRole("button", { name: "AI Agents/Teams", exact: true })
      .click();
    const rows = page.locator(
      `[data-iori-cli-row="${app.cliId}"], [data-iori-cli-row="${other}"]`,
    );
    await expect(rows).toContainText([app.cliId, other]);
    const otherRow = page.locator(`[data-iori-cli-row="${other}"]`);
    await otherRow
      .getByRole("button", { name: `Drag to reorder ${other}` })
      .press("ArrowUp");
    await expect(rows).toContainText([other, app.cliId]);
    await otherRow
      .getByRole("button", { name: "CLI actions", exact: true })
      .click();
    await page
      .getByRole("menuitem", { name: "Hide from pickers", exact: true })
      .click();
    await page
      .getByRole("button", { name: basename(app.folder), exact: true })
      .click();
    await page.getByRole("button", { name: "New tab", exact: true }).click();
    await expect(
      page
        .getByRole("dialog")
        .getByRole("button", { name: other, exact: true }),
    ).toHaveCount(0);
    await page.keyboard.press("Escape");
    await page
      .getByRole("button", { name: "AI Agents/Teams", exact: true })
      .click();
    await page.getByRole("button", { name: "Hidden", exact: true }).click();
    await expect(otherRow).toBeVisible();
    await otherRow
      .getByRole("button", { name: "CLI actions", exact: true })
      .click();
    await page
      .getByRole("menuitem", { name: "Show in pickers", exact: true })
      .click();
    await expect(rows).toContainText([other, app.cliId]);
    await page
      .getByRole("button", { name: basename(app.folder), exact: true })
      .click();
    await page.getByRole("button", { name: "New tab", exact: true }).click();
    await expect(
      page
        .getByRole("dialog")
        .getByRole("button", { name: other, exact: true }),
    ).toBeVisible();
  },
);

test(
  "定義したCLIを一覧から開く",
  { tag: "@desktop" },
  async ({ page, registeredApp: app }) => {
    await page.goto(app.url);
    await openFolder(page, app);
    await page.getByRole("button", { name: "New tab", exact: true }).click();
    await page
      .getByRole("dialog")
      .getByRole("button", { name: app.cliId, exact: true })
      .click();
    const terminal = visibleTerminal(page);
    const id = await terminalId(terminal);
    await app.terminalText(id, "ACTOR_READY");
    await expect(
      page.locator(`[data-iori-tab-cli="${app.cliId}"]`),
    ).toBeVisible();
  },
);
