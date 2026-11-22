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
  "チームで子へ委譲し報告後にタブを閉じても結果が残る",
  { tag: "@desktop" },
  async ({ page, registeredApp: app }) => {
    await createTeam(app, { name: "Scripted team" });
    await app.open(page);
    await openFolder(page, app);
    await page.getByRole("button", { name: "New tab", exact: true }).click();
    await page
      .getByRole("dialog")
      .getByRole("button", { name: "Scripted team", exact: true })
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
          "UI result",
          "--worktree",
          "parent",
          "--body",
          "Report the result.",
        ],
      }),
    );
    const delegation = await app.terminalText(
      parentId,
      /ACTOR_RESULT:delegate:.*\r?\n/,
    );
    expect(delegation).toContain('"ok":true');
    const acceptedPrompts = (delegation.match(/ACTOR_PROMPT:/g) ?? []).length;
    const childRow = page
      .locator("[data-iori-child-id]")
      .filter({ hasText: "UI result" });
    await expect(childRow).toBeVisible();
    const childId = (await childRow.getAttribute("data-iori-child-id"))!;
    await childRow.click();
    const childTerminalId = await terminalId(visibleTerminal(page));
    await app.terminalText(childTerminalId, "ACTOR_PROMPT:");
    await page.getByRole("button", { name: "New tab", exact: true }).click();
    await page.locator('[data-iori-action="workspace-open-board"]').click();
    const result = page.locator(`[data-iori-board-agent="${childId}"]`);
    await expect(result).toContainText("Running");
    await expect(result).not.toContainText("Orchestrator:");
    await childRow.click();
    await expect(visibleTerminal(page)).toHaveAttribute(
      "data-iori-terminal-id",
      childTerminalId,
    );
    await sendLine(
      visibleTerminal(page),
      JSON.stringify({
        id: "report",
        command: ["report", "--body", "UI_REPORT_COMPLETE"],
      }),
    );
    await app.terminalText(childTerminalId, "ACTOR_RESULT:report:");
    await page.locator(`[data-iori-terminal-row="${parentId}"]`).click();
    await app.terminalText(
      parentId,
      new RegExp(`(?:ACTOR_PROMPT:[\\s\\S]*?){${acceptedPrompts + 1}}`),
    );
    await sendLine(
      visibleTerminal(page),
      JSON.stringify({ id: "read", command: ["read", childId] }),
    );
    await app.terminalText(parentId, "UI_REPORT_COMPLETE");
    await page.locator('[data-iori-tab-kind="board"]').click();
    await expect(result).toContainText("Reported");
    await expect(result).toContainText("Orchestrator: Pending");
    await page
      .getByRole("button", { name: "Worker · UI result Close", exact: true })
      .click();
    await expect(result).toContainText("Reported");
    await expect(childRow).toBeVisible();
    await expect(
      page.getByRole("tab", { name: "Worker · UI result", exact: true }),
    ).toHaveCount(0);
    await expect(result).toContainText("Orchestrator: Pending");
    await childRow.click();
    await expect(visibleTerminal(page)).toHaveAttribute(
      "data-iori-terminal-id",
      childTerminalId,
    );
    await app.terminalText(childTerminalId, "ACTOR_RESULT:report:");
  },
);
