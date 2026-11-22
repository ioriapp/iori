import type { ReactNode } from "react";
import {
  FieldRow,
  SettingsSection as Section,
} from "../components/page-layout.tsx";
import { Button } from "../components/ui/button.tsx";
import { Switch } from "../components/ui/switch.tsx";
import { UnifiedPushSettings } from "../UnifiedPushSettings.tsx";
import type { UnifiedPushSettingsState } from "../unified-push.ts";
import { ErrorMessage, type Preferences, type Translate } from "./shared.tsx";

export function NotificationsSettings({
  preferences,
  mobile,
  unifiedPush,
  notificationError,
  notificationPermissionGranted,
  onPreferencesChange,
  onClearPreferenceField,
  onNotificationPermission,
  preferenceError,
  t,
}: {
  preferences: Preferences;
  mobile: boolean;
  unifiedPush?: UnifiedPushSettingsState;
  notificationError?: boolean;
  notificationPermissionGranted: boolean;
  onPreferencesChange: (change: Partial<Preferences>) => void;
  onClearPreferenceField: () => void;
  onNotificationPermission: () => void;
  preferenceError: (field: string) => ReactNode;
  t: Translate;
}) {
  return (
    <>
      <Section>
        {(
          [
            [
              "notifyWaiting",
              "Attention notifications",
              "notifications-waiting",
            ],
            ["notifyDone", "Completion notifications", "notifications-done"],
          ] as const
        ).map(([key, label, action]) => (
          <FieldRow key={key} label={t(label)} error={preferenceError(key)}>
            <Switch
              checked={preferences[key]}
              aria-label={t(label)}
              data-iori-action={action}
              onCheckedChange={(checked) => {
                onPreferencesChange({ [key]: checked });
                if (checked) onNotificationPermission();
              }}
            />
          </FieldRow>
        ))}
      </Section>
      {mobile && unifiedPush && (
        <UnifiedPushSettings
          push={{
            ...unifiedPush,
            choose: (mode, distributor) => {
              onClearPreferenceField();
              unifiedPush.choose(mode, distributor);
            },
          }}
          t={t}
          onNotificationPermission={onNotificationPermission}
        />
      )}
      {notificationError && (
        <div className="mt-4">
          <ErrorMessage
            message={t(
              "Could not configure notifications. Retry in notification settings.",
            )}
          />
        </div>
      )}
      {mobile && !notificationPermissionGranted && (
        <Button
          variant="outline"
          size="sm"
          className="mt-4"
          data-iori-action="notifications-permission"
          onClick={onNotificationPermission}
        >
          {t("Allow OS notifications")}
        </Button>
      )}
    </>
  );
}
