import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
  type RefObject,
} from "react";
import type { createWorkspaceDockAdapter } from "../workspace-dock-adapter.ts";
import type { WorkspaceTab, WorkspaceViewKind } from "../workspace-panel.tsx";
import {
  clearMaximizedGroupClasses,
  dockGroupElement,
  findDockGroup,
  isDockGroupMaximized,
  setDockGroupMaximized,
  setDockGroupPaneWidth,
  type DockGroup,
} from "./dock-adapter.ts";
import { maximizesFullWidth, type WorkspaceFrameProps } from "./types.ts";

export function useWorkspaceMaximize({
  dock,
  dockRoot,
  isMobile,
  activeTabId,
  tabs,
  panelWidths,
  panelFullWidth,
  onPanelWidthsChange,
  onPanelFullWidthChange,
}: {
  dock: ReturnType<typeof createWorkspaceDockAdapter>;
  dockRoot: RefObject<HTMLDivElement | null>;
  isMobile: boolean;
  activeTabId: string;
  tabs: WorkspaceTab[];
  panelWidths: WorkspaceFrameProps["panelWidths"];
  panelFullWidth: WorkspaceFrameProps["panelFullWidth"];
  onPanelWidthsChange: WorkspaceFrameProps["onPanelWidthsChange"];
  onPanelFullWidthChange: WorkspaceFrameProps["onPanelFullWidthChange"];
}) {
  const [maximizedGroup, setMaximizedGroup] = useState<string>();
  const [maximizedWidths, setMaximizedWidths] = useState(panelWidths);
  const [maximizedFullWidth, setMaximizedFullWidth] = useState(panelFullWidth);
  const maximizedWidthsRef = useRef(maximizedWidths);
  maximizedWidthsRef.current = maximizedWidths;
  const maximizedFullWidthRef = useRef(maximizedFullWidth);
  maximizedFullWidthRef.current = maximizedFullWidth;
  // A maximized pane is never narrower than the same pane before maximizing.
  const unmaximizedWidth = useRef(0);

  useEffect(() => setMaximizedWidths(panelWidths), [panelWidths]);
  useEffect(() => setMaximizedFullWidth(panelFullWidth), [panelFullWidth]);

  const widthForKind = useCallback(
    (kind: WorkspaceViewKind) =>
      maximizedWidthsRef.current[kind] ?? (kind === "terminal" ? 1100 : 1400),
    [],
  );

  const kindOfGroup = dock.kindOfGroup;

  const setGroupWidth = useCallback(
    (group: DockGroup, fullWidth: boolean) => {
      const kind = kindOfGroup(group);
      const width = fullWidth
        ? "calc(100vw - 24px)"
        : `min(${Math.max(widthForKind(kind), unmaximizedWidth.current)}px, calc(100vw - 24px))`;
      setDockGroupPaneWidth(group, dockRoot.current, width);
    },
    [dockRoot, kindOfGroup, widthForKind],
  );

  const toggleMaximize = useCallback(
    (group: DockGroup) => {
      if (isMobile) return;
      if (isDockGroupMaximized(group)) {
        setDockGroupMaximized(group, false);
        setMaximizedGroup(undefined);
        return;
      }
      clearMaximizedGroupClasses(dockRoot.current);
      unmaximizedWidth.current = Math.round(
        dockGroupElement(group).getBoundingClientRect().width,
      );
      setGroupWidth(
        group,
        maximizesFullWidth(kindOfGroup(group), maximizedFullWidthRef.current),
      );
      setDockGroupMaximized(group, true);
      setMaximizedGroup(group.id);
    },
    [dockRoot, isMobile, kindOfGroup, setGroupWidth],
  );

  const toggleMaximizedFullWidth = (group: DockGroup) => {
    const kind = kindOfGroup(group);
    const next = {
      ...maximizedFullWidthRef.current,
      [kind]: !maximizesFullWidth(kind, maximizedFullWidthRef.current),
    };
    maximizedFullWidthRef.current = next;
    setMaximizedFullWidth(next);
    setGroupWidth(group, maximizesFullWidth(kind, next));
    onPanelFullWidthChange(next);
  };

  const beginMaximizedResize =
    (kind: WorkspaceViewKind, side: "left" | "right") =>
    (event: ReactPointerEvent<HTMLDivElement>) => {
      event.preventDefault();
      event.stopPropagation();
      const group = findDockGroup(dock.api, maximizedGroup);
      if (!group || maximizesFullWidth(kind, maximizedFullWidthRef.current))
        return;
      const startWidth = dockGroupElement(group).getBoundingClientRect().width;
      const startX = event.clientX;
      const direction = side === "right" ? 1 : -1;
      const move = (moveEvent: PointerEvent) => {
        const maxWidth = Math.max(240, window.innerWidth - 24);
        const nextWidth = Math.round(
          Math.min(
            Math.max(
              Math.min(360, maxWidth),
              startWidth + (moveEvent.clientX - startX) * direction * 2,
            ),
            maxWidth,
          ),
        );
        const paneWidth = `min(${nextWidth}px, calc(100vw - 24px))`;
        setDockGroupPaneWidth(group, dockRoot.current, paneWidth);
        const next = { ...maximizedWidthsRef.current, [kind]: nextWidth };
        maximizedWidthsRef.current = next;
        setMaximizedWidths(next);
      };
      const finish = () => {
        window.removeEventListener("pointermove", move);
        window.removeEventListener("pointercancel", finish);
        window.removeEventListener("pointerup", finish);
        onPanelWidthsChange(maximizedWidthsRef.current);
      };
      window.addEventListener("pointermove", move);
      window.addEventListener("pointercancel", finish, { once: true });
      window.addEventListener("pointerup", finish, { once: true });
    };

  const closeMaximize = useCallback(() => {
    clearMaximizedGroupClasses(dockRoot.current);
    setMaximizedGroup(undefined);
  }, [dockRoot]);

  useEffect(() => {
    if (maximizedGroup) return;
    // Switching tabs while maximized makes Dockview measure the lifted group.
    // Refresh its overlay coordinates once the normal group geometry is back.
    dock.refreshOverlays();
  }, [dock, maximizedGroup]);

  // Keep the overlay of the maximized group's visible panel lifted with it,
  // also when the view changes inside the group. Split ratios stay unchanged.
  useEffect(() => {
    if (!maximizedGroup) return;
    const group = findDockGroup(dock.api, maximizedGroup);
    if (!group) {
      setMaximizedGroup(undefined);
      return;
    }
    setGroupWidth(
      group,
      maximizesFullWidth(kindOfGroup(group), maximizedFullWidthRef.current),
    );
  }, [activeTabId, dock.api, kindOfGroup, maximizedGroup, tabs, setGroupWidth]);

  useEffect(() => {
    if (isMobile) closeMaximize();
  }, [isMobile, closeMaximize]);

  const maximizedDockGroup = findDockGroup(dock.api, maximizedGroup);
  const isMaximizedFullWidth = maximizedDockGroup
    ? maximizesFullWidth(kindOfGroup(maximizedDockGroup), maximizedFullWidth)
    : false;

  return {
    maximizedGroup,
    setMaximizedGroup,
    maximizedDockGroup,
    isMaximizedFullWidth,
    toggleMaximize,
    toggleMaximizedFullWidth,
    beginMaximizedResize,
    closeMaximize,
  };
}
