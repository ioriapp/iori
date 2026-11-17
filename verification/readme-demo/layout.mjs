// Use the product's split button, tab menu and pane divider for the recording.
export async function setBoardWidth(page, width = 1000) {
  const board = await page.locator('[data-iori-view="board"]').boundingBox();
  const sash = page
    .locator(
      ".dv-split-view-container.dv-horizontal > .dv-sash-container > .dv-sash.dv-enabled",
    )
    .first();
  const handle = await sash.boundingBox();
  await page.mouse.move(handle.x + handle.width / 2, handle.y + 80);
  await page.mouse.down();
  await page.mouse.move(board.x + board.width - width, handle.y + 80, {
    steps: 18,
  });
  await page.mouse.up();
}

export async function splitBoard(page) {
  await page.locator('[data-iori-tab-kind="board"]').hover();
  await page.getByRole("button", { name: "Board Close", exact: true }).click();
  await page
    .getByRole("button", { name: "Split right", exact: true })
    .first()
    .click();
  await page
    .getByRole("button", { name: "New tab", exact: true })
    .last()
    .click();
  await page.locator('[data-iori-action="workspace-open-board"]').click();
  await setBoardWidth(page);
}
