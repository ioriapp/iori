import { test, expect, visibleTerminal, terminalId } from "./fixtures/test.ts";
import { openPath } from "./fixtures/journeys.ts";

test(
  "ForgeのPRとCIの状態とIssueを表示しIssueから始める",
  { tag: "@desktop" },
  async ({ page, registeredApp: app }) => {
    const forge = await app.host.forge();
    await app.open(page);
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

test(
  "Issuesのラベル読み込み中は空表示を出さず取得完了後にラベルを表示する",
  { tag: "@desktop" },
  async ({ page, registeredApp: app }) => {
    const forge = await app.host.forge();
    await app.open(page);
    await openPath(page, forge.repository, app.hostKey);
    await app.faults.hold("forge.issues.labels");
    await page
      .locator(
        `[data-iori-action="repository-issues"][data-iori-repository-path="${forge.repository}"]`,
      )
      .click();
    await page.locator('[data-iori-action="issues-labels"]').click();
    const menu = page.getByRole("menu");
    await expect(menu).toBeVisible();
    await expect(menu).toContainText("Loading");
    await expect(menu).not.toContainText("There are no labels.");
    await app.faults.clear();
    await expect(
      menu.locator(
        '[data-iori-action="issues-label"][data-iori-label="agent-ready"]',
      ),
    ).toBeVisible();
    await expect(menu).not.toContainText("Loading");
  },
);
