import type { ReactNode } from "react";
import {
  ArrowLeft,
  Bot,
  CalendarClock,
  ChevronDown,
  ChevronRight,
  GripVertical,
  History,
  Plus,
  Users,
} from "lucide-react";
import {
  DndContext,
  closestCenter,
  type SensorDescriptor,
  type SensorOptions,
} from "@dnd-kit/core";
import {
  SortableContext,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { cn } from "cn";
import { Button } from "../../components/ui/button.tsx";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "../../components/ui/collapsible.tsx";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuTrigger,
} from "../../components/ui/context-menu.tsx";
import { SidebarTrigger } from "../../components/ui/sidebar.tsx";
import { useI18n } from "../context.tsx";
import { pickerTeams, type Role, type Team } from "../team-data.ts";
import { ActionsMenu } from "./EditorPrimitives.tsx";
import {
  isTeamDirty,
  type EditableTeamRecord,
  type Selection,
} from "./types.ts";

function TeamRoleRow({
  role,
  sortable,
  selected,
  onOpen,
  onStep,
  children,
}: {
  role: Role;
  sortable: boolean;
  selected: boolean;
  onOpen: () => void;
  onStep: (direction: number) => void;
  children: ReactNode;
}) {
  const { t } = useI18n();
  const {
    attributes,
    listeners,
    setNodeRef,
    setActivatorNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: role.id, disabled: !sortable });

  return (
    <div
      ref={setNodeRef}
      className={cn(
        "group relative flex min-w-0 items-center",
        sortable && "-ml-5 max-md:-ml-7 [@media(pointer:coarse)]:min-h-11",
        isDragging && "z-(--z-popover) rounded-md bg-sidebar shadow-md",
      )}
      style={{
        transform: transform
          ? `translate3d(${transform.x}px,${transform.y}px,0)`
          : undefined,
        transition,
      }}
    >
      {sortable && (
        <Button
          type="button"
          variant="ghost"
          size="icon-xs"
          className="relative z-1 w-5 shrink-0 cursor-grab touch-none text-muted-foreground hover:text-foreground max-md:w-7 [@media(pointer:coarse)]:before:absolute [@media(pointer:coarse)]:before:top-1/2 [@media(pointer:coarse)]:before:-right-2 [@media(pointer:coarse)]:before:size-11 [@media(pointer:coarse)]:before:-translate-y-1/2"
          ref={setActivatorNodeRef}
          {...attributes}
          {...listeners}
          aria-label={`${t("Drag to reorder")} ${role.name}`}
          onKeyDown={(event) => {
            if (
              !isDragging &&
              (event.key === "ArrowUp" || event.key === "ArrowDown")
            ) {
              event.preventDefault();
              onStep(event.key === "ArrowUp" ? -1 : 1);
            } else {
              listeners?.onKeyDown?.(event);
            }
          }}
        >
          <GripVertical className="size-3.5" aria-hidden="true" />
        </Button>
      )}
      <button
        type="button"
        data-iori-action="team-role"
        data-iori-role-id={role.id}
        onClick={onOpen}
        className={cn(
          "relative flex min-h-8 min-w-0 flex-1 cursor-pointer items-center justify-between gap-2 rounded-md px-2 py-1.5 text-left text-xs font-medium transition-colors max-md:min-h-11 max-md:text-sm",
          selected
            ? "md:rounded-l-none md:bg-sidebar-accent md:text-foreground md:before:pointer-events-none md:before:absolute md:before:inset-y-0 md:before:left-0 md:before:w-0.5 md:before:bg-primary"
            : "text-sidebar-foreground/85 hover:bg-sidebar-accent/70 hover:text-foreground",
        )}
      >
        <span className="min-w-0 truncate">{role.name}</span>
        {role.limit && (
          <small className="shrink-0 rounded-sm border border-border bg-background/70 px-1.5 py-0.25 text-2xs tabular-nums text-muted-foreground">
            {role.limit}
          </small>
        )}
      </button>
      <div className="shrink-0 opacity-70 transition-opacity group-hover:opacity-100 focus-within:opacity-100">
        {children}
      </div>
    </div>
  );
}

export function AdminSidebar({
  selection,
  teams,
  expanded,
  onExpandedChange,
  isMobile,
  mobileDetail,
  sensors,
  onBack,
  onNavigate,
  onNewTeam,
  onOpenTeam,
  onAddRole,
  onMoveRole,
  renderTeamMenu,
  renderRoleMenu,
  renderMobileSaveBar,
}: {
  selection: Selection;
  teams: EditableTeamRecord[];
  expanded: Record<string, boolean>;
  onExpandedChange: (teamId: string, open: boolean) => void;
  isMobile: boolean;
  mobileDetail: boolean;
  sensors: SensorDescriptor<SensorOptions>[];
  onBack?: () => void;
  onNavigate: (next: Selection) => void;
  onNewTeam: () => void;
  onOpenTeam: (teamId: string, detail?: string) => void;
  onAddRole: (teamId: string) => void;
  onMoveRole: (
    record: EditableTeamRecord,
    id: string,
    targetId: string,
  ) => void;
  renderTeamMenu: (source: Team, context?: boolean) => ReactNode;
  renderRoleMenu: (role: Role, teamId: string) => ReactNode;
  renderMobileSaveBar: (record: EditableTeamRecord) => ReactNode;
}) {
  const { t, hostName } = useI18n();

  const navItemClass = (active: boolean) =>
    cn(
      "relative flex min-h-8 w-full cursor-pointer items-center gap-2 rounded-md px-2.5 py-1.5 text-left text-xs font-medium transition-colors max-md:min-h-11 max-md:text-sm",
      active
        ? "md:rounded-l-none md:bg-sidebar-accent md:text-foreground md:before:pointer-events-none md:before:absolute md:before:inset-y-0 md:before:left-0 md:before:w-0.5 md:before:bg-primary"
        : "text-sidebar-foreground/85 hover:bg-sidebar-accent/70 hover:text-foreground",
    );

  return (
    <nav
      aria-label={t("AI Agents/Teams")}
      className={cn(
        "flex w-60 shrink-0 flex-col overflow-y-auto border-r border-sidebar-border bg-sidebar p-3 [scrollbar-gutter:stable] max-lg:w-56 max-md:w-full max-md:flex-1 max-md:border-r-0 max-md:p-0",
        mobileDetail && "max-md:hidden",
      )}
    >
      {/* Top workspace-back / host bar */}
      <div className="mb-3 flex min-h-8 items-center gap-1.5 px-1 max-md:mb-2 max-md:min-h-12 max-md:border-b max-md:border-border max-md:px-1.5">
        <SidebarTrigger
          className="hidden size-11 max-md:inline-flex"
          aria-label={t("Open sidebar")}
          title={t("Open sidebar")}
          data-iori-action="sidebar-toggle"
        />
        {onBack ? (
          <button
            type="button"
            onClick={onBack}
            className="inline-flex min-w-0 cursor-pointer items-center gap-1.5 rounded-md px-1.5 py-1 text-xs font-medium text-muted-foreground transition-colors hover:bg-sidebar-accent hover:text-sidebar-foreground max-md:min-h-10 max-md:text-sm"
          >
            <ArrowLeft className="size-3.5 shrink-0" aria-hidden="true" />
            <span className="truncate">{hostName}</span>
          </button>
        ) : (
          <span className="truncate px-1.5 text-xs font-semibold text-muted-foreground max-md:text-sm">
            {hostName}
          </span>
        )}
      </div>

      {/* 4-Area Management Navigation */}
      <div className="flex flex-1 flex-col gap-0.5 max-md:px-3 max-md:pb-6">
        {/* 1. AI Agents */}
        <button
          type="button"
          className={navItemClass(selection.page === "agents")}
          data-iori-action="teams-agents"
          onClick={() => onNavigate({ page: "agents" })}
        >
          <Bot
            className={cn(
              "size-4 shrink-0",
              selection.page === "agents"
                ? "md:text-primary"
                : "text-muted-foreground",
            )}
            aria-hidden="true"
          />
          <span>{t("AI Agents")}</span>
        </button>

        {/* 2. Teams + Team Tree */}
        <div className="mt-1 flex flex-col gap-0.5">
          <div className="flex items-center gap-1">
            <button
              type="button"
              className={cn(navItemClass(selection.page === "teams"), "flex-1")}
              data-iori-action="teams-list"
              onClick={() => onNavigate({ page: "teams" })}
            >
              <Users
                className={cn(
                  "size-4 shrink-0",
                  selection.page === "teams"
                    ? "md:text-primary"
                    : "text-muted-foreground",
                )}
                aria-hidden="true"
              />
              <span>{t("Teams")}</span>
            </button>
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              aria-label={t("New team")}
              data-iori-action="team-new"
              className="shrink-0 text-muted-foreground hover:text-foreground max-md:size-11"
              onClick={onNewTeam}
            >
              <Plus className="size-4" />
            </Button>
          </div>

          {/* Expandable Team Trees */}
          {pickerTeams(teams).map((record) => {
            const open = !!expanded[record.draft.id];
            const dirty = isTeamDirty(record);
            const isThisTeam =
              selection.page === "team" && selection.teamId === record.draft.id;
            return (
              <Collapsible
                key={record.draft.id}
                open={open}
                onOpenChange={(yes) => onExpandedChange(record.draft.id, yes)}
                className="mt-0.5 flex flex-col"
              >
                <div className="group flex items-start gap-0.5">
                  <ContextMenu>
                    <ContextMenuTrigger asChild>
                      <CollapsibleTrigger asChild>
                        <button
                          type="button"
                          className="team-tree-team flex min-h-8 min-w-0 flex-1 cursor-pointer items-start gap-1.5 rounded-md px-2 py-1.5 text-left text-xs font-medium text-sidebar-foreground transition-colors hover:bg-sidebar-accent/70 max-md:min-h-11 max-md:text-sm"
                          data-iori-team-id={record.draft.id}
                        >
                          <span className="mt-0.5 flex shrink-0 items-center text-muted-foreground">
                            {open ? (
                              <ChevronDown className="size-3.5" />
                            ) : (
                              <ChevronRight className="size-3.5" />
                            )}
                          </span>
                          <span
                            data-iori-team-name={record.draft.id}
                            className="min-w-0 flex-1 break-words whitespace-normal"
                          >
                            {record.draft.name}
                          </span>
                          {dirty && (
                            <span
                              aria-label={t("Unsaved changes")}
                              className="mt-1.5 size-2 shrink-0 rounded-full bg-status-waiting"
                            />
                          )}
                        </button>
                      </CollapsibleTrigger>
                    </ContextMenuTrigger>
                    <ContextMenuContent>
                      {renderTeamMenu(record.saved, true)}
                    </ContextMenuContent>
                  </ContextMenu>
                  <div className="shrink-0 pt-0.5 opacity-70 transition-opacity group-hover:opacity-100 focus-within:opacity-100">
                    <ActionsMenu
                      label="Team actions"
                      size={isMobile ? "icon-touch" : "icon-sm"}
                    >
                      {renderTeamMenu(record.saved, false)}
                    </ActionsMenu>
                  </div>
                </div>

                <CollapsibleContent className="ml-5 flex flex-col gap-0.5 border-l border-sidebar-border/80 pl-2 max-md:ml-6">
                  <button
                    type="button"
                    data-iori-action="team-overview"
                    data-iori-team-id={record.draft.id}
                    onClick={() => onOpenTeam(record.draft.id, "overview")}
                    className={navItemClass(
                      isThisTeam && selection.detail === "overview",
                    )}
                  >
                    {t("Team overview")}
                  </button>
                  <button
                    type="button"
                    data-iori-action="team-parent"
                    data-iori-team-id={record.draft.id}
                    onClick={() => onOpenTeam(record.draft.id, "parent")}
                    className={navItemClass(
                      isThisTeam && selection.detail === "parent",
                    )}
                  >
                    {t("Orchestrator")}
                  </button>

                  <DndContext
                    sensors={sensors}
                    collisionDetection={closestCenter}
                    onDragEnd={({ active, over }) => {
                      if (over)
                        onMoveRole(record, String(active.id), String(over.id));
                    }}
                  >
                    <SortableContext
                      items={record.draft.roles.map((r) => r.id)}
                      strategy={verticalListSortingStrategy}
                    >
                      {record.draft.roles.map((r, index, allRoles) => (
                        <TeamRoleRow
                          key={r.id}
                          role={r}
                          sortable={allRoles.length > 1}
                          selected={isThisTeam && selection.detail === r.id}
                          onOpen={() => onOpenTeam(record.draft.id, r.id)}
                          onStep={(direction) => {
                            const target = allRoles[index + direction];
                            if (target) onMoveRole(record, r.id, target.id);
                          }}
                        >
                          {renderRoleMenu(r, record.draft.id)}
                        </TeamRoleRow>
                      ))}
                    </SortableContext>
                  </DndContext>

                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={() => onAddRole(record.draft.id)}
                    className="my-1 justify-start gap-1.5 px-2 text-xs text-muted-foreground hover:text-foreground max-md:min-h-11 max-md:text-sm"
                  >
                    <Plus className="size-3.5" aria-hidden="true" />
                    {t("Add role")}
                  </Button>

                  {isMobile && !mobileDetail && dirty && (
                    <div className="mb-2 flex flex-wrap items-center gap-2 rounded-md border border-status-waiting-border bg-status-waiting-bg/50 p-2.5">
                      {renderMobileSaveBar(record)}
                    </div>
                  )}
                </CollapsibleContent>
              </Collapsible>
            );
          })}
        </div>

        {/* 3. Automations */}
        <button
          type="button"
          className={cn(navItemClass(selection.page === "automations"), "mt-1")}
          data-iori-action="teams-automations"
          onClick={() => onNavigate({ page: "automations" })}
        >
          <CalendarClock
            className={cn(
              "size-4 shrink-0",
              selection.page === "automations"
                ? "md:text-primary"
                : "text-muted-foreground",
            )}
            aria-hidden="true"
          />
          <span>Automations</span>
        </button>

        {/* 4. Records */}
        <button
          type="button"
          className={navItemClass(selection.page === "records")}
          data-iori-action="teams-records"
          onClick={() => onNavigate({ page: "records" })}
        >
          <History
            className={cn(
              "size-4 shrink-0",
              selection.page === "records"
                ? "md:text-primary"
                : "text-muted-foreground",
            )}
            aria-hidden="true"
          />
          <span>Records</span>
        </button>
      </div>
    </nav>
  );
}
