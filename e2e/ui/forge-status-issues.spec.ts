import { test, expect, visibleTerminal, terminalId } from "./fixtures/test.ts";
import { openPath } from "./fixtures/journeys.ts";

test(
  "ForgeのPRとCIの状態とIssueを表示しIssueから始める",
  { tag: "@desktop" },
  async ({ page, registeredApp: app }) => {
    const forge = await app.host.forge();
    await page.goto(app.url);
    await openPath(page, forge.repository, app.hostKey);
    await expect(
      page.getByRole("button", { name: "CI failed", exact: true }),
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Pull request #5 open", exact: true }),
    ).toBeVisible();
    await page
      .locator(
        `[data-iori-action="repository-issues"][data-iori-repository-path="${forge.repository}"]`,
      )
      .click();
    await page.locator('[data-iori-issue="3"]').click();
    await expect(page.locator('[data-iori-part="issue-body"]')).toContainText(
      "Issue body",
    );
    await page.locator('[data-iori-action="issue-start"]').click();
    await page
      .getByRole("dialog")
      .getByRole("button", { name: "Here (without a worktree)", exact: true })
      .click();
    const id = await terminalId(visibleTerminal(page));
    await app.terminalText(id, "ACTOR_PROMPT:");
    await expect(visibleTerminal(page)).toHaveAttribute(
      "data-iori-host-key",
      app.hostKey,
    );
  },
);
