import { Button } from "./components/ui/button.tsx";
import { FieldRow, SettingsSection } from "./components/page-layout.tsx";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "./components/ui/select.tsx";
import { native } from "./native.ts";
import type { UnifiedPushSettingsState } from "./unified-push.ts";

export function UnifiedPushSettings({
  push,
  t,
  onNotificationPermission,
}: {
  push: UnifiedPushSettingsState;
  t: (key: string) => string;
  onNotificationPermission: () => void;
}) {
  const unavailable = !push.distributors.length;
  const notice = push.notice;
  const noticeText =
    notice?.kind === "removed"
      ? t("Turned off because no UnifiedPush app was found.")
      : notice?.kind === "unregistered"
        ? t("Turned off because {app} removed the registration.").replace(
            "{app}",
            notice.app,
          )
        : notice?.kind === "action_required"
          ? t(
              "Couldn't register with {app}. Open {app} and check its settings.",
            ).replaceAll("{app}", notice.app)
          : notice?.kind === "network"
            ? t(
                "Couldn't register with {app}. Connect to the internet and try again.",
              ).replace("{app}", notice.app)
            : undefined;
  return (
    <fieldset className="m-0 mt-8 min-w-0 border-0 p-0">
      <legend className="mb-2 px-1 text-sm font-semibold">
        {t("When the app is closed")}
      </legend>
      <SettingsSection>
        {(
          [
            ["none", "Don't receive", undefined],
            [
              "background",
              "Keep connected in the background",
              "Receive from Hosts on your LAN or VPN. Shows one ongoing notification and uses battery.",
            ],
            [
              "push",
              "UnifiedPush",
              "Receive through a UnifiedPush app, even outside your LAN or VPN. Notification contents are encrypted.",
            ],
          ] as const
        ).map(([mode, label, description]) => (
          <div key={mode}>
            <label className="m-0! flex! flex-row! max-w-none! items-start! justify-start! gap-3!">
              <input
                type="radio"
                name="closed-app"
                value={mode}
                aria-label={t(label)}
                checked={push.mode === mode}
                disabled={mode === "push" && unavailable}
                onChange={() => {
                  push.choose(mode);
                  if (mode === "background") onNotificationPermission();
                }}
                aria-describedby={
                  description ? `closed-app-${mode}-description` : undefined
                }
                className="mt-0.5 size-4 shrink-0 accent-primary scheme-light dark:scheme-dark"
              />
              <span className="field-copy">
                <span
                  className={
                    mode === "push" && unavailable
                      ? "text-muted-foreground"
                      : undefined
                  }
                >
                  {t(label)}
                </span>
                {description && (
                  <span
                    id={`closed-app-${mode}-description`}
                    className="page-description block"
                  >
                    {t(description)}
                  </span>
                )}
              </span>
            </label>
            {mode === "push" && (
              <div className="ml-7">
                {notice?.kind === "removed" && (
                  <p role="status" className="page-description mt-2">
                    {noticeText}
                  </p>
                )}
                {unavailable && (
                  <>
                    <p className="page-description mt-2">
                      {t(
                        "Install a UnifiedPush app such as ntfy, then open it once.",
                      )}
                    </p>
                    <Button asChild variant="link" className="px-0 mt-2">
                      <a
                        href="https://unifiedpush.org/users/distributors/"
                        onClick={(event) => {
                          event.preventDefault();
                          void native.openUrl(event.currentTarget.href);
                        }}
                      >
                        {t("UnifiedPush apps")}
                      </a>
                    </Button>
                  </>
                )}
                {push.mode === "push" && (
                  <div className="mt-4">
                    <FieldRow label={t("UnifiedPush app")}>
                      <Select
                        value={push.distributor}
                        onValueChange={(value) => push.choose("push", value)}
                      >
                        <SelectTrigger aria-label={t("UnifiedPush app")}>
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {push.distributors.map((app) => (
                            <SelectItem key={app.id} value={app.id}>
                              {app.name}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </FieldRow>
                  </div>
                )}
                {notice && notice.kind !== "removed" && (
                  <p
                    role={notice.kind === "unregistered" ? "status" : "alert"}
                    className={`page-description mt-2 wrap-anywhere${notice.kind !== "unregistered" ? " connection-error" : ""}`}
                  >
                    {noticeText}
                  </p>
                )}
                {push.oldHosts.map((host) => (
                  <p
                    key={host}
                    role="alert"
                    className="page-description connection-error mt-2 wrap-anywhere"
                  >
                    {t(
                      "{host}'s iori Host doesn't support UnifiedPush notifications. Update iori Host.",
                    ).replace("{host}", host)}
                  </p>
                ))}
              </div>
            )}
          </div>
        ))}
      </SettingsSection>
    </fieldset>
  );
}
