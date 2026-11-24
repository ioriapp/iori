import { chooseSaveDestination } from "./fixtures/browser.ts";
import type { Page } from "@playwright/test";
import type { App } from "./fixtures/test.ts";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { test, expect, visibleTerminal } from "./fixtures/test.ts";
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

test(
  "Filesのツールバーと右クリックメニューで作成・複製・名前変更・削除し、Git差分へ移れる",
  { tag: "@desktop" },
  async ({ page, registeredApp: app }) => {
    await repository(app.folder);
    await writeFile(join(app.folder, "notes.md"), "# Changed notes\n");
    await openReading(page, app, false, "files");

    await page.locator('[data-iori-action="files-toolbar-new-file"]').click();
    await page
      .locator('[data-iori-field="file-create-name"]')
      .fill("sub/created.txt");
    await page.locator('[data-iori-action="file-create-confirm"]').click();
    await expect(
      page.locator('[data-iori-tab="sub/created.txt"]'),
    ).toBeVisible();
    await expect(
      page.getByRole("treeitem", { name: "created.txt", exact: true }),
    ).toBeVisible();

    await page
      .getByRole("treeitem", { name: "created.txt", exact: true })
      .click({ button: "right" });
    await page.locator('[data-iori-action="files-duplicate"]').click();
    await expect(
      page.getByRole("treeitem", { name: "created copy.txt", exact: true }),
    ).toBeVisible();

    await page
      .getByRole("treeitem", { name: "created copy.txt", exact: true })
      .click();
    await expect(
      page.locator('[data-iori-tab="sub/created copy.txt"]'),
    ).toBeVisible();

    await page
      .getByRole("treeitem", { name: "created copy.txt", exact: true })
      .click({ button: "right" });
    await page.locator('[data-iori-action="files-rename"]').click();
    await page
      .locator('[data-iori-field="file-rename-name"]')
      .fill("renamed.txt");
    await page.locator('[data-iori-action="file-rename-confirm"]').click();
    await expect(
      page.getByRole("treeitem", { name: "renamed.txt", exact: true }),
    ).toBeVisible();
    await expect(
      page.locator('[data-iori-tab="sub/renamed.txt"]'),
    ).toBeVisible();

    await page
      .getByRole("treeitem", { name: "renamed.txt", exact: true })
      .click({ button: "right" });
    await page.locator('[data-iori-action="files-delete"]').click();
    const deleteDialog = page.locator('[data-iori-dialog="file-delete"]');
    await expect(deleteDialog).toBeVisible();
    await expect(
      deleteDialog.getByRole("button", { name: "Cancel", exact: true }),
    ).toBeFocused();
    await deleteDialog
      .locator('[data-iori-action="file-delete-confirm"]')
      .click();
    await expect(
      page.getByRole("treeitem", { name: "renamed.txt", exact: true }),
    ).toHaveCount(0);
    await expect(page.locator('[data-iori-tab="sub/renamed.txt"]')).toHaveCount(
      0,
    );

    await page
      .getByRole("treeitem", { name: "sub", exact: true })
      .click({ button: "right" });
    await page.locator('[data-iori-action="files-rename"]').click();
    await page.locator('[data-iori-field="file-rename-name"]').fill("sub2");
    await page.locator('[data-iori-action="file-rename-confirm"]').click();
    await expect(
      page.getByRole("treeitem", { name: "sub2", exact: true }),
    ).toHaveAttribute("aria-expanded", "true");
    await expect(
      page.getByRole("treeitem", { name: "created.txt", exact: true }),
    ).toBeVisible();
    await expect(
      page.locator('[data-iori-tab="sub2/created.txt"]'),
    ).toBeVisible();

    await page
      .getByRole("treeitem", { name: "notes.md", exact: true })
      .click({ button: "right" });
    await page.locator('[data-iori-action="files-open-diff"]').click();
    await expect(page.locator('[data-iori-view="git"]')).toBeVisible();
    await expect(
      page.locator('[data-iori-action="git-detail-path"]'),
    ).toContainText("notes.md");
  },
);

test(
  "Ctrl+Pのクイックオープンからファイルを選んでFilesタブで開く",
  { tag: "@desktop" },
  async ({ page, registeredApp: app }) => {
    await repository(app.folder);
    await mkdir(join(app.folder, "nested"));
    await writeFile(
      join(app.folder, "nested", "quick.txt"),
      "Quick open body\n",
    );
    await openReading(page, app, false, "files");

    await page.keyboard.press("Control+p");
    const dialog = page.locator('[data-iori-view="quick-open"]');
    await expect(dialog).toBeVisible();
    await dialog
      .locator('[data-iori-field="quick-open-input"]')
      .fill("nested/quick");
    await dialog.locator('[data-iori-file="nested/quick.txt"]').click();
    await expect(dialog).toBeHidden();
    await expect(page.getByText("Quick open body")).toBeVisible();
  },
);

test(
  "Filesで空ファイルと通常テキストを編集して自動保存し、外部変更の競合で上書きと再読み込みを選べる",
  { tag: "@desktop" },
  async ({ page, registeredApp: app }) => {
    await repository(app.folder);
    await openReading(page, app, false, "files");

    await page.locator('[data-iori-action="files-toolbar-new-file"]').click();
    await page
      .locator('[data-iori-field="file-create-name"]')
      .fill("draft.txt");
    await page.locator('[data-iori-action="file-create-confirm"]').click();

    const editor = page.locator('[data-iori-view="file-editor"]');
    const content = editor.locator(".cm-content");
    await expect(content).toBeVisible();
    await content.click();
    await page.keyboard.type("First line");
    await expect(editor).toHaveAttribute("data-iori-dirty", "true");
    await expect(editor).toHaveAttribute("data-iori-dirty", "false");
    expect(await readFile(join(app.folder, "draft.txt"), "utf8")).toBe(
      "First line",
    );

    await app.files({ "draft.txt": "From agent" });
    await expect(content).toContainText("From agent");

    await content.click();
    await page.keyboard.press("End");
    await page.keyboard.type(" + local");
    await app.files({ "draft.txt": "External update" });
    const conflictBar = page.locator('[data-iori-part="file-conflict-bar"]');
    await expect(conflictBar).toBeVisible();

    await conflictBar
      .locator('[data-iori-action="file-conflict-overwrite"]')
      .click();
    await expect(conflictBar).toBeHidden();
    await expect(editor).toHaveAttribute("data-iori-dirty", "false");
    expect(await readFile(join(app.folder, "draft.txt"), "utf8")).toBe(
      "From agent + local",
    );

    await content.click();
    await page.keyboard.press("End");
    await page.keyboard.type(" discard");
    await app.files({ "draft.txt": "Reloaded from disk" });
    await expect(conflictBar).toBeVisible();

    await conflictBar
      .locator('[data-iori-action="file-conflict-reload"]')
      .click();
    await expect(conflictBar).toBeHidden();
    await expect(content).toContainText("Reloaded from disk");
  },
);

test(
  "Ctrl+Shift+Fとフォルダーメニューからワークスペース全文検索して該当行へ移動する",
  { tag: "@desktop" },
  async ({ page, registeredApp: app }) => {
    await repository(app.folder);
    await mkdir(join(app.folder, "sub"));
    await writeFile(join(app.folder, "alpha.txt"), "one\ntwo\nneedle alpha\n");
    await writeFile(
      join(app.folder, "sub", "beta.txt"),
      "first\nsecond\nthird\nneedle beta\n",
    );
    await openReading(page, app, false, "files");

    await page.keyboard.press("Control+Shift+f");
    const searchPane = page.locator('[data-iori-view="workspace-search"]');
    await expect(searchPane).toBeVisible();
    await searchPane
      .locator('[data-iori-field="workspace-search-input"]')
      .fill("needle");
    const betaMatch = searchPane.locator(
      '[data-iori-action="workspace-search-match"][data-iori-file="sub/beta.txt"]',
    );
    await expect(betaMatch).toBeVisible();
    await expect(
      searchPane.locator(
        '[data-iori-action="workspace-search-match"][data-iori-file="alpha.txt"]',
      ),
    ).toBeVisible();
    await betaMatch.click();
    await expect(page.locator('[data-iori-tab="sub/beta.txt"]')).toBeVisible();
    await expect(
      page.locator(
        '[data-iori-view="file-editor"] [data-iori-line="4"][data-selected="true"]',
      ),
    ).toContainText("needle beta");

    await searchPane
      .locator('[data-iori-action="workspace-search-close"]')
      .click();
    await expect(searchPane).toBeHidden();

    await page
      .getByRole("treeitem", { name: "sub", exact: true })
      .click({ button: "right" });
    await page.locator('[data-iori-action="files-find-in-folder"]').click();
    await expect(searchPane).toBeVisible();
    await searchPane
      .locator('[data-iori-field="workspace-search-input"]')
      .fill("needle");
    await expect(betaMatch).toBeVisible();
    await expect(
      searchPane.locator(
        '[data-iori-action="workspace-search-match"][data-iori-file="alpha.txt"]',
      ),
    ).toHaveCount(0);
  },
);

test(
  "保存の応答待ちの間に入力を続けても外部変更の競合を表示しない",
  { tag: "@desktop" },
  async ({ page, registeredApp: app }) => {
    await repository(app.folder);
    await openReading(page, app, false, "files");
    await page.locator('[data-iori-action="files-toolbar-new-file"]').click();
    await page.locator('[data-iori-field="file-create-name"]').fill("d.txt");
    await page.locator('[data-iori-action="file-create-confirm"]').click();
    const editor = page.locator('[data-iori-view="file-editor"]');
    const content = editor.locator(".cm-content");
    await content.click();
    await page.keyboard.type("one");
    await expect(editor).toHaveAttribute("data-iori-dirty", "false");

    await app.faults.hold("files.write");
    await page.keyboard.type(" two");
    await expect(
      page.locator('[data-iori-part="file-edit-status"]'),
    ).toBeVisible();
    await page.keyboard.type(" three");
    await app.faults.clear();
    await expect(
      page.locator('[data-iori-part="file-edit-status"]'),
    ).toBeHidden();
    await expect(
      page.locator('[data-iori-part="file-conflict-bar"]'),
    ).toBeHidden();
    await expect(editor).toHaveAttribute("data-iori-dirty", "false");
    expect(await readFile(join(app.folder, "d.txt"), "utf8")).toBe(
      "one two three",
    );
  },
);

test(
  "スマホでFilesのテキストを閲覧から編集へ切り替えて保存する",
  { tag: "@phone" },
  async ({ page, registeredApp: app }) => {
    await repository(app.folder);
    await writeFile(join(app.folder, "mobile.txt"), "Start");
    await openReading(page, app, true, "files");

    await page
      .getByRole("treeitem", { name: "mobile.txt", exact: true })
      .click();
    const editor = page.locator('[data-iori-view="file-editor"]');
    await expect(editor).toHaveAttribute("data-iori-editing", "false");

    const toggleEdit = page.locator('[data-iori-action="file-toggle-edit"]');
    await toggleEdit.click();
    await expect(editor).toHaveAttribute("data-iori-editing", "true");
    await editor.locator(".cm-content").click();
    await page.keyboard.press("End");
    await page.keyboard.type(" edited");
    await toggleEdit.click();
    await expect(editor).toHaveAttribute("data-iori-editing", "false");
    await expect(editor).toHaveAttribute("data-iori-dirty", "false");
    expect(await readFile(join(app.folder, "mobile.txt"), "utf8")).toBe(
      "Start edited",
    );
  },
);

test(
  "ファイルを開いた直後にCtrl+Zを押しても内容が消えず編集後のUndoとCtrl+Shift+ZのRedoができる",
  { tag: "@desktop" },
  async ({ page, registeredApp: app }) => {
    await repository(app.folder);
    await writeFile(join(app.folder, "ignore.txt"), "node_modules/\ndist/\n");
    await openReading(page, app, false, "files");

    await page
      .getByRole("treeitem", { name: "ignore.txt", exact: true })
      .click();
    const editor = page.locator('[data-iori-view="file-editor"]');
    const content = editor.locator(".cm-content");
    await expect(content).toContainText("node_modules/");

    // Pressing Ctrl+Z immediately after opening must NOT undo the initial file load.
    await content.click();
    await page.keyboard.press("Control+z");
    await expect(content).toContainText("node_modules/");
    await expect(content).toContainText("dist/");
    await expect(editor).toHaveAttribute("data-iori-dirty", "false");

    // Editing, undoing with Ctrl+Z, and redoing with Ctrl+Shift+Z all work.
    await page.keyboard.press("Control+End");
    await page.keyboard.type("build/");
    await expect(content).toContainText("build/");
    await page.keyboard.press("Control+z");
    await expect(content).not.toContainText("build/");
    await expect(content).toContainText("node_modules/");
    await page.keyboard.press("Control+Shift+z");
    await expect(content).toContainText("build/");
    await expect(editor).toHaveAttribute("data-iori-dirty", "false");
    expect(await readFile(join(app.folder, "ignore.txt"), "utf8")).toBe(
      "node_modules/\ndist/\nbuild/",
    );
  },
);

test(
  "Markdownの<picture>と<img>タグがローカル画像として表示される",
  { tag: "@desktop" },
  async ({ page, registeredApp: app }) => {
    await repository(app.folder);
    await writeFile(
      join(app.folder, "picture-demo.md"),
      [
        "# Picture demo",
        "",
        "<picture>",
        '  <source media="(prefers-color-scheme: dark)" srcset="image.png">',
        '  <source media="(prefers-color-scheme: light)" srcset="image.png">',
        '  <img alt="Hero preview" src="image.png">',
        "</picture>",
        "",
        "<p>",
        "  <picture>",
        '    <source media="(prefers-color-scheme: dark)" srcset="image.png">',
        '    <img alt="Mobile preview" src="image.png" width="320">',
        "  </picture>",
        "</p>",
      ].join("\n"),
    );
    await openReading(page, app, false, "files");
    await page
      .getByRole("treeitem", { name: "picture-demo.md", exact: true })
      .click();
    const markdown = page.locator('[data-iori-scroll="file-markdown"]');
    await expect(markdown).toContainText("Picture demo");
    const heroImg = markdown.locator('img[alt="Hero preview"]');
    await expect(heroImg).toBeVisible();
    await expect(heroImg).toHaveAttribute("src", /^blob:/u);
    const mobileImg = markdown.locator('img[alt="Mobile preview"]');
    await expect(mobileImg).toBeVisible();
    await expect(mobileImg).toHaveAttribute("width", "320");
    await expect(markdown).not.toContainText("<picture>");
  },
);

test(
  "FilesからTerminalへパスを送信すると送信先のTerminalへ入力フォーカスが移る",
  { tag: "@desktop" },
  async ({ page, registeredApp: app }) => {
    await repository(app.folder);
    const cliList = await app.request("cli.list", {});
    const launched = await app.request("cli.launch", {
      cwd: app.folder,
      cliId: cliList.clis[0]!.id,
    });
    await openReading(page, app, false, "files");
    await page
      .getByRole("treeitem", { name: "notes.md", exact: true })
      .click({ button: "right" });
    await page.locator('[data-iori-action="files-send-to-terminal"]').click();

    const terminal = visibleTerminal(page);
    await expect(terminal).toHaveAttribute(
      "data-iori-terminal-id",
      launched.terminal.id,
    );
    await expect(terminal).toHaveAttribute("data-iori-stream-state", "ready");
    await expect(terminal.locator(".xterm-helper-textarea")).toBeFocused();
    // Keyboard input goes straight into the Terminal without clicking it first.
    await page.keyboard.press("Enter");
    await app.terminalText(launched.terminal.id, /ACTOR_INPUT:.*notes\.md/u);
  },
);
