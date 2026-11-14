import type { Page } from "@playwright/test";
import type { App } from "./fixtures/test.ts";
import { writeFile } from "node:fs/promises";
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

function worktreeJourney(mobile: boolean) {
  return async ({ page, registeredApp: app }: Args) => {
    await repository(app.folder);
    const candidate = {
      id: "scripted",
      cli: app.cliId,
      model: "",
      tools: [],
      minimum: "",
    };
    const { saved } = await app.request("teams.create", {
      definition: {
        name: "Removal team",
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
    await openFolder(page, app, mobile);
    if (mobile)
      await page.getByRole("button", { name: "Open sidebar" }).click();
    await page.getByRole("button", { name: "New worktree" }).click();
    await page
      .getByRole("textbox", { name: "Name (optional)" })
      .fill("feature");
    await page.locator('[data-iori-field="worktree-launcher"]').click();
    await page.getByRole("option", { name: /Removal team/ }).click();
    await page
      .getByRole("button", { name: "Create worktree", exact: true })
      .click();
    const path = `${app.folder}-feature`;
    await expect(
      page.locator("[data-iori-current-worktree-path]"),
    ).toHaveAttribute("data-iori-current-worktree-path", path);
    const id = await terminalId(visibleTerminal(page));
    await app.terminalText(id, "ACTOR_PROMPT:");
    await app.input(
      id,
      JSON.stringify({
        id: "delegate",
        command: [
          "delegate",
          "--role",
          "Worker",
          "--difficulty",
          "medium",
          "--title",
          "Owned child",
          "--worktree",
          "new",
          "--body",
          "Work on the child.",
        ],
      }) + "\r",
    );
    const result = await app.terminalText(id, /ACTOR_RESULT:delegate:.*\r?\n/);
    expect(result).toContain('"ok":true');
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
    await page.goto(app.url);
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
test("取り込み済みのworktreeを片付ける", { tag: "@desktop" }, cleanup(false));
test(
  "スマホで取り込み済みのworktreeを片付ける",
  { tag: "@phone" },
  cleanup(true),
);
