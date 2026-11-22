import { join } from "node:path";
import { createTeam, launch } from "./fixtures/journeys.ts";
import {
  test,
  expect,
  openFolder,
  visibleTerminal,
  terminalId,
  type App,
} from "./fixtures/test.ts";
import { repository } from "./support/reading.ts";

async function addKeyboardCli(app: App) {
  const cli = "Keyboard fixture";
  const file = "keyboard-fixture.mjs";
  await app.files({
    [file]: `
      process.stdout.write("\\x1b]2;Review sprint\\x07");
      process.stdin.setRawMode(true);
      process.stdin.on("data", (bytes) => {
        for (const byte of bytes) console.log("KEY:" + byte.toString(16));
      });
      console.log("KEYBOARD_READY");
    `,
  });
  await app.request("cli.definition.save", {
    definition: JSON.stringify({
      schema: 1,
      id: "keyboard-fixture",
      name: cli,
      command: { shell: `'${process.execPath}' '${join(app.folder, file)}'` },
    }),
  });
  return cli;
}

test(
  "最大化したCLIでEscとCtrl+Kを入力できる",
  { tag: "@desktop" },
  async ({ page, registeredApp: app }) => {
    const cli = await addKeyboardCli(app);
    await app.open(page);
    await openFolder(page, app);
    await launch(page, cli);
    const terminal = visibleTerminal(page);
    const id = await terminalId(terminal);
    await app.terminalText(id, "KEYBOARD_READY");
    await page.getByRole("button", { name: "Maximize", exact: true }).click();
    const restore = page.locator('[data-iori-action="workspace-restore"]');
    await expect(restore).toBeVisible();
    const input = terminal.getByRole("textbox");
    await input.press("Control+Shift+F");
    const find = terminal.getByRole("textbox", {
      name: "Search terminal output",
    });
    await find.press("Escape");
    await expect(find).toBeHidden();
    await expect(restore).toBeVisible();

    await input.press("Control+k");
    await input.press("Escape");
    await app.terminalText(id, "KEY:b");
    await app.terminalText(id, "KEY:1b");
    await expect(restore).toBeVisible();
    await restore.press("Escape");
    await expect(restore).toBeHidden();
  },
);

test(
  "サイドバーで会話の名前とCLIの名前から絞り込む",
  { tag: "@desktop" },
  async ({ page, registeredApp: app }) => {
    const cli = await addKeyboardCli(app);
    await app.open(page);
    await openFolder(page, app);
    await launch(page, cli);
    const row = page.getByRole("button", {
      name: "Review sprint",
      exact: true,
    });
    await expect(row).toBeVisible();
    const search = page.getByRole("textbox", { name: "Search", exact: true });
    await search.fill("review sprint");
    await expect(row).toBeVisible();
    await search.fill("keyboard fixture");
    await expect(row).toBeVisible();
    await search.fill("unmatched search");
    await expect(row).toBeHidden();
  },
);

test(
  "タブを分割して最大化し再読込後も配置を保つ",
  { tag: "@desktop" },
  async ({ page, registeredApp: app }) => {
    await app.open(page);
    await openFolder(page, app);
    await page.getByRole("button", { name: "New tab", exact: true }).click();
    await page
      .getByRole("dialog")
      .getByRole("button", { name: app.cliId, exact: true })
      .click();
    await page
      .getByRole("button", { name: "Split right", exact: true })
      .click();
    await page.getByRole("button", { name: "Bash", exact: true }).click();
    await expect(page.locator('[data-iori-tab-kind="files"]')).toBeVisible();
    await page
      .getByRole("region", { name: "Bash" })
      .getByRole("button", { name: "Maximize", exact: true })
      .click();
    await expect(
      page.locator('[data-iori-action="workspace-restore"]'),
    ).toBeVisible();
    await page.locator('[data-iori-action="workspace-restore"]').click();
    await page.reload();
    await expect(page.locator('[data-iori-tab-kind="files"]')).toBeVisible();
    await expect(
      page.locator(`[data-iori-tab-cli="${app.cliId}"]`),
    ).toBeVisible();
    await expect(page.getByRole("region", { name: "Bash" })).toBeVisible();
    await expect(page.getByRole("region", { name: app.cliId })).toBeVisible();
  },
);

test(
  "GitとBoardのタブを開き再読込後も表示する",
  { tag: "@desktop" },
  async ({ page, registeredApp: app }) => {
    await repository(app.folder);
    await createTeam(app, { name: "Tab team", roles: [] });
    await app.open(page);
    await openFolder(page, app);
    await page.getByRole("button", { name: "New tab", exact: true }).click();
    await page
      .getByRole("dialog")
      .getByRole("button", { name: "Tab team", exact: true })
      .click();
    const id = await terminalId(visibleTerminal(page));
    await app.terminalText(id, "ACTOR_READY");
    const git = page.locator('[data-iori-tab-kind="git"]');
    await git.click();
    await expect(git).toHaveAttribute("data-state", "active");
    const board = page.locator('[data-iori-tab-kind="board"]');
    await board.click();
    await expect(board).toHaveAttribute("data-state", "active");
    await page.reload();
    await expect(git).toBeVisible();
    await expect(board).toBeVisible();
    await board.click();
    await expect(board).toHaveAttribute("data-state", "active");
    await git.click();
    await expect(git).toHaveAttribute("data-state", "active");
  },
);

test(
  "複数タブのペインが単一のtablistとaria-selectedを持つ",
  { tag: "@desktop" },
  async ({ page, registeredApp: app }) => {
    await repository(app.folder);
    await app.open(page);
    await openFolder(page, app);
    const tablists = page.getByRole("tablist", {
      name: "Open tabs",
      exact: true,
    });
    await expect(tablists).toHaveCount(1);
    const tabs = tablists.first().getByRole("tab");
    await expect(tabs).toHaveCount(3);
    const startTab = tabs.filter({ hasText: "Start" });
    const filesTab = tabs.filter({ hasText: "Files" });
    const gitTab = tabs.filter({ hasText: "Git" });
    await expect(startTab).toHaveAttribute("aria-selected", "true");
    await expect(startTab).toHaveAttribute("tabindex", "0");
    await expect(filesTab).toHaveAttribute("aria-selected", "false");
    await expect(filesTab).toHaveAttribute("tabindex", "-1");
    await expect(gitTab).toHaveAttribute("aria-selected", "false");
    await expect(gitTab).toHaveAttribute("tabindex", "-1");

    await filesTab.click();
    await expect(filesTab).toHaveAttribute("aria-selected", "true");
    await expect(filesTab).toHaveAttribute("tabindex", "0");
    await expect(startTab).toHaveAttribute("aria-selected", "false");

    await filesTab.press("ArrowRight");
    await expect(gitTab).toHaveAttribute("aria-selected", "true");
    await expect(gitTab).toBeFocused();
  },
);
