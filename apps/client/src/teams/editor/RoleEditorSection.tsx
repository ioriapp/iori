import { useState, type ReactNode } from "react";
import { ChevronDown, ChevronRight, Plus } from "lucide-react";
import {
  DndContext,
  closestCenter,
  type SensorDescriptor,
  type SensorOptions,
} from "@dnd-kit/core";
import {
  SortableContext,
  arrayMove,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { cn } from "cn";
import { Button } from "../../components/ui/button.tsx";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "../../components/ui/collapsible.tsx";
import { Input } from "../../components/ui/input.tsx";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "../../components/ui/popover.tsx";
import { Switch } from "../../components/ui/switch.tsx";
import { useCliName, useI18n, useModelLabel } from "../context.tsx";
import { ModelPicker } from "../ModelPicker.tsx";
import { LimitInput, SettingsRow } from "../SettingsRow.tsx";
import type { Candidate, Difficulty, Role, Team } from "../team-data.ts";
import { ExecutionHeading } from "./CandidateControls.tsx";
import { ChildText, Field, GrowingText } from "./EditorPrimitives.tsx";
import { DIFFICULTY_LABELS, DIFFICULTY_LEVELS } from "./types.ts";

export function RoleEditorSection({
  team,
  role,
  difficulty,
  onDifficultyChange,
  candidateSearchOpen,
  onCandidateSearchOpenChange,
  selectableModels,
  recentModels,
  sensors,
  onEditRole,
  onAddCandidate,
  renderCandidateRow,
}: {
  team: Team;
  role: Role;
  difficulty: Difficulty;
  onDifficultyChange: (difficulty: Difficulty) => void;
  candidateSearchOpen: boolean;
  onCandidateSearchOpenChange: (open: boolean) => void;
  selectableModels: Record<string, string[]>;
  recentModels: { cli: string; model: string }[];
  sensors: SensorDescriptor<SensorOptions>[];
  onEditRole: (changes: Partial<Role>) => void;
  onAddCandidate: (cli: string, model: string) => void;
  renderCandidateRow: (
    item: Candidate,
    index: number,
    total: number,
  ) => ReactNode;
}) {
  const { t } = useI18n();
  const cliName = useCliName();
  const modelLabel = useModelLabel();
  const [advancedOpen, setAdvancedOpen] = useState(false);

  const actualDifficulty: Difficulty = role.split ? difficulty : "medium";
  const candidateRows = role.candidates[actualDifficulty];

  const parentLabel = team.parent.cli
    ? `${cliName(team.parent.cli)} › ${
        team.parent.model
          ? modelLabel(team.parent.cli, team.parent.model)
          : t("Default")
      }`
    : "";

  const advancedSummary = [
    `${t("Concurrency limit")}: ${role.limit || t("Unlimited")}`,
    `${t("Reuse child sessions")}: ${t(role.reuse ? "Reuse" : "Do not reuse")}`,
    t("Request and report"),
    t("Text sent to child"),
  ].join(" · ");

  return (
    <div className="team-role-content mx-auto flex w-full max-w-[960px] flex-col gap-5 px-6 py-5 max-md:px-4 max-md:py-4">
      {/* 1. Basics (flat hairline section, zero card nesting) */}
      <section
        id="team-section-0"
        data-iori-role-name={role.name}
        aria-label={t("Basics")}
        className="flex flex-col gap-3"
      >
        <h2 className="font-heading text-sm font-semibold text-foreground">
          {t("Basics")}
        </h2>
        <div className="flex flex-col gap-3.5">
          <Field label="Name">
            <Input
              className="max-w-sm"
              value={role.name}
              aria-label={t("Name")}
              data-iori-field="team-name"
              onChange={(event) => onEditRole({ name: event.target.value })}
            />
          </Field>
          <Field
            label="When to call"
            hint="The orchestrator reads this to choose where to delegate."
          >
            <GrowingText
              label="When to call"
              rows={2}
              value={role.when}
              onChange={(when) => onEditRole({ when })}
            />
          </Field>
        </div>
      </section>

      {/* 2. Model Candidates (always visible, 100% granularity, PC flat table / Mobile 2-tier) */}
      <section
        id="team-section-1"
        aria-label={t("Candidates")}
        className="flex flex-col gap-2.5 border-t border-border pt-4"
      >
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0 flex-1">
            <h2 className="font-heading text-sm font-semibold text-foreground">
              {t("Candidates")}
            </h2>
            <p className="mt-0.5 text-2xs leading-relaxed text-muted-foreground">
              {candidateRows.length > 0
                ? t("Candidates are tried in this order.")
                : team.parent.cli
                  ? t(
                      "No candidates. Runs with the orchestrator's settings ({model}).",
                    ).replace("{model}", parentLabel)
                  : t("No candidates configured.")}
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-3.5">
            <label className="inline-flex cursor-pointer items-center gap-2 text-xs font-medium text-foreground">
              <span>{t("Separate by difficulty")}</span>
              <Switch
                checked={role.split}
                aria-label={t("Separate by difficulty")}
                onCheckedChange={(split) => onEditRole({ split })}
              />
            </label>

            <Popover
              open={candidateSearchOpen}
              onOpenChange={onCandidateSearchOpenChange}
            >
              <PopoverTrigger asChild>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  data-iori-action="candidate-add"
                  className="max-md:h-10 max-md:px-3"
                >
                  <Plus className="size-3.5" aria-hidden="true" />
                  {t("Add candidate")}
                </Button>
              </PopoverTrigger>
              <PopoverContent
                className="team-search-popover w-[min(500px,calc(100vw-2rem))] gap-0 overflow-hidden p-0"
                align="end"
                collisionPadding={16}
                onEscapeKeyDown={(event) => {
                  if (event.isComposing) event.preventDefault();
                }}
              >
                <ModelPicker
                  availableModels={selectableModels}
                  recent={recentModels}
                  onSelect={({ cli, name: model }) => {
                    onAddCandidate(cli, model);
                    onCandidateSearchOpenChange(false);
                  }}
                />
              </PopoverContent>
            </Popover>
          </div>
        </div>

        {/* Difficulty switcher when enabled: underlined tab bar */}
        {role.split && (
          <div
            role="tablist"
            aria-label={t("Separate by difficulty")}
            className="flex items-center gap-1 border-b border-border"
          >
            {DIFFICULTY_LEVELS.map((level) => {
              const active = difficulty === level;
              const count = role.candidates[level].length;
              return (
                <button
                  key={level}
                  type="button"
                  role="tab"
                  aria-selected={active}
                  onClick={() => onDifficultyChange(level)}
                  className={cn(
                    "relative cursor-pointer px-3 py-2 text-xs font-medium tabular-nums transition-colors max-md:min-h-10",
                    active
                      ? "text-foreground"
                      : "text-muted-foreground hover:text-foreground",
                  )}
                >
                  <span>
                    {t(DIFFICULTY_LABELS[level])} ({count})
                  </span>
                  {active && (
                    <span className="absolute inset-x-0 bottom-0 h-0.5 bg-primary" />
                  )}
                </button>
              );
            })}
          </div>
        )}

        {/* Candidate table / rows */}
        {candidateRows.length > 0 && (
          <div className="flex flex-col border-t border-border">
            <ExecutionHeading />
            <div className="divide-y divide-border-subtle">
              <DndContext
                sensors={sensors}
                collisionDetection={closestCenter}
                onDragEnd={({ active: dragged, over }) => {
                  if (over && dragged.id !== over.id) {
                    onEditRole({
                      candidates: {
                        ...role.candidates,
                        [actualDifficulty]: arrayMove(
                          candidateRows,
                          candidateRows.findIndex((c) => c.id === dragged.id),
                          candidateRows.findIndex((c) => c.id === over.id),
                        ),
                      },
                    });
                  }
                }}
              >
                <SortableContext
                  items={candidateRows.map((c) => c.id)}
                  strategy={verticalListSortingStrategy}
                >
                  {candidateRows.map((c, index) =>
                    renderCandidateRow(c, index, candidateRows.length),
                  )}
                </SortableContext>
              </DndContext>
            </div>
          </div>
        )}
      </section>

      {/* 3. Instructions */}
      <section
        id="team-section-2"
        aria-label={t("Instructions")}
        className="flex flex-col gap-2 border-t border-border pt-4"
      >
        <Field label="Child instructions">
          <GrowingText
            label="Child instructions"
            rows={5}
            value={role.instruction}
            onChange={(instruction) => onEditRole({ instruction })}
          />
        </Field>
      </section>

      {/* 4. Progressive Disclosure: Advanced settings (flat 1px hairline accordion) */}
      <Collapsible
        open={advancedOpen}
        onOpenChange={setAdvancedOpen}
        className="border-y border-border"
      >
        <CollapsibleTrigger asChild>
          <button
            type="button"
            data-iori-action="role-advanced-toggle"
            className="flex min-h-12 w-full cursor-pointer items-center justify-between gap-4 py-3 text-left transition-colors hover:bg-accent/35 max-md:min-h-14"
          >
            <div className="flex min-w-0 flex-1 flex-col gap-0.5">
              <span className="font-heading text-sm font-semibold text-foreground">
                {t("Advanced settings")}
              </span>
              <p className="m-0 truncate text-2xs tabular-nums text-muted-foreground max-md:whitespace-normal">
                {advancedSummary}
              </p>
            </div>
            {advancedOpen ? (
              <ChevronDown
                className="size-4 shrink-0 text-muted-foreground max-md:size-5"
                aria-hidden="true"
              />
            ) : (
              <ChevronRight
                className="size-4 shrink-0 text-muted-foreground max-md:size-5"
                aria-hidden="true"
              />
            )}
          </button>
        </CollapsibleTrigger>

        <CollapsibleContent className="border-t border-border-subtle">
          <div className="flex flex-col divide-y divide-border-subtle">
            <SettingsRow
              label="Concurrency limit"
              hint="How many children in this role can run at once in a conversation using this team."
            >
              <LimitInput
                value={role.limit}
                label={t("Concurrency limit")}
                onChange={(limit) => onEditRole({ limit })}
              />
            </SettingsRow>

            <SettingsRow
              label="Reuse child sessions"
              hint={
                role.reuse
                  ? "Ask a child that has reported to continue or make corrections."
                  : "A new child takes over each time, quoting the previous report."
              }
            >
              <Switch
                checked={role.reuse}
                aria-label={t("Reuse child sessions")}
                onCheckedChange={(reuse) => onEditRole({ reuse })}
              />
            </SettingsRow>

            {/* Request & Report fields */}
            <div
              id="team-section-3"
              className="grid gap-4 py-3.5 sm:grid-cols-2"
            >
              <Field label="Request fields">
                <GrowingText
                  label="Request fields"
                  rows={4}
                  value={role.request}
                  onChange={(request) => onEditRole({ request })}
                />
              </Field>
              <Field label="Report fields">
                <GrowingText
                  label="Report fields"
                  rows={4}
                  value={role.report}
                  onChange={(report) => onEditRole({ report })}
                />
              </Field>
            </div>

            {/* Text sent to child preview */}
            <div id="team-section-4" className="flex flex-col gap-2 py-3.5">
              <span className="text-xs font-medium text-foreground">
                {t("Text sent to child")}
              </span>
              <div className="rounded-md border border-border-subtle bg-terminal p-3 font-mono text-2xs leading-relaxed whitespace-pre-wrap [overflow-wrap:anywhere] text-terminal-foreground">
                <ChildText value={role} />
              </div>
            </div>
          </div>
        </CollapsibleContent>
      </Collapsible>
    </div>
  );
}
