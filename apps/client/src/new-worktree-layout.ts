import type { SerializedDockview } from "dockview-react";

export type LayoutSlotKind =
  "agent" | "files" | "git" | "board" | "issues" | "ci" | "terminal";
export type LayoutSlot = { id: string; kind: LayoutSlotKind };
export type WorktreeLayoutTemplate = {
  version: 1;
  layout: SerializedDockview;
  slots: LayoutSlot[];
  activeSlot?: string;
};
const kinds: LayoutSlotKind[] = [
  "agent",
  "files",
  "git",
  "board",
  "issues",
  "ci",
  "terminal",
];
const object = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === "object" && !Array.isArray(value);

type GridNode = SerializedDockview["grid"]["root"];
type Group = Exclude<GridNode["data"], GridNode[]>;
type Tree = {
  size?: number;
  group?: Group;
  children?: Tree[];
  axis: SerializedDockview["grid"]["orientation"];
};

/** Keep only mapped panels, remove empty groups and collapse redundant splits.
 * Rebuild only portable Dockview fields: panel params never carry a target/path.
 */
export function pruneLayout(
  layout: SerializedDockview,
  panelIds: ReadonlyMap<string, string>,
): SerializedDockview | undefined {
  const panels: SerializedDockview["panels"] = {};
  const groups = new Map<string, string>();
  const read = (
    node: GridNode,
    axis: SerializedDockview["grid"]["orientation"],
  ): Tree | undefined => {
    if (node.type === "leaf" && !Array.isArray(node.data)) {
      const views = node.data.views.flatMap((id) => {
        const mapped = panelIds.get(id);
        if (!mapped || !layout.panels[id]) return [];
        panels[mapped] = {
          id: mapped,
          contentComponent: "workspace",
          params: { tabId: mapped },
        };
        return [mapped];
      });
      if (!views.length) return;
      const id = `group-${groups.size + 1}`;
      groups.set(node.data.id, id);
      const activeView = panelIds.get(node.data.activeView ?? "");
      return {
        axis,
        size: node.size,
        group: {
          id,
          views,
          activeView:
            activeView && views.includes(activeView) ? activeView : views[0],
        },
      };
    }
    if (node.type !== "branch" || !Array.isArray(node.data)) return;
    const children = node.data.flatMap((child) => {
      const kept = read(
        child,
        axis === "HORIZONTAL"
          ? ("VERTICAL" as typeof axis)
          : ("HORIZONTAL" as typeof axis),
      );
      return kept ? [kept] : [];
    });
    if (!children.length) return;
    if (children.length === 1)
      return { ...children[0], size: node.size ?? children[0].size };
    // Collapsing a level can put parallel splits next to one another.
    const flattened = children.flatMap((child) => {
      if (!child.children || child.axis !== axis) return [child];
      const total = child.children.reduce(
        (sum, item) => sum + (item.size ?? 1),
        0,
      );
      return child.children.map((item) => ({
        ...item,
        size: ((child.size ?? total) * (item.size ?? 1)) / total,
      }));
    });
    return { axis, size: node.size, children: flattened };
  };
  const tree = read(layout.grid.root, layout.grid.orientation);
  if (!tree) return;
  const write = (node: Tree): GridNode =>
    node.group
      ? { type: "leaf", size: node.size, data: node.group }
      : { type: "branch", size: node.size, data: node.children!.map(write) };
  const root = tree.group
    ? { type: "branch" as const, data: [write(tree)] }
    : write(tree);
  return {
    grid: {
      root,
      width: layout.grid.width,
      height: layout.grid.height,
      orientation: tree.group ? layout.grid.orientation : tree.axis,
    },
    panels,
    activeGroup:
      groups.get(layout.activeGroup ?? "") ?? [...groups.values()][0],
  };
}

/** Unknown/damaged settings are treated as an unsaved default. */
export function readWorktreeLayoutTemplate(
  value: unknown,
): WorktreeLayoutTemplate | undefined {
  if (
    !object(value) ||
    value.version !== 1 ||
    !object(value.layout) ||
    !Array.isArray(value.slots)
  )
    return;
  const seen = new Set<string>();
  const slots = value.slots
    .filter((slot): slot is LayoutSlot => {
      if (
        !object(slot) ||
        typeof slot.id !== "string" ||
        !kinds.includes(slot.kind as LayoutSlotKind) ||
        seen.has(slot.id)
      )
        return false;
      seen.add(slot.id);
      return true;
    })
    .map(({ id, kind }) => ({ id, kind }));
  if (!slots.length) return;
  try {
    const layout = pruneLayout(
      value.layout as unknown as SerializedDockview,
      new Map(slots.map(({ id }) => [id, id])),
    );
    if (!layout) return;
    return {
      version: 1,
      layout,
      slots: slots.filter(({ id }) => layout.panels[id]),
      activeSlot:
        typeof value.activeSlot === "string" && layout.panels[value.activeSlot]
          ? value.activeSlot
          : undefined,
    };
  } catch {
    return;
  }
}
