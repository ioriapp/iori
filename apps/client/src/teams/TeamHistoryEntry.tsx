import { useState } from "react";
import { Button } from "../components/ui/button.tsx";
import { Textarea } from "../components/ui/textarea.tsx";
import { useI18n } from "./context.tsx";
import { historySummary } from "./team-history.ts";
import type { TeamHistory } from "./team-history.ts";

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
      className={`team-history-entry ${selected ? "selected" : ""}`}
    >
      <Button
        variant="ghost"
        className="team-history-select"
        onClick={onSelect}
      >
        <strong>
          {t("Version {version}").replace(
            "{version}",
            String(entry.team.version),
          )}
          <time>{date}</time>
        </strong>
        <span>{historySummary(entry, t)}</span>
      </Button>
      {entry.memo && <p className="team-history-memo">{entry.memo}</p>}
      {editing ? (
        <div className="team-history-memo-editor">
          <Textarea
            autoFocus
            rows={3}
            data-iori-field="team-memo"
            aria-label={`${t("Version {version}").replace("{version}", String(entry.team.version))} ${t("Memo")}`}
            value={memo}
            onChange={(event) => {
              setMemo(event.target.value);
              setError(false);
            }}
          />
          {error && (
            <p className="team-error" role="alert">
              {t("Could not save memo. Reconnect and retry.")}
            </p>
          )}
          <div className="team-history-memo-actions">
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                setEditing(false);
                setError(false);
              }}
            >
              {t("Cancel")}
            </Button>
            <Button
              size="sm"
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
        <Button
          variant="ghost"
          size="sm"
          className="team-history-memo-trigger"
          data-iori-action="team-memo-add"
          onClick={() => {
            setMemo(entry.memo ?? "");
            setEditing(true);
            onSelect();
          }}
        >
          {t(entry.memo ? "Edit memo" : "Add memo")}
        </Button>
      )}
    </div>
  );
}
