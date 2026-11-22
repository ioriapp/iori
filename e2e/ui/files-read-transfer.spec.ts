import { chooseSaveDestination } from "./fixtures/browser.ts";
import type { Page } from "@playwright/test";
import type { App } from "./fixtures/test.ts";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { test, expect } from "./fixtures/test.ts";
import { git, openReading, repository } from "./support/reading.ts";

type Args = { page: Page; registeredApp: App };

function switchWorktree(mobile: boolean) {
  return async ({ page, registeredApp: app }: Args) => {
    await repository(app.folder);
    const child = `${app.folder}-feature`;
    git(app.folder, "worktree", "add", "-b", "feature", child);
    await writeFile(join(child, "notes.md"), "# Feature notes\n");
    await openReading(page, app, mobile, "files");
    if (mobile)
      await page.getByRole("button", { name: "Open sidebar" }).click();
    await page
      .locator(`[data-iori-worktree-path=${JSON.stringify(child)}]`)
      .click();
    if (mobile) {
      await page.locator('[data-iori-mobile-view-tab="files"]').click();
    } else {
      await page.getByRole("button", { name: "New tab", exact: true }).click();
      await page.locator('[data-iori-action="workspace-open-files"]').click();
    }
    await page.getByRole("treeitem", { name: "notes.md" }).click();
    await expect(
      page.getByRole("heading", { name: "Feature notes" }),
    ).toBeVisible();
    if (mobile) await app.back(page);
    await page.locator('[data-iori-field="files-worktree"]').click();
    await page
      .locator(`[data-iori-worktree-choice=${JSON.stringify(app.folder)}]`)
      .click();
    await page.getByRole("treeitem", { name: "notes.md" }).click();
    await expect(
      page.getByRole("heading", { name: "Initial notes" }),
    ).toBeVisible();
  };
}

function readFiles(mobile: boolean) {
  return async ({ page, registeredApp: app }: Args) => {
    await repository(app.folder);
    await openReading(page, app, mobile, "files");
    await page.getByRole("treeitem", { name: "notes.md" }).click();
    await expect(
      page.getByRole("heading", { name: "Initial notes" }),
    ).toBeVisible();
    if (mobile) await app.back(page);
    await page.getByRole("treeitem", { name: "image.png" }).click();
    await expect(page.locator('[data-iori-part="file-image"]')).toBeVisible();
  };
}

function upload(mobile: boolean) {
  return async ({ page, registeredApp: app }: Args) => {
    await repository(app.folder);
    await mkdir(join(app.folder, "uploads"));
    await openReading(page, app, mobile, "files");
    await page
      .getByRole("treeitem", { name: "uploads" })
      .click({ button: "right" });
    const chooser = page.waitForEvent("filechooser");
    await page.getByRole("menuitem", { name: "Upload files…" }).click();
    await (
      await chooser
    ).setFiles({
      name: "uploaded.txt",
      mimeType: "text/plain",
      buffer: Buffer.from("Uploaded content"),
    });
    await page.getByRole("treeitem", { name: "uploads" }).click();
    await page.getByRole("treeitem", { name: "uploaded.txt" }).click();
    await expect(page.getByText("Uploaded content")).toBeVisible();
  };
}

test(
  "Filesでworktreeを切り替えて内容を見る",
  { tag: "@desktop" },
  switchWorktree(false),
);
test(
  "スマホでFilesでworktreeを切り替えて内容を見る",
  { tag: "@phone" },
  switchWorktree(true),
);

test(
  "Filesの一覧からMarkdownと画像を開く",
  { tag: "@desktop" },
  readFiles(false),
);

test(
  "Filesの再読み込みに失敗しても本文を読み続け、再試行できる",
  { tag: "@desktop" },
  async ({ page, registeredApp: app }) => {
    await repository(app.folder);
    await openReading(page, app, false, "files");
    await page.getByRole("treeitem", { name: "notes.md" }).click();
    const original = page.getByRole("heading", { name: "Initial notes" });
    await expect(original).toBeVisible();

    await app.faults.fail("files.info");
    await app.files({ "notes.md": "# Updated notes\n" });
    const alert = page
      .getByRole("alert")
      .filter({ hasText: "Could not read this." });
    await expect(alert).toBeVisible();
    await expect(original).toBeVisible();

    await app.faults.clear();
    await alert.getByRole("button", { name: "Retry", exact: true }).click();
    await expect(
      page.getByRole("heading", { name: "Updated notes" }),
    ).toBeVisible();
    await expect(alert).toBeHidden();
  },
);

test(
  "スマホでFilesの一覧からMarkdownと画像を開く",
  { tag: "@phone" },
  readFiles(true),
);

test("Filesへファイルをアップロードする", { tag: "@desktop" }, upload(false));
test(
  "スマホでFilesへファイルをアップロードする",
  { tag: "@phone" },
  upload(true),
);

test(
  "Filesからブラウザーの保存APIへ渡した内容を保存先で読む（OSダイアログは対象外）",
  { tag: "@desktop" },
  async ({ page, registeredApp: app }, info) => {
    await repository(app.folder);
    const saved = await chooseSaveDestination(
      page,
      info.outputPath("download", "notes.md"),
    );
    await openReading(page, app, false, "files");
    await page
      .getByRole("treeitem", { name: "notes.md", exact: true })
      .click({ button: "right" });
    await page
      .getByRole("menuitem", { name: "Download…", exact: true })
      .click();
    expect((await saved.contents()).toString()).toBe("# Initial notes\n");
  },
);

test(
  "Filesのファイルタブをキーボードで移動して閉じる",
  { tag: "@desktop" },
  async ({ page, registeredApp: app }) => {
    await repository(app.folder);
    await writeFile(join(app.folder, "alpha.txt"), "Alpha content\n");
    await writeFile(join(app.folder, "beta.txt"), "Beta content\n");
    await openReading(page, app, false, "files");

    await page.getByRole("treeitem", { name: "notes.md", exact: true }).click();
    await page
      .getByRole("treeitem", { name: "alpha.txt", exact: true })
      .click();
    await page.getByRole("treeitem", { name: "beta.txt", exact: true }).click();

    const tabs = page.locator('[data-iori-part="file-tabs"]');
    const notesTab = tabs.locator('[data-iori-tab="notes.md"]');
    const alphaTab = tabs.locator('[data-iori-tab="alpha.txt"]');
    const betaTab = tabs.locator('[data-iori-tab="beta.txt"]');

    await expect(betaTab).toHaveAttribute("role", "tab");
    await expect(betaTab).toHaveAttribute("aria-selected", "true");
    await expect(betaTab).toHaveAttribute("tabindex", "0");
    await expect(betaTab.locator("button")).toHaveCount(0);
    await expect(notesTab).toHaveAttribute("aria-selected", "false");
    await expect(notesTab).toHaveAttribute("tabindex", "-1");
    await expect(alphaTab).toHaveAttribute("aria-selected", "false");
    await expect(alphaTab).toHaveAttribute("tabindex", "-1");

    await betaTab.focus();
    await expect(betaTab).toBeFocused();

    await page.keyboard.press("Home");
    await expect(notesTab).toBeFocused();
    await expect(notesTab).toHaveAttribute("aria-selected", "true");
    await expect(notesTab).toHaveAttribute("tabindex", "0");
    await expect(
      page.getByRole("heading", { name: "Initial notes" }),
    ).toBeVisible();

    await page.keyboard.press("ArrowRight");
    await expect(alphaTab).toBeFocused();
    await expect(alphaTab).toHaveAttribute("aria-selected", "true");
    await expect(alphaTab).toHaveAttribute("tabindex", "0");
    await expect(page.getByText("Alpha content")).toBeVisible();

    await page.keyboard.press("End");
    await expect(betaTab).toBeFocused();
    await expect(betaTab).toHaveAttribute("aria-selected", "true");
    await expect(page.getByText("Beta content")).toBeVisible();

    await page.keyboard.press("ArrowLeft");
    await expect(alphaTab).toBeFocused();
    await expect(alphaTab).toHaveAttribute("aria-selected", "true");

    await page.keyboard.press("Delete");
    await expect(alphaTab).toHaveCount(0);
    await expect(betaTab).toBeFocused();
    await expect(betaTab).toHaveAttribute("aria-selected", "true");
  },
);
