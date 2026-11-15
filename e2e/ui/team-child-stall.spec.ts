import { createTeam } from "./fixtures/journeys.ts";
import {
  test,
  expect,
  openFolder,
  visibleTerminal,
  terminalId,
  sendLine,
} from "./fixtures/test.ts";

test.use({ hostEnvironment: { IORI_TEST_STALL_MS: "1200" } });

test(
  "作業中の子が止まるとBoardとサイドバーに応答なしと経過時間が出て再開で戻る",
  { tag: "@desktop" },
  async ({ page, registeredApp: app }) => {
    await createTeam(app, { name: "Stall team" });
    await app.open(page);
    await openFolder(page, app);
    await page.getByRole("button", { name: "New tab", exact: true }).click();
    await page
      .getByRole("dialog")
      .getByRole("button", { name: "Stall team", exact: true })
      .click();
    const parentId = await terminalId(visibleTerminal(page));
    await app.terminalText(parentId, "ACTOR_PROMPT:");

    await sendLine(
      visibleTerminal(page),
      JSON.stringify({
        id: "delegate",
        command: [
          "delegate",
          "--role",
          "Worker",
          "--difficulty",
          "medium",
          "--title",
          "Stalled task",
          "--worktree",
          "parent",
          "--body",
          "Work on this task.",
        ],
      }),
    );
    const delegation = await app.terminalText(
      parentId,
      /ACTOR_RESULT:delegate:.*\r?\n/,
    );
    expect(delegation).toContain('"ok":true');

    const childRow = page
      .locator("[data-iori-child-id]")
      .filter({ hasText: "Stalled task" });
    await expect(childRow).toBeVisible();
    const childId = (await childRow.getAttribute("data-iori-child-id"))!;

    await childRow.click();
    const childTerminalId = await terminalId(visibleTerminal(page));
    await app.terminalText(childTerminalId, "ACTOR_PROMPT:");
    await sendLine(
      visibleTerminal(page),
      JSON.stringify({ id: "work", hook: "UserPromptSubmit" }),
    );
    await app.terminalText(childTerminalId, "ACTOR_HOOK:work");

    await page.getByRole("button", { name: "New tab", exact: true }).click();
    await page.locator('[data-iori-action="workspace-open-board"]').click();
    const boardAgent = page.locator(`[data-iori-board-agent="${childId}"]`);
    await expect(boardAgent).toBeVisible();

    await expect(boardAgent).toContainText(/Not responding · \d+[smh]/);
    await expect(childRow).toContainText(/Not responding · \d+[smh]/);

    await app.input(
      childTerminalId,
      JSON.stringify({ id: "resume", hook: "UserPromptSubmit" }) + "\r",
    );
    await expect(boardAgent).toContainText("Running");
    await expect(boardAgent).not.toContainText("Not responding");
    await expect(childRow).toContainText("Running");
    await expect(childRow).not.toContainText("Not responding");
  },
);
