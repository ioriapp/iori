import { putClipboardImage } from "./fixtures/browser.ts";
import { png } from "./support/reading.ts";
import {
  test,
  expect,
  openFolder,
  visibleTerminal,
  terminalId,
  sendLine,
} from "./fixtures/test.ts";

test(
  "スマホで画像を選びTerminalの入力にパスを入れる",
  { tag: "@phone" },
  async ({ page, registeredApp: app }) => {
    await page.goto(app.url);
    await openFolder(page, app, true);
    await page.getByRole("button", { name: "New tab", exact: true }).tap();
    await page
      .getByRole("dialog")
      .getByRole("button", { name: "Bash", exact: true })
      .tap();
    const id = await terminalId(visibleTerminal(page));
    await app.terminalText(id, /[$#] /);
    await sendLine(
      visibleTerminal(page),
      `printf 'IMAGE_READY\\n'; IFS= read -r image; printf 'IMAGE_PATH:%s\\n' "$image"`,
    );
    await app.terminalText(id, /IMAGE_READY\r?\n/);
    const chooser = page.waitForEvent("filechooser");
    await page.getByRole("button", { name: "Image", exact: true }).tap();
    await (
      await chooser
    ).setFiles({
      name: "photo.png",
      mimeType: "image/png",
      buffer: Buffer.from(
        "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=",
        "base64",
      ),
    });
    await app.terminalText(id, ".png");
    await visibleTerminal(page).locator('[data-iori-key="enter"]').tap();
    await app.terminalText(id, /IMAGE_PATH:\/[^\r\n ]+\.png/);
    await page
      .getByRole("button", { name: "Switch to batch input", exact: true })
      .tap();
    await expect(
      page.getByRole("textbox", { name: "Type a command…", exact: true }),
    ).toHaveValue("");
  },
);

test(
  "PCで画像を貼り付けTerminalの入力にHostのパスを入れる",
  { tag: "@desktop" },
  async ({ page, registeredApp: app }) => {
    await page.goto(app.url);
    await openFolder(page, app);
    await page.getByRole("button", { name: "New tab", exact: true }).click();
    await page
      .getByRole("dialog")
      .getByRole("button", { name: "Bash", exact: true })
      .click();
    const terminal = visibleTerminal(page);
    const id = await terminalId(terminal);
    await app.terminalText(id, /[$#] /);
    await sendLine(
      terminal,
      `printf 'PASTE_READY\\n'; IFS= read -r image; printf 'PASTED_PATH:%s\\n' "$image"`,
    );
    await app.terminalText(id, /PASTE_READY\r?\n/);
    await putClipboardImage(page, png);
    await terminal.getByRole("textbox").press("Control+Shift+V");
    await app.terminalText(id, /\/[^\r\n ]+\.png/);
    await terminal.getByRole("textbox").press("Enter");
    expect(await app.terminalText(id, /PASTED_PATH:\/[^\r\n ]+\.png/)).toMatch(
      /PASTED_PATH:\/[^\r\n ]+\.png/,
    );
  },
);
