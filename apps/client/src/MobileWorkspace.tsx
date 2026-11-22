import type { ReactNode } from "react";
import { cn } from "cn";
import {
  Check,
  ChevronDown,
  CircleDot,
  FileCode,
  GitBranch,
  LayoutDashboard,
  MoreHorizontal,
  Plus,
  Terminal,
  Workflow,
  X,
} from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
} from "./components/ui/dropdown-menu.tsx";
import { Button } from "./components/ui/button.tsx";
import { SidebarTrigger } from "./components/ui/sidebar.tsx";
import { StatusDot } from "./components/StatusDot.tsx";
import { hasWindowChrome } from "./native.ts";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "./components/ui/popover.tsx";

export type MobileViewTabKind =
  "terminal" | "board" | "files" | "git" | "issues" | "ci";

export type MobileViewTab = {
  id: string;
  label: string;
  kind: MobileViewTabKind;
  active: boolean;
  badge?: number;
  onSelect: () => void;
};

export type MobileSessionItem = {
  id: string;
  label: string;
  active: boolean;
  attention?: boolean;
  onSelect: () => void;
};

const VIEW_TAB_ICONS: Record<MobileViewTabKind, typeof Terminal> = {
  terminal: Terminal,
  board: LayoutDashboard,
  files: FileCode,
  git: GitBranch,
  issues: CircleDot,
  ci: Workflow,
};

/** The thin location row, optional 1-tap View switcher bar, and full-screen View on Mobile. */
export function MobileWorkspace({
  name,
  branch,
  t,
  onNew,
  onCloseView,
  onStopChild,
  viewTabs,
  sessions,
  activeSessionLabel,
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
  viewTabs?: MobileViewTab[];
  sessions?: MobileSessionItem[];
  activeSessionLabel?: string;
  children: ReactNode;
}) {
  const location = branch ? `${name} · ${branch}` : name;
  const activeSession = sessions?.find((session) => session.active);
  const sessionTriggerLabel =
    activeSessionLabel ?? activeSession?.label ?? t("Open tabs");
  const hasSessionAttention = sessions?.some(
    (session) => session.attention && !session.active,
  );

  return (
    <div className="mobile-workspace flex h-full min-h-0 flex-col bg-background">
      <header
        className="mobile-location flex h-[calc(var(--spacing)*12+1px)] min-h-[calc(var(--spacing)*12+1px)] shrink-0 items-center gap-1 border-b border-border bg-background px-1.5 text-xs text-muted-foreground"
        data-iori-part="mobile-location"
      >
        <SidebarTrigger
          className="size-11 shrink-0 text-muted-foreground hover:text-foreground"
          title={t("Open sidebar")}
          data-iori-action="sidebar-toggle"
          aria-label={t("Open sidebar")}
        />
        <Popover>
          <PopoverTrigger asChild>
            <button
              type="button"
              className="mobile-location-label min-w-0 flex-1 truncate rounded-sm border-0 bg-transparent px-1 py-1.5 text-left font-medium text-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring"
              title={location}
            >
              {location}
            </button>
          </PopoverTrigger>
          <PopoverContent className="max-w-xs break-words text-xs">
            {location}
          </PopoverContent>
        </Popover>
        {sessions && sessions.length >= 2 && (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                variant="ghost"
                size="sm"
                className="h-10 max-w-36 shrink-0 gap-1 px-2 text-xs font-medium text-foreground [@media(pointer:coarse)]:h-11"
                data-iori-action="mobile-session-switch"
                aria-label={sessionTriggerLabel}
                title={sessionTriggerLabel}
              >
                {hasSessionAttention && (
                  <StatusDot state="waiting" t={t} aria-hidden="true" />
                )}
                <span className="min-w-0 truncate">{sessionTriggerLabel}</span>
                <ChevronDown
                  className="size-3.5 shrink-0 text-muted-foreground"
                  aria-hidden="true"
                />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="max-w-64">
              {sessions.map((session) => (
                <DropdownMenuItem
                  key={session.id}
                  data-iori-mobile-session={session.id}
                  onSelect={session.onSelect}
                  className="gap-2"
                >
                  {session.attention ? (
                    <StatusDot state="waiting" t={t} />
                  ) : (
                    <Check
                      className={cn(
                        "size-3.5 shrink-0",
                        session.active ? "opacity-100" : "opacity-0",
                      )}
                      aria-hidden="true"
                    />
                  )}
                  <span className="min-w-0 flex-1 truncate">
                    {session.label}
                  </span>
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
        )}
        {hasWindowChrome && (
          <div className="window-mobile-drag-region" data-tauri-drag-region />
        )}
        <Button
          variant="ghost"
          size="icon"
          className="size-10 shrink-0 text-muted-foreground hover:text-foreground [@media(pointer:coarse)]:size-11"
          aria-label={t("New tab")}
          title={t("New tab")}
          data-iori-action="workspace-add-tab"
          onClick={onNew}
        >
          <Plus className="size-4" aria-hidden="true" />
        </Button>
        {onStopChild && (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                className="size-10 shrink-0 text-muted-foreground hover:text-foreground [@media(pointer:coarse)]:size-11"
                aria-label={t("Child actions")}
              >
                <MoreHorizontal className="size-4" aria-hidden="true" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
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
            size="icon"
            className="size-10 shrink-0 text-muted-foreground hover:text-foreground [@media(pointer:coarse)]:size-11"
            aria-label={t("Close tab")}
            title={t("Close tab")}
            data-iori-action="workspace-close-tab"
            onClick={onCloseView}
          >
            <X className="size-4" aria-hidden="true" />
          </Button>
        )}
      </header>
      {viewTabs && viewTabs.length > 0 && (
        <nav
          aria-label={t("Open tabs")}
          data-iori-part="mobile-view-tabs"
          className="no-scrollbar flex min-h-10 shrink-0 items-stretch gap-0.5 overflow-x-auto border-b border-border bg-background px-1.5"
        >
          {viewTabs.map((tab) => {
            const Icon = VIEW_TAB_ICONS[tab.kind];
            return (
              <button
                key={tab.id}
                type="button"
                aria-current={tab.active ? "page" : undefined}
                data-iori-mobile-view-tab={tab.kind}
                data-active={tab.active ? "true" : undefined}
                onClick={tab.onSelect}
                className={cn(
                  "inline-flex min-h-10 shrink-0 items-center gap-1.5 border-b-2 px-2.5 text-xs font-medium whitespace-nowrap transition-colors outline-none focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring",
                  tab.active
                    ? "border-primary text-foreground"
                    : "border-transparent text-muted-foreground [@media(hover:hover)]:hover:text-foreground",
                )}
              >
                <Icon className="size-3.5 shrink-0" aria-hidden="true" />
                <span>{tab.label}</span>
                {tab.badge !== undefined && tab.badge > 0 && (
                  <span className="inline-flex min-w-4 items-center justify-center rounded-sm bg-muted px-1 text-2xs tabular-nums text-muted-foreground">
                    {tab.badge}
                  </span>
                )}
              </button>
            );
          })}
        </nav>
      )}
      <div
        className={cn(
          "mobile-view-content flex min-h-0 flex-1 flex-col overflow-hidden",
          "[&>.mobile-retained-view:not([hidden])]:flex [&>.mobile-retained-view:not([hidden])]:min-h-0 [&>.mobile-retained-view:not([hidden])]:flex-1 [&>.mobile-retained-view:not([hidden])]:flex-col [&>.mobile-retained-view:not([hidden])]:overflow-hidden",
          "[&>.mobile-retained-view[hidden]]:hidden",
        )}
      >
        {children}
      </div>
    </div>
  );
}
