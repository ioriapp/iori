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
  "BoardのPlanは状態順に並べ、同じ状態では計画の順を保つ",
  { tag: "@desktop" },
  async ({ page, registeredApp: app }) => {
    await createTeam(app, { name: "Board plan team" });
    await app.open(page);
    await openFolder(page, app);
    await page.getByRole("button", { name: "New tab", exact: true }).click();
    await page
      .getByRole("dialog")
      .getByRole("button", { name: "Board plan team", exact: true })
      .click();
    const terminal = visibleTerminal(page);
    const parentId = await terminalId(terminal);
    await app.terminalText(parentId, "ACTOR_PROMPT:");

    const commands = [
      ["add-follow-up", "add", "--title", "Review the result"],
      ["add-verification", "add", "--title", "Check the requirements"],
      ["add-implementation", "add", "--title", "Implement the change"],
      ["add-notes", "add", "--title", "Write the release notes", "--first"],
      ["finish-verification", "update", "2", "--state", "done"],
      ["start-implementation", "update", "3", "--state", "in_progress"],
    ];
    for (const [id, ...args] of commands) {
      await sendLine(
        terminal,
        JSON.stringify({ id, command: ["plan", ...args] }),
      );
      const result = await app.terminalText(
        parentId,
        new RegExp(`ACTOR_RESULT:${id}:.*\\r?\\n`),
      );
      expect(result).toContain('"ok":true');
    }

    await page.getByRole("button", { name: "New tab", exact: true }).click();
    await page.locator('[data-iori-action="workspace-open-board"]').click();
    await expect(page.locator("[data-iori-plan-task]")).toContainText([
      "Check the requirements",
      "Implement the change",
      "Write the release notes",
      "Review the result",
    ]);
  },
);
