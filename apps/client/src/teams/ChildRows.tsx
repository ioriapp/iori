import { Spinner } from "../components/ui/spinner.tsx";
import { creationOrder } from "@iori/protocol";
import { useEffect, useState } from "react";
import type { DragEvent } from "react";
import {
  ChevronDown,
  ChevronRight,
  GitBranch,
  MoreHorizontal,
  Square,
} from "lucide-react";
import type { ChildSummary } from "@iori/protocol";
import { cn } from "cn";
import { Button } from "../components/ui/button.tsx";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "../components/ui/collapsible.tsx";
import { SidebarMenuButton } from "../components/ui/sidebar.tsx";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
} from "../components/ui/dropdown-menu.tsx";
import { StatusDot } from "../components/StatusDot.tsx";
import { CliIcon } from "../CliIcon.tsx";
import { MiddleEllipsis } from "../MiddleEllipsis.tsx";
import { childRank, childStatus } from "./children.ts";
import { isStalledCliStatus, useTick } from "../CliStatus.tsx";
import { elapsedTime } from "./board-i18n.ts";

export type ChildRowProps = {
  hostKey: string;
  isRemoving?: (path: string) => boolean;
  children: ChildSummary[];
  activeTerminalId?: string;
  t: (key: string) => string;
  onOpen: (child: ChildSummary) => void;
  onStop: (child: ChildSummary) => void;
  onBranch: (child: ChildSummary) => void;
  onDrag: (
    child: ChildSummary,
  ) => (event: DragEvent<HTMLButtonElement>) => void;
  dragViews: boolean;
  errors: Record<string, string>;
  branches: Record<string, string>;
};

function Elapsed({ child }: { child: ChildSummary }) {
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    if (!child.startedAt) return;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [child.startedAt]);
  if (child.elapsedMs === undefined && child.startedAt === undefined)
    return null;
  const seconds = Math.floor(
    ((child.elapsedMs ?? 0) +
      (child.startedAt ? Math.max(0, now - child.startedAt) : 0)) /
      1000,
  );
  return (
    <time className="cli-elapsed shrink-0 self-center text-xs tabular-nums text-muted-foreground">
      {seconds < 60
        ? `${seconds}s`
        : seconds < 3600
          ? `${Math.floor(seconds / 60)}m`
          : `${Math.floor(seconds / 3600)}h ${Math.floor((seconds % 3600) / 60)}m`}
    </time>
  );
}

export function ChildRows(props: ChildRowProps) {
  const {
    children,
    t,
    onOpen,
    onStop,
    onBranch,
    onDrag,
    dragViews,
    activeTerminalId,
    errors,
    branches,
  } = props;
  const [expanded, setExpanded] = useState(false);
  const now = useTick(
    children.some((child) => isStalledCliStatus(child.cliStatus)),
  );
  const ended: ChildSummary[] = [];
  const live: ChildSummary[] = [];
  for (const child of children)
    (["finished", "stopped"].includes(child.state) ? ended : live).push(child);

  const row = (child: ChildSummary) => {
    const removing = props.isRemoving?.(child.cwd ?? child.parentCwd);
    const status = childStatus(child);
    const translatedStatusLabel = t(status.label);
    const elapsed =
      status.stalledSince !== undefined
        ? elapsedTime(now - status.stalledSince)
        : undefined;
    const reason =
      child.state === "failed"
        ? child.failure
        : child.state === "stopped"
          ? undefined
          : child.reason;
    const isCurrent = Boolean(
      child.terminalId && child.terminalId === activeTerminalId,
    );
    const isEnded = ["finished", "stopped"].includes(child.state);

    return (
      <div
        key={child.id}
        className={cn(
          "nav-child",
          removing && "removal-disabled pointer-events-none opacity-50",
        )}
        inert={removing || undefined}
        data-iori-child-id={child.id}
        data-iori-child-state={child.state}
      >
        <div className="nav-child-line group/child flex items-center">
          <SidebarMenuButton
            className={cn(
              "nav-session nav-child-button flex h-auto min-h-9 min-w-0 flex-1 items-center gap-1.5 rounded-md py-1 pr-1.5 pl-3.5 text-sm text-muted-foreground transition-colors disabled:opacity-100 [@media(pointer:coarse)]:min-h-10",
              isCurrent &&
                "is-current bg-primary/15 font-semibold text-foreground",
            )}
            title={[
              child.role,
              child.title,
              child.cli?.name,
              child.model,
              translatedStatusLabel,
              elapsed,
              status.description && t(status.description),
              reason,
            ]
              .filter(Boolean)
              .join(" · ")}
            disabled={removing || !child.terminalId}
            draggable={!removing && dragViews && !!child.terminalId}
            onDragStart={onDrag(child)}
            onClick={() => onOpen(child)}
          >
            <span className="nav-child-copy flex min-w-0 flex-1 flex-col">
              <span className="nav-child-title flex min-w-0 items-center gap-1.5 leading-normal">
                <StatusDot
                  state={status.state}
                  animated={status.state === "active"}
                  t={t}
                  label={translatedStatusLabel}
                />
                <span className="nav-child-role shrink-0 font-semibold text-foreground">
                  {child.role}
                </span>
                <span className="nav-child-task min-w-0 flex-1 truncate text-muted-foreground">
                  {child.title}
                </span>
                <Elapsed child={child} />
              </span>
              <span className="nav-child-detail flex min-w-0 items-center pl-3 text-xs leading-normal text-muted-foreground [&>.cli-icon]:mr-1 [&>.cli-icon]:shrink-0">
                {child.cli && (
                  <>
                    <CliIcon
                      hostKey={props.hostKey}
                      cli={child.cli}
                      size={12}
                    />
                    <span className="nav-child-model min-w-0 shrink truncate">
                      {child.model || child.cli.name}
                    </span>
                    <span className="mx-1 shrink-0" aria-hidden="true">
                      ·
                    </span>
                  </>
                )}
                <span className="nav-child-state max-w-[65%] min-w-0 shrink-0 truncate only:max-w-full">
                  {translatedStatusLabel}
                  {elapsed ? ` · ${elapsed}` : ""}
                  {status.description && ` · ${t(status.description)}`}
                  {reason ? ` · ${reason}` : ""}
                </span>
              </span>
            </span>
          </SidebarMenuButton>
          {!removing && !isEnded && (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon-sm"
                  className="nav-child-menu size-7 shrink-0 text-muted-foreground hover:text-foreground [@media(pointer:coarse)]:-my-0.5 [@media(pointer:coarse)]:size-11"
                  aria-label={`${t("Child actions")} ${child.title}`}
                  data-iori-action="child-menu"
                >
                  <MoreHorizontal className="size-3.5" aria-hidden="true" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem
                  data-iori-action="child-stop"
                  onSelect={() => onStop(child)}
                >
                  <Square className="size-3.5" aria-hidden="true" />
                  {t("Stop child")}
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          )}
          {isEnded && (
            <span
              className="nav-child-menu size-7 shrink-0 [@media(pointer:coarse)]:w-11"
              aria-hidden="true"
            />
          )}
        </div>
        {errors[child.id] && (
          <p
            className="nav-inline-error mx-3 my-1 text-xs text-status-failed-text"
            role="alert"
          >
            {t(errors[child.id])}
          </p>
        )}
      </div>
    );
  };

  const grouped = (items: ChildSummary[]) => {
    const groups = new Map<string, ChildSummary[]>();
    for (const child of [...items].sort(creationOrder)) {
      const path = child.worktreeRemoved
        ? child.parentCwd
        : (child.cwd ?? child.parentCwd);
      let group = groups.get(path);
      if (!group) groups.set(path, (group = []));
      group.push(child);
    }
    const name = (path: string, own: ChildSummary[]) =>
      `${own[0].repositoryName ?? ""} ${branches[path] ?? own[0].branch ?? path.split(/[\\/]/u).at(-1)}`;
    return [...groups]
      .sort(
        ([a, left], [b, right]) =>
          name(a, left).localeCompare(name(b, right)) || a.localeCompare(b),
      )
      .map(([path, own]) => {
        const removing = props.isRemoving?.(path);
        const label = `${own[0].repositoryName ? `${own[0].repositoryName} › ` : ""}${branches[path] ?? own[0].branch ?? path.split(/[\\/]/u).at(-1)}`;
        const pendingLabel = removing
          ? t("Deleting {name}").replace("{name}", () => label)
          : undefined;
        return (
          <div key={path}>
            {path !== own[0].parentCwd && (
              <div
                role="group"
                title={pendingLabel}
                aria-label={pendingLabel}
                data-iori-worktree-removing={removing ? "true" : undefined}
              >
                <Button
                  variant="ghost"
                  size="sm"
                  disabled={removing}
                  className={cn(
                    "nav-child-branch h-auto min-h-7 w-full justify-start gap-1.5 border-0 py-0.5 pr-2 pl-3.5 text-sm font-normal text-muted-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground",
                    removing &&
                      "is-deleting pointer-events-none cursor-default text-muted-foreground opacity-100",
                  )}
                  onClick={() => onBranch(own[0])}
                  title={removing ? undefined : path}
                >
                  {removing ? (
                    <Spinner aria-hidden="true" />
                  ) : (
                    <GitBranch
                      className="size-3.5 shrink-0"
                      aria-hidden="true"
                    />
                  )}
                  <MiddleEllipsis
                    className="nav-child-branch-name min-w-0 flex-1 overflow-hidden text-left whitespace-nowrap"
                    text={label}
                  />
                </Button>
              </div>
            )}
            {own
              .sort(
                (a, b) => childRank(a) - childRank(b) || creationOrder(a, b),
              )
              .map(row)}
          </div>
        );
      });
  };

  if (children.length === 0) return null;

  return (
    <div className="nav-children pl-5.5">
      {grouped(live)}
      {ended.length > 0 && (
        <Collapsible open={expanded} onOpenChange={setExpanded}>
          <CollapsibleTrigger asChild>
            <Button
              variant="ghost"
              size="sm"
              className="nav-children-toggle h-auto min-h-7 w-full justify-start gap-1.5 py-0.5 pr-2 pl-3.5 text-xs font-normal text-muted-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground [@media(pointer:coarse)]:min-h-9"
              disabled={ended.every((child) =>
                props.isRemoving?.(
                  child.worktreeRemoved
                    ? child.parentCwd
                    : (child.cwd ?? child.parentCwd),
                ),
              )}
              data-iori-action="children-ended"
              aria-expanded={expanded}
            >
              {expanded ? (
                <ChevronDown className="size-3.5 shrink-0" aria-hidden="true" />
              ) : (
                <ChevronRight
                  className="size-3.5 shrink-0"
                  aria-hidden="true"
                />
              )}
              <span>
                {t("{count} Finished").replace("{count}", String(ended.length))}
              </span>
            </Button>
          </CollapsibleTrigger>
          <CollapsibleContent>{grouped(ended)}</CollapsibleContent>
        </Collapsible>
      )}
    </div>
  );
}
