import { createTeam } from "./fixtures/journeys.ts";
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
    await createTeam(app, { name: "Mobile team", roles: [] });
    await app.open(page);
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
    await app.back(page);
    await expect(page.locator('[data-iori-view="board"]')).toBeVisible();
    await app.back(page);
    await expect(page.locator('[data-iori-view="mobile-home"]')).toBeVisible();
    await page.locator("[data-iori-board-worktree]").tap();
    await page.getByRole("button", { name: "Open sidebar", exact: true }).tap();
    await page.getByRole("button", { name: "Home", exact: true }).tap();
    await expect(page.locator('[data-iori-view="mobile-home"]')).toBeVisible();
  },
);

test(
  "モバイルドロワーのworktree行を1タップすると直ちにそのworktreeへ遷移してドロワーが閉じる",
  { tag: "@phone" },
  async ({ page, registeredApp: app }) => {
    await app.open(page);
    await openFolder(page, app, true);
    await page.getByRole("button", { name: "Open sidebar", exact: true }).tap();
    await page.getByRole("button", { name: "Home", exact: true }).tap();
    await expect(page.locator('[data-iori-view="mobile-home"]')).toBeVisible();
    await page.getByRole("button", { name: "Open sidebar", exact: true }).tap();
    const worktreeButton = page.locator(
      `[data-iori-worktree-path=${JSON.stringify(app.folder)}]`,
    );
    await expect(worktreeButton).toBeVisible();
    await worktreeButton.tap();
    await expect(
      page.locator('[data-iori-part="mobile-location"]'),
    ).toBeVisible();
    await expect(
      page.locator('[data-slot="sidebar"][data-mobile="true"]'),
    ).toBeHidden();
  },
);

test(
  "スマホの上部View切替バーとセッション切替で複数セッションを行き来できる",
  { tag: "@phone" },
  async ({ page, registeredApp: app }) => {
    await app.open(page);
    await openFolder(page, app, true);

    await page.getByRole("button", { name: "New tab", exact: true }).tap();
    await page
      .getByRole("dialog")
      .getByRole("button", { name: "Bash", exact: true })
      .tap();
    const firstId = await terminalId(visibleTerminal(page));
    await expect(
      page.locator('[data-iori-action="mobile-session-switch"]'),
    ).toHaveCount(0);

    await page.locator('[data-iori-mobile-view-tab="files"]').tap();
    await expect(page.locator('[data-iori-view="files"]')).toBeVisible();

    await page.locator('[data-iori-mobile-view-tab="terminal"]').tap();
    await expect(visibleTerminal(page)).toHaveAttribute(
      "data-iori-terminal-id",
      firstId,
    );

    await page.getByRole("button", { name: "New tab", exact: true }).tap();
    await page
      .getByRole("dialog")
      .getByRole("button", { name: "Bash", exact: true })
      .tap();
    const secondId = await terminalId(visibleTerminal(page));
    expect(secondId).not.toBe(firstId);

    const switcher = page.locator('[data-iori-action="mobile-session-switch"]');
    await expect(switcher).toBeVisible();
    await switcher.tap();
    await page.locator(`[data-iori-mobile-session="${firstId}"]`).tap();
    await expect(visibleTerminal(page)).toHaveAttribute(
      "data-iori-terminal-id",
      firstId,
    );
  },
);
