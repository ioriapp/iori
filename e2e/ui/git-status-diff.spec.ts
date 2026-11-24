import type { Page } from "@playwright/test";
import type { App } from "./fixtures/test.ts";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test, expect } from "./fixtures/test.ts";
import { git, openReading, repository } from "./support/reading.ts";

type Args = { page: Page; registeredApp: App };

function gitJourney(mobile: boolean) {
  return async ({ page, registeredApp: app }: Args) => {
    await repository(app.folder);
    await writeFile(join(app.folder, "notes.md"), "# Changed notes\n");
    await writeFile(
      join(app.folder, "image.png"),
      Buffer.from(
        "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADElEQVR4nGNgYPgPAAEDAQAIicLsAAAAAElFTkSuQmCC",
        "base64",
      ),
    );
    await openReading(page, app, mobile, "git");
    const changed = page.getByRole("button", { name: /notes\.md/ });
    await expect(changed.getByRole("img", { name: "Modified" })).toBeVisible();
    await changed.click();
    await expect(page.locator('[data-iori-scroll="git-diff"]')).toContainText(
      "Changed notes",
    );
    if (mobile) await app.back(page);
    await page.getByRole("button", { name: /image\.png/ }).click();
    await expect(
      page.getByRole("img", { name: "Before image.png" }),
    ).toBeVisible();
    await expect(
      page.getByRole("img", { name: "After image.png" }),
    ).toBeVisible();
    if (mobile) await app.back(page);
    await page.getByRole("tab", { name: "History" }).click();
    await page.getByRole("button", { name: /Initial notes/ }).click();
    await expect(
      page.locator('[data-iori-part="commit-header"]'),
    ).toContainText("Initial notes");
  };
}

test(
  "Gitの状態、差分、画像の差分、履歴を見る",
  { tag: "@desktop" },
  gitJourney(false),
);
test(
  "スマホでGitの状態、差分、画像の差分、履歴を見る",
  { tag: "@phone" },
  gitJourney(true),
);

test(
  "Gitでブランチ全体差分・ツリー表示・確認済み・構文色分け・並べて表示・行コメント・Filesで開くを使える",
  { tag: "@desktop" },
  async ({ page, registeredApp: app }) => {
    await repository(app.folder);
    git(app.folder, "checkout", "-b", "feature");
    await mkdir(join(app.folder, "src"));
    await writeFile(
      join(app.folder, "src", "app.ts"),
      "export const answer: number = 42;\nexport function greet(name: string) {\n  return name;\n}\n",
    );
    git(app.folder, "add", "src/app.ts");
    git(app.folder, "commit", "-m", "Add app.ts");
    await writeFile(join(app.folder, "notes.md"), "# Feature branch notes\n");

    await openReading(page, app, false, "git");
    await page.locator('[data-iori-action="git-scope-branch"]').click();
    await expect(
      page.locator(
        '[data-iori-action="git-change-select"][data-path="src/app.ts"]',
      ),
    ).toBeVisible();
    await expect(
      page.locator(
        '[data-iori-action="git-change-select"][data-path="notes.md"]',
      ),
    ).toBeVisible();

    await page.locator('[data-iori-action="git-changes-layout"]').click();
    await expect(
      page.locator('[data-iori-action="git-tree-folder"]', { hasText: "src" }),
    ).toBeVisible();

    await page
      .locator('[data-iori-action="git-change-select"][data-path="src/app.ts"]')
      .click();
    const unifiedDiff = page.locator('[data-iori-scroll="git-diff"]');
    await expect(unifiedDiff).toContainText("answer");
    await expect(unifiedDiff.locator("[data-syntax]").first()).toBeVisible();

    await page.locator('[data-iori-action="git-diff-viewed"]').click();
    await expect(
      page.locator('[data-iori-action="git-diff-viewed"]'),
    ).toHaveAttribute("aria-pressed", "true");
    await expect(
      page.locator('[data-iori-part="git-viewed-count"]'),
    ).toHaveText("1/2");

    await page.locator('[data-iori-action="git-diff-split"]').click();
    const splitDiff = page.locator('[data-iori-view="git-diff-split"]');
    await expect(splitDiff).toBeVisible();
    await expect(splitDiff).toContainText("answer");

    const addComment = splitDiff
      .locator('[data-iori-action="diff-add-comment"]')
      .first();
    await addComment.hover();
    await addComment.click();
    await page
      .locator('[data-iori-field="diff-comment-input"]')
      .fill("Rename answer to result");
    await page.locator('[data-iori-action="diff-comment-save"]').click();
    await expect(
      page.locator('[data-iori-part="diff-comments-bar"]'),
    ).toBeVisible();

    await page
      .locator(
        '[data-iori-part="diff-header"] [data-iori-action="git-open-in-files"]',
      )
      .click();
    await expect(page.locator('[data-iori-view="files"]')).toBeVisible();
    await expect(page.locator('[data-iori-tab="src/app.ts"]')).toBeVisible();
  },
);

test(
  "作業ツリーのツリー表示・絞り込み・確認済みが動作し、無関係なファイル変更で確認済みが外れない",
  { tag: "@desktop" },
  async ({ page, registeredApp: app }) => {
    await repository(app.folder);
    await mkdir(join(app.folder, "src"));
    await writeFile(join(app.folder, "src", "one.ts"), "export const a = 1;\n");
    await writeFile(join(app.folder, "notes.md"), "# Updated notes\n");

    await openReading(page, app, false, "git");
    const viewedCheckbox = page.locator(
      '[data-iori-action="git-toggle-viewed"][data-path="notes.md"]',
    );
    await expect(viewedCheckbox).toBeVisible();
    await viewedCheckbox.click();
    await expect(viewedCheckbox).toHaveAttribute("data-state", "checked");
    await expect(
      page.locator('[data-iori-part="git-viewed-count"]'),
    ).toHaveText("1/2");

    await page.locator('[data-iori-action="git-changes-layout"]').click();
    await expect(
      page.locator('[data-iori-action="git-tree-folder"]', { hasText: "src" }),
    ).toBeVisible();
    await expect(
      page.locator(
        '[data-iori-action="git-change-select"][data-path="src/one.ts"]',
      ),
    ).toBeVisible();

    await page.locator('[data-iori-field="git-changes-filter"]').fill("notes");
    await expect(
      page.locator(
        '[data-iori-action="git-change-select"][data-path="notes.md"]',
      ),
    ).toBeVisible();
    await expect(
      page.locator(
        '[data-iori-action="git-change-select"][data-path="src/one.ts"]',
      ),
    ).toHaveCount(0);
    await page.locator('[data-iori-field="git-changes-filter"]').fill("");

    await app.files({ "src/one.ts": "export const a = 2;\n" });
    await expect(
      page.locator(
        '[data-iori-action="git-toggle-viewed"][data-path="notes.md"]',
      ),
    ).toHaveAttribute("data-state", "checked");

    await app.files({ "notes.md": "# Changed again\nline 2\n" });
    await expect(
      page.locator(
        '[data-iori-action="git-toggle-viewed"][data-path="notes.md"]',
      ),
    ).toHaveAttribute("data-state", "unchecked");
  },
);

test(
  "Gitでstage・unstage・hunk操作・変更の破棄・commit・fetch/pull/pushを行える",
  { tag: "@desktop" },
  async ({ page, registeredApp: app }) => {
    const tempBase = await mkdtemp(join(tmpdir(), "iori-git-write-"));
    const remoteDir = join(tempBase, "remote.git");
    const peerDir = join(tempBase, "peer");
    try {
      await mkdir(remoteDir);
      git(remoteDir, "init", "--bare", "--initial-branch=main");

      await repository(app.folder);
      const baseLines = Array.from({ length: 20 }, (_, i) => `line ${i + 1}`);
      await writeFile(
        join(app.folder, "multi.txt"),
        `${baseLines.join("\n")}\n`,
      );
      git(app.folder, "add", "multi.txt");
      git(app.folder, "commit", "-m", "Add multi.txt");
      git(app.folder, "remote", "add", "origin", remoteDir);

      const editedLines = [...baseLines];
      editedLines[0] = "line 1 changed";
      editedLines[19] = "line 20 changed";
      await writeFile(
        join(app.folder, "multi.txt"),
        `${editedLines.join("\n")}\n`,
      );
      await writeFile(join(app.folder, "notes.md"), "# Updated for commit\n");
      await writeFile(join(app.folder, "scratch.txt"), "remove me\n");

      await openReading(page, app, false, "git");

      // Commit stays disabled with 0 staged changes even when message is entered.
      const commitInput = page.locator(
        '[data-iori-field="git-commit-message"]',
      );
      const commitSubmit = page.locator(
        '[data-iori-action="git-commit-submit"]',
      );
      await commitInput.fill("Should stay disabled");
      await expect(commitSubmit).toBeDisabled();

      // Stage only the first hunk of multi.txt.
      await page
        .locator(
          '[data-iori-action="git-change-select"][data-area="unstaged"][data-path="multi.txt"]',
        )
        .click();
      const stageHunk = page
        .locator('[data-iori-action="git-hunk-stage"]')
        .first();
      await expect(stageHunk).toBeVisible();
      await stageHunk.click();
      await expect(
        page.locator(
          '[data-iori-action="git-change-select"][data-area="staged"][data-path="multi.txt"]',
        ),
      ).toBeVisible();
      await expect(
        page.locator(
          '[data-iori-action="git-change-select"][data-area="unstaged"][data-path="multi.txt"]',
        ),
      ).toBeVisible();

      // Discard untracked scratch.txt via confirmation dialog (Cancel focused first).
      const scratchRow = page.locator(
        '[data-iori-action="git-change-select"][data-path="scratch.txt"]',
      );
      await scratchRow.hover();
      await page
        .locator(
          '[data-iori-action="git-discard-file"][data-path="scratch.txt"]',
        )
        .click();
      const discardDialog = page.locator('[data-iori-dialog="git-discard"]');
      await expect(discardDialog).toBeVisible();
      const cancelBtn = discardDialog.getByRole("button", { name: "Cancel" });
      await expect(cancelBtn).toBeFocused();
      await cancelBtn.click();
      await expect(discardDialog).toBeHidden();
      await expect(scratchRow).toBeVisible();

      await scratchRow.hover();
      await page
        .locator(
          '[data-iori-action="git-discard-file"][data-path="scratch.txt"]',
        )
        .click();
      await expect(discardDialog).toBeVisible();
      await page.locator('[data-iori-action="git-discard-confirm"]').click();
      await expect(discardDialog).toBeHidden();
      await expect(scratchRow).toHaveCount(0);

      // Stage notes.md, unstage it, then stage again and commit staged changes.
      const notesRow = page.locator(
        '[data-iori-action="git-change-select"][data-area="unstaged"][data-path="notes.md"]',
      );
      await notesRow.hover();
      await page
        .locator('[data-iori-action="git-stage-file"][data-path="notes.md"]')
        .click();
      const stagedNotesRow = page.locator(
        '[data-iori-action="git-change-select"][data-area="staged"][data-path="notes.md"]',
      );
      await expect(stagedNotesRow).toBeVisible();
      await stagedNotesRow.hover();
      await page
        .locator('[data-iori-action="git-unstage-file"][data-path="notes.md"]')
        .click();
      await expect(notesRow).toBeVisible();
      await notesRow.hover();
      await page
        .locator('[data-iori-action="git-stage-file"][data-path="notes.md"]')
        .click();
      await expect(stagedNotesRow).toBeVisible();

      await commitInput.fill("Step 2-B commit");
      await expect(commitSubmit).toBeEnabled();
      await commitSubmit.click();
      await expect(commitInput).toHaveValue("");

      // Push to bare remote (sets upstream automatically).
      await page.locator('[data-iori-action="git-push"]').click();
      await expect(
        page.locator('[data-iori-part="git-remote-bar"]'),
      ).toHaveAttribute("data-has-upstream", "true");
      expect(git(remoteDir, "log", "-1", "--pretty=%s").trim()).toBe(
        "Step 2-B commit",
      );

      // Push a new commit from a peer clone, then fetch and pull --ff-only.
      git(tempBase, "clone", remoteDir, peerDir);
      git(peerDir, "config", "user.name", "Peer");
      git(peerDir, "config", "user.email", "peer@example.com");
      await writeFile(join(peerDir, "remote.txt"), "from remote\n");
      git(peerDir, "add", "remote.txt");
      git(peerDir, "commit", "-m", "Remote commit");
      git(peerDir, "push");

      await page.locator('[data-iori-action="git-fetch"]').click();
      await expect(page.locator('[data-iori-action="git-pull"]')).toContainText(
        "↓1",
      );
      await page.locator('[data-iori-action="git-pull"]').click();
      await expect(
        page.locator('[data-iori-action="git-pull"]'),
      ).not.toContainText("↓1");

      await page.locator('[data-iori-action="git-mode-history"]').click();
      await expect(
        page.locator('[data-iori-action="git-commit-select"]', {
          hasText: "Remote commit",
        }),
      ).toBeVisible();
    } finally {
      await rm(tempBase, { recursive: true, force: true });
    }
  },
);
