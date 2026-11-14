import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { test, expect, openFolder } from "./fixtures/test.ts";

test(
  "本文を選択してスクロール後にコピーする",
  { tag: "@desktop" },
  async ({ page, context, registeredApp: app }) => {
    const content = Array.from(
      { length: 100 },
      (_, i) => `Line ${i + 1}: text to copy`,
    ).join("\n");
    await writeFile(join(app.folder, "copy.txt"), content + "\n");
    await context.grantPermissions(["clipboard-read", "clipboard-write"]);
    await page.goto(app.url);
    await openFolder(page, app);
    await page.getByRole("tab", { name: "Files", exact: true }).first().click();
    await page.locator('[data-iori-file="copy.txt"]').click();
    const first = page.locator('[data-iori-view="files"] [data-iori-line="1"]');
    await first.click();
    await page.keyboard.press("Control+a");
    await page.mouse.wheel(0, 1500);
    await expect(first).not.toBeInViewport();
    await page.keyboard.press("Control+c");
    await page.getByRole("button", { name: "Settings", exact: true }).click();
    await page.getByRole("button", { name: "Connection", exact: true }).click();
    const address = page.locator('[data-iori-field="address"]');
    await address.fill("");
    await address.press("Control+v");
    await expect(address).toHaveValue(content);
  },
);
