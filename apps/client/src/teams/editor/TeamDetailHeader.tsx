import type { ReactNode } from "react";
import { ArrowLeft, History, RotateCcw } from "lucide-react";
import { cn } from "cn";
import { Badge } from "../../components/ui/badge.tsx";
import { Button } from "../../components/ui/button.tsx";
import { useI18n } from "../context.tsx";
import { ActionsMenu } from "./EditorPrimitives.tsx";
import type { EditableTeamRecord, Selection, WorkingAction } from "./types.ts";

export function TeamSaveStatus({
  dirty,
  saveMessage,
}: {
  dirty: boolean;
  saveMessage: string;
}) {
  const { t } = useI18n();
  const error = saveMessage.startsWith("Could");

  if (error) {
    return (
      <span
        role="alert"
        className="text-xs font-medium text-status-failed-text [overflow-wrap:anywhere]"
      >
        {t(saveMessage)}
      </span>
    );
  }
  if (dirty) {
    return (
      <Badge variant="waiting" role="status">
        {t("Unsaved changes")}
      </Badge>
    );
  }
  return (
    <Badge variant="neutral" role="status">
      {t(saveMessage ? "Settings saved" : "Saved")}
    </Badge>
  );
}

export function TeamDetailHeader({
  record,
  selection,
  selectedRoleName,
  dirty,
  working,
  workingOn,
  saveMessage,
  isMobile,
  onBack,
  onOpenHistory,
  onUndo,
  onSave,
  renderTeamMenu,
}: {
  record: EditableTeamRecord;
  selection: Extract<Selection, { page: "team" }>;
  selectedRoleName?: string;
  dirty: boolean;
  working: boolean;
  workingOn?: WorkingAction;
  saveMessage: string;
  isMobile: boolean;
  onBack: () => void;
  onOpenHistory: () => void;
  onUndo: () => void;
  onSave: () => void;
  renderTeamMenu: () => ReactNode;
}) {
  const { t } = useI18n();
  const team = record.draft;
  const detailTitle =
    selection.detail === "parent"
      ? t("Orchestrator")
      : selection.detail === "overview"
        ? t("Team overview")
        : (selectedRoleName ?? team.name);

  return (
    <div className="sticky top-0 z-(--z-sticky) shrink-0 bg-background">
      <header
        data-iori-team-id={team.id}
        className="team-save-header flex flex-wrap items-center justify-between gap-x-3 gap-y-2 border-b border-border bg-background px-6 py-2.5 max-md:px-2 max-md:py-1.5"
      >
        <div className="flex min-w-0 flex-1 flex-wrap items-center gap-x-2.5 gap-y-1">
          <Button
            type="button"
            variant="ghost"
            size={isMobile ? "icon-touch" : "sm"}
            title={team.name}
            aria-label={isMobile ? t("Back") : undefined}
            onClick={onBack}
            className={cn(
              "text-muted-foreground hover:text-foreground",
              !isMobile && "h-7 max-w-52 px-1.5",
            )}
          >
            <ArrowLeft
              className={cn("shrink-0", isMobile ? "size-5" : "size-3.5")}
              aria-hidden="true"
            />
            {!isMobile && <span className="truncate">{team.name}</span>}
          </Button>

          <h1 className="m-0 min-w-0 font-heading text-base font-semibold text-foreground max-md:text-sm">
            <strong
              data-iori-team-version={team.version}
              className="font-semibold"
            >
              {detailTitle}
            </strong>
          </h1>

          <span className="text-xs tabular-nums text-muted-foreground max-md:hidden">
            {t("Version {version}").replace(
              "{version}",
              String(record.saved.version),
            )}
          </span>

          <div className="max-md:hidden">
            <TeamSaveStatus dirty={dirty} saveMessage={saveMessage} />
          </div>
        </div>

        <div className="flex shrink-0 items-center gap-1.5">
          <Button
            type="button"
            variant="outline"
            size={isMobile ? "icon-touch" : "sm"}
            className="team-history-button"
            data-iori-action="team-history"
            aria-label={isMobile ? t("History") : undefined}
            onClick={onOpenHistory}
          >
            <History
              className={cn(isMobile ? "size-4" : "size-3.5")}
              aria-hidden="true"
            />
            {!isMobile && <span>{t("History")}</span>}
          </Button>

          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={!dirty || working}
            onClick={onUndo}
            className="max-md:hidden"
          >
            <RotateCcw className="size-3.5" aria-hidden="true" />
            {t("Undo")}
          </Button>

          <Button
            type="button"
            variant="default"
            size="sm"
            disabled={!dirty || working}
            pending={workingOn === "save"}
            className="team-save-button max-md:h-10 max-md:px-4 max-md:text-sm"
            data-iori-action="team-save"
            onClick={onSave}
          >
            {t("Save")}
          </Button>

          <ActionsMenu
            label="Team actions"
            size={isMobile ? "icon-touch" : "icon-sm"}
          >
            {renderTeamMenu()}
          </ActionsMenu>
        </div>
      </header>

      {/* Mobile status / unsaved amber bar (flat hairline exception a) */}
      {isMobile && (dirty || saveMessage.startsWith("Could")) && (
        <div
          className={cn(
            "flex flex-wrap items-center justify-between gap-2 border-b px-3.5 py-2 text-xs",
            saveMessage.startsWith("Could")
              ? "border-status-failed-border bg-status-failed-bg/45"
              : "border-status-waiting-border bg-status-waiting-bg/55",
          )}
        >
          <div className="flex min-w-0 items-center gap-2">
            <TeamSaveStatus dirty={dirty} saveMessage={saveMessage} />
            <span className="text-2xs tabular-nums text-muted-foreground">
              {t("Version {version}").replace(
                "{version}",
                String(record.saved.version),
              )}
            </span>
          </div>
          {dirty && (
            <Button
              type="button"
              variant="ghost"
              size="xs"
              disabled={working}
              onClick={onUndo}
            >
              <RotateCcw className="size-3" aria-hidden="true" />
              {t("Undo")}
            </Button>
          )}
        </div>
      )}
    </div>
  );
}
