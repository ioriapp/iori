import type { ReactNode } from "react";
import {
  DndContext,
  type SensorDescriptor,
  type SensorOptions,
} from "@dnd-kit/core";
import {
  defaultBackgroundWakeMinutes,
  maxTeamIntervalMinutes,
  parentTeamText,
} from "@iori/protocol";
import { Switch } from "../../components/ui/switch.tsx";
import { useI18n } from "../context.tsx";
import { LimitInput, SettingsRow } from "../SettingsRow.tsx";
import type { Team } from "../team-data.ts";
import { ExecutionHeading } from "./CandidateControls.tsx";
import { Field, GrowingText, TextPreview } from "./EditorPrimitives.tsx";
import { hasEffortOption } from "./types.ts";

export function OrchestratorSection({
  team,
  sensors,
  onEditTeam,
  renderParentExecution,
}: {
  team: Team;
  sensors: SensorDescriptor<SensorOptions>[];
  onEditTeam: (fn: (value: Team) => Team) => void;
  renderParentExecution: () => ReactNode;
}) {
  const { t, catalogs, clis } = useI18n();

  return (
    <div className="mx-auto flex w-full max-w-[960px] flex-col gap-6 px-6 py-5 max-md:px-4 max-md:py-4">
      {/* 1. Execution settings */}
      <section className="flex flex-col gap-2.5">
        <h2 className="font-heading text-sm font-semibold text-foreground">
          {t("Execution settings")}
        </h2>
        <div className="border-y border-border">
          <ExecutionHeading
            parent
            showEffort={hasEffortOption(team.parent, catalogs, clis)}
          />
          <DndContext sensors={sensors}>{renderParentExecution()}</DndContext>
        </div>
      </section>

      {/* 2. Supervision / Watch settings */}
      <section className="flex flex-col divide-y divide-border-subtle border-y border-border">
        <SettingsRow
          label="Allow orchestrator input to children"
          hint="The orchestrator can send input to a child's Terminal, including answers to approval prompts. When off, the orchestrator can still read the child's screen and stop it."
        >
          <Switch
            checked={team.parentInput === true}
            aria-label={t("Allow orchestrator input to children")}
            onCheckedChange={(checked) =>
              onEditTeam((value) => {
                const next = { ...value };
                if (checked) next.parentInput = true;
                else delete next.parentInput;
                return next;
              })
            }
          />
        </SettingsRow>

        {(
          [
            {
              field: "checkMinutes",
              label: "Check on working children",
              hint: "While a child keeps working, the orchestrator reads its screen at this interval. Each check uses the orchestrator's tokens.",
              minutes: team.checkMinutes,
            },
            {
              field: "backgroundWakeMinutes",
              label: "Remind children waiting on background commands",
              hint: "When a child ends its response while a background command keeps running, iori asks the child to check that command at this interval. Each reminder uses the child's tokens.",
              minutes:
                team.backgroundWakeMinutes ?? defaultBackgroundWakeMinutes,
            },
          ] as const
        ).map(({ field, label, hint, minutes }) => (
          <SettingsRow
            key={field}
            label={label}
            hint={hint}
            detail={
              !!minutes && (
                <>
                  <LimitInput
                    key={`${team.id}-${field}`}
                    value={String(minutes)}
                    label={`${t(label)}: ${t("Interval in minutes")}`}
                    min={1}
                    max={maxTeamIntervalMinutes}
                    onChange={(raw) =>
                      onEditTeam((value) => ({
                        ...value,
                        [field]: Number(raw),
                      }))
                    }
                  />
                  <span className="text-xs text-muted-foreground">
                    {t("minutes")}
                  </span>
                </>
              )
            }
          >
            <Switch
              checked={!!minutes}
              aria-label={t(label)}
              onCheckedChange={(checked) =>
                onEditTeam((value) => {
                  const next = { ...value };
                  if (checked) next[field] = defaultBackgroundWakeMinutes;
                  else if (field === "checkMinutes") delete next.checkMinutes;
                  else next.backgroundWakeMinutes = 0;
                  return next;
                })
              }
            />
          </SettingsRow>
        ))}
      </section>

      {/* 3. Orchestrator instructions */}
      <section className="flex flex-col gap-2">
        <h2 className="font-heading text-sm font-semibold text-foreground">
          {t("Orchestrator instructions")}
        </h2>
        <Field
          hideLabel
          label="Orchestrator instructions"
          hint="Describe how to run the team. iori separately provides the delegation, revision and acceptance commands."
        >
          <GrowingText
            label="Orchestrator instructions"
            rows={8}
            value={team.instruction}
            onChange={(instruction) =>
              onEditTeam((value) => ({ ...value, instruction }))
            }
          />
        </Field>
      </section>

      {/* 4. Text sent to orchestrator */}
      <section className="border-y border-border py-1">
        <TextPreview title="Text sent to orchestrator">
          <p className="m-0 whitespace-pre-wrap">{parentTeamText(team)}</p>
        </TextPreview>
      </section>
    </div>
  );
}
