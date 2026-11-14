import {
  test,
  expect,
  visibleTerminal,
  terminalId,
  sendLine,
} from "./fixtures/test.ts";
import { openPath, launch, sidebar } from "./fixtures/journeys.ts";
import type { Page, Locator } from "@playwright/test";

async function reorder(
  page: Page,
  from: Locator,
  to: Locator,
  mobile: boolean,
) {
  await from.hover();
  const a = (await from.boundingBox())!,
    b = (await to.boundingBox())!;
  const announcement = page
    .getByRole("status")
    .filter({ hasText: /Picked up\.|Move to this position\./ });
  if (mobile) {
    const session = await page.context().newCDPSession(page);
    await session.send("Input.dispatchTouchEvent", {
      type: "touchStart",
      touchPoints: [{ x: a.x + a.width / 2, y: a.y + a.height / 2 }],
    });
    await expect(announcement).toContainText(
      /Picked up\.|Move to this position\./,
    );
    await session.send("Input.dispatchTouchEvent", {
      type: "touchMove",
      touchPoints: [{ x: b.x + b.width / 2, y: b.y + b.height / 2 }],
    });
    await session.send("Input.dispatchTouchEvent", {
      type: "touchEnd",
      touchPoints: [],
    });
    await session.detach();
  } else {
    await page.mouse.move(a.x + a.width / 2, a.y + a.height / 2);
    await page.mouse.down();
    await page.mouse.move(a.x + a.width / 2 + 12, a.y + a.height / 2);
    await expect(announcement).toContainText(
      /Picked up\.|Move to this position\./,
    );
    await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2);
    await page.mouse.up();
  }
}
function journey(mobile: boolean) {
  return async ({
    page,
    registeredApp: app,
  }: {
    page: Page;
    registeredApp: import("./fixtures/test.ts").App;
  }) => {
    const git = await app.host.forge();
    const second = await app.addHost();
    await app.registerHost(second);
    await page.goto(app.url);
    await openPath(page, app.folder, app.hostKey, mobile);
    await openPath(page, git.repository, app.hostKey, mobile);
    await sidebar(page, mobile);
    await page.locator(`[data-iori-worktree-path="${git.worktree}"]`).click();
    await expect(
      page.locator("[data-iori-current-worktree-path]"),
    ).toHaveAttribute("data-iori-current-worktree-path", git.worktree);
    if (mobile)
      await page.getByRole("button", { name: "Files", exact: true }).click();
    await openPath(page, second.folder, second.hostKey, mobile);
    await launch(page, "Bash");
    const pane = visibleTerminal(page),
      id = await terminalId(pane);
    await expect(pane).toHaveAttribute("data-iori-host-key", second.hostKey);
    await sendLine(pane, "pwd");
    await app.terminalText(id, second.folder);
    await sidebar(page, mobile);
    const firstHost = page
      .getByRole("button")
      .and(page.locator(`[data-iori-host-key="${app.hostKey}"][aria-expanded]`))
      .filter({ hasNotText: "Host settings" });
    const nextHost = page
      .getByRole("button")
      .and(
        page.locator(`[data-iori-host-key="${second.hostKey}"][aria-expanded]`),
      )
      .filter({ hasNotText: "Host settings" });
    await reorder(page, nextHost, firstHost, mobile);
    const hostRows = page
      .getByRole("button")
      .and(page.locator("[data-iori-host-key][aria-expanded]"));
    await expect(hostRows.first()).toHaveAttribute(
      "data-iori-host-key",
      second.hostKey,
    );
    const plain = page.locator(`[data-iori-worktree-path="${app.folder}"]`);
    const repository = page
      .locator(`[data-iori-repository-path="${git.repository}"]`)
      .and(page.getByRole("button", { name: "repository", exact: true }));
    await reorder(page, repository, plain, mobile);
    if (mobile) await firstHost.tap();
    else await firstHost.click();
    await expect(firstHost).toHaveAttribute("aria-expanded", "false");
    await page.reload();
    if (mobile)
      await expect(
        page.getByRole("heading", { name: /^Worktree/ }),
      ).toBeVisible();
    else
      await expect(visibleTerminal(page)).toHaveAttribute(
        "data-iori-terminal-id",
        id,
      );
    await sidebar(page, mobile);
    await expect(
      firstHost.getByRole("img", { name: "Connected", exact: true }),
    ).toBeVisible();
    await expect(hostRows.first()).toHaveAttribute(
      "data-iori-host-key",
      second.hostKey,
    );
    await expect(firstHost).toHaveAttribute("aria-expanded", "false");
    if (mobile) await firstHost.tap();
    else await firstHost.click();
    const folders = plain.or(repository);
    await expect(folders.first()).toHaveAttribute(
      "data-iori-repository-path",
      git.repository,
    );
  };
}
test(
  "複数Hostとフォルダーとworktreeを選び順序と開閉を保持する",
  { tag: "@desktop" },
  journey(false),
);
test(
  "スマホで複数Hostとフォルダーとworktreeの順序と開閉を保持する",
  { tag: "@phone" },
  journey(true),
);
