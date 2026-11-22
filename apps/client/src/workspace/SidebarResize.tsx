import type {
  KeyboardEvent as ReactKeyboardEvent,
  PointerEvent as ReactPointerEvent,
} from "react";
import { cn } from "cn";
import { useSidebar } from "../components/ui/sidebar.tsx";
import { hasWindowChrome } from "../native.ts";
import { DEFAULT_SIDEBAR_WIDTH } from "../Settings.tsx";

const MIN_SIDEBAR_WIDTH = 240;
const KEYBOARD_STEP_PX = 16;

function maxSidebarWidth() {
  return Math.max(MIN_SIDEBAR_WIDTH, Math.floor(window.innerWidth / 2));
}

function clampSidebarWidth(value: number) {
  return Math.round(
    Math.max(MIN_SIDEBAR_WIDTH, Math.min(maxSidebarWidth(), value)),
  );
}

export function SidebarResize({
  width,
  onWidthChange,
  t,
}: {
  width: number;
  onWidthChange: (width: number) => void;
  t: (key: string) => string;
}) {
  const { isMobile, open } = useSidebar();
  if (isMobile || !open) return null;

  const maxWidth = maxSidebarWidth();
  const currentWidth = clampSidebarWidth(width);

  const applyWidth = (handle: HTMLElement, nextWidth: number) => {
    handle
      .closest<HTMLElement>(".workspace")
      ?.style.setProperty("--sidebar-preferred-width", `${nextWidth}px`);
    onWidthChange(nextWidth);
  };

  const begin = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return;
    const workspace = event.currentTarget.closest<HTMLElement>(".workspace");
    if (!workspace) return;
    event.preventDefault();
    const startX = event.clientX;
    const startWidth =
      workspace
        .querySelector<HTMLElement>('[data-slot="sidebar-gap"]')
        ?.getBoundingClientRect().width ?? width;
    let next = startWidth;
    let moved = false;
    workspace.dataset.sidebarResizing = "true";
    const move = (e: PointerEvent) => {
      if (e.pointerId !== event.pointerId) return;
      next = clampSidebarWidth(startWidth + e.clientX - startX);
      moved = true;
      workspace.style.setProperty("--sidebar-preferred-width", `${next}px`);
    };
    const finish = () => {
      document.removeEventListener("pointermove", move);
      document.removeEventListener("pointerup", finish);
      document.removeEventListener("pointercancel", finish);
      window.removeEventListener("blur", finish);
      delete workspace.dataset.sidebarResizing;
      if (moved) onWidthChange(next);
    };
    document.addEventListener("pointermove", move);
    document.addEventListener("pointerup", finish);
    document.addEventListener("pointercancel", finish);
    window.addEventListener("blur", finish);
  };

  const handleKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    if (event.key === "ArrowLeft") {
      event.preventDefault();
      applyWidth(
        event.currentTarget,
        clampSidebarWidth(currentWidth - KEYBOARD_STEP_PX),
      );
    } else if (event.key === "ArrowRight") {
      event.preventDefault();
      applyWidth(
        event.currentTarget,
        clampSidebarWidth(currentWidth + KEYBOARD_STEP_PX),
      );
    } else if (event.key === "Home") {
      event.preventDefault();
      applyWidth(event.currentTarget, DEFAULT_SIDEBAR_WIDTH);
    }
  };

  return (
    <div
      className={cn(
        "workspace-resize-handle sidebar-resize-handle absolute bottom-0 left-[calc(var(--sidebar-width)-4px)] z-20 w-2 cursor-ew-resize touch-none",
        hasWindowChrome ? "top-[var(--window-caption-height,35px)]" : "top-0",
        "after:absolute after:inset-y-0 after:left-[3px] after:w-0.5 after:content-['']",
        "hover:after:bg-sidebar-border focus-visible:outline-none focus-visible:after:bg-ring",
        "in-[.workspace[data-sidebar-resizing]]:after:bg-sidebar-border",
      )}
      role="separator"
      aria-orientation="vertical"
      aria-label={t("Resize sidebar")}
      aria-valuenow={currentWidth}
      aria-valuemin={MIN_SIDEBAR_WIDTH}
      aria-valuemax={maxWidth}
      tabIndex={0}
      onPointerDown={begin}
      onKeyDown={handleKeyDown}
      onDoubleClick={(event) => {
        applyWidth(event.currentTarget, DEFAULT_SIDEBAR_WIDTH);
      }}
    />
  );
}
