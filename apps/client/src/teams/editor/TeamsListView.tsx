import { useEffect, useRef, useState, type ReactNode } from "react";
import { Check, Plus, Users } from "lucide-react";
import { AsyncState } from "../../components/AsyncState.tsx";
import { FlatPageHeader } from "../../components/SectionLayout.tsx";
import { Badge } from "../../components/ui/badge.tsx";
import { Button } from "../../components/ui/button.tsx";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "../../components/ui/select.tsx";
import { useI18n } from "../context.tsx";
import { HiddenItems } from "../HiddenItems.tsx";
import { pickerTeams, type Team } from "../team-data.ts";
import { ActionsMenu } from "./EditorPrimitives.tsx";
import { isTeamDirty, type EditableTeamRecord } from "./types.ts";

export function TeamsListView({
  teams,
  defaultTeam,
  settingsError,
  onDefaultTeamChange,
  onNewTeam,
  onOpenTeam,
  formatDate,
  renderTeamMenu,
}: {
  teams: EditableTeamRecord[];
  defaultTeam: string;
  settingsError?: "defaultTeam" | "limits";
  onDefaultTeamChange: (teamId: string) => Promise<boolean>;
  onNewTeam: () => void;
  onOpenTeam: (teamId: string) => void;
  formatDate: (value: string) => string;
  renderTeamMenu: (source: Team) => ReactNode;
}) {
  const { t } = useI18n();
  const [defaultSaved, setDefaultSaved] = useState(false);
  const savedTimer = useRef<number | null>(null);

  useEffect(() => {
    return () => {
      if (savedTimer.current !== null) window.clearTimeout(savedTimer.current);
    };
  }, []);

  const visibleTeams = pickerTeams(teams);
  const hiddenTeams = teams.filter((record) => record.hidden);

  const renderTeamRow = (record: EditableTeamRecord) => {
    const conversations =
      typeof record.conversationCount === "number"
        ? record.conversationCount
        : undefined;
    const isDefault = record.saved.id === defaultTeam;
    const dirty = isTeamDirty(record);
    return (
      <div
        key={record.saved.id}
        className="flex items-start justify-between gap-3 px-2 py-3.5 transition-colors [@media(hover:hover)]:hover:bg-accent/40"
      >
        <button
          type="button"
          className="team-list-open flex min-w-0 flex-1 cursor-pointer flex-col gap-1 text-left outline-none focus-visible:ring-2 focus-visible:ring-ring/40"
          data-iori-team-id={record.saved.id}
          onClick={() => onOpenTeam(record.saved.id)}
        >
          <div className="flex flex-wrap items-center gap-2">
            <strong className="font-heading text-sm font-semibold break-words whitespace-normal text-foreground">
              {record.saved.name}
            </strong>
            {isDefault && <Badge variant="default">{t("Default")}</Badge>}
            {dirty && (
              <span
                aria-label={t("Unsaved changes")}
                className="size-2 shrink-0 rounded-full bg-status-waiting"
              />
            )}
          </div>
          {record.saved.description && (
            <p className="m-0 text-xs leading-relaxed text-muted-foreground">
              {record.saved.description}
            </p>
          )}
          <div className="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-2xs tabular-nums text-muted-foreground">
            <span className="font-medium text-foreground">
              {t("Version {version}").replace(
                "{version}",
                String(record.saved.version),
              )}
            </span>
            <time>
              {t("Updated")} {formatDate(record.saved.updated)}
            </time>
            {conversations !== undefined && (
              <Badge
                variant={conversations > 0 ? "running" : "neutral"}
                data-iori-team-conversations={conversations}
              >
                {conversations === 1
                  ? t("1 conversation")
                  : t("{count} conversations").replace(
                      "{count}",
                      String(conversations),
                    )}
              </Badge>
            )}
          </div>
        </button>

        <div className="shrink-0 pt-0.5">
          <ActionsMenu label="Team actions" triggerClassName="max-md:size-11">
            {renderTeamMenu(record.saved)}
          </ActionsMenu>
        </div>
      </div>
    );
  };

  return (
    <div className="mx-auto flex w-full max-w-[960px] flex-col gap-6 px-6 py-5 max-md:px-4 max-md:py-4">
      <FlatPageHeader
        title={t("Teams")}
        bordered={false}
        className="pb-0"
        actions={
          <Button type="button" size="sm" onClick={onNewTeam}>
            <Plus className="size-3.5" aria-hidden="true" />
            {t("New team")}
          </Button>
        }
      />

      {/* Default Team (immediate save, flat 1px hairline row) */}
      <section
        aria-label={t("Default team")}
        className="flex flex-col border-t border-border pt-3.5"
      >
        <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
          <span className="text-xs font-semibold text-foreground">
            {t("Default team")}
          </span>
          <div className="flex min-w-0 flex-wrap items-center gap-2.5">
            {defaultSaved && (
              <span
                role="status"
                className="inline-flex items-center gap-1 text-2xs font-medium text-status-running-text"
              >
                <Check className="size-3" aria-hidden="true" />
                {t("Saved")}
              </span>
            )}
            <Select
              value={defaultTeam || "none"}
              onValueChange={(value) => {
                void onDefaultTeamChange(value === "none" ? "" : value).then(
                  (ok) => {
                    if (!ok) return;
                    setDefaultSaved(true);
                    if (savedTimer.current !== null)
                      window.clearTimeout(savedTimer.current);
                    savedTimer.current = window.setTimeout(
                      () => setDefaultSaved(false),
                      2500,
                    );
                  },
                );
              }}
            >
              <SelectTrigger
                aria-label={t("Default team")}
                data-iori-action="default-team"
                className="h-auto min-h-8 w-56 max-w-full whitespace-normal *:data-[slot=select-value]:line-clamp-none *:data-[slot=select-value]:break-words *:data-[slot=select-value]:whitespace-normal max-md:w-48"
              >
                <SelectValue />
              </SelectTrigger>
              <SelectContent className="w-[var(--radix-select-trigger-width)]">
                {["none", ...visibleTeams.map((record) => record.saved.id)].map(
                  (id) => (
                    <SelectItem
                      value={id}
                      key={id}
                      data-iori-default-team={id}
                      className="h-auto min-h-7 items-start break-words whitespace-normal"
                    >
                      {id === "none"
                        ? t("None")
                        : teams.find((record) => record.saved.id === id)?.saved
                            .name}
                    </SelectItem>
                  ),
                )}
              </SelectContent>
            </Select>
          </div>
        </div>
        {settingsError === "defaultTeam" && (
          <p role="alert" className="mt-2 text-xs text-status-failed-text">
            {t("Could not save settings. Choose it again to retry.")}
          </p>
        )}
      </section>

      {/* Team List (flat 1px divide-y hairline rows, zero cards) */}
      <section aria-label={t("Teams")} className="flex flex-col">
        <AsyncState
          mode={teams.length === 0 ? "empty" : "ready"}
          t={t}
          emptyIcon={<Users className="size-4" aria-hidden="true" />}
          emptyTitle={t(
            "No teams yet. Choose New team to create one from a template.",
          )}
          errorTitle={t("Could not load teams. Retry.")}
        >
          <div className="divide-y divide-border-subtle border-y border-border">
            {visibleTeams.map(renderTeamRow)}
          </div>
          {hiddenTeams.length > 0 && (
            <HiddenItems>
              <div className="divide-y divide-border-subtle">
                {hiddenTeams.map(renderTeamRow)}
              </div>
            </HiddenItems>
          )}
        </AsyncState>
      </section>
    </div>
  );
}
