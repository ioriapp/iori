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
import "./children.css";
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
    <time className="cli-elapsed">
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
  const ended: ChildSummary[] = [];
  const live: ChildSummary[] = [];
  for (const child of children)
    (["finished", "stopped"].includes(child.state) ? ended : live).push(child);
  const row = (child: ChildSummary) => {
    const removing = props.isRemoving?.(child.cwd ?? child.parentCwd);
    const status = childStatus(child);
    const reason =
      child.state === "failed"
        ? child.failure
        : child.state === "stopped"
          ? undefined
          : child.reason;
    return (
      <div
        key={child.id}
        className={`nav-child ${removing ? "removal-disabled" : ""}`}
        inert={removing || undefined}
        data-iori-child-id={child.id}
        data-iori-child-state={child.state}
      >
        <div className="nav-child-line">
          <SidebarMenuButton
            className={`nav-session nav-child-button ${child.terminalId && child.terminalId === activeTerminalId ? "is-current" : ""}`}
            title={[
              child.role,
              child.title,
              child.cli?.name,
              child.model,
              status.label,
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
            <span className="nav-child-copy">
              <span className="nav-child-title">
                <StatusDot
                  state={status.state}
                  animated={status.state === "active"}
                  aria-label={status.label}
                />
                <span className="nav-child-role">{child.role}</span>
                <span className="nav-child-task">{child.title}</span>
                <Elapsed child={child} />
              </span>
              <span className="nav-child-detail">
                {child.cli && (
                  <>
                    <CliIcon
                      hostKey={props.hostKey}
                      cli={child.cli}
                      size={10}
                    />
                    <span className="nav-child-model">
                      {child.model || child.cli.name}
                    </span>
                    <span aria-hidden="true">·</span>
                  </>
                )}
                <span className="nav-child-state">
                  {status.label}
                  {status.description && ` · ${t(status.description)}`}
                  {reason ? ` · ${reason}` : ""}
                </span>
              </span>
            </span>
          </SidebarMenuButton>
          {!removing && !["finished", "stopped"].includes(child.state) && (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon-sm"
                  className="nav-child-menu"
                  aria-label={`${t("Child actions")} ${child.title}`}
                  data-iori-action="child-menu"
                >
                  <MoreHorizontal size={14} />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent>
                <DropdownMenuItem
                  data-iori-action="child-stop"
                  onSelect={() => onStop(child)}
                >
                  <Square size={13} />
                  {t("Stop child")}
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          )}
          {["finished", "stopped"].includes(child.state) && (
            <span className="nav-child-menu" aria-hidden="true" />
          )}
        </div>
        {errors[child.id] && (
          <p className="nav-inline-error" role="alert">
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
                  className={`nav-child-branch ${removing ? "is-deleting" : ""}`}
                  onClick={() => onBranch(own[0])}
                  title={removing ? undefined : path}
                >
                  {removing ? (
                    <Spinner aria-hidden="true" />
                  ) : (
                    <GitBranch size={13} />
                  )}
                  <MiddleEllipsis
                    className="nav-child-branch-name"
                    text={`${own[0].repositoryName ? `${own[0].repositoryName} › ` : ""}${branches[path] ?? own[0].branch ?? path.split(/[\\/]/u).at(-1)}`}
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
  return (
    <div className="nav-children">
      {grouped(live)}
      {ended.length > 0 && (
        <Collapsible open={expanded} onOpenChange={setExpanded}>
          <CollapsibleTrigger asChild>
            <Button
              variant="ghost"
              size="sm"
              className="nav-children-toggle"
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
                <ChevronDown size={13} />
              ) : (
                <ChevronRight size={13} />
              )}
              <span>{ended.length} Finished</span>
            </Button>
          </CollapsibleTrigger>
          <CollapsibleContent>{grouped(ended)}</CollapsibleContent>
        </Collapsible>
      )}
    </div>
  );
}
