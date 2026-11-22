import { Input } from "../../components/ui/input.tsx";
import { useI18n } from "../context.tsx";
import type { Team } from "../team-data.ts";
import { Field, GrowingText } from "./EditorPrimitives.tsx";

export function TeamOverviewSection({
  team,
  onEditTeam,
}: {
  team: Team;
  onEditTeam: (fn: (value: Team) => Team) => void;
}) {
  const { t } = useI18n();
  return (
    <div className="mx-auto flex w-full max-w-[960px] flex-col gap-5 px-6 py-5 max-md:px-4 max-md:py-4">
      <section className="flex flex-col gap-4">
        <div className="border-b border-border pb-2.5">
          <h2 className="font-heading text-sm font-semibold text-foreground">
            {t("Team overview")}
          </h2>
        </div>
        <div className="flex flex-col gap-4">
          <Field label="Name">
            <Input
              className="max-w-sm"
              value={team.name}
              aria-label={t("Name")}
              data-iori-field="team-name"
              onChange={(event) =>
                onEditTeam((value) => ({ ...value, name: event.target.value }))
              }
            />
          </Field>
          <Field label="Description">
            <GrowingText
              label="Description"
              rows={3}
              value={team.description}
              onChange={(description) =>
                onEditTeam((value) => ({ ...value, description }))
              }
            />
          </Field>
        </div>
      </section>
    </div>
  );
}
