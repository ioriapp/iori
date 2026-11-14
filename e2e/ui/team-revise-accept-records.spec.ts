import {
  test,
  expect,
  openFolder,
  visibleTerminal,
  terminalId,
} from "./fixtures/test.ts";

test(
  "差し戻して受け入れたタスクの経緯をRecordsで見返す",
  { tag: "@desktop" },
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
        name: "Records team",
        description: "",
        instruction: "",
        parent: { ...candidate, id: "parent" },
        roles: [
          {
            id: "worker",
            name: "Worker",
            when: "",
            limit: "",
            reuse: true,
            split: false,
            instruction: "",
            request: "",
            report: "",
            candidates: { high: [], medium: [candidate], low: [] },
          },
        ],
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
      .getByRole("button", { name: "Records team", exact: true })
      .click();
    const parent = await terminalId(visibleTerminal(page));
    await app.terminalText(parent, "ACTOR_PROMPT:");
    const command = async (terminal: string, id: string, args: string[]) => {
      await app.input(terminal, JSON.stringify({ id, command: args }) + "\r");
      await app.terminalText(
        terminal,
        new RegExp(`ACTOR_RESULT:${id}:.*"ok":true`),
      );
    };
    await command(parent, "delegate", [
      "delegate",
      "--role",
      "Worker",
      "--difficulty",
      "medium",
      "--title",
      "Review work",
      "--worktree",
      "parent",
      "--body",
      "Do the work.",
    ]);
    const row = page
      .locator("[data-iori-child-id]")
      .filter({ hasText: "Review work" });
    await expect(row).toBeVisible();
    const childId = (await row.getAttribute("data-iori-child-id"))!;
    await row.getByRole("button").first().click();
    const child = await terminalId(visibleTerminal(page));
    await app.terminalText(child, "ACTOR_PROMPT:");
    await command(child, "report", ["report", "--body", "First report"]);
    await page.locator(`[data-iori-terminal-row="${parent}"]`).click();
    await command(parent, "revise", [
      "send",
      childId,
      "--kind",
      "revise",
      "--body",
      "Check again",
    ]);
    await row.getByRole("button").first().click();
    await app.terminalText(child, /(?:ACTOR_PROMPT:[\s\S]*?){2}/);
    await command(child, "report-again", ["report", "--body", "Checked again"]);
    await page.locator(`[data-iori-terminal-row="${parent}"]`).click();
    await command(parent, "accept", [
      "finish",
      childId,
      "--decision",
      "accept",
      "--reason",
      "Verified",
      "--worktree",
      "keep",
    ]);
    await page
      .getByRole("button", { name: "AI Agents/Teams", exact: true })
      .click();
    await page.getByRole("button", { name: "Records", exact: true }).click();
    await page
      .getByRole("table", { name: "Worker", exact: true })
      .getByRole("button", { name: new RegExp(app.cliId) })
      .click();
    const task = page.getByRole("button", { name: /Review work/ });
    await expect(task).toContainText("Accepted");
    await task.click();
    await expect(
      page.locator('[data-iori-view="record-task-list"]'),
    ).toContainText("Check again");
    await expect(
      page.locator('[data-iori-view="record-task-list"]'),
    ).toContainText("Verified");
  },
);
