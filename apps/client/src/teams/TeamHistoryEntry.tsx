import { useState } from "react";
import { cn } from "cn";
import { Button } from "../components/ui/button.tsx";
import { Textarea } from "../components/ui/textarea.tsx";
import { useI18n } from "./context.tsx";
import { historySummary, type TeamHistory } from "./team-history.ts";

export function TeamHistoryEntry({
  entry,
  selected,
  date,
  onSelect,
  onSaveMemo,
}: {
  entry: TeamHistory;
  selected: boolean;
  date: string;
  onSelect: () => void;
  onSaveMemo: (memo: string) => Promise<boolean>;
}) {
  const { t } = useI18n();
  const [editing, setEditing] = useState(false);
  const [memo, setMemo] = useState("");
  const [error, setError] = useState(false);
  const [saving, setSaving] = useState(false);

  return (
    <div
      data-iori-history-version={entry.team.version}
      className={cn(
        "flex flex-col gap-1 py-2.5 transition-colors",
        selected && "border-l-2 border-l-primary bg-accent/55 pl-2.5",
        !selected && "px-2",
      )}
    >
      <button
        type="button"
        onClick={onSelect}
        className="flex w-full cursor-pointer flex-col gap-1 text-left outline-none focus-visible:ring-2 focus-visible:ring-ring/40"
      >
        <div className="flex items-center justify-between gap-3">
          <strong className="text-xs font-semibold tabular-nums text-foreground">
            {t("Version {version}").replace(
              "{version}",
              String(entry.team.version),
            )}
          </strong>
          <time className="text-2xs tabular-nums text-muted-foreground">
            {date}
          </time>
        </div>
        <span className="text-xs leading-relaxed text-muted-foreground">
          {historySummary(entry, t)}
        </span>
      </button>

      {entry.memo && (
        <p className="m-0 text-xs leading-relaxed whitespace-pre-wrap [overflow-wrap:anywhere] text-foreground">
          {entry.memo}
        </p>
      )}

      {editing ? (
        <div className="mt-1 flex flex-col gap-2">
          <Textarea
            autoFocus
            rows={3}
            data-iori-field="team-memo"
            aria-label={`${t("Version {version}").replace("{version}", String(entry.team.version))} ${t("Memo")}`}
            value={memo}
            className="min-h-20 text-xs"
            onChange={(event) => {
              setMemo(event.target.value);
              setError(false);
            }}
          />
          {error && (
            <p className="m-0 text-xs text-status-failed-text" role="alert">
              {t("Could not save memo. Reconnect and retry.")}
            </p>
          )}
          <div className="flex items-center justify-end gap-2">
            <Button
              type="button"
              variant="outline"
              size="xs"
              onClick={() => {
                setEditing(false);
                setError(false);
              }}
            >
              {t("Cancel")}
            </Button>
            <Button
              type="button"
              size="xs"
              data-iori-action="team-memo-save"
              pending={saving}
              onClick={async () => {
                setSaving(true);
                const saved = await onSaveMemo(memo);
                setSaving(false);
                if (saved) setEditing(false);
                else setError(true);
              }}
            >
              {t("Save memo")}
            </Button>
          </div>
        </div>
      ) : (
        <div>
          <Button
            type="button"
            variant="ghost"
            size="xs"
            className="h-6 px-1.5 text-2xs font-normal text-muted-foreground hover:text-foreground"
            data-iori-action="team-memo-add"
            onClick={() => {
              setMemo(entry.memo ?? "");
              setEditing(true);
              onSelect();
            }}
          >
            {t(entry.memo ? "Edit memo" : "Add memo")}
          </Button>
        </div>
      )}
    </div>
  );
}
