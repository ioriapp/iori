import { waitFor } from "../ui.mjs";

// Dragging a tab to an edge moves it; split buttons open a Start tab in a new pane.
export async function splitTab(screen, selector, direction) {
  const id = await screen.attribute(selector, "data-iori-tab-id");
  const group = await screen.attribute(
    selector,
    "data-iori-group-id",
    "[data-iori-group-id]",
  );
  await screen.drag(
    selector,
    `[data-iori-workspace-panel=${JSON.stringify(id)}]`,
    direction === "right" ? { x: 0.95 } : { y: 0.95 },
  );
  await waitFor(
    () =>
      screen.attribute(selector, "data-iori-group-id", "[data-iori-group-id]"),
    (value) => value && value !== group,
  );
}

// PC uses tabs and the + menu; Mobile keeps the drawer entries.
export async function openWorkspaceView(screen, kind, groupId) {
  const drawer = `[data-iori-action="sidebar-open-${kind}"]`;
  if (await screen.visible(drawer)) return screen.click(drawer);
  const tab = `button[data-iori-tab-kind="${kind}"]`;
  if (
    await screen.evaluate(
      `Boolean(document.querySelector(${JSON.stringify(tab)}))`,
    )
  )
    return screen.click(tab);
  await screen.click(
    (groupId ? `[data-iori-group-id=${JSON.stringify(groupId)}] ` : "") +
      '[data-iori-action="workspace-add-tab"]',
  );
  await screen.click(`[data-iori-action="workspace-open-${kind}"]`);
}
