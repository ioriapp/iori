import { MoreHorizontal, Terminal, Users, X } from "lucide-react";
import type {
  ChildSummary,
  FolderHistoryItem,
  HostInfo,
  TerminalSummary,
  Worktree,
} from "@iori/protocol";
import { cn } from "cn";
import { Button } from "../components/ui/button.tsx";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuTrigger,
} from "../components/ui/context-menu.tsx";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "../components/ui/dropdown-menu.tsx";
import {
  SidebarMenuButton,
  SidebarMenuItem,
} from "../components/ui/sidebar.tsx";
import { ChildRows, type ChildRowProps } from "../teams/ChildRows.tsx";
import { CliIcon } from "../CliIcon.tsx";
import {
  CliElapsed,
  CliStateDot,
  withStalledDescription,
} from "../CliStatus.tsx";
import { terminalTitle } from "../workspace-panel.tsx";
import { parentStateLabel, type NavigationProps } from "./types.ts";

export function SessionRow({
  host,
  folder,
  item,
  terminal,
  removing,
  isRemoving,
  activeTerminalId,
  dragViews,
  now,
  t,
  childRows,
  childrenOfParent,
  terminalError,
  onDragView,
  onOpenTerminal,
  onCloseTerminal,
  onCloseMobile,
}: {
  host: HostInfo;
  folder: FolderHistoryItem;
  item: Worktree;
  terminal: TerminalSummary;
  removing: boolean;
  isRemoving: (hostKey: string, path: string) => boolean;
  activeTerminalId?: string;
  dragViews: boolean;
  now: number;
  t: (key: string) => string;
  childRows: ChildRowProps;
  childrenOfParent: ChildSummary[];
  terminalError?: string;
  onDragView: NavigationProps["onDragView"];
  onOpenTerminal: NavigationProps["onOpenTerminal"];
  onCloseTerminal: NavigationProps["onCloseTerminal"];
  onCloseMobile: () => void;
}) {
  const teamName =
    terminal.teamConversation && !terminal.teamChild
      ? terminal.teamName
      : undefined;
  const stateLabel = teamName ? parentStateLabel(terminal, t, now) : undefined;
  const isCurrent = terminal.id === activeTerminalId;
  const titleText = terminalTitle(terminal.title);

  return (
    <SidebarMenuItem className="[&:has(.nav-session_.state-dot)>.nav-children]:pl-8.5">
      <div className="group/session flex items-center">
        <ContextMenu>
          <ContextMenuTrigger asChild disabled={removing}>
            <SidebarMenuButton
              className={cn(
                "nav-session flex h-auto min-h-9 min-w-0 flex-1 items-center gap-1.5 rounded-md py-1 pr-1.5 pl-3.5 text-sm text-muted-foreground transition-colors [@media(pointer:coarse)]:min-h-10",
                "[&>.cli-icon]:size-4 [&>.cli-icon]:shrink-0 [&>.cli-icon>img]:size-4 [&>.cli-icon>img]:shrink-0",
                teamName &&
                  "is-team-parent flex-col items-stretch gap-0 [&:not(:has(.state-dot))_.nav-session-detail]:pl-0",
                isCurrent &&
                  "is-current bg-primary/15 font-semibold text-foreground [&>svg:not(.state-dot_svg)]:text-primary [&_.nav-session-line>svg:not(.state-dot_svg)]:text-primary",
                removing && "removal-disabled pointer-events-none opacity-50",
              )}
              aria-current={isCurrent ? "page" : undefined}
              title={
                teamName
                  ? [teamName, titleText, stateLabel]
                      .filter(Boolean)
                      .join(" · ")
                  : withStalledDescription(
                      titleText,
                      terminal.cliStatus,
                      t,
                      now,
                    )
              }
              disabled={removing}
              draggable={!removing && dragViews}
              onDragStart={onDragView("terminal", terminal.id, {
                hostKey: host.publicKey,
                workspacePath: folder.workspacePath,
                worktreePath: item.path,
              })}
              data-iori-terminal-row={terminal.id}
              data-iori-row-cli={terminal.cli?.id}
              onClick={() => {
                onOpenTerminal(terminal.id, host.publicKey);
                onCloseMobile();
              }}
            >
              {teamName ? (
                <>
                  <span className="nav-session-line flex w-full min-w-0 items-center gap-1.5 leading-normal">
                    <CliStateDot status={terminal.cliStatus} t={t} />
                    <Users
                      className="nav-session-team-icon size-3.5 shrink-0"
                      aria-hidden="true"
                    />
                    <span className="nav-session-copy flex min-w-0 flex-1 overflow-hidden">
                      <span className="nav-session-title nav-session-team-name truncate leading-normal font-semibold text-foreground">
                        {teamName}
                      </span>
                    </span>
                    <CliElapsed status={terminal.cliStatus} />
                  </span>
                  <span className="nav-child-detail nav-session-detail flex min-w-0 items-center pl-3 text-xs leading-normal font-normal text-muted-foreground [&>.cli-icon]:mr-1 [&>.cli-icon]:shrink-0">
                    {terminal.cli ? (
                      <CliIcon
                        hostKey={host.publicKey}
                        cli={terminal.cli}
                        size={12}
                      />
                    ) : (
                      <Terminal
                        className="cli-icon mr-1 size-3 shrink-0"
                        aria-hidden="true"
                      />
                    )}
                    <span className="nav-child-model min-w-0 shrink truncate">
                      {titleText}
                    </span>
                    {stateLabel && (
                      <>
                        <span className="mx-1 shrink-0" aria-hidden="true">
                          ·
                        </span>
                        <span className="nav-child-state max-w-[65%] min-w-0 shrink-0 truncate">
                          {stateLabel}
                        </span>
                      </>
                    )}
                  </span>
                </>
              ) : (
                <>
                  <CliStateDot status={terminal.cliStatus} t={t} />
                  {terminal.cli ? (
                    <CliIcon
                      hostKey={host.publicKey}
                      cli={terminal.cli}
                      size={14}
                    />
                  ) : (
                    <Terminal
                      className="size-3.5 shrink-0"
                      aria-hidden="true"
                    />
                  )}
                  <span className="nav-session-copy flex min-w-0 flex-1 overflow-hidden">
                    <span className="nav-session-title truncate leading-normal">
                      {titleText}
                    </span>
                  </span>
                  <CliElapsed status={terminal.cliStatus} />
                  {(terminal.state === "exited" ||
                    terminal.state === "error") && (
                    <span className="nav-session-exited shrink-0 text-xs text-muted-foreground">
                      {t("Exited")}
                    </span>
                  )}
                </>
              )}
            </SidebarMenuButton>
          </ContextMenuTrigger>
          <ContextMenuContent>
            <ContextMenuItem
              data-iori-action="terminal-close"
              onSelect={() => onCloseTerminal(terminal.id)}
            >
              <X className="size-3.5" aria-hidden="true" />
              {t("Close terminal")}
            </ContextMenuItem>
          </ContextMenuContent>
        </ContextMenu>
        {!removing && (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                variant="ghost"
                size="icon-sm"
                className="size-7 shrink-0 text-muted-foreground opacity-0 transition-opacity hover:text-foreground focus-visible:opacity-100 group-focus-within/session:opacity-100 group-hover/session:opacity-100 data-[state=open]:opacity-100 [@media(pointer:coarse)]:-my-0.5 [@media(pointer:coarse)]:size-11 [@media(pointer:coarse)]:opacity-100"
                aria-label={`${t("Terminal actions")} ${titleText}`}
                data-iori-action="terminal-menu"
              >
                <MoreHorizontal className="size-3.5" aria-hidden="true" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem
                data-iori-action="terminal-close"
                onSelect={() => onCloseTerminal(terminal.id)}
              >
                <X className="size-3.5" aria-hidden="true" />
                {t("Close terminal")}
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        )}
      </div>
      <ChildRows
        {...childRows}
        isRemoving={(path) => removing || isRemoving(host.publicKey, path)}
        children={childrenOfParent}
      />
      {terminalError && (
        <p
          className="nav-inline-error mx-3 my-1 text-xs text-status-failed-text"
          role="alert"
        >
          {terminalError}
        </p>
      )}
    </SidebarMenuItem>
  );
}
