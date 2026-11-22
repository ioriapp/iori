import type {
  DockviewApi,
  IDockviewHeaderActionsProps,
  IDockviewPanelHeaderProps,
} from "dockview-react";

export type DockGroup = IDockviewHeaderActionsProps["group"];

/**
 * Isolates Dockview internal model and DOM structure access (`.dv-*`,
 * `group.model`, `group.element`) so layout components depend on one adapter.
 */

export function hasDockGroupActivePanel(group: DockGroup): boolean {
  return Boolean(group.model.activePanel);
}

export function dockGroupActivePanelId(group: DockGroup): string | undefined {
  return group.activePanel?.id;
}

export function dockGroupPanels(group: DockGroup) {
  return group.panels;
}

export function isDockPanelActiveInGroup(
  panel: IDockviewPanelHeaderProps<{ tabId: string }>,
): boolean {
  return panel.api.group.activePanel?.id === panel.api.id;
}

export function dockPanelTabId(panel: {
  params?: Record<string, unknown>;
}): string | undefined {
  return typeof panel.params?.tabId === "string"
    ? panel.params.tabId
    : undefined;
}

export function dockGroupCount(api: DockviewApi): number {
  return api.groups.length;
}

export function activeDockPanelId(api: DockviewApi | null): string | undefined {
  return api?.activePanel?.id;
}

export function activeDockGroup(
  api: DockviewApi | null,
): DockGroup | undefined {
  return api?.activePanel?.api.group;
}

export function findDockGroup(
  api: DockviewApi | null,
  groupId: string | undefined,
): DockGroup | undefined {
  if (!api || !groupId) return undefined;
  return api.groups.find((item) => item.id === groupId);
}

export function dockGroupElement(group: DockGroup): HTMLElement {
  return group.element;
}

export function findDockTabsStrip(
  element: HTMLElement | null,
): HTMLElement | null {
  return element?.closest<HTMLElement>(".dv-tabs-container") ?? null;
}

export function syncMaximizedPanelOverlay(
  contentElement: HTMLElement | null,
  isMaximized: boolean,
): void {
  contentElement
    ?.closest(".dv-render-overlay")
    ?.classList.toggle("iori-dock-maximized-overlay", isMaximized);
}

export function clearMaximizedGroupClasses(root: HTMLElement | null): void {
  root
    ?.querySelectorAll(".iori-dock-maximized")
    .forEach((item) => item.classList.remove("iori-dock-maximized"));
}

export function isDockGroupMaximized(group: DockGroup): boolean {
  return group.element.classList.contains("iori-dock-maximized");
}

export function setDockGroupMaximized(
  group: DockGroup,
  maximized: boolean,
): void {
  group.element.classList.toggle("iori-dock-maximized", maximized);
}

export function setDockGroupPaneWidth(
  group: DockGroup,
  root: HTMLElement | null,
  width: string,
): void {
  group.element.style.setProperty("--iori-pane-width", width);
  root?.style.setProperty("--iori-maximized-pane-width", width);
}

/**
 * Assigns a single `role="tablist"` per Dockview pane tab strip and demotes
 * Dockview's outer `.dv-tab` wrappers to `role="presentation"` so each inner
 * tab button is the sole `role="tab"` inside its pane's tablist.
 */
export function syncDockTablistSemantics(
  root: HTMLElement | null,
  tablistLabel: string,
): void {
  if (!root) return;
  for (const strip of root.querySelectorAll<HTMLElement>(
    ".dv-tabs-container",
  )) {
    if (strip.getAttribute("role") !== "tablist") {
      strip.setAttribute("role", "tablist");
    }
    if (strip.getAttribute("aria-orientation") !== "horizontal") {
      strip.setAttribute("aria-orientation", "horizontal");
    }
    if (strip.getAttribute("aria-label") !== tablistLabel) {
      strip.setAttribute("aria-label", tablistLabel);
    }
    for (const wrapper of strip.querySelectorAll<HTMLElement>(".dv-tab")) {
      if (wrapper.getAttribute("role") !== "presentation") {
        wrapper.setAttribute("role", "presentation");
      }
      if (wrapper.hasAttribute("aria-selected")) {
        wrapper.removeAttribute("aria-selected");
      }
      if (wrapper.hasAttribute("tabindex")) {
        wrapper.removeAttribute("tabindex");
      }
    }
  }
}

/**
 * Updates Dockview header bars for sidebar toggle placement, Windows caption
 * drag regions, and single-tablist ARIA semantics.
 */
export function syncDockHeaders(
  root: HTMLElement | null,
  hasWindowChrome: boolean,
  tablistLabel: string,
): Element | null {
  if (!root) return null;
  syncDockTablistSemantics(root, tablistLabel);
  const bars = Array.from(
    root.querySelectorAll(".dv-tabs-and-actions-container"),
  ).filter((element) => element.getBoundingClientRect().width > 0);
  bars.sort((a, b) => {
    const x = a.getBoundingClientRect();
    const y = b.getBoundingClientRect();
    return x.top - y.top || x.left - y.left;
  });
  if (hasWindowChrome) {
    const topBars = bars.filter((bar) => bar.getBoundingClientRect().top === 0);
    const right = topBars.at(-1);
    for (const bar of bars) {
      bar.classList.toggle("window-caption-right", bar === right);
      const regions = [bar, ...bar.querySelectorAll(".dv-void-container")];
      for (const region of regions) {
        if (topBars.includes(bar))
          region.setAttribute("data-tauri-drag-region", "");
        else region.removeAttribute("data-tauri-drag-region");
      }
    }
  }
  return bars[0] ?? null;
}

/**
 * Moves keyboard focus and selection across `role="tab"` elements within the
 * same Dockview pane tablist (WAI-ARIA automatic-activation horizontal tabs).
 */
export function moveDockTabFocus(
  currentTab: HTMLButtonElement,
  key: string,
): boolean {
  if (
    key !== "ArrowLeft" &&
    key !== "ArrowRight" &&
    key !== "Home" &&
    key !== "End"
  ) {
    return false;
  }
  const tablist = currentTab.closest<HTMLElement>('[role="tablist"]');
  if (!tablist) return false;
  const tabs = Array.from(
    tablist.querySelectorAll<HTMLButtonElement>('[role="tab"]'),
  );
  if (tabs.length < 2) return false;
  const index = tabs.indexOf(currentTab);
  if (index === -1) return false;
  const nextIndex =
    key === "Home"
      ? 0
      : key === "End"
        ? tabs.length - 1
        : (index + (key === "ArrowRight" ? 1 : -1) + tabs.length) % tabs.length;
  const target = tabs[nextIndex];
  if (!target || target === currentTab) return false;
  target.focus();
  target.click();
  return true;
}
