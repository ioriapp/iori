import {
  test,
  expect,
  openFolder,
  visibleTerminal,
  terminalId,
} from "./fixtures/test.ts";

test(
  "スマホの一覧から会話へ移り入力して戻りドロワーからホームへ移動する",
  { tag: "@phone" },
  async ({ page, registeredApp: app }) => {
    const candidate = {
      id: "scripted",
      cli: app.cliId,
      model: "",
      tools: [],
      minimum: "",
    };
    const { saved } = await app.request("teams.create", {
      definition: {
        name: "Mobile team",
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
    await openFolder(page, app, true);
    await page.getByRole("button", { name: "New tab", exact: true }).tap();
    await page
      .getByRole("dialog")
      .getByRole("button", { name: "Mobile team", exact: true })
      .tap();
    const id = await terminalId(visibleTerminal(page));
    await app.terminalText(id, "ACTOR_PROMPT:");
    await page.getByRole("button", { name: "Open sidebar", exact: true }).tap();
    await page.getByRole("button", { name: "Home", exact: true }).tap();
    await page.locator("[data-iori-board-worktree]").tap();
    await page
      .getByRole("button", { name: "Open conversation", exact: true })
      .tap();
    await expect(visibleTerminal(page)).toHaveAttribute(
      "data-iori-terminal-id",
      id,
    );
    await page
      .getByRole("textbox", { name: "Type a command…", exact: true })
      .fill(
        JSON.stringify({ id: "mobile-navigation", hook: "UserPromptSubmit" }),
      );
    await page.getByRole("button", { name: "Send", exact: true }).tap();
    await app.terminalText(id, "ACTOR_HOOK:mobile-navigation");
    await page.keyboard.press("Alt+ArrowLeft");
    await expect(page.locator('[data-iori-view="board"]')).toBeVisible();
    await page.keyboard.press("Alt+ArrowLeft");
    await expect(page.locator('[data-iori-view="mobile-home"]')).toBeVisible();
    await page.locator("[data-iori-board-worktree]").tap();
    await page.getByRole("button", { name: "Open sidebar", exact: true }).tap();
    await page.getByRole("button", { name: "Home", exact: true }).tap();
    await expect(page.locator('[data-iori-view="mobile-home"]')).toBeVisible();
  },
);
