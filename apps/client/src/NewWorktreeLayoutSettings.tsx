import { useEffect } from "react";
import { FieldRow, SettingsSection } from "./components/page-layout.tsx";
import { Button } from "./components/ui/button.tsx";
import {
  useWorktreeLayoutDefault,
  worktreeLayoutDefault,
} from "./new-worktree-layout-store.ts";

export function NewWorktreeLayoutSettings({
  t,
}: {
  t: (key: string) => string;
}) {
  const { saved, save } = useWorktreeLayoutDefault();
  useEffect(() => {
    void worktreeLayoutDefault.load();
  }, []);
  return (
    <SettingsSection title={t("New worktree layout")}>
      <FieldRow
        className="v9-settings-row"
        data-iori-view="new-worktree-layout-settings"
      >
        <span>
          {t(
            saved
              ? "Opens with your saved layout."
              : "Opens with the default layout.",
          )}
        </span>
        <div className="new-worktree-layout-actions">
          <span title={!save ? t("Open a worktree, then save.") : undefined}>
            <Button
              variant="outline"
              disabled={!save}
              title={!save ? t("Open a worktree, then save.") : undefined}
              data-iori-action="save-worktree-layout"
              onClick={() => void worktreeLayoutDefault.save(t)}
            >
              {t("Save current layout")}
            </Button>
          </span>
          <Button
            variant="outline"
            disabled={!saved}
            data-iori-action="reset-worktree-layout"
            onClick={() => void worktreeLayoutDefault.save(t, true)}
          >
            {t("Reset to default")}
          </Button>
        </div>
      </FieldRow>
    </SettingsSection>
  );
}
