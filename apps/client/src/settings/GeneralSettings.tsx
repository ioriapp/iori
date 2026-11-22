import type { ReactNode } from "react";
import {
  FieldRow,
  SettingsSection as Section,
} from "../components/page-layout.tsx";
import { Switch } from "../components/ui/switch.tsx";
import { UpdateSettings } from "../updates/UpdateSettings.tsx";
import type { Preferences, Translate } from "./shared.tsx";

export function GeneralSettings({
  canCloseToExit,
  preferences,
  onPreferencesChange,
  preferenceError,
  t,
}: {
  canCloseToExit: boolean;
  preferences: Preferences;
  onPreferencesChange: (change: Partial<Preferences>) => void;
  preferenceError: (field: string) => ReactNode;
  t: Translate;
}) {
  return (
    <>
      {canCloseToExit && (
        <Section>
          <FieldRow
            label={t("Exit when the window closes")}
            error={preferenceError("closeToExit")}
          >
            <Switch
              checked={preferences.closeToExit}
              onCheckedChange={(closeToExit) =>
                onPreferencesChange({ closeToExit })
              }
              aria-label={t("Exit when the window closes")}
              data-iori-action="general-close-to-exit"
            />
          </FieldRow>
        </Section>
      )}
      <UpdateSettings
        t={t}
        receiveDevelopmentVersions={
          preferences.receiveDevelopmentVersions ?? false
        }
        onDevelopmentVersionsChange={(receiveDevelopmentVersions) =>
          onPreferencesChange({ receiveDevelopmentVersions })
        }
        preferenceError={preferenceError("receiveDevelopmentVersions")}
      />
    </>
  );
}
