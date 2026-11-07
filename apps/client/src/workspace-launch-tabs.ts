export function replaceStartTab<T extends { id: string }>(
  tabs: T[],
  startTabId: string,
  terminalTab: T,
): T[] {
  if (tabs.some((tab) => tab.id === terminalTab.id))
    return tabs.filter((tab) => tab.id !== startTabId);
  return tabs.map((tab) => (tab.id === startTabId ? terminalTab : tab));
}
