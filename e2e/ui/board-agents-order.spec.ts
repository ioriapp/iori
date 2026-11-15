import { createTeam } from "./fixtures/journeys.ts";
import {
  test,
  expect,
  openFolder,
  visibleTerminal,
  terminalId,
  sendLine,
} from "./fixtures/test.ts";

test(
  "BoardのAgentsは状態が変わっても委譲した順を保つ",
  { tag: "@desktop" },
  async ({ page, registeredApp: app }) => {
    await createTeam(app, { name: "Board order team" });
    await app.open(page);
    await openFolder(page, app);
    await page.getByRole("button", { name: "New tab", exact: true }).click();
    await page
      .getByRole("dialog")
      .getByRole("button", { name: "Board order team", exact: true })
      .click();
    const parentId = await terminalId(visibleTerminal(page));
    await app.terminalText(parentId, "ACTOR_PROMPT:");

    for (const [id, title] of [
      ["first", "First task"],
      ["second", "Second task"],
    ]) {
      await sendLine(
        visibleTerminal(page),
        JSON.stringify({
          id,
          command: [
            "delegate",
            "--role",
            "Worker",
            "--difficulty",
            "medium",
            "--title",
            title,
            "--worktree",
            "parent",
            "--body",
            "Work on this task.",
          ],
        }),
      );
      const result = await app.terminalText(
        parentId,
        new RegExp(`ACTOR_RESULT:${id}:.*\\r?\\n`),
      );
      expect(result).toContain('"ok":true');
    }

    const firstRow = page
      .locator("[data-iori-child-id]")
      .filter({ hasText: "First task" });
    const secondRow = page
      .locator("[data-iori-child-id]")
      .filter({ hasText: "Second task" });
    await expect(firstRow).toBeVisible();
    await expect(secondRow).toBeVisible();
    const secondChildId = (await secondRow.getAttribute("data-iori-child-id"))!;

    await page.getByRole("button", { name: "New tab", exact: true }).click();
    await page.locator('[data-iori-action="workspace-open-board"]').click();
    const agentRows = page.locator("[data-iori-board-agent]");
    await expect(agentRows).toContainText(["First task", "Second task"]);

    await secondRow.click();
    const secondTerminalId = await terminalId(visibleTerminal(page));
    await app.terminalText(secondTerminalId, "ACTOR_PROMPT:");
    await sendLine(
      visibleTerminal(page),
      JSON.stringify({
        id: "report",
        command: ["report", "--body", "SECOND_REPORT_DONE"],
      }),
    );
    await app.terminalText(secondTerminalId, "ACTOR_RESULT:report:");

    await page.locator('[data-iori-tab-kind="board"]').click();
    await expect(
      page.locator(`[data-iori-board-agent="${secondChildId}"]`),
    ).toContainText("Reported");
    await expect(agentRows).toContainText(["First task", "Second task"]);
  },
);
