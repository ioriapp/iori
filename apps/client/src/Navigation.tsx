import { useEffect, useState } from "react";
import {
  Bot,
  ChevronDown,
  ChevronRight,
  CircleDot,
  Folder,
  Home,
  Plus,
  Search,
  Settings,
} from "lucide-react";
import type { FolderHistoryItem, HostInfo } from "@iori/protocol";
import { cn } from "cn";
import {
  useWorktreeRemovalFlow,
  locallyRemoving,
} from "./worktree-removal-flow.ts";
import ioriIcon from "./assets/iori-icon.svg";
import { connection } from "./connection.ts";
import { useForgeStatus, forgeKey } from "./forge-status.ts";
import { issueRepositoryKey } from "./issues/issue-repositories.ts";
import { SidebarSort, SortableSidebarItem } from "./SidebarSort.tsx";
import { hostNeedsUpdate } from "./updates/host-controller.ts";
import { UpdateMark, SettingsUpdateMark } from "./updates/UpdateSettings.tsx";
import { hasWindowChrome } from "./native.ts";
import { Button } from "./components/ui/button.tsx";
import { Input } from "./components/ui/input.tsx";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "./components/ui/collapsible.tsx";
import {
  ContextMenu,
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
import { basename } from "./workspace-panel.tsx";
import { isStalledCliStatus, useTick } from "./CliStatus.tsx";
import { StatusDot } from "./components/StatusDot.tsx";
import {
  worktreesOf,
  type NavigationProps,
  type SidebarFolder,
} from "./navigation/types.ts";
import {
  SORTABLE_ITEM_CLASS,
  SortableRowButton,
  WorktreeContextMenuContent,
  WorktreeItem,
} from "./navigation/WorktreeItem.tsx";

export { worktreesOf, type SidebarFolder };

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
  issueRepositories,
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
}: NavigationProps) {
  const removalState = useWorktreeRemovalFlow();
  const isRemoving = (hostKey: string, path: string) =>
    locallyRemoving(removalState, hostKey, path) ||
    folders.some(
      (entry) =>
        entry.host.publicKey === hostKey &&
        entry.folder.worktrees?.some(
          (item) => item.path === path && item.removing,
        ),
    );
  const {
    isMobile,
    setOpenMobile,
    open: sidebarOpen,
    openMobile,
  } = useSidebar();
  const [cliOrders, setCliOrders] = useState<Record<string, string[]>>({});
  const now = useTick(
    folders.some((entry) =>
      worktreesOf(entry.folder).some((wt) =>
        sessionsFor(entry.host.publicKey, wt.path).some((terminal) =>
          isStalledCliStatus(terminal.cliStatus),
        ),
      ),
    ),
  );
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
      if (
        folders.some(
          ({ host: folderHost, folder }) =>
            folderHost.publicKey === host.publicKey &&
            folder.kind === "git" &&
            folder.worktrees === undefined &&
            id.startsWith(
              `worktree:${host.publicKey}:${folder.workspacePath}:`,
            ),
        )
      )
        return true;
      return existing.has(id);
    });
    if (next.length !== collapsedKeys.length) onCollapsedChange(next, true);
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
  const closeMobile = () => setOpenMobile(false);

  const renderWorktree = (
    host: HostInfo,
    folder: FolderHistoryItem,
    item: ReturnType<typeof worktreesOf>[number],
  ) => (
    <WorktreeItem
      key={item.path}
      host={host}
      folder={folder}
      item={item}
      needle={needle}
      matching={matching}
      isMobile={isMobile}
      isSelected={
        selected?.hostKey === host.publicKey &&
        selected.workspacePath === folder.workspacePath &&
        selected.worktreePath === item.path
      }
      removing={isRemoving(host.publicKey, item.path)}
      isRemoving={isRemoving}
      collapsed={collapsed}
      toggle={toggle}
      cliOrder={cliOrders[host.publicKey] ?? []}
      forgeStatus={
        showForgeStatus
          ? forgeStatuses[forgeKey(host.publicKey, item.path)]
          : undefined
      }
      childRows={getChildRows(host.publicKey, item.path)}
      sessions={sessionsFor(host.publicKey, item.path)}
      activeTerminalId={activeTerminalId}
      terminalErrors={terminalErrors}
      dragViews={dragViews}
      now={now}
      t={t}
      onSelectWorktree={onSelectWorktree}
      onCreate={onCreate}
      onOpenView={onOpenView}
      onOpenCi={onOpenCi}
      onDragView={onDragView}
      onOpenTerminal={onOpenTerminal}
      onCloseTerminal={onCloseTerminal}
      onDeleteWorktree={onDeleteWorktree}
      onRemoveFolder={onRemoveFolder}
      onSettings={onSettings}
      onCloseMobile={closeMobile}
    />
  );

  const repository = (host: HostInfo, folder: FolderHistoryItem) => {
    const items = worktreesOf(folder).filter(
      (worktree) => !isChildWorktree(host.publicKey, worktree.path),
    );
    const rows = items.map((item) => renderWorktree(host, folder, item));
    if (!rows.some(Boolean)) return null;
    const id = `repo:${host.publicKey}:${folder.workspacePath}`;
    const open = !collapsed.has(id) || Boolean(needle);
    return (
      <SortableSidebarItem
        id={folder.workspacePath}
        disabled={Boolean(needle)}
        key={folder.workspacePath}
        className={cn(
          SORTABLE_ITEM_CLASS,
          "nav-repository mx-1.5 mt-2.5 mb-0.5",
        )}
      >
        <Collapsible open={open} onOpenChange={(value) => toggle(id, value)}>
          <div className="nav-repository-heading flex items-center pr-1.5">
            <ContextMenu>
              <ContextMenuTrigger asChild>
                <CollapsibleTrigger asChild>
                  <SortableRowButton
                    sortable={!needle}
                    className="nav-repository-button h-auto min-h-7 min-w-0 flex-1 touch-manipulation gap-1.5 px-1.5 py-1 text-sm font-medium text-foreground [@media(pointer:coarse)]:min-h-9"
                    data-iori-repository-path={folder.workspacePath}
                    data-iori-workspace-path={folder.workspacePath}
                    title={folder.workspacePath}
                  >
                    <Folder
                      className="size-3.5 shrink-0 text-muted-foreground"
                      aria-hidden="true"
                    />
                    <span className="truncate">
                      {basename(folder.workspacePath)}
                    </span>
                  </SortableRowButton>
                </CollapsibleTrigger>
              </ContextMenuTrigger>
              <WorktreeContextMenuContent
                host={host}
                folder={folder}
                t={t}
                onSettings={onSettings}
                onDeleteWorktree={onDeleteWorktree}
                onRemoveFolder={onRemoveFolder}
                onCloseMobile={closeMobile}
              />
            </ContextMenu>
            {issueRepositories[
              issueRepositoryKey(host.publicKey, folder.workspacePath)
            ] && (
              <Button
                variant="ghost"
                size="icon-sm"
                className="nav-repository-action size-6.5 shrink-0 text-muted-foreground hover:text-foreground [@media(pointer:coarse)]:size-10"
                aria-label="Issues"
                title="Issues"
                data-iori-action="repository-issues"
                data-iori-repository-path={folder.workspacePath}
                onClick={() => onOpenIssues(host, folder)}
              >
                <CircleDot className="size-3.5" aria-hidden="true" />
              </Button>
            )}
            <Button
              variant="ghost"
              size="icon-sm"
              className="nav-repository-action size-6.5 shrink-0 text-muted-foreground hover:text-foreground [@media(pointer:coarse)]:size-10"
              aria-label={t("New worktree")}
              title={t("New worktree")}
              data-iori-action="new-worktree"
              data-iori-repository-path={folder.workspacePath}
              onClick={() => onCreate(host, folder)}
            >
              <Plus className="size-3.5" aria-hidden="true" />
            </Button>
            <CollapsibleTrigger asChild>
              <Button
                variant="ghost"
                size="icon-sm"
                className="nav-worktree-toggle size-6.5 shrink-0 text-muted-foreground hover:text-foreground aria-expanded:bg-transparent aria-expanded:hover:bg-accent [@media(pointer:coarse)]:size-10"
                aria-label={t(
                  open ? "Collapse {name}" : "Expand {name}",
                ).replace("{name}", basename(folder.workspacePath))}
                data-iori-action="repository-toggle"
              >
                {open ? (
                  <ChevronDown className="size-3.5" aria-hidden="true" />
                ) : (
                  <ChevronRight className="size-3.5" aria-hidden="true" />
                )}
              </Button>
            </CollapsibleTrigger>
          </div>
          <CollapsibleContent>
            <SidebarMenu className="gap-0">{rows}</SidebarMenu>
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
        : worktreesOf(folder).map((item) => renderWorktree(host, folder, item)),
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
    // A Host that is not connected has not answered yet; that is not a failure.
    const historyFailure = connected ? historyError[host.publicKey] : undefined;

    return (
      <SortableSidebarItem
        id={host.publicKey}
        disabled={Boolean(needle)}
        className={cn(
          SORTABLE_ITEM_CLASS,
          "nav-host-section mt-3 border-t border-sidebar-border/70 pt-2 first:mt-1 first:border-t-0 first:pt-0",
        )}
        key={host.publicKey}
      >
        <Collapsible open={open} onOpenChange={(value) => toggle(id, value)}>
          <div className="nav-host-row relative flex items-center pr-1">
            <CollapsibleTrigger asChild>
              <SortableRowButton
                sortable={!needle}
                className="nav-host-title flex h-auto min-h-8 min-w-0 flex-1 touch-manipulation items-center gap-1.5 px-3 py-1 text-sm font-medium text-sidebar-foreground [@media(pointer:coarse)]:min-h-10"
                data-iori-host-key={host.publicKey}
              >
                <span className="nav-host-name min-w-0 truncate">
                  {host.hostName}
                </span>
                {host.os && (
                  <span className="nav-host-os ml-auto shrink-0 text-xs font-normal text-muted-foreground">
                    {host.os}
                  </span>
                )}
                <span
                  className={cn(
                    "nav-connected-mark size-1.5 shrink-0 rounded-full",
                    host.os ? "ml-1" : "ml-auto",
                    connected ? "bg-status-running" : "bg-status-stopped",
                  )}
                  data-connected={connected}
                  role="img"
                  aria-label={t(connected ? "Connected" : "Disconnected")}
                />
              </SortableRowButton>
            </CollapsibleTrigger>
            <Button
              variant="ghost"
              size="icon-sm"
              className="nav-host-settings relative size-6.5 shrink-0 text-muted-foreground hover:text-foreground [&_[data-iori-state=update-available]]:absolute [&_[data-iori-state=update-available]]:top-0.5 [&_[data-iori-state=update-available]]:right-0.5 [@media(pointer:coarse)]:size-10"
              aria-label={t("Host settings")}
              title={t("Host settings")}
              data-iori-action="host-settings-open"
              data-iori-host-key={host.publicKey}
              onClick={() => {
                onSettings(host.publicKey);
                closeMobile();
              }}
            >
              <Settings className="size-3.5" aria-hidden="true" />
              <UpdateMark
                t={t}
                available={hostNeedsUpdate(observedHosts[host.publicKey])}
              />
            </Button>
            <Button
              variant="ghost"
              size="icon-sm"
              className="nav-host-add size-6.5 shrink-0 text-muted-foreground hover:text-foreground [@media(pointer:coarse)]:size-10"
              aria-label={t("Add folder")}
              title={t("Add folder")}
              data-iori-action="sidebar-add-folder"
              data-iori-host-name={host.hostName}
              onClick={() => onAddFolder(host.publicKey)}
            >
              <Plus className="size-3.5" aria-hidden="true" />
            </Button>
          </div>
          <CollapsibleContent>
            {historyFailure && (
              <div
                className="nav-inline-error mx-3 my-1 flex items-center justify-between gap-2 text-xs text-status-failed-text"
                role="alert"
              >
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
            <SidebarMenu className="gap-0">
              <SidebarMenuItem className="mx-1.5">
                <SidebarMenuButton
                  isActive={teamsHostKey === host.publicKey}
                  aria-current={
                    teamsHostKey === host.publicKey ? "page" : undefined
                  }
                  className="h-auto min-h-8 gap-2 px-2 py-1 text-sm data-[active=true]:bg-primary/15 data-[active=true]:font-semibold data-[active=true]:[&>svg]:text-primary [@media(pointer:coarse)]:min-h-10"
                  data-iori-action="open-agents-teams"
                  data-iori-host-key={host.publicKey}
                  onClick={() => {
                    onTeams(host);
                    closeMobile();
                  }}
                >
                  <Bot className="size-3.5 shrink-0" aria-hidden="true" />
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
                <SidebarMenuItem className="nav-worktree mx-1.5">
                  <SidebarMenuButton
                    className="nav-add-folder h-auto min-h-8 gap-2 px-2 py-1 text-sm text-muted-foreground [@media(pointer:coarse)]:min-h-10"
                    onClick={() => onAddFolder(host.publicKey)}
                  >
                    <Plus className="size-3.5 shrink-0" aria-hidden="true" />
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
    <Sidebar
      className="nav-sidebar border-r border-sidebar-border bg-sidebar text-sm text-sidebar-foreground data-[mobile=true]:w-[min(20.375rem,calc(100vw-2.75rem))] data-[mobile=true]:max-w-[calc(100vw-2.75rem)]"
      collapsible="offcanvas"
    >
      <SidebarHeader className="gap-1.5 px-2 pt-2 pb-1.5">
        {hasWindowChrome && (
          <div className="window-sidebar-drag-strip" data-tauri-drag-region />
        )}
        {!isMobile && (
          <div
            className="nav-brand-row flex min-h-7 items-center gap-2"
            data-tauri-drag-region={hasWindowChrome ? "" : undefined}
          >
            <div
              className="nav-brand flex shrink-0 items-center gap-2 px-2"
              data-tauri-drag-region={hasWindowChrome ? "" : undefined}
            >
              <img
                src={ioriIcon}
                width={20}
                height={20}
                alt=""
                className="size-5 shrink-0"
                data-tauri-drag-region={hasWindowChrome ? "" : undefined}
              />
              <span
                className="app-wordmark font-heading text-sm font-semibold tracking-tight text-sidebar-foreground"
                data-tauri-drag-region={hasWindowChrome ? "" : undefined}
              >
                iori
              </span>
            </div>
          </div>
        )}
        <div
          className="nav-search flex min-h-7 items-center gap-1.5 rounded-md border border-sidebar-border bg-sidebar-accent/60 px-2.5 text-muted-foreground focus-within:border-ring focus-within:ring-1 focus-within:ring-ring/40"
          data-tauri-drag-region={hasWindowChrome ? "" : undefined}
        >
          <Search className="size-3.5 shrink-0" aria-hidden="true" />
          <Input
            placeholder={t("Search")}
            aria-label={t("Search")}
            className="h-auto min-h-7 border-0 bg-transparent p-0 text-sm shadow-none focus-visible:border-transparent focus-visible:ring-0"
            // Opening the drawer must not raise the software keyboard.
            tabIndex={isMobile ? -1 : undefined}
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
        </div>
        <SidebarMenu className="gap-0">
          <SidebarMenuItem>
            <SidebarMenuButton
              className={cn(
                "nav-pending flex h-auto min-h-8 items-center gap-2 rounded-md px-2 py-1 text-sm font-normal [@media(pointer:coarse)]:min-h-10",
                attentionCount > 0 &&
                  "border border-status-waiting-border bg-status-waiting-bg/50 font-medium text-foreground",
              )}
              data-iori-action="attention-open"
              data-iori-attention-count={attentionCount}
              onClick={() => {
                onAttention();
                closeMobile();
              }}
              disabled={attentionCount === 0}
            >
              <StatusDot state="waiting" t={t} label={t("Attention")} />
              <span>{t("Attention")}</span>
              <span className="nav-count ml-auto text-xs tabular-nums text-muted-foreground">
                {attentionCount}
              </span>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarHeader>

      <SidebarContent className="gap-0 overflow-hidden">
        <div className="navigation-scroll flex min-h-0 flex-1 flex-col overflow-x-hidden overflow-y-auto pr-1.5">
          {removeError && (
            <p
              className="nav-inline-error mx-3 my-1 text-xs text-status-failed-text"
              role="alert"
            >
              {t(removeError)}
            </p>
          )}
          <SidebarMenu className="gap-0 pb-2">
            {isMobile && (
              <SidebarMenuItem className="mx-1.5 mb-1">
                <SidebarMenuButton
                  isActive={homeActive}
                  aria-current={homeActive ? "page" : undefined}
                  className="h-auto min-h-9 gap-2 px-2 py-1 text-sm data-[active=true]:bg-primary/15 data-[active=true]:font-semibold data-[active=true]:[&>svg]:text-primary [@media(pointer:coarse)]:min-h-10"
                  data-iori-action="mobile-home"
                  onClick={onHome}
                >
                  <Home className="size-3.5 shrink-0" aria-hidden="true" />
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
        </div>
      </SidebarContent>

      <SidebarFooter className="border-t border-sidebar-border px-2 py-1">
        <div className="nav-footer-actions flex min-h-8 items-center gap-1">
          <Button
            variant="ghost"
            size="icon-sm"
            className="relative size-7 text-muted-foreground hover:text-foreground [@media(pointer:coarse)]:size-11"
            aria-label={t("Settings")}
            title={t("Settings")}
            data-iori-action="settings-open"
            onClick={() => {
              onSettings();
              closeMobile();
            }}
          >
            <Settings className="size-3.5" aria-hidden="true" />
            <SettingsUpdateMark t={t} />
          </Button>
        </div>
      </SidebarFooter>
    </Sidebar>
  );
}
