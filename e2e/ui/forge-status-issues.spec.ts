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

test(
  "CIログの検索・エラー移動・PC折返し・file:lineからFiles起動・他worktreeのAgentへの失敗送信を行える",
  { tag: "@desktop" },
  async ({ page, registeredApp: app }) => {
    const forge = await app.host.forge({
      log: [
        "setup step output",
        "##[error]base.txt:1: assertion failed in build",
        "trailing summary line",
      ].join("\n"),
    });
    const cliList = await app.request("cli.list", {});
    const launched = await app.request("cli.launch", {
      cwd: forge.worktree,
      cliId: cliList.clis[0]!.id,
    });
    await app.open(page);
    await openPath(page, forge.repository, app.hostKey);

    const ciButton = page.getByRole("button", {
      name: "CI failed",
      exact: true,
    });
    await expect(ciButton).toBeVisible();
    await ciButton.click();

    const ciLog = page.locator('[data-iori-view="ci-log"]');
    await expect(ciLog).toBeVisible();
    await expect(ciLog).toContainText("assertion failed in build");

    // PC wrap toggle works on desktop.
    const wrapButton = page.locator('[data-iori-action="ci-log-wrap"]');
    await expect(wrapButton).toBeVisible();
    await wrapButton.click();
    await expect(ciLog).toHaveAttribute("data-wrap", "true");

    // Error jump bar shows the error count and allows jumping.
    await expect(
      page.locator('[data-iori-part="ci-log-error-count"]'),
    ).toHaveText("1");
    await page.locator('[data-iori-action="ci-log-next-error"]').click();
    await expect(
      page.locator('[data-iori-part="ci-log-error-count"]'),
    ).toHaveText("1/1");

    // Log search highlights matches and counts them.
    await page.locator('[data-iori-action="ci-log-find"]').click();
    await page
      .locator('[data-iori-field="ci-log-find-input"]')
      .fill("assertion");
    await expect(
      page.locator('[data-iori-part="ci-log-find-count"]'),
    ).toHaveText("1/1");
    await expect(
      ciLog.locator('[data-iori-part="search-current"]'),
    ).toBeVisible();

    // Clicking a workspace-relative file:line link opens the file in Files View.
    await ciLog
      .locator('[data-iori-action="ci-log-file-link"][data-path="base.txt"]')
      .click();
    await expect(page.locator('[data-iori-view="files"]')).toBeVisible();
    await expect(page.locator('[data-iori-tab="base.txt"]')).toBeVisible();

    // Return to main's CI tab (no CLI on main) and send failure to feature worktree's CLI.
    await ciButton.click();
    const sendButton = page.locator(
      '[data-iori-action="ci-send-failure-to-agent"]',
    );
    await expect(sendButton).toBeEnabled();
    await sendButton.click();

    await expect(
      page.locator("[data-iori-current-worktree-path]"),
    ).toHaveAttribute("data-iori-current-worktree-path", forge.worktree);
    await expect(visibleTerminal(page)).toHaveAttribute(
      "data-iori-terminal-id",
      launched.terminal.id,
    );
    await expect(visibleTerminal(page)).toHaveAttribute(
      "data-iori-stream-state",
      "ready",
    );
    // Text is inserted without Enter; pressing Enter submits the buffered CI failure prompt.
    await app.input(launched.terminal.id, "\r");
    await app.terminalText(
      launched.terminal.id,
      /ACTOR_INPUT:.*iori ci log 9/u,
    );
  },
);

test(
  "サイドバーのPRアイコンからPR詳細を開き、変更ファイルからGitブランチ差分へ遷移し、レビューコメントをEnter無しでAgentへ送信できる",
  { tag: "@desktop" },
  async ({ page, registeredApp: app }) => {
    const forge = await app.host.forge({ pr: "detail" });
    const cliList = await app.request("cli.list", {});
    const launched = await app.request("cli.launch", {
      cwd: forge.worktree,
      cliId: cliList.clis[0]!.id,
    });
    await app.open(page);
    await openPath(page, forge.repository, app.hostKey);

    const prButton = page.getByRole("button", {
      name: "Pull request #5 open",
      exact: true,
    });
    await expect(prButton).toBeVisible();
    await prButton.click();

    const prDetail = page.locator('[data-iori-part="pr-detail"]');
    await expect(prDetail).toBeVisible();
    await expect(prDetail).toContainText("Improve feature flow");
    await expect(prDetail).toContainText("PR summary body");
    await expect(prDetail).toContainText("enhancement");
    await expect(
      prDetail.locator('[data-iori-part="pr-ci-summary"]'),
    ).toBeVisible();

    // Changed files tab opens Git View in branch diff for the PR's base branch.
    await prDetail.getByRole("tab", { name: /Files/u }).click();
    await page
      .locator('[data-iori-action="pr-file-open"][data-path="base.txt"]')
      .click();
    await expect(page.locator('[data-iori-view="git"]')).toBeVisible();
    await expect(page.locator('[data-iori-view="git"]')).toContainText(
      "feature change",
    );

    // Return to PR detail via sidebar mark and send inline review comment to Agent without Enter.
    await prButton.click();
    await expect(prDetail).toBeVisible();
    await prDetail.getByRole("tab", { name: /Comments/u }).click();
    await expect(page.locator('[data-iori-part="pr-comments"]')).toContainText(
      "Please guard edge case here.",
    );
    await page
      .locator('[data-iori-part="pr-comments"] article', {
        hasText: "Please guard edge case here.",
      })
      .locator('[data-iori-action="pr-comment-send"]')
      .click();

    await expect(visibleTerminal(page)).toHaveAttribute(
      "data-iori-terminal-id",
      launched.terminal.id,
    );
    await expect(visibleTerminal(page)).toHaveAttribute(
      "data-iori-stream-state",
      "ready",
    );
    await app.input(launched.terminal.id, "\r");
    const terminalOutput = await app.terminalText(
      launched.terminal.id,
      /ACTOR_INPUT:/u,
    );
    const normalized = terminalOutput.replace(/\s+/gu, " ");
    expect(normalized).toContain("PR #5: Improve feature flow");
    expect(normalized).toContain("base.txt:2");
    expect(normalized).toContain("Please guard edge case here.");
  },
);

test(
  "開いているPRが無いブランチでは既定DraftオンのPR作成フォームからPRを作成して詳細を表示できる",
  { tag: "@desktop" },
  async ({ page, registeredApp: app }) => {
    const forge = await app.host.forge({ pr: "create" });
    await app.open(page);
    await openPath(page, forge.repository, app.hostKey);

    // Select the unpushed feature worktree and open PR / CI from the New tab menu.
    await page.getByRole("button", { name: "feature", exact: true }).click();
    await expect(
      page.locator("[data-iori-current-worktree-path]"),
    ).toHaveAttribute("data-iori-current-worktree-path", forge.worktree);
    await page.locator('[data-iori-action="workspace-add-tab"]').click();
    await page.locator('[data-iori-action="workspace-open-ci"]').click();
    await page.locator('[data-iori-action="ci-section-pr"]').click();

    const createForm = page.locator('[data-iori-part="pr-create-form"]');
    await expect(createForm).toBeVisible();
    await expect(
      createForm.locator('[data-iori-action="pr-create-draft"]'),
    ).toHaveAttribute("aria-checked", "true");

    await createForm
      .locator('[data-iori-field="pr-create-title"]')
      .fill("Add PR UI");
    await createForm.locator('[data-iori-action="pr-create-submit"]').click();

    const prDetail = page.locator('[data-iori-part="pr-detail"]');
    await expect(prDetail).toBeVisible();
    await expect(prDetail).toContainText("#42");
    await expect(prDetail).toContainText("Draft");
  },
);
