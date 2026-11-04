import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
} from "./components/ui/dropdown-menu.tsx";
import type { ReactNode } from "react";
import { Plus, X, MoreHorizontal } from "lucide-react";
import { Button } from "./components/ui/button.tsx";
import { SidebarTrigger } from "./components/ui/sidebar.tsx";
import { hasWindowChrome } from "./native.ts";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "./components/ui/popover.tsx";
import "./mobile-workspace.css";

/** The thin location row and one full-screen View for a worktree on Mobile. */
export function MobileWorkspace({
  name,
  branch,
  t,
  onNew,
  onCloseView,
  onStopChild,
  children,
}: {
  name: string;
  branch?: string;
  t: (key: string) => string;
  /** Opens the list of shells to start a new View in this worktree. */
  onNew: () => void;
  /** Closes the shown View, as a tab's × does; a Terminal keeps running. */
  onCloseView?: () => void;
  onStopChild?: () => void;
  children: ReactNode;
}) {
  const location = branch ? `${name} · ${branch}` : name;
  return (
    <div className="mobile-workspace">
      <header className="mobile-location" data-iori-part="mobile-location">
        <SidebarTrigger
          className="size-12"
          title={t("Open sidebar")}
          data-iori-action="sidebar-toggle"
          aria-label={t("Open sidebar")}
        />
        <Popover>
          <PopoverTrigger asChild>
            <button
              type="button"
              className="mobile-location-label"
              title={location}
            >
              {location}
            </button>
          </PopoverTrigger>
          <PopoverContent>{location}</PopoverContent>
        </Popover>
        {hasWindowChrome && (
          <div className="window-mobile-drag-region" data-tauri-drag-region />
        )}
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label={t("New tab")}
          title={t("New tab")}
          data-iori-action="workspace-add-tab"
          onClick={onNew}
        >
          <Plus size={16} />
        </Button>
        {onStopChild && (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                variant="ghost"
                size="icon-sm"
                aria-label={t("Child actions")}
              >
                <MoreHorizontal size={16} />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent>
              <DropdownMenuItem
                data-iori-action="child-tab-stop"
                onSelect={onStopChild}
              >
                {t("Stop child")}
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        )}
        {onCloseView && (
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label={t("Close tab")}
            title={t("Close tab")}
            data-iori-action="workspace-close-tab"
            onClick={onCloseView}
          >
            <X size={16} />
          </Button>
        )}
      </header>
      <div className="mobile-view-content">{children}</div>
    </div>
  );
}
