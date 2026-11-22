import { useCallback, useRef, useState } from "react";
import { Check, Copy } from "lucide-react";
import {
  DndContext,
  type SensorDescriptor,
  type SensorOptions,
} from "@dnd-kit/core";
import type { TeamDefinition, TeamRecord as SavedRecord } from "@iori/protocol";
import { UnsavedChangesDialog } from "../../components/UnsavedChangesDialog.tsx";
import { Button } from "../../components/ui/button.tsx";
import {
  Command,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "../../components/ui/command.tsx";
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "../../components/ui/dialog.tsx";
import { Label } from "../../components/ui/label.tsx";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "../../components/ui/select.tsx";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "../../components/ui/sheet.tsx";
import { connection } from "../../connection.ts";
import { useCliName, useI18n, useModelLabel } from "../context.tsx";
import { TeamHistoryEntry } from "../TeamHistoryEntry.tsx";
import { historySummary } from "../team-history.ts";
import type { Candidate, Team } from "../team-data.ts";
import { ExecutionHeading, ExecutionRow } from "./CandidateControls.tsx";
import {
  DIFFICULTY_LABELS,
  DIFFICULTY_LEVELS,
  hasEffortOption,
  type ConfirmationState,
  type EditableTeamRecord,
  type SaveConflictState,
  type WorkingAction,
} from "./types.ts";

export function SaveConflictDialog({
  saveConflict,
  conflictError,
  working,
  workingOn,
  formatDate,
  onCancel,
  onReload,
  onOverwrite,
  onDiscardDeleted,
  onSaveAsNew,
}: {
  saveConflict: SaveConflictState | null;
  conflictError: boolean;
  working: boolean;
  workingOn?: WorkingAction;
  formatDate: (value: string) => string;
  onCancel: () => void;
  onReload: (current: SavedRecord) => void;
  onOverwrite: () => Promise<void>;
  onDiscardDeleted: () => void;
  onSaveAsNew: () => Promise<void>;
}) {
  const { t } = useI18n();
  return (
    <Dialog
      open={!!saveConflict}
      onOpenChange={(open) => {
        if (!open) onCancel();
      }}
    >
      <DialogContent
        showCloseButton={false}
        data-iori-view="team-save-conflict"
        className="max-md:top-auto max-md:bottom-3 max-md:w-[calc(100%-1.5rem)] max-md:max-w-none max-md:translate-y-0 sm:max-w-md"
        onCloseAutoFocus={(event) => {
          event.preventDefault();
          document
            .querySelector<HTMLButtonElement>(
              ".team-surface:not([hidden]) .team-save-button",
            )
            ?.focus();
        }}
      >
        <DialogHeader className="pr-0">
          <DialogTitle>
            {t(
              saveConflict?.current
                ? "This team was changed on another device"
                : "This team was deleted on another device",
            )}
          </DialogTitle>
          {saveConflict?.current && (
            <p className="text-xs text-muted-foreground tabular-nums">
              {[
                t("Version {version}").replace(
                  "{version}",
                  String(saveConflict.current.saved.version),
                ),
                formatDate(saveConflict.current.saved.updated),
                historySummary(saveConflict.current.history[0], t),
              ].join(" · ")}
            </p>
          )}
          <DialogDescription>
            {t(
              saveConflict?.current
                ? "Reloading discards your unsaved changes on this device. Overwriting saves your changes as a new version, and the other device’s changes stay in History."
                : "To keep your changes, save them as a new team.",
            )}
          </DialogDescription>
        </DialogHeader>

        {conflictError && (
          <p role="alert" className="text-xs text-status-failed-text">
            {t("Could not save the team. Try again.")}
          </p>
        )}

        <DialogFooter className="flex flex-col-reverse gap-2 md:flex-row md:justify-end">
          <Button
            type="button"
            variant="outline"
            data-iori-action="team-conflict-cancel"
            disabled={working}
            className="max-md:min-h-11 max-md:w-full"
            onClick={onCancel}
          >
            {t("Cancel")}
          </Button>
          {saveConflict?.current ? (
            <>
              <Button
                type="button"
                variant="outline"
                data-iori-action="team-conflict-reload"
                disabled={working}
                className="max-md:min-h-11 max-md:w-full"
                onClick={() => onReload(saveConflict.current!)}
              >
                {t("Reload")}
              </Button>
              <Button
                type="button"
                variant="outline"
                data-iori-action="team-conflict-overwrite"
                disabled={working}
                pending={workingOn === "save"}
                className="max-md:min-h-11 max-md:w-full"
                onClick={() => void onOverwrite()}
              >
                {t("Overwrite")}
              </Button>
            </>
          ) : (
            <>
              <Button
                type="button"
                variant="outline"
                data-iori-action="team-conflict-discard"
                disabled={working}
                className="max-md:min-h-11 max-md:w-full"
                onClick={onDiscardDeleted}
              >
                {t("Discard Changes")}
              </Button>
              <Button
                type="button"
                data-iori-action="team-conflict-create"
                disabled={working}
                pending={workingOn === "create"}
                className="max-md:min-h-11 max-md:w-full"
                onClick={() => void onSaveAsNew()}
              >
                {t("Save as New Team")}
              </Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function LeaveConfirmDialog({
  open,
  dirty,
  working,
  saving,
  onCancel,
  onDiscard,
  onSave,
}: {
  open: boolean;
  dirty: boolean;
  working: boolean;
  saving: boolean;
  onCancel: () => void;
  onDiscard: () => void;
  onSave: () => void;
}) {
  const { t } = useI18n();
  if (dirty) {
    return (
      <UnsavedChangesDialog
        open={open}
        t={t}
        saving={saving}
        description={t("Changes to this team have not been saved.")}
        onCancel={onCancel}
        onDiscard={onDiscard}
        onSave={onSave}
      />
    );
  }
  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) onCancel();
      }}
    >
      <DialogContent
        showCloseButton={false}
        data-iori-view="team-discard-confirmation"
        className="max-md:top-auto max-md:bottom-3 max-md:w-[calc(100%-1.5rem)] max-md:max-w-none max-md:translate-y-0 sm:max-w-md"
      >
        <DialogHeader className="pr-0">
          <DialogTitle>{t("Discard changes?")}</DialogTitle>
          <DialogDescription>
            {t("Changes to these settings have not been saved.")}
          </DialogDescription>
        </DialogHeader>
        <DialogFooter className="flex flex-col-reverse gap-2 md:flex-row md:justify-end">
          <Button
            type="button"
            variant="outline"
            className="max-md:min-h-11 max-md:w-full"
            onClick={onCancel}
          >
            {t("Keep editing")}
          </Button>
          <Button
            type="button"
            variant="destructive"
            disabled={working}
            data-iori-action="team-discard"
            className="max-md:min-h-11 max-md:w-full"
            onClick={onDiscard}
          >
            {t("Discard changes")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function DeleteConfirmDialog({
  confirmation,
  error,
  working,
  onClose,
  onConfirm,
}: {
  confirmation: ConfirmationState | null;
  error: string;
  working: boolean;
  onClose: () => void;
  onConfirm: () => Promise<void>;
}) {
  const { t } = useI18n();
  return (
    <Dialog
      open={!!confirmation}
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DialogContent
        showCloseButton={false}
        className="max-md:top-auto max-md:bottom-3 max-md:w-[calc(100%-1.5rem)] max-md:max-w-none max-md:translate-y-0 sm:max-w-md"
      >
        <DialogHeader className="pr-0">
          <DialogTitle>{t(confirmation?.title ?? "")}</DialogTitle>
          <DialogDescription>{confirmation?.text}</DialogDescription>
        </DialogHeader>
        {error && (
          <p className="text-xs text-status-failed-text" role="alert">
            {t(error)}
          </p>
        )}
        <DialogFooter className="flex flex-col-reverse gap-2 md:flex-row md:justify-end">
          <Button
            type="button"
            variant="outline"
            className="max-md:min-h-11 max-md:w-full"
            onClick={onClose}
          >
            {t("Cancel")}
          </Button>
          <Button
            type="button"
            variant="destructive"
            data-iori-action={
              confirmation?.title === "Delete team?"
                ? "team-delete-confirm"
                : "role-delete-confirm"
            }
            pending={working}
            className="max-md:min-h-11 max-md:w-full"
            onClick={() => void onConfirm()}
          >
            {t("Delete")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

const TEMPLATE_LABELS: Record<string, string> = {
  development: "Development",
  research: "Research",
  writing: "Writing",
  minimal: "Minimal",
};

export function NewTeamDialog({
  open,
  onOpenChange,
  templates,
  teams,
  teamSource,
  onTeamSourceChange,
  newParent,
  onNewParentChange,
  selectableModels,
  availableClis,
  sensors,
  working,
  creating,
  onLimits,
  onCreate,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  templates: Record<string, TeamDefinition>;
  teams: EditableTeamRecord[];
  teamSource: string;
  onTeamSourceChange: (value: string) => void;
  newParent: Candidate;
  onNewParentChange: (changes: Partial<Candidate>) => void;
  selectableModels: Record<string, string[]>;
  availableClis: string[];
  sensors: SensorDescriptor<SensorOptions>[];
  working: boolean;
  creating: boolean;
  onLimits: (cli: string) => void;
  onCreate: () => void;
}) {
  const { t, catalogs, clis } = useI18n();
  const sourceListRef = useRef<HTMLDivElement>(null);
  const [sourceHasMore, setSourceHasMore] = useState(false);

  const updateSourceShadow = () => {
    const el = sourceListRef.current;
    if (el)
      setSourceHasMore(el.scrollHeight > el.clientHeight + el.scrollTop + 1);
  };

  const mountSourceList = useCallback((el: HTMLDivElement | null) => {
    sourceListRef.current = el;
    if (!el) return;
    const update = () =>
      setSourceHasMore(el.scrollHeight > el.clientHeight + el.scrollTop + 1);
    const observer = new ResizeObserver(update);
    observer.observe(el);
    if (el.firstElementChild) observer.observe(el.firstElementChild);
    update();
    return () => observer.disconnect();
  }, []);

  const isExisting = teamSource.startsWith("existing:");

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[calc(100dvh-2rem)] flex-col overflow-hidden sm:max-w-[680px]">
        <DialogHeader className="shrink-0">
          <DialogTitle>{t("New team")}</DialogTitle>
          <DialogDescription>
            {t("Start with a template or an existing team.")}
          </DialogDescription>
        </DialogHeader>

        <DialogBody className="flex min-h-0 flex-1 flex-col gap-4">
          <Command className="flex min-h-44 flex-1 flex-col rounded-md border border-border bg-background p-0">
            <CommandInput placeholder={t("Search")} />
            <div className="relative min-h-0 flex-1">
              <CommandList
                ref={mountSourceList}
                onScroll={updateSourceShadow}
                className="max-h-60"
              >
                <CommandGroup heading={t("Templates")}>
                  {Object.keys(templates).map((id) => {
                    const label = t(TEMPLATE_LABELS[id] ?? id);
                    const value = `template:${id}`;
                    return (
                      <CommandItem
                        key={id}
                        data-iori-template={id}
                        value={value}
                        keywords={[label]}
                        onSelect={() => onTeamSourceChange(value)}
                        className="justify-between"
                      >
                        <span>{label}</span>
                        {teamSource === value && (
                          <Check className="size-3.5 text-primary" />
                        )}
                      </CommandItem>
                    );
                  })}
                </CommandGroup>
                <CommandGroup heading={t("Existing teams")}>
                  {teams.map((record) => {
                    const value = `existing:${record.saved.id}`;
                    return (
                      <CommandItem
                        key={record.saved.id}
                        value={value}
                        keywords={[record.saved.name]}
                        onSelect={() => onTeamSourceChange(value)}
                        className="justify-between"
                      >
                        <span>{record.saved.name}</span>
                        {teamSource === value && (
                          <Check className="size-3.5 text-primary" />
                        )}
                      </CommandItem>
                    );
                  })}
                </CommandGroup>
              </CommandList>
              {sourceHasMore && (
                <div
                  aria-hidden="true"
                  className="pointer-events-none absolute inset-x-0 bottom-0 h-px bg-border shadow-xs"
                />
              )}
            </div>
          </Command>

          {!isExisting && (
            <div
              role="group"
              aria-labelledby="new-team-parent-label"
              aria-describedby="new-team-parent-description"
              className="flex shrink-0 flex-col gap-1.5"
            >
              <Label
                id="new-team-parent-label"
                className="text-xs font-medium text-foreground"
              >
                {t("Orchestrator")}
              </Label>
              <p
                id="new-team-parent-description"
                className="m-0 text-2xs text-muted-foreground"
              >
                {t("Roles without candidates also run with these settings.")}
              </p>
              <div className="border-y border-border">
                <ExecutionHeading
                  parent
                  showEffort={hasEffortOption(newParent, catalogs, clis)}
                />
                <DndContext sensors={sensors}>
                  <ExecutionRow
                    item={newParent}
                    parent
                    onChange={onNewParentChange}
                    availableModels={selectableModels}
                    recent={[]}
                    limits={{}}
                    available={availableClis}
                    onLimits={onLimits}
                  />
                </DndContext>
              </div>
            </div>
          )}
        </DialogBody>

        <DialogFooter className="shrink-0">
          <Button
            type="button"
            variant="outline"
            onClick={() => onOpenChange(false)}
          >
            {t("Cancel")}
          </Button>
          <Button
            type="button"
            disabled={working}
            pending={creating}
            data-iori-action="team-create"
            onClick={onCreate}
          >
            {t("Create")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function CopyToHostDialog({
  host,
  copyTeam,
  copyHost,
  working,
  copying,
  onCopyHostChange,
  onClose,
  onCopy,
}: {
  host: string;
  copyTeam: Team | null;
  copyHost: string;
  working: boolean;
  copying: boolean;
  onCopyHostChange: (hostKey: string) => void;
  onClose: () => void;
  onCopy: () => Promise<void>;
}) {
  const { t } = useI18n();
  return (
    <Dialog
      open={!!copyTeam}
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{t("Copy to another Host")}</DialogTitle>
          <DialogDescription>{copyTeam?.name}</DialogDescription>
        </DialogHeader>
        <Select value={copyHost} onValueChange={onCopyHostChange}>
          <SelectTrigger aria-label={t("Host")} className="w-full">
            <SelectValue placeholder={t("Select Host")} />
          </SelectTrigger>
          <SelectContent>
            {connection
              .getSnapshot()
              .initial?.hosts.filter((entry) => entry.publicKey !== host)
              .map((entry) => (
                <SelectItem value={entry.publicKey} key={entry.publicKey}>
                  {entry.hostName}
                </SelectItem>
              ))}
          </SelectContent>
        </Select>
        <DialogFooter>
          <Button type="button" variant="outline" onClick={onClose}>
            {t("Cancel")}
          </Button>
          <Button
            type="button"
            disabled={!copyHost || working}
            pending={copying}
            onClick={() => void onCopy()}
          >
            <Copy className="size-3.5" aria-hidden="true" />
            {t("Copy to another Host")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function TeamHistorySheet({
  open,
  onOpenChange,
  record,
  historyVersion,
  onSelectVersion,
  formatDate,
  working,
  restoring,
  onSaveMemo,
  onRestore,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  record?: EditableTeamRecord;
  historyVersion: number | null;
  onSelectVersion: (version: number) => void;
  formatDate: (value: string) => string;
  working: boolean;
  restoring: boolean;
  onSaveMemo: (version: number, memo: string) => Promise<boolean>;
  onRestore: () => void;
}) {
  const { t } = useI18n();
  const cliName = useCliName();
  const modelLabel = useModelLabel();
  const currentHistory =
    record?.history.find((entry) => entry.team.version === historyVersion) ??
    record?.history[0];

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        className="w-full sm:w-[560px] sm:max-w-[560px]"
        onCloseAutoFocus={(event) => {
          event.preventDefault();
          document
            .querySelector<HTMLButtonElement>(".team-history-button")
            ?.focus();
        }}
      >
        <SheetHeader className="border-b border-border pb-4">
          <SheetTitle>
            {t("Team history")} · {record?.draft.name}
          </SheetTitle>
          <SheetDescription>
            {t("Select a version to view its contents.")}
          </SheetDescription>
        </SheetHeader>

        <div className="min-h-0 flex-1 overflow-y-auto px-6 py-4 max-md:px-4">
          <div className="divide-y divide-border-subtle border-y border-border">
            {record?.history.map((entry) => (
              <TeamHistoryEntry
                key={entry.team.version}
                entry={entry}
                selected={currentHistory?.team.version === entry.team.version}
                date={formatDate(entry.team.updated)}
                onSelect={() => onSelectVersion(entry.team.version)}
                onSaveMemo={(memo) => onSaveMemo(entry.team.version, memo)}
              />
            ))}
          </div>

          {currentHistory && (
            <div className="mt-5 flex flex-col gap-3 border-t border-border pt-4 text-xs">
              <h2 className="font-heading text-sm font-semibold tabular-nums text-foreground">
                {t("Version {version}").replace(
                  "{version}",
                  String(currentHistory.team.version),
                )}{" "}
                · {formatDate(currentHistory.team.updated)}
              </h2>
              <div className="flex flex-col gap-1">
                <h3 className="font-heading text-xs font-semibold text-foreground">
                  {currentHistory.team.name}
                </h3>
                {currentHistory.team.description && (
                  <p className="whitespace-pre-wrap text-muted-foreground">
                    {currentHistory.team.description}
                  </p>
                )}
              </div>

              <div className="flex flex-col gap-1 border-t border-border-subtle pt-3">
                <h3 className="font-heading text-xs font-semibold text-foreground">
                  {t("Orchestrator")}
                </h3>
                <p className="text-muted-foreground">
                  {!currentHistory.team.parent.cli ? (
                    t("Not set")
                  ) : (
                    <>
                      {cliName(currentHistory.team.parent.cli)} ·{" "}
                      {modelLabel(
                        currentHistory.team.parent.cli,
                        currentHistory.team.parent.model,
                      )}{" "}
                      ·{" "}
                      {currentHistory.team.parent.effort === undefined
                        ? t("Not specified")
                        : currentHistory.team.parent.effort}{" "}
                      ·{" "}
                      {currentHistory.team.parent.permission === undefined
                        ? t("Not specified")
                        : currentHistory.team.parent.permission}
                      {currentHistory.team.parent.sandbox !== undefined &&
                        ` · ${currentHistory.team.parent.sandbox}`}
                      {currentHistory.team.parent.tools.length > 0 &&
                        ` · ${currentHistory.team.parent.tools.join(", ")}`}
                    </>
                  )}
                </p>
                {currentHistory.team.instruction && (
                  <p className="whitespace-pre-wrap text-muted-foreground">
                    {currentHistory.team.instruction}
                  </p>
                )}
              </div>

              {currentHistory.team.roles.map((r) => (
                <div
                  key={r.id}
                  className="flex flex-col gap-1.5 border-t border-border-subtle pt-3"
                >
                  <h3 className="font-heading text-xs font-semibold text-foreground">
                    {r.name}
                  </h3>
                  {r.when && (
                    <p className="whitespace-pre-wrap text-muted-foreground">
                      {r.when}
                    </p>
                  )}
                  <p className="tabular-nums text-muted-foreground">
                    {t("Concurrency limit")}: {r.limit || t("Unlimited")} ·{" "}
                    {t("Reuse child sessions")}:{" "}
                    {t(r.reuse ? "Reuse" : "Do not reuse")}
                  </p>
                  {DIFFICULTY_LEVELS.map(
                    (level) =>
                      r.candidates[level].length > 0 && (
                        <div key={level} className="flex flex-col gap-0.5">
                          <h4 className="font-medium text-foreground">
                            {t(DIFFICULTY_LABELS[level])}
                          </h4>
                          {r.candidates[level].map((c, idx) => (
                            <p
                              key={c.id}
                              className="tabular-nums text-muted-foreground"
                            >
                              {idx + 1}. {cliName(c.cli)} ·{" "}
                              {modelLabel(c.cli, c.model)} ·{" "}
                              {c.effort === undefined
                                ? t("Not specified")
                                : c.effort}{" "}
                              ·{" "}
                              {c.permission === undefined
                                ? t("Not specified")
                                : c.permission}
                              {c.sandbox !== undefined && ` · ${c.sandbox}`}
                              {c.tools.length > 0 && ` · ${c.tools.join(", ")}`}
                            </p>
                          ))}
                        </div>
                      ),
                  )}
                  {r.instruction && (
                    <>
                      <h4 className="font-medium text-foreground">
                        {t("Child instructions")}
                      </h4>
                      <p className="whitespace-pre-wrap text-muted-foreground">
                        {r.instruction}
                      </p>
                    </>
                  )}
                  {r.request && (
                    <>
                      <h4 className="font-medium text-foreground">
                        {t("Request fields")}
                      </h4>
                      <p className="whitespace-pre-wrap text-muted-foreground">
                        {r.request}
                      </p>
                    </>
                  )}
                  {r.report && (
                    <>
                      <h4 className="font-medium text-foreground">
                        {t("Report fields")}
                      </h4>
                      <p className="whitespace-pre-wrap text-muted-foreground">
                        {r.report}
                      </p>
                    </>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="flex shrink-0 flex-col gap-3 border-t border-border px-6 py-4 max-md:px-4">
          <p className="m-0 text-xs text-muted-foreground">
            {t(
              "Restoring saves a new version. Started children keep their assigned version.",
            )}
          </p>
          <div>
            <Button
              type="button"
              size="sm"
              disabled={
                !currentHistory ||
                currentHistory.team.version === record?.saved.version ||
                working
              }
              pending={restoring}
              data-iori-action="team-restore"
              onClick={onRestore}
            >
              {t("Restore this version")}
            </Button>
          </div>
        </div>
      </SheetContent>
    </Sheet>
  );
}
