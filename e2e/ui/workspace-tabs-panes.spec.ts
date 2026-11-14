import {
  test,
  expect,
  openFolder,
  visibleTerminal,
  terminalId,
} from "./fixtures/test.ts";
import { repository } from "./support/reading.ts";

test(
  "タブを分割して最大化し再読込後も配置を保つ",
  { tag: "@desktop" },
  async ({ page, registeredApp: app }) => {
    await page.goto(app.url);
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
    const candidate = {
      id: "scripted",
      cli: app.cliId,
      model: "",
      tools: [],
      minimum: "",
    };
    const { saved } = await app.request("teams.create", {
      definition: {
        name: "Tab team",
        description: "",
        instruction: "",
        parent: { ...candidate, id: "parent" },
        roles: [],
      },
    });
    await app.request("teams.settings", {
      enabled: true,
      defaultTeam: saved.id,
      limits: {},
    });
    await page.goto(app.url);
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
