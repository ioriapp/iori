import { execFileSync } from "node:child_process";
import { symlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { Page } from "@playwright/test";
import { expect, openFolder, type App } from "../fixtures/test.ts";

export const png = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADElEQVR4nGP4z8AAAAMBAQDJ/pLvAAAAAElFTkSuQmCC",
  "base64",
);

export function git(folder: string, ...args: string[]) {
  return execFileSync("git", args, { cwd: folder, encoding: "utf8" });
}

export async function repository(folder: string) {
  const gitPath = execFileSync("which", ["git"], { encoding: "utf8" }).trim();
  await symlink(gitPath, join(folder, "..", "bin", "git"));
  git(folder, "init", "-b", "main");
  git(folder, "config", "user.name", "UI Test");
  git(folder, "config", "user.email", "ui@localhost");
  await writeFile(join(folder, "notes.md"), "# Initial notes\n");
  await writeFile(join(folder, "image.png"), png);
  git(folder, "add", ".");
  git(folder, "commit", "-m", "Initial notes");
}

export async function openReading(
  page: Page,
  app: App,
  mobile: boolean,
  kind: "files" | "git",
) {
  await page.goto(app.url);
  await openFolder(page, app, mobile);
  if (mobile) await page.getByRole("button", { name: "Open sidebar" }).click();
  if (kind === "git")
    await expect(
      page.getByRole("button", { name: "New worktree" }),
    ).toBeVisible();
  if (mobile) {
    await page.locator(`[data-iori-action="sidebar-open-${kind}"]`).click();
  } else {
    await page.getByRole("button", { name: "New tab", exact: true }).click();
    await page.locator(`[data-iori-action="workspace-open-${kind}"]`).click();
  }
}
