import type { Page } from "@playwright/test";
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
    await page.goto(app.url);
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
