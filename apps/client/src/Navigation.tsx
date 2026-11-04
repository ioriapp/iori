import { connection } from "./connection.ts";
import { creationOrder, worktreeOrder, definitionOrder } from "@iori/protocol";
import { terminalTitle } from "./workspace-panel.tsx";
import { WorktreeEntrances } from "./WorktreeEntrances.tsx";
import { MiddleEllipsis } from "./MiddleEllipsis.tsx";
import { ForgeMarks } from "./ForgeMarks.tsx";
import { useForgeStatus, forgeKey } from "./forge-status.ts";
import {
  useIssueRepositories,
  issueRepositoryKey,
} from "./issues/issue-repositories.ts";
import {
  SidebarSort,
  SortableSidebarItem,
  useSidebarSortHandle,
} from "./SidebarSort.tsx";
import {
  hostRemovalLabel,
  type HostRemoval,
} from "./updates/host-lifecycle.ts";
import { hostNeedsUpdate } from "./updates/host-controller.ts";
import { UpdateMark, SettingsUpdateMark } from "./updates/UpdateSettings.tsx";
import { hasWindowChrome } from "./native.ts";
import { ChildRows, type ChildRowProps } from "./teams/ChildRows.tsx";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import type { DragEvent as ReactDragEvent } from "react";
import {
  Bot,
  ChevronDown,
  ChevronRight,
  CircleDot,
  Folder,
  FolderMinus,
  GitBranch,
  Home,
  Plus,
  Search,
  Settings,
  Terminal,
  Trash2,
  X,
} from "lucide-react";
import type {
  CliSummary,
  FolderHistoryItem,
  HostInfo,
  Worktree,
} from "@iori/protocol";
import { Button } from "./components/ui/button.tsx";
import { Input } from "./components/ui/input.tsx";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "./components/ui/collapsible.tsx";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuLabel,
  ContextMenuItem,
  ContextMenuTrigger,
} from "./components/ui/context-menu.tsx";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  useSidebar,
} from "./components/ui/sidebar.tsx";
import { ScrollArea } from "./components/ui/scroll-area.tsx";
import {
  basename,
  type WorkspaceViewKind,
  worktreeLabel,
} from "./workspace-panel.tsx";
import "./navigation.css";
import { CliStateDot, CliElapsed } from "./CliStatus.tsx";
import { StatusDot } from "./components/StatusDot.tsx";
import { CliIcon } from "./CliIcon.tsx";

export type SidebarFolder = { host: HostInfo; folder: FolderHistoryItem };

type Props = {
  showForgeStatus: boolean;
  clisRevision: number;
  childRows: (hostKey: string, path: string) => ChildRowProps;
  isChildWorktree: (hostKey: string, path: string) => boolean;
  sessionsFor: (
    hostKey: string,
    path: string,
  ) => import("@iori/protocol").TerminalSummary[];
  t: (key: string) => string;
  hosts: HostInfo[];
  onReorderHosts: (keys: string[]) => void;
  collapsedKeys?: string[];
  onCollapsedChange: (keys: string[]) => void;
  loadedHistoryHosts: string[];
  onReorderFolders: (hostKey: string, paths: string[]) => void;
  observedHosts: Record<string, HostInfo>;
  homeActive: boolean;
  onHome: () => void;
  teamsHostKey?: string;
  onTeams: (host: HostInfo) => void;
  connectedHosts: string[];
  removals: Record<string, HostRemoval>;
  folders: SidebarFolder[];
  selected?: { hostKey: string; workspacePath: string; worktreePath: string };
  historyError: Record<string, string>;
  removeError: string;
  dragViews: boolean;
  onRetryHistory: (hostKey: string) => void;
  onDeleteWorktree: (
    host: HostInfo,
    path: string,
    cleanup: boolean,
    label?: string,
  ) => void;
  onCreate: (host: HostInfo, folder: FolderHistoryItem) => void;
  onOpenIssues: (host: HostInfo, folder: FolderHistoryItem) => void;
  onSelectWorktree: (
    host: HostInfo,
    folder: FolderHistoryItem,
    worktree: Worktree,
  ) => void;
  onOpenView: (kind: WorkspaceViewKind) => void;
  /** A worktree row's CI mark: that worktree's CI View. */
  onOpenCi: (host: HostInfo, folder: FolderHistoryItem, item: Worktree) => void;
  onDragView: (
    kind: WorkspaceViewKind,
    terminalId?: string,
    source?: { hostKey: string; workspacePath: string; worktreePath: string },
  ) => (event: ReactDragEvent<HTMLButtonElement>) => void;
  attentionCount: number;
  onAttention: () => void;
  activeTerminalId?: string;
  terminalErrors: Record<string, string>;
  onOpenTerminal: (terminalId: string, hostKey: string) => void;
  onCloseTerminal: (terminalId: string) => void;
  onAddFolder: (hostKey: string) => void;
  onRemoveFolder: (hostKey: string, folder: FolderHistoryItem) => void;
  onSettings: (hostKey?: string, repositoryPath?: string) => void;
};

function SortableRowButton({
  sortable,
  ...props
}: React.ComponentProps<typeof SidebarMenuButton> & {
  sortable: boolean;
}) {
  const handle = useSidebarSortHandle(sortable);
  return <SidebarMenuButton {...props} {...handle} />;
}

function WorkspaceSidebarItem({
  sortable,
  id,
  disabled,
  ...props
}: React.ComponentProps<typeof SidebarMenuItem> & {
  sortable: boolean;
  id: string;
  disabled: boolean;
}) {
  return sortable ? (
    <SortableSidebarItem id={id} disabled={disabled} {...props} />
  ) : (
    <SidebarMenuItem {...props} />
  );
}

function WorktreeRow({
  children,
  controls,
}: {
  children: React.ReactNode;
  controls: React.ReactNode;
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
    <div className="nav-worktree-row" ref={row}>
      {children}
      <div className="nav-worktree-controls" ref={end}>
        {controls}
      </div>
    </div>
  );
}

export function worktreesOf(folder: FolderHistoryItem): Worktree[] {
  return folder.kind === "git"
    ? [...(folder.worktrees ?? [])].sort((a, b) =>
        worktreeOrder(
          {
            ...a,
            label: worktreeLabel(a.branch, a.path, folder.workspacePath),
          },
          {
            ...b,
            label: worktreeLabel(b.branch, b.path, folder.workspacePath),
          },
        ),
      )
    : [{ path: folder.path, detached: false, primary: true }];
}

type ActivityGroup = { cli?: CliSummary; count: number };

// Measure the existing icons and counts at the user's text size. The summary
// reserves room for the worktree name and keeps only the prefix that fits.
function WorktreeActivity({
  hostKey,
  groups,
  t,
}: {
  hostKey: string;
  groups: ActivityGroup[];
  t: Props["t"];
}) {
  const container = useRef<HTMLSpanElement>(null);
  const measure = useRef<HTMLSpanElement>(null);
  const [visible, setVisible] = useState(groups.length);
  const groupSizes = JSON.stringify(
    groups.map((group) => [group.cli?.id, group.count]),
  );
  const groupCount = groups.length;
  useLayoutEffect(() => {
    const element = container.current;
    const ruler = measure.current;
    if (!element || !ruler) return;
    const resize = () => {
      const items = [...ruler.children];
      const gap = parseFloat(getComputedStyle(ruler).columnGap);
      const widths = items.map((item) => item.getBoundingClientRect().width);
      const available = element.getBoundingClientRect().width;
      let count = groupCount;
      const width = (length: number) =>
        widths.slice(0, length).reduce((sum, value) => sum + value, 0) +
        Math.max(0, length - 1) * gap;
      if (width(count) > available) {
        while (count > 0 && width(count) + gap + widths[groupCount] > available)
          count--;
      }
      setVisible(count);
    };
    const observer = new ResizeObserver(resize);
    observer.observe(element);
    observer.observe(ruler);
    resize();
    return () => observer.disconnect();
  }, [groupSizes, groupCount]);
  const render = (group: ActivityGroup) => (
    <span className="nav-activity-kind" key={group.cli?.id ?? "terminal"}>
      {group.cli ? (
        <CliIcon hostKey={hostKey} cli={group.cli} size={14} />
      ) : (
        <Terminal size={14} />
      )}
      {group.count > 1 && <span>{group.count}</span>}
    </span>
  );
  const description = groups
    .map((group) => `${group.cli?.name ?? t("Terminal")} × ${group.count}`)
    .join(", ");
  return (
    <span
      className="nav-activity-summary"
      ref={container}
      role="img"
      aria-label={description}
      title={description}
    >
      <span className="nav-activity-measure" ref={measure} aria-hidden="true">
        {groups.map(render)}
        <span>+{groups.length}</span>
      </span>
      <span className="nav-activity-visible" aria-hidden="true">
        {groups.slice(0, visible).map(render)}
        {visible < groups.length && <span>+{groups.length - visible}</span>}
      </span>
    </span>
  );
}

export function Navigation({
  showForgeStatus,
  clisRevision,
  childRows: getChildRows,
  isChildWorktree,
  sessionsFor,
  t,
  hosts,
  onReorderHosts,
  collapsedKeys,
  onCollapsedChange,
  loadedHistoryHosts,
  onReorderFolders,
  observedHosts,
  homeActive,
  onHome,
  teamsHostKey,
  onTeams,
  connectedHosts,
  removals,
  folders,
  selected,
  historyError,
  removeError,
  dragViews,
  onRetryHistory,
  onSelectWorktree,
  onCreate,
  onOpenIssues,
  onDeleteWorktree,
  onOpenView,
  onOpenCi,
  onDragView,
  onAddFolder,
  onRemoveFolder,
  onSettings,
  attentionCount,
  onAttention,
  activeTerminalId,
  terminalErrors,
  onOpenTerminal,
  onCloseTerminal,
}: Props) {
  const {
    isMobile,
    setOpenMobile,
    open: sidebarOpen,
    openMobile,
  } = useSidebar();
  const [cliOrders, setCliOrders] = useState<Record<string, string[]>>({});
  const connectedKey = JSON.stringify(connectedHosts);
  useEffect(() => {
    let active = true;
    for (const host of connectedHosts)
      void connection
        .requestHost(host, "cli.list", {})
        .then((result) => {
          if (active && result?.ok)
            setCliOrders((current) => ({
              ...current,
              [host]: result.result.clis.map((cli) => cli.id),
            }));
        })
        .catch(() => {});
    return () => {
      active = false;
    };
  }, [connectedKey, clisRevision]);
  const forgeTargets = hosts.map((host) => ({
    host: host.publicKey,
    paths: folders
      .filter(
        (entry) =>
          entry.host.publicKey === host.publicKey &&
          entry.folder.kind === "git",
      )
      .flatMap((entry) => worktreesOf(entry.folder).map((item) => item.path)),
  }));
  const forgeStatuses = useForgeStatus(
    forgeTargets,
    selected?.worktreePath,
    selected?.hostKey,
    showForgeStatus && (isMobile ? openMobile : sidebarOpen),
  );
  const issueRepositories = useIssueRepositories(
    folders
      .filter((entry) => entry.folder.kind === "git")
      .map((entry) => ({
        host: entry.host.publicKey,
        workspacePath: entry.folder.workspacePath,
      })),
    connectedHosts,
  );
  const [query, setQuery] = useState("");
  const collapsed = new Set(collapsedKeys);
  useEffect(() => {
    if (!collapsedKeys?.length) return;
    const existing = new Set(hosts.map((host) => `host:${host.publicKey}`));
    for (const { host, folder } of folders) {
      if (folder.kind === "git")
        existing.add(`repo:${host.publicKey}:${folder.workspacePath}`);
      for (const item of worktreesOf(folder))
        existing.add(
          `worktree:${host.publicKey}:${folder.workspacePath}:${item.path}`,
        );
    }
    const next = collapsedKeys.filter((id) => {
      const host = hosts.find(
        ({ publicKey }) =>
          id === `host:${publicKey}` ||
          id.startsWith(`repo:${publicKey}:`) ||
          id.startsWith(`worktree:${publicKey}:`),
      );
      // App discards removed Hosts even when the sidebar is unmounted.
      if (!host) return true;
      // An absent row is only gone after its connected Host sent its history.
      if (
        !connectedHosts.includes(host.publicKey) ||
        !loadedHistoryHosts.includes(host.publicKey)
      )
        return true;
      return existing.has(id);
    });
    if (next.length !== collapsedKeys.length) onCollapsedChange(next);
  }, [
    collapsedKeys,
    hosts,
    folders,
    connectedHosts,
    loadedHistoryHosts,
    onCollapsedChange,
  ]);
  const needle = query.trim().toLocaleLowerCase();
  const matching = (value: string) =>
    value.toLocaleLowerCase().includes(needle);
  const toggle = (id: string, open: boolean) => {
    if (collapsed.has(id) === !open) return;
    const next = new Set(collapsed);
    if (open) next.delete(id);
    else next.add(id);
    onCollapsedChange([...next]);
  };

  const removeMenu = (
    host: HostInfo,
    folder: FolderHistoryItem,
    item?: Worktree,
  ) => (
    <ContextMenuContent>
      {item && (
        <ContextMenuLabel className="nav-folder-menu-name">
          {basename(item.path)}
        </ContextMenuLabel>
      )}
      {(!item || folder.kind !== "git") && (
        <ContextMenuItem
          data-iori-action="workspace-settings"
          onSelect={() => {
            onSettings(host.publicKey, folder.workspacePath);
            setOpenMobile(false);
          }}
        >
          <Settings aria-hidden="true" />
          {t("Workspace settings…")}
        </ContextMenuItem>
      )}
      {folder.kind === "git" && (!item || !item.primary) && (
        <ContextMenuItem
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
          <Trash2 aria-hidden="true" />
          {t(item ? "Delete worktree" : "Delete merged worktrees…")}
        </ContextMenuItem>
      )}
      {(!item || item.primary || folder.kind !== "git") && (
        <ContextMenuItem
          data-iori-action="sidebar-remove"
          onSelect={() => onRemoveFolder(host.publicKey, folder)}
        >
          <FolderMinus aria-hidden="true" />
          {t("Remove from sidebar")}
        </ContextMenuItem>
      )}
    </ContextMenuContent>
  );

  const worktree = (
    host: HostInfo,
    folder: FolderHistoryItem,
    item: Worktree,
  ) => {
    const plain = folder.kind !== "git";
    const childRows = getChildRows(host.publicKey, item.path);
    const terminals = sessionsFor(host.publicKey, item.path).sort(
      creationOrder,
    );
    const childrenByParent = new Map<string, typeof childRows.children>();
    for (const child of [...childRows.children].sort(creationOrder)) {
      let children = childrenByParent.get(child.parentTerminalId);
      if (!children)
        childrenByParent.set(child.parentTerminalId, (children = []));
      children.push(child);
    }
    if (
      !matching(
        `${host.hostName} ${folder.path} ${item.branch ?? ""} ${item.path} ${childRows.children.map((child) => `${child.role} ${child.title} ${child.model ?? ""}`).join(" ")}`,
      )
    )
      return null;
    const isSelected =
      selected?.hostKey === host.publicKey &&
      selected.workspacePath === folder.workspacePath &&
      selected.worktreePath === item.path;
    const folderName = basename(item.path);
    const label = plain
      ? folderName
      : worktreeLabel(item.branch, item.path, folder.workspacePath);
    const forgeStatus = showForgeStatus
      ? forgeStatuses[forgeKey(host.publicKey, item.path)]
      : undefined;
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
    const button = (
      <SortableRowButton
        sortable={plain && !needle}
        className={`nav-worktree-button ${isSelected ? "is-selected" : ""}`}
        aria-current={isSelected ? "page" : undefined}
        title={`${label}
${folderName}
${item.path}`}
        data-iori-worktree-path={item.path}
        data-iori-workspace-path={plain ? folder.workspacePath : undefined}
        data-iori-host-key={host.publicKey}
        onClick={() => {
          toggle(id, true);
          onSelectWorktree(host, folder, item);
        }}
      >
        <span className="nav-worktree-titleline">
          {plain ? <Folder size={14} /> : <GitBranch size={14} />}
          {/* Selection changes the font weight used to fit the name. */}
          <MiddleEllipsis
            key={isSelected ? "selected" : "unselected"}
            text={label}
          />
          {item.merged && forgeStatus?.pullRequest?.state !== "merged" && (
            <span className="nav-branch" data-iori-worktree-merged="true">
              Merged
            </span>
          )}
          {!open && activity.size > 0 && (
            <WorktreeActivity
              hostKey={host.publicKey}
              groups={[...activity.values()].sort((a, b) =>
                definitionOrder(cliOrders[host.publicKey] ?? [])(
                  a.cli?.id ?? "",
                  b.cli?.id ?? "",
                ),
              )}
              t={t}
            />
          )}
        </span>
      </SortableRowButton>
    );
    return (
      <WorkspaceSidebarItem
        sortable={plain}
        id={folder.workspacePath}
        disabled={Boolean(needle)}
        className={`nav-worktree ${plain ? "nav-plain-folder" : ""}`}
        key={item.path}
      >
        <Collapsible open={open} onOpenChange={(value) => toggle(id, value)}>
          <WorktreeRow
            controls={
              <>
                <ForgeMarks
                  status={forgeStatus}
                  t={t}
                  onOpenCi={() => onOpenCi(host, folder, item)}
                />
                {plain && (
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    aria-label={t("Start CLI or team")}
                    title={t("Start CLI or team")}
                    className="nav-folder-start"
                    data-iori-action="folder-start-cli"
                    data-iori-folder-path={folder.path}
                    onClick={() => onCreate(host, folder)}
                  >
                    <Plus size={14} />
                  </Button>
                )}
                {hasRows && (
                  <CollapsibleTrigger asChild>
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      className="nav-worktree-toggle"
                      aria-label={t(
                        open ? "Collapse {name}" : "Expand {name}",
                      ).replace("{name}", label)}
                      data-iori-action="worktree-toggle"
                    >
                      {open ? (
                        <ChevronDown size={13} />
                      ) : (
                        <ChevronRight size={13} />
                      )}
                    </Button>
                  </CollapsibleTrigger>
                )}
              </>
            }
          >
            <ContextMenu>
              <ContextMenuTrigger asChild>{button}</ContextMenuTrigger>
              {removeMenu(host, folder, item)}
            </ContextMenu>
          </WorktreeRow>
          <CollapsibleContent>
            {isSelected && isMobile && (
              <WorktreeEntrances
                plain={plain}
                board={terminals.some((terminal) => terminal.teamConversation)}
                mobile
                t={t}
                onDrag={onDragView}
                onOpen={(kind) => {
                  onOpenView(kind);
                  setOpenMobile(false);
                }}
              />
            )}
            {hasRows && (
              <SidebarMenu className="nav-session-list">
                {terminals.map((terminal) => (
                  <SidebarMenuItem key={terminal.id}>
                    <ContextMenu>
                      <ContextMenuTrigger asChild>
                        <SidebarMenuButton
                          className={`nav-session ${terminal.id === activeTerminalId ? "is-current" : ""}`}
                          aria-current={
                            terminal.id === activeTerminalId
                              ? "page"
                              : undefined
                          }
                          title={terminalTitle(terminal.title)}
                          draggable={dragViews}
                          onDragStart={onDragView("terminal", terminal.id, {
                            hostKey: host.publicKey,
                            workspacePath: folder.workspacePath,
                            worktreePath: item.path,
                          })}
                          data-iori-terminal-row={terminal.id}
                          data-iori-row-cli={terminal.cli?.id}
                          onClick={() => {
                            onOpenTerminal(terminal.id, host.publicKey);
                            setOpenMobile(false);
                          }}
                        >
                          <CliStateDot status={terminal.cliStatus} t={t} />
                          {terminal.cli ? (
                            <CliIcon
                              hostKey={host.publicKey}
                              cli={terminal.cli}
                              size={14}
                            />
                          ) : (
                            <Terminal size={14} />
                          )}
                          <span className="nav-session-copy">
                            <span className="nav-session-title">
                              {terminalTitle(terminal.title)}
                            </span>
                          </span>
                          <CliElapsed status={terminal.cliStatus} />
                          {(terminal.state === "exited" ||
                            terminal.state === "error") && (
                            <span className="nav-session-exited">
                              {t("Exited")}
                            </span>
                          )}
                        </SidebarMenuButton>
                      </ContextMenuTrigger>
                      <ContextMenuContent>
                        <ContextMenuItem
                          data-iori-action="terminal-close"
                          onSelect={() => onCloseTerminal(terminal.id)}
                        >
                          <X aria-hidden="true" />
                          {t("Close terminal")}
                        </ContextMenuItem>
                      </ContextMenuContent>
                    </ContextMenu>
                    <ChildRows
                      {...childRows}
                      children={childrenByParent.get(terminal.id) ?? []}
                    />
                    {terminalErrors[terminal.id] && (
                      <p className="nav-inline-error" role="alert">
                        {terminalErrors[terminal.id]}
                      </p>
                    )}
                  </SidebarMenuItem>
                ))}
              </SidebarMenu>
            )}
          </CollapsibleContent>
        </Collapsible>
      </WorkspaceSidebarItem>
    );
  };

  const repository = (host: HostInfo, folder: FolderHistoryItem) => {
    const items = worktreesOf(folder).filter(
      (worktree) => !isChildWorktree(host.publicKey, worktree.path),
    );
    const rows = items.map((item) => worktree(host, folder, item));
    if (!rows.some(Boolean)) return null;
    const id = `repo:${host.publicKey}:${folder.workspacePath}`;
    const open = !collapsed.has(id) || Boolean(needle);
    return (
      <SortableSidebarItem
        id={folder.workspacePath}
        disabled={Boolean(needle)}
        key={folder.workspacePath}
        className="nav-repository"
      >
        <Collapsible open={open} onOpenChange={(value) => toggle(id, value)}>
          <div className="nav-repository-heading">
            <ContextMenu>
              <ContextMenuTrigger asChild>
                <CollapsibleTrigger asChild>
                  <SortableRowButton
                    sortable={!needle}
                    className="nav-repository-button"
                    data-iori-repository-path={folder.workspacePath}
                    data-iori-workspace-path={folder.workspacePath}
                    title={folder.workspacePath}
                  >
                    <Folder size={13} />
                    <span>{basename(folder.workspacePath)}</span>
                  </SortableRowButton>
                </CollapsibleTrigger>
              </ContextMenuTrigger>
              {removeMenu(host, folder)}
            </ContextMenu>
            {issueRepositories[
              issueRepositoryKey(host.publicKey, folder.workspacePath)
            ] && (
              <Button
                variant="ghost"
                size="icon-sm"
                className="nav-repository-action"
                aria-label="Issues"
                title="Issues"
                data-iori-action="repository-issues"
                data-iori-repository-path={folder.workspacePath}
                onClick={() => onOpenIssues(host, folder)}
              >
                <CircleDot size={14} />
              </Button>
            )}
            <Button
              variant="ghost"
              size="icon-sm"
              className="nav-repository-action"
              aria-label={t("New worktree")}
              title={t("New worktree")}
              data-iori-action="new-worktree"
              data-iori-repository-path={folder.workspacePath}
              onClick={() => onCreate(host, folder)}
            >
              <Plus size={14} />
            </Button>
            <CollapsibleTrigger asChild>
              <Button
                variant="ghost"
                size="icon-sm"
                className="nav-worktree-toggle"
                aria-label={t(
                  open ? "Collapse {name}" : "Expand {name}",
                ).replace("{name}", basename(folder.workspacePath))}
                data-iori-action="repository-toggle"
              >
                {open ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
              </Button>
            </CollapsibleTrigger>
          </div>
          <CollapsibleContent>
            <SidebarMenu>{rows}</SidebarMenu>
          </CollapsibleContent>
        </Collapsible>
      </SortableSidebarItem>
    );
  };

  const hostSection = (host: HostInfo) => {
    const own = folders.filter(
      (item) => item.host.publicKey === host.publicKey,
    );
    const rows = own.map(({ folder }) =>
      folder.kind === "git"
        ? repository(host, folder)
        : worktreesOf(folder).map((item) => worktree(host, folder, item)),
    );
    if (
      needle &&
      !rows.flat().some(Boolean) &&
      !matching(`${host.hostName} ${t("AI Agents/Teams")}`)
    )
      return null;
    const id = `host:${host.publicKey}`;
    const open = !collapsed.has(id) || Boolean(needle);
    const connected = connectedHosts.includes(host.publicKey);
    const removalLabel = hostRemovalLabel(removals[host.publicKey]);
    // A Host that is not connected has not answered yet; that is not a failure.
    const historyFailure = connected ? historyError[host.publicKey] : undefined;
    return (
      <SortableSidebarItem
        id={host.publicKey}
        disabled={Boolean(needle)}
        className="nav-host-section"
        key={host.publicKey}
      >
        <Collapsible open={open} onOpenChange={(value) => toggle(id, value)}>
          <div className="nav-host-row">
            <CollapsibleTrigger asChild>
              <SortableRowButton
                sortable={!needle}
                className="nav-host-title"
                data-iori-removal={removals[host.publicKey]?.status?.phase}
                data-iori-host-key={host.publicKey}
              >
                <span className="nav-host-name">
                  {host.hostName}
                  {removalLabel ? ` · ${t(removalLabel)}` : ""}
                </span>
                {host.os && <span className="nav-host-os">{host.os}</span>}
                <span
                  className="nav-connected-mark"
                  data-connected={connected}
                  role="img"
                  aria-label={t(connected ? "Connected" : "Disconnected")}
                />
              </SortableRowButton>
            </CollapsibleTrigger>
            <Button
              variant="ghost"
              size="icon-sm"
              className="nav-host-settings"
              aria-label={t("Host settings")}
              title={t("Host settings")}
              data-iori-action="host-settings-open"
              data-iori-host-key={host.publicKey}
              onClick={() => {
                onSettings(host.publicKey);
                setOpenMobile(false);
              }}
            >
              <Settings size={13} />
              <UpdateMark
                t={t}
                available={hostNeedsUpdate(observedHosts[host.publicKey])}
              />
            </Button>
            <Button
              variant="ghost"
              size="icon-sm"
              className="nav-host-add"
              aria-label={t("Add folder")}
              title={t("Add folder")}
              data-iori-action="sidebar-add-folder"
              data-iori-host-name={host.hostName}
              onClick={() => onAddFolder(host.publicKey)}
            >
              <Plus size={13} />
            </Button>
          </div>
          <CollapsibleContent>
            {historyFailure && (
              <div className="nav-inline-error" role="alert">
                <span>{t(historyFailure)}</span>
                <Button
                  variant="outline"
                  size="xs"
                  onClick={() => onRetryHistory(host.publicKey)}
                >
                  {t("Retry")}
                </Button>
              </div>
            )}
            <SidebarMenu>
              <SidebarMenuItem>
                <SidebarMenuButton
                  isActive={teamsHostKey === host.publicKey}
                  aria-current={
                    teamsHostKey === host.publicKey ? "page" : undefined
                  }
                  data-iori-action="open-agents-teams"
                  data-iori-host-key={host.publicKey}
                  onClick={() => {
                    onTeams(host);
                    setOpenMobile(false);
                  }}
                >
                  <Bot size={14} />
                  <span>{t("AI Agents/Teams")}</span>
                </SidebarMenuButton>
              </SidebarMenuItem>
              <SidebarSort
                ids={own.map(({ folder }) => folder.workspacePath)}
                disabled={Boolean(needle)}
                t={t}
                onReorder={(paths) => onReorderFolders(host.publicKey, paths)}
              >
                {rows}
              </SidebarSort>
              {own.length === 0 && !historyFailure && (
                <SidebarMenuItem className="nav-worktree">
                  <SidebarMenuButton
                    className="nav-add-folder"
                    onClick={() => onAddFolder(host.publicKey)}
                  >
                    <Plus size={13} />
                    <span>{t("Add folder")}…</span>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              )}
            </SidebarMenu>
          </CollapsibleContent>
        </Collapsible>
      </SortableSidebarItem>
    );
  };

  return (
    <Sidebar className="nav-sidebar" collapsible="offcanvas">
      <SidebarHeader>
        {hasWindowChrome && (
          <div className="window-sidebar-drag-strip" data-tauri-drag-region />
        )}
        <div
          className="nav-search"
          data-tauri-drag-region={hasWindowChrome ? "" : undefined}
        >
          <Search size={13} />
          <Input
            placeholder={t("Search")}
            aria-label={t("Search")}
            // Opening the drawer must not raise the software keyboard.
            tabIndex={isMobile ? -1 : undefined}
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
        </div>
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton
              className="nav-pending"
              data-iori-action="attention-open"
              data-iori-attention-count={attentionCount}
              onClick={() => {
                onAttention();
                setOpenMobile(false);
              }}
              disabled={attentionCount === 0}
            >
              <StatusDot state="waiting" aria-label={t("Attention")} />
              <span>{t("Attention")}</span>
              <span className="nav-count">{attentionCount}</span>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarHeader>
      <SidebarContent>
        <ScrollArea className="navigation-scroll">
          {removeError && (
            <p className="nav-inline-error" role="alert">
              {t(removeError)}
            </p>
          )}
          <SidebarMenu>
            {isMobile && (
              <SidebarMenuItem>
                <SidebarMenuButton
                  isActive={homeActive}
                  aria-current={homeActive ? "page" : undefined}
                  data-iori-action="mobile-home"
                  onClick={onHome}
                >
                  <Home size={14} />
                  <span>{t("Home")}</span>
                </SidebarMenuButton>
              </SidebarMenuItem>
            )}
            <SidebarSort
              ids={hosts.map((host) => host.publicKey)}
              disabled={Boolean(needle)}
              t={t}
              onReorder={onReorderHosts}
            >
              {hosts.map(hostSection)}
            </SidebarSort>
          </SidebarMenu>
        </ScrollArea>
      </SidebarContent>
      <SidebarFooter>
        <div className="nav-footer-actions">
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label={t("Settings")}
            title={t("Settings")}
            data-iori-action="settings-open"
            onClick={() => {
              onSettings();
              setOpenMobile(false);
            }}
          >
            <Settings size={14} />
            <SettingsUpdateMark t={t} />
          </Button>
        </div>
      </SidebarFooter>
    </Sidebar>
  );
}
