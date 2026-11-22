import { useLayoutEffect, useRef } from "react";
import type { ComponentProps, ReactNode } from "react";
import { creationOrder, definitionOrder } from "@iori/protocol";
import type {
  CliSummary,
  FolderHistoryItem,
  ForgeStatus,
  HostInfo,
  Worktree,
} from "@iori/protocol";
import {
  ChevronDown,
  ChevronRight,
  Folder,
  FolderMinus,
  GitBranch,
  MoreHorizontal,
  Plus,
  Settings,
  Trash2,
  Workflow,
} from "lucide-react";
import { cn } from "cn";
import { Button } from "../components/ui/button.tsx";
import { Spinner } from "../components/ui/spinner.tsx";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "../components/ui/collapsible.tsx";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuLabel,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from "../components/ui/context-menu.tsx";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "../components/ui/dropdown-menu.tsx";
import {
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
} from "../components/ui/sidebar.tsx";
import { SortableSidebarItem, useSidebarSortHandle } from "../SidebarSort.tsx";
import { ForgeMarks } from "../ForgeMarks.tsx";
import { MiddleEllipsis } from "../MiddleEllipsis.tsx";
import { WorktreeEntrances } from "../WorktreeEntrances.tsx";
import { basename, terminalTitle, worktreeLabel } from "../workspace-panel.tsx";
import { WorktreeActivity } from "./WorktreeActivity.tsx";
import { SessionRow } from "./SessionRow.tsx";
import type { ActivityGroup, NavigationProps } from "./types.ts";

const FORGE_MARKS_CLASS = cn(
  "[&_.nav-forge-marks]:flex [&_.nav-forge-marks]:shrink-0 [&_.nav-forge-marks]:items-center [&_.nav-forge-marks]:gap-0.5",
  "[&_.nav-forge-mark]:h-6.5 [&_.nav-forge-mark]:w-auto [&_.nav-forge-mark]:min-w-6.5 [&_.nav-forge-mark]:gap-0.5 [&_.nav-forge-mark]:px-1 [&_.nav-forge-mark]:text-xs",
  "[&_.nav-forge-passed]:text-status-running-text [&_.nav-forge-open]:text-status-running-text",
  "[&_.nav-forge-failed]:text-status-failed-text [&_.nav-forge-closed]:text-status-failed-text",
  "[&_.nav-forge-running]:text-muted-foreground [&_.nav-forge-running_svg]:stroke-[2.6]",
  "[&_.nav-forge-draft]:text-muted-foreground [&_.nav-forge-merged]:text-muted-foreground [&_.nav-forge-other]:text-muted-foreground",
);

const MOBILE_ENTRANCES_CLASS = cn(
  "[&_.nav-view-links]:flex [&_.nav-view-links]:flex-wrap [&_.nav-view-links]:items-center [&_.nav-view-links]:gap-1 [&_.nav-view-links]:py-1 [&_.nav-view-links]:pr-1 [&_.nav-view-links]:pl-2",
  "[&_.nav-view-link]:h-auto [&_.nav-view-link]:min-h-8 [&_.nav-view-link]:gap-1 [&_.nav-view-link]:px-2 [&_.nav-view-link]:text-xs [&_.nav-view-link]:font-normal [&_.nav-view-link]:text-muted-foreground [&_.nav-view-link]:hover:bg-sidebar-accent [&_.nav-view-link]:hover:text-foreground",
);

export const SORTABLE_ITEM_CLASS = cn(
  "relative",
  "data-[sidebar-sorting=true]:z-(--z-sticky) data-[sidebar-sorting=true]:rounded-md data-[sidebar-sorting=true]:bg-popover data-[sidebar-sorting=true]:shadow-md [&[data-sidebar-sorting=true]_button]:cursor-grabbing",
);

export function SortableRowButton({
  sortable,
  ...props
}: ComponentProps<typeof SidebarMenuButton> & {
  sortable: boolean;
}) {
  const handle = useSidebarSortHandle(sortable);
  return <SidebarMenuButton {...props} {...handle} />;
}

function WorkspaceSidebarItem({
  sortable,
  id,
  disabled,
  className,
  ...props
}: ComponentProps<typeof SidebarMenuItem> & {
  sortable: boolean;
  id: string;
  disabled: boolean;
}) {
  return sortable ? (
    <SortableSidebarItem
      id={id}
      disabled={disabled}
      className={cn(SORTABLE_ITEM_CLASS, className)}
      {...props}
    />
  ) : (
    <SidebarMenuItem className={className} {...props} />
  );
}

function WorktreeRow({
  children,
  controls,
  plain,
  removing,
  ...props
}: ComponentProps<"div"> & {
  children: ReactNode;
  controls: ReactNode;
  plain: boolean;
  removing: boolean;
}) {
  const row = useRef<HTMLDivElement>(null);
  const end = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const element = row.current;
    const trailing = end.current;
    if (!element || !trailing) return;
    const resize = () =>
      element.style.setProperty(
        "--nav-worktree-controls-width",
        `${trailing.getBoundingClientRect().width}px`,
      );
    const observer = new ResizeObserver(resize);
    observer.observe(trailing);
    resize();
    return () => observer.disconnect();
  }, []);
  return (
    <div
      className={cn(
        "nav-worktree-row group/worktree relative",
        !removing &&
          "[@media(hover:hover)]:hover:[&_.nav-worktree-button]:bg-sidebar-accent [@media(hover:hover)]:hover:[&_.nav-worktree-button]:text-sidebar-accent-foreground",
      )}
      ref={row}
      {...props}
    >
      {children}
      <div
        className={cn(
          "nav-worktree-controls absolute top-1/2 flex -translate-y-1/2 items-center gap-0",
          plain ? "right-2" : "right-0.5",
          FORGE_MARKS_CLASS,
        )}
        ref={end}
      >
        {controls}
      </div>
    </div>
  );
}

export function WorktreeContextMenuContent({
  host,
  folder,
  item,
  t,
  onSettings,
  onDeleteWorktree,
  onRemoveFolder,
  onCloseMobile,
}: {
  host: HostInfo;
  folder: FolderHistoryItem;
  item?: Worktree;
  t: (key: string) => string;
  onSettings: NavigationProps["onSettings"];
  onDeleteWorktree: NavigationProps["onDeleteWorktree"];
  onRemoveFolder: NavigationProps["onRemoveFolder"];
  onCloseMobile: () => void;
}) {
  const hasSettings = !item || folder.kind !== "git";
  const hasDelete = folder.kind === "git" && (!item || !item.primary);
  const hasRemove = !item || item.primary || folder.kind !== "git";
  const hasDestructive = hasDelete || hasRemove;

  return (
    <ContextMenuContent>
      {item && (
        <ContextMenuLabel className="nav-folder-menu-name max-w-[22rem] [overflow-wrap:anywhere]">
          {basename(item.path)}
        </ContextMenuLabel>
      )}
      {hasSettings && (
        <ContextMenuItem
          data-iori-action="workspace-settings"
          onSelect={() => {
            onSettings(host.publicKey, folder.workspacePath);
            onCloseMobile();
          }}
        >
          <Settings className="size-3.5" aria-hidden="true" />
          {t("Workspace settings…")}
        </ContextMenuItem>
      )}
      {hasSettings && hasDestructive && <ContextMenuSeparator />}
      {hasDelete && (
        <ContextMenuItem
          variant="destructive"
          data-iori-action={item ? "worktree-delete" : "worktree-cleanup"}
          onSelect={() =>
            onDeleteWorktree(
              host,
              item?.path ?? folder.workspacePath,
              !item,
              item
                ? worktreeLabel(item.branch, item.path, folder.workspacePath)
                : undefined,
            )
          }
        >
          <Trash2 className="size-3.5" aria-hidden="true" />
          {t(item ? "Delete worktree" : "Delete merged worktrees…")}
        </ContextMenuItem>
      )}
      {hasRemove && (
        <ContextMenuItem
          variant="destructive"
          data-iori-action="sidebar-remove"
          onSelect={() => onRemoveFolder(host.publicKey, folder)}
        >
          <FolderMinus className="size-3.5" aria-hidden="true" />
          {t("Remove from sidebar")}
        </ContextMenuItem>
      )}
    </ContextMenuContent>
  );
}

export function WorktreeItem({
  host,
  folder,
  item,
  needle,
  matching,
  isMobile,
  isSelected,
  removing,
  isRemoving,
  collapsed,
  toggle,
  cliOrder,
  forgeStatus,
  childRows,
  sessions,
  activeTerminalId,
  terminalErrors,
  dragViews,
  now,
  t,
  onSelectWorktree,
  onCreate,
  onOpenView,
  onOpenCi,
  onDragView,
  onOpenTerminal,
  onCloseTerminal,
  onDeleteWorktree,
  onRemoveFolder,
  onSettings,
  onCloseMobile,
}: {
  host: HostInfo;
  folder: FolderHistoryItem;
  item: Worktree;
  needle: string;
  matching: (value: string) => boolean;
  isMobile: boolean;
  isSelected: boolean;
  removing: boolean;
  isRemoving: (hostKey: string, path: string) => boolean;
  collapsed: Set<string>;
  toggle: (id: string, open: boolean) => void;
  cliOrder: string[];
  forgeStatus?: ForgeStatus;
  childRows: ReturnType<NavigationProps["childRows"]>;
  sessions: ReturnType<NavigationProps["sessionsFor"]>;
  activeTerminalId?: string;
  terminalErrors: Record<string, string>;
  dragViews: boolean;
  now: number;
  t: (key: string) => string;
  onSelectWorktree: NavigationProps["onSelectWorktree"];
  onCreate: NavigationProps["onCreate"];
  onOpenView: NavigationProps["onOpenView"];
  onOpenCi: NavigationProps["onOpenCi"];
  onDragView: NavigationProps["onDragView"];
  onOpenTerminal: NavigationProps["onOpenTerminal"];
  onCloseTerminal: NavigationProps["onCloseTerminal"];
  onDeleteWorktree: NavigationProps["onDeleteWorktree"];
  onRemoveFolder: NavigationProps["onRemoveFolder"];
  onSettings: NavigationProps["onSettings"];
  onCloseMobile: () => void;
}) {
  const plain = folder.kind !== "git";
  const terminals = [...sessions].sort(creationOrder);
  const childrenByParent = new Map<string, typeof childRows.children>();
  for (const child of [...childRows.children].sort(creationOrder)) {
    let children = childrenByParent.get(child.parentTerminalId);
    if (!children)
      childrenByParent.set(child.parentTerminalId, (children = []));
    children.push(child);
  }

  if (
    needle &&
    !matching(
      `${host.hostName} ${folder.path} ${item.branch ?? ""} ${item.path}`,
    ) &&
    !terminals.some(({ title, cli, teamName }) =>
      matching(`${terminalTitle(title)} ${cli?.name ?? ""} ${teamName ?? ""}`),
    ) &&
    !childRows.children.some(({ role, title, model, cli }) =>
      matching(`${role} ${title} ${model ?? ""} ${cli?.name ?? ""}`),
    )
  )
    return null;

  const folderName = basename(item.path);
  const label = plain
    ? folderName
    : worktreeLabel(item.branch, item.path, folder.workspacePath);
  const id = `worktree:${host.publicKey}:${folder.workspacePath}:${item.path}`;
  const hasRows = terminals.length > 0 || childRows.children.length > 0;
  const open = !hasRows || !collapsed.has(id) || Boolean(needle);

  const activity = new Map<string, ActivityGroup>();
  const addActivity = (cli?: CliSummary) => {
    const key = cli?.id ?? "terminal";
    const group = activity.get(key);
    if (group) group.count++;
    else activity.set(key, { cli, count: 1 });
  };
  for (const terminal of terminals)
    if (terminal.state === "running" && !terminal.cliResumePending)
      addActivity(terminal.cli);
  for (const child of [...childRows.children].sort(creationOrder))
    if (
      child.terminalId &&
      child.cli &&
      ["running", "reported", "question"].includes(child.state)
    )
      addActivity(child.cli);

  const hasDelete = !plain && !item.primary;
  const hasRemove = plain || item.primary;

  const button = (
    <SortableRowButton
      sortable={plain && !needle && !removing}
      className={cn(
        "nav-worktree-button flex h-auto min-h-9 w-full touch-manipulation flex-col items-stretch justify-center gap-0.5 rounded-md border border-transparent py-1.5 text-left text-sm transition-colors [@media(pointer:coarse)]:min-h-10",
        plain
          ? "pl-1.5 pr-[calc(1rem+var(--nav-worktree-controls-width,0px))]"
          : "pl-2 pr-[calc(0.5rem+var(--nav-worktree-controls-width,0px))]",
        isSelected &&
          "is-selected relative bg-transparent font-semibold text-foreground before:absolute before:inset-y-1 before:left-0 before:w-0.5 before:rounded-r-xs before:bg-primary",
        removing &&
          "is-deleting pointer-events-none cursor-default text-muted-foreground opacity-100",
      )}
      disabled={removing}
      aria-current={isSelected ? "page" : undefined}
      title={removing ? undefined : `${label}\n${folderName}\n${item.path}`}
      data-iori-worktree-path={item.path}
      data-iori-workspace-path={plain ? folder.workspacePath : undefined}
      data-iori-host-key={host.publicKey}
      onClick={() => {
        toggle(id, true);
        onSelectWorktree(host, folder, item);
        if (isMobile) onCloseMobile();
      }}
    >
      <span className="nav-worktree-titleline flex w-full min-w-0 items-center gap-1.5">
        {removing ? (
          <Spinner aria-hidden="true" />
        ) : plain ? (
          <Folder
            className={cn(
              "size-3.5 shrink-0",
              isSelected ? "text-primary" : "text-muted-foreground",
            )}
            aria-hidden="true"
          />
        ) : (
          <GitBranch
            className={cn(
              "size-3.5 shrink-0",
              isSelected ? "text-primary" : "text-muted-foreground",
            )}
            aria-hidden="true"
          />
        )}
        {/* Selection changes the font weight used to fit the name. */}
        <MiddleEllipsis
          key={isSelected ? "selected" : "unselected"}
          className={cn(
            "nav-worktree-name min-w-0 flex-1 overflow-hidden text-sm whitespace-nowrap",
            isSelected ? "font-semibold" : "font-normal",
            removing && "text-muted-foreground",
          )}
          text={label}
        />
        {item.merged && forgeStatus?.pullRequest?.state !== "merged" && (
          <span
            className="nav-branch ml-auto max-w-[6.5rem] shrink-0 truncate text-xs font-normal text-muted-foreground"
            data-iori-worktree-merged="true"
          >
            Merged
          </span>
        )}
        {!open && activity.size > 0 && (
          <WorktreeActivity
            hostKey={host.publicKey}
            groups={[...activity.values()].sort((a, b) =>
              definitionOrder(cliOrder)(a.cli?.id ?? "", b.cli?.id ?? ""),
            )}
            t={t}
          />
        )}
      </span>
    </SortableRowButton>
  );

  const overflowMenu = !removing && (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="icon-sm"
          className={cn(
            "size-6.5 shrink-0 text-muted-foreground hover:text-foreground [@media(pointer:coarse)]:-my-0.5 [@media(pointer:coarse)]:size-11",
            !isMobile &&
              "opacity-0 transition-opacity focus-visible:opacity-100 group-focus-within/worktree:opacity-100 group-hover/worktree:opacity-100 data-[state=open]:opacity-100",
          )}
          aria-label={`${label} ${t("Menu")}`}
          data-iori-action="worktree-menu"
        >
          <MoreHorizontal className="size-3.5" aria-hidden="true" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuLabel className="nav-folder-menu-name max-w-[22rem] [overflow-wrap:anywhere]">
          {folderName}
        </DropdownMenuLabel>
        {isMobile && plain && (
          <DropdownMenuItem
            data-iori-action="folder-start-cli"
            data-iori-folder-path={folder.path}
            onSelect={() => {
              onCreate(host, folder);
              onCloseMobile();
            }}
          >
            <Plus className="size-3.5" aria-hidden="true" />
            {t("Start CLI or team")}
          </DropdownMenuItem>
        )}
        {isMobile && forgeStatus?.checks && (
          <DropdownMenuItem
            data-iori-forge="ci"
            onSelect={() => {
              onOpenCi(host, folder, item);
              onCloseMobile();
            }}
          >
            <Workflow className="size-3.5" aria-hidden="true" />
            CI
          </DropdownMenuItem>
        )}
        {isMobile && hasRows && (
          <DropdownMenuItem
            data-iori-action="worktree-toggle"
            onSelect={() => toggle(id, !open)}
          >
            {open ? (
              <ChevronDown className="size-3.5" aria-hidden="true" />
            ) : (
              <ChevronRight className="size-3.5" aria-hidden="true" />
            )}
            {t(open ? "Collapse {name}" : "Expand {name}").replace(
              "{name}",
              label,
            )}
          </DropdownMenuItem>
        )}
        {plain && (
          <DropdownMenuItem
            data-iori-action="workspace-settings"
            onSelect={() => {
              onSettings(host.publicKey, folder.workspacePath);
              onCloseMobile();
            }}
          >
            <Settings className="size-3.5" aria-hidden="true" />
            {t("Workspace settings…")}
          </DropdownMenuItem>
        )}
        {(hasDelete || hasRemove) && <DropdownMenuSeparator />}
        {hasDelete && (
          <DropdownMenuItem
            variant="destructive"
            data-iori-action="worktree-delete"
            onSelect={() =>
              onDeleteWorktree(
                host,
                item.path,
                false,
                worktreeLabel(item.branch, item.path, folder.workspacePath),
              )
            }
          >
            <Trash2 className="size-3.5" aria-hidden="true" />
            {t("Delete worktree")}
          </DropdownMenuItem>
        )}
        {hasRemove && (
          <DropdownMenuItem
            variant="destructive"
            data-iori-action="sidebar-remove"
            onSelect={() => onRemoveFolder(host.publicKey, folder)}
          >
            <FolderMinus className="size-3.5" aria-hidden="true" />
            {t("Remove from sidebar")}
          </DropdownMenuItem>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );

  return (
    <WorkspaceSidebarItem
      sortable={plain}
      id={folder.workspacePath}
      disabled={Boolean(needle)}
      className={cn(
        "nav-worktree mx-1.5 mb-0.5",
        plain && "nav-plain-folder mt-2",
      )}
    >
      <Collapsible open={open} onOpenChange={(value) => toggle(id, value)}>
        <WorktreeRow
          plain={plain}
          removing={removing}
          role="group"
          title={
            removing
              ? t("Deleting {name}").replace("{name}", () => label)
              : undefined
          }
          aria-label={
            removing
              ? t("Deleting {name}").replace("{name}", () => label)
              : undefined
          }
          data-iori-worktree-removing={removing ? "true" : undefined}
          onContextMenu={
            removing ? (event) => event.preventDefault() : undefined
          }
          controls={
            isMobile ? (
              overflowMenu
            ) : (
              <>
                <ForgeMarks
                  status={removing ? undefined : forgeStatus}
                  t={t}
                  onOpenCi={() => onOpenCi(host, folder, item)}
                />
                {plain && (
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    aria-label={t("Start CLI or team")}
                    title={t("Start CLI or team")}
                    className="nav-folder-start size-6.5 text-muted-foreground hover:text-foreground"
                    data-iori-action="folder-start-cli"
                    data-iori-folder-path={folder.path}
                    onClick={() => onCreate(host, folder)}
                  >
                    <Plus className="size-3.5" aria-hidden="true" />
                  </Button>
                )}
                {hasRows && (
                  <CollapsibleTrigger asChild>
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      className="nav-worktree-toggle size-6.5 text-muted-foreground hover:text-foreground aria-expanded:bg-transparent aria-expanded:hover:bg-accent"
                      disabled={removing}
                      aria-label={t(
                        open ? "Collapse {name}" : "Expand {name}",
                      ).replace("{name}", label)}
                      data-iori-action="worktree-toggle"
                    >
                      {open ? (
                        <ChevronDown className="size-3.5" aria-hidden="true" />
                      ) : (
                        <ChevronRight className="size-3.5" aria-hidden="true" />
                      )}
                    </Button>
                  </CollapsibleTrigger>
                )}
                {overflowMenu}
              </>
            )
          }
        >
          {removing ? (
            button
          ) : (
            <ContextMenu>
              <ContextMenuTrigger asChild>{button}</ContextMenuTrigger>
              <WorktreeContextMenuContent
                host={host}
                folder={folder}
                item={item}
                t={t}
                onSettings={onSettings}
                onDeleteWorktree={onDeleteWorktree}
                onRemoveFolder={onRemoveFolder}
                onCloseMobile={onCloseMobile}
              />
            </ContextMenu>
          )}
        </WorktreeRow>
        <CollapsibleContent>
          {isSelected && isMobile && !removing && (
            <div className={MOBILE_ENTRANCES_CLASS}>
              <WorktreeEntrances
                plain={plain}
                board={terminals.some((terminal) => terminal.teamConversation)}
                mobile
                t={t}
                onDrag={onDragView}
                onOpen={(kind) => {
                  onOpenView(kind);
                  onCloseMobile();
                }}
              />
            </div>
          )}
          {hasRows && (
            <SidebarMenu className="nav-session-list gap-px pb-1">
              {terminals.map((terminal) => (
                <SessionRow
                  key={terminal.id}
                  host={host}
                  folder={folder}
                  item={item}
                  terminal={terminal}
                  removing={removing}
                  isRemoving={isRemoving}
                  activeTerminalId={activeTerminalId}
                  dragViews={dragViews}
                  now={now}
                  t={t}
                  childRows={childRows}
                  childrenOfParent={childrenByParent.get(terminal.id) ?? []}
                  terminalError={terminalErrors[terminal.id]}
                  onDragView={onDragView}
                  onOpenTerminal={onOpenTerminal}
                  onCloseTerminal={onCloseTerminal}
                  onCloseMobile={onCloseMobile}
                />
              ))}
            </SidebarMenu>
          )}
        </CollapsibleContent>
      </Collapsible>
    </WorkspaceSidebarItem>
  );
}
