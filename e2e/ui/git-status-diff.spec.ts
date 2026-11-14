import type { Page } from "@playwright/test";
import type { App } from "./fixtures/test.ts";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { test, expect } from "./fixtures/test.ts";
import { openReading, repository } from "./support/reading.ts";

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
    if (mobile) await page.locator("body").press("Alt+ArrowLeft");
    await page.getByRole("button", { name: /image\.png/ }).click();
    await expect(
      page.getByRole("img", { name: "Before image.png" }),
    ).toBeVisible();
    await expect(
      page.getByRole("img", { name: "After image.png" }),
    ).toBeVisible();
    if (mobile) await page.locator("body").press("Alt+ArrowLeft");
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
