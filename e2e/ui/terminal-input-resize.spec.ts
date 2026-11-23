import type { Page } from "@playwright/test";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import {
  test,
  expect,
  openFolder,
  visibleTerminal,
  terminalId,
  sendLine,
  type App,
} from "./fixtures/test.ts";

const modes = [
  {
    tag: "@desktop",
    mobile: false,
    direction: -1,
    resize: async (page: Page) => {
      const divider = page.getByRole("separator", {
        name: "Resize sidebar",
        exact: true,
      });
      const box = (await divider.boundingBox())!;
      await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
      await page.mouse.down();
      await page.mouse.move(box.x + 180, box.y + box.height / 2);
      await page.mouse.up();
    },
  },
  {
    tag: "@phone",
    mobile: true,
    direction: 1,
    resize: async (page: Page) => {
      const width = page.getByRole("button", {
        name: "Desktop width",
        exact: true,
      });
      await width.tap();
      await expect(
        page.getByRole("button", { name: "Device width", exact: true }),
      ).toHaveAttribute("aria-pressed", "true");
    },
  },
];
async function newTab(page: Page, mobile: boolean) {
  const button = page.getByRole("button", { name: "New tab", exact: true });
  if (mobile) await button.tap();
  else await button.click();
}
async function reopen(page: Page, id: string, mobile: boolean) {
  if (mobile)
    await page.getByRole("button", { name: "Open sidebar", exact: true }).tap();
  await page.locator(`[data-iori-terminal-row="${id}"]`).click();
  await expect(visibleTerminal(page)).toHaveAttribute(
    "data-iori-terminal-id",
    id,
  );
}
function journey(mode: (typeof modes)[number]) {
  return async ({
    page,
    registeredApp: app,
  }: {
    page: Page;
    registeredApp: App;
  }) => {
    await app.open(page);
    await openFolder(page, app, mode.mobile);
    await newTab(page, mode.mobile);
    await page
      .getByRole("dialog")
      .getByRole("button", { name: "Bash", exact: true })
      .click();
    const terminal = visibleTerminal(page);
    const id = await terminalId(terminal);
    await sendLine(
      terminal,
      "printf 'BEFORE:%s\\n' retained; /usr/bin/stty size",
    );
    const before = await app.terminalText(
      id,
      /BEFORE:retained\r?\n(?:\x1b\[[0-9;?]*[a-zA-Z])*\d+ \d+/,
    );
    const oldCols = Number(before.match(/\r?\n(\d+) (\d+)\r?\n/)?.[2]);
    expect(oldCols).toBeGreaterThan(0);
    await mode.resize(page);
    const newCols = await app.waitForTerminalResize(
      terminal,
      id,
      oldCols,
      mode.direction,
    );
    expect(newCols).toBeGreaterThan(0);
    expect((newCols - oldCols) * mode.direction).toBeGreaterThan(0);
    await newTab(page, mode.mobile);
    await page
      .getByRole("dialog")
      .getByRole("button", { name: "sh", exact: true })
      .click();
    await expect(page.locator(`[data-iori-terminal-id="${id}"]`)).toBeHidden();
    await reopen(page, id, mode.mobile);
    await sendLine(visibleTerminal(page), "printf 'CONTINUED:%s\\n' retained");
    const output = await app.terminalText(id, "CONTINUED:retained");
    expect(output).toContain("BEFORE:retained");
  };
}
test(
  "Terminalの幅とタブを変えても出力を保持し続けて入力する",
  { tag: "@desktop" },
  journey(modes[0]),
);
test(
  "スマホでTerminalの幅とタブを変えても出力を保持し続けて入力する",
  { tag: "@phone" },
  journey(modes[1]),
);

const linkedFileBody = "Content of the linked file";

for (const { title, path, fragment, tab, content } of [
  {
    title: "Terminalのファイルリンクから作業ディレクトリ外のファイルを開く",
    path: "../external notes.md",
    fragment: "",
    tab: "external notes.md",
    content: (page: Page) => page.getByText(linkedFileBody),
  },
  {
    title: "TerminalのファイルリンクからFilesで指定した行を開く",
    path: "notes.md",
    fragment: "#L3-L5",
    tab: "Files",
    content: (page: Page) =>
      page
        .locator('[data-iori-line="3"][data-selected="true"]')
        .getByText(linkedFileBody),
  },
]) {
  test(title, { tag: "@desktop" }, async ({ page, registeredApp: app }) => {
    await app.files({ [path]: `# Notes\n\n${linkedFileBody}\n` });
    await app.open(page);
    await openFolder(page, app);
    await newTab(page, false);
    await page
      .getByRole("dialog")
      .getByRole("button", { name: "Bash" })
      .click();
    const terminal = visibleTerminal(page);
    const id = await terminalId(terminal);
    const uri = pathToFileURL(resolve(app.folder, path)).href + fragment;
    // Put the linked label at the top left of the terminal screen.
    await sendLine(
      terminal,
      `printf '\\033[2J\\033[H\\033]8;;%s\\007Open document\\033]8;;\\007\\n' '${uri}'`,
    );
    await app.terminalText(id, `\x1b]8;;${uri}\x07Open document\x1b]8;;\x07`);
    await expect(terminal.getByRole("textbox")).toBeFocused();
    await terminal.locator(".xterm-screen").click({ position: { x: 1, y: 1 } });
    await expect(
      page.getByRole("tab", { name: tab, exact: true }),
    ).toHaveAttribute("aria-selected", "true");
    await expect(content(page)).toBeVisible();
  });
}
