import { createTeam } from "./fixtures/journeys.ts";
import type { Page } from "@playwright/test";
import type { App } from "./fixtures/test.ts";
import { execFileSync } from "node:child_process";
import { symlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import {
  test,
  expect,
  openFolder,
  terminalId,
  visibleTerminal,
} from "./fixtures/test.ts";
import { longPress } from "./fixtures/browser.ts";
import { git, repository } from "./support/reading.ts";

type Args = { page: Page; registeredApp: App };

async function createWorktreeWithTeam(page: Page, name: string, team: string) {
  await page.getByRole("button", { name: "New worktree" }).click();
  const dialog = page.getByRole("dialog", { name: "New worktree" });
  await dialog.getByRole("textbox", { name: "Name (optional)" }).fill(name);
  await dialog.locator('[data-iori-field="worktree-launcher"]').click();
  await page.getByRole("option", { name: team, exact: false }).click();
  await dialog
    .getByRole("button", { name: "Create worktree", exact: true })
    .click();
}

async function delegateToWorktree(
  app: App,
  id: string,
  worktree: string,
  title: string,
) {
  await app.input(
    id,
    JSON.stringify({
      id: worktree,
      command: [
        "delegate",
        "--role",
        "Worker",
        "--difficulty",
        "medium",
        "--title",
        title,
        "--worktree",
        worktree,
        "--body",
        "Work on the child.",
      ],
    }) + "\r",
  );
  const result = new RegExp(`ACTOR_RESULT:${worktree}:(.*)\\r?\\n`);
  const output = await app.terminalText(id, result);
  expect(JSON.parse(output.match(result)![1])).toMatchObject({ ok: true });
}

function worktreeJourney(mobile: boolean) {
  return async ({ page, registeredApp: app }: Args) => {
    await repository(app.folder);
    await createTeam(app, { name: "Removal team" });
    await app.open(page);
    await openFolder(page, app, mobile);
    if (mobile)
      await page.getByRole("button", { name: "Open sidebar" }).click();
    await createWorktreeWithTeam(page, "feature", "Removal team");
    const path = `${app.folder}-feature`;
    await expect(
      page.locator("[data-iori-current-worktree-path]"),
    ).toHaveAttribute("data-iori-current-worktree-path", path);
    const id = await terminalId(visibleTerminal(page));
    await app.terminalText(id, "ACTOR_PROMPT:");
    await delegateToWorktree(app, id, "new", "Owned child");
    if (mobile)
      await page.getByRole("button", { name: "Open sidebar" }).click();
    await expect(
      page.locator("[data-iori-child-id]").filter({ hasText: "Owned child" }),
    ).toBeVisible();
    const children = await app.request("teams.children", { cwd: path });
    const child = children.children.find(
      (item) => item.title === "Owned child",
    );
    expect(child).toBeDefined();
    await writeFile(join(child!.cwd!, "child-draft.txt"), "Child change\n");
    await writeFile(join(path, "notes.md"), "# Feature commit\n");
    git(path, "add", "notes.md");
    git(path, "commit", "-m", "Feature commit");
    await writeFile(join(path, "draft.txt"), "Uncommitted change\n");
    await app.input(
      id,
      JSON.stringify({ id: "working", hook: "UserPromptSubmit" }) + "\r",
    );
    await app.terminalText(id, "ACTOR_HOOK:working");
    const worktree = page.locator(
      `[data-iori-worktree-path=${JSON.stringify(path)}]`,
    );
    if (mobile) await longPress(worktree);
    else await worktree.click({ button: "right" });
    await page.getByRole("menuitem", { name: "Delete worktree" }).click();
    await expect(page.locator("[data-iori-removal-changes]")).toContainText(
      "Uncommitted changes will be lost",
    );
    await expect(
      page.locator(`[data-iori-removal-changed=${JSON.stringify(child!.cwd)}]`),
    ).toBeVisible();
    await expect(page.locator("[data-iori-removal-branches]")).toContainText(
      "feature",
    );
    await expect(page.locator("[data-iori-removal-working]")).toContainText(
      "Owned child",
    );
    await page.locator('[data-iori-action="worktree-removal-confirm"]').click();
    await expect(
      page.locator(`[data-iori-worktree-path=${JSON.stringify(path)}]`),
    ).toHaveCount(0);
  };
}

function cleanup(mobile: boolean) {
  return async ({ page, registeredApp: app }: Args) => {
    await repository(app.folder);
    const path = `${app.folder}-merged`;
    git(app.folder, "worktree", "add", "-b", "merged", path);
    await writeFile(join(path, "merged.txt"), "Merged change\n");
    git(path, "add", "merged.txt");
    git(path, "commit", "-m", "Merged change");
    git(app.folder, "merge", "--no-ff", "merged", "-m", "Merge worktree");
    await app.open(page);
    await openFolder(page, app, mobile);
    if (mobile)
      await page.getByRole("button", { name: "Open sidebar" }).click();
    const project = page.getByRole("button", { name: "project", exact: true });
    if (mobile) await longPress(project);
    else await project.click({ button: "right" });
    await page
      .getByRole("menuitem", { name: "Delete merged worktrees…" })
      .click();
    await expect(
      page.locator(`[data-iori-removal-select=${JSON.stringify(path)}]`),
    ).toBeChecked();
    await page.locator('[data-iori-action="worktree-removal-confirm"]').click();
    await expect(
      page.locator(`[data-iori-worktree-path=${JSON.stringify(path)}]`),
    ).toHaveCount(0);
  };
}

test(
  "worktreeを作って開き変更を確認して削除する",
  { tag: "@desktop" },
  worktreeJourney(false),
);
test(
  "スマホでworktreeを作って開き変更を確認して削除する",
  { tag: "@phone" },
  worktreeJourney(true),
);

test(
  "委譲先の既存worktreeは残り、子のために作成したworktreeは親の会話を閉じると一覧に表示される",
  { tag: "@desktop" },
  async ({ page, registeredApp: app }) => {
    await repository(app.folder);
    const existing = `${app.folder}-existing`;
    git(app.folder, "worktree", "add", "-b", "existing", existing);
    await createTeam(app, { name: "Delegation team" });
    await app.open(page);
    await openFolder(page, app);
    await createWorktreeWithTeam(page, "feature", "Delegation team");
    const feature = `${app.folder}-feature`;
    await expect(
      page.locator("[data-iori-current-worktree-path]"),
    ).toHaveAttribute("data-iori-current-worktree-path", feature);
    const parentId = await terminalId(visibleTerminal(page));
    await app.terminalText(parentId, "ACTOR_PROMPT:");

    const sidebar = page.locator('[data-sidebar="sidebar"]');
    const newTitle = "New worktree child";
    for (const [worktree, title] of [
      ["main", "Main worktree child"],
      ["existing", "Existing worktree child"],
      ["new", newTitle],
    ]) {
      await delegateToWorktree(app, parentId, worktree, title);
      const child = sidebar.getByRole("button", {
        name: new RegExp(`Worker ${title}`),
      });
      await expect(child).toBeVisible();
      await expect(child).toBeEnabled();
    }
    const { children } = await app.request("teams.children", { cwd: feature });
    const cwd = children.find((child) => child.title === newTitle)?.cwd;
    expect(cwd).toBeDefined();
    const worktreeRow = (path: string) =>
      sidebar.locator(`[data-iori-worktree-path=${JSON.stringify(path)}]`);
    const created = worktreeRow(cwd!);
    await expect(worktreeRow(app.folder)).toBeVisible();
    await expect(worktreeRow(existing)).toBeVisible();
    await expect(created).toHaveCount(0);

    const parent = sidebar.getByRole("button", { name: "Delegation team" });
    await parent.click({ button: "right" });
    await page.getByRole("menuitem", { name: "Close terminal" }).click();
    await expect(parent).toHaveCount(0);
    await page.reload();
    await expect(created).toBeVisible();
  },
);

test("取り込み済みのworktreeを片付ける", { tag: "@desktop" }, cleanup(false));
test(
  "スマホで取り込み済みのworktreeを片付ける",
  { tag: "@phone" },
  cleanup(true),
);

test(
  "コミットが0件のリポジトリで新しいworktreeの画面を開くと理由が出て作成できない",
  { tag: "@desktop" },
  async ({ page, registeredApp: app }) => {
    const gitPath = execFileSync("which", ["git"], { encoding: "utf8" }).trim();
    await symlink(gitPath, join(app.folder, "..", "bin", "git"));
    git(app.folder, "init", "-b", "main");
    await app.open(page);
    await openFolder(page, app, false);
    await page.getByRole("button", { name: "New worktree" }).click();
    const dialog = page.getByRole("dialog", { name: "New worktree" });
    await expect(dialog.getByRole("alert")).toHaveText(
      "Make the first commit, then you can create a worktree.",
    );
    await expect(
      dialog.getByRole("button", { name: "Create worktree", exact: true }),
    ).toBeDisabled();
    await expect(
      dialog.getByRole("button", {
        name: "Here (without a worktree)",
        exact: true,
      }),
    ).toBeEnabled();
    await expect(
      dialog.getByRole("button", { name: "Cancel", exact: true }),
    ).toBeEnabled();
  },
);
