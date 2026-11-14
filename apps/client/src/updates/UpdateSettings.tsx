import { Switch } from "../components/ui/switch.tsx";
import type { ReactNode } from "react";
import { Checkbox } from "../components/ui/checkbox.tsx";
import { connectedHostsToUpdate } from "./connected-hosts.ts";
import { SettingsSection, FieldRow } from "../components/page-layout.tsx";
import { Spinner } from "../components/ui/spinner.tsx";
import { Progress } from "../components/ui/progress.tsx";
import { Button } from "../components/ui/button.tsx";
import { native } from "../native.ts";
import { useSyncExternalStore } from "react";
import { connection } from "../connection.ts";
import { hostNeedsUpdate } from "./host-controller.ts";
import {
  selectConnectedHostUpdate,
  checkUpdate,
  downloadUpdate,
  installUpdate,
  resumeInstallation,
  useClientUpdate,
} from "./controller.ts";

export function UpdateMark({
  t,
  available,
}: {
  t: (key: string) => string;
  available?: boolean;
}) {
  const update = useClientUpdate();
  return (available ?? Boolean(update.available)) ? (
    <span
      role="img"
      className="size-1.5 shrink-0 rounded-full bg-primary"
      aria-label={t("Update available")}
      data-iori-state="update-available"
    />
  ) : null;
}

export function SettingsUpdateMark({ t }: { t: (key: string) => string }) {
  const state = useSyncExternalStore(
    connection.subscribe,
    connection.getSnapshot,
  );
  const update = useClientUpdate();
  return (
    <UpdateMark
      t={t}
      available={
        Boolean(update.available) ||
        Object.values(state.observedHosts).some(hostNeedsUpdate)
      }
    />
  );
}
export function UpdateSettings({
  t,
  receiveDevelopmentVersions,
  onDevelopmentVersionsChange,
  preferenceError,
}: {
  t: (key: string) => string;
  receiveDevelopmentVersions: boolean;
  onDevelopmentVersionsChange: (checked: boolean) => void;
  preferenceError?: ReactNode;
}) {
  const update = useClientUpdate();
  useSyncExternalStore(connection.subscribe, connection.getSnapshot);
  const hostCount = update.available
    ? connectedHostsToUpdate(update.available.version).length
    : 0;
  if (!update.options) return null;
  const busy = update.phase === "downloading" || update.phase === "installing";
  const progress = update.progress
    ? Math.floor((update.progress.received / update.progress.total) * 100)
    : undefined;
  return (
    <SettingsSection title={t("Updates")} data-iori-view="client-update">
      <FieldRow
        className="v9-settings-row"
        label={t("Current version")}
        description={
          update.latest && !update.available && !update.error
            ? t("You are up to date")
            : undefined
        }
      >
        <div className="update-current-controls">
          <span>{update.options.version}</span>
          <Button
            variant="outline"
            size="sm"
            data-iori-action="update-check"
            disabled={update.phase === "installing"}
            pending={update.checking}
            onClick={() => void checkUpdate(true)}
          >
            {t("Check for updates")}
          </Button>
        </div>
      </FieldRow>
      <FieldRow className="v9-settings-row v9-settings-switch-row">
        <span>
          <label htmlFor="receive-development-versions">
            {t("Receive development versions")}
          </label>
          <span className="settings-note block">
            {t("Also update to versions that are still being tested.")}
          </span>
        </span>
        <Switch
          id="receive-development-versions"
          data-iori-action="receive-development-versions"
          checked={receiveDevelopmentVersions}
          disabled={update.phase === "installing"}
          onCheckedChange={onDevelopmentVersionsChange}
        />
        {preferenceError}
      </FieldRow>
      {(update.available ||
        (update.phase === "installing" && update.confirmationAvailable)) && (
        <FieldRow
          className="v9-settings-row"
          label={
            update.available ? (
              <>
                {t("New version")}{" "}
                <span data-iori-state="update-version">
                  {update.available.version}
                </span>
              </>
            ) : (
              t("Installing update")
            )
          }
        >
          {update.available && (
            <Button
              variant="link"
              size="sm"
              onClick={() => {
                void native.openUrl(update.available!.notesUrl);
              }}
            >
              {t("Release notes")}
            </Button>
          )}
          {update.available && (
            <Button
              size="sm"
              data-iori-action="update-install"
              disabled={busy}
              onClick={() => {
                if (
                  update.options?.backgroundDownload &&
                  update.phase === "idle"
                )
                  void downloadUpdate();
                else void installUpdate();
              }}
            >
              {busy && (
                <Spinner
                  aria-hidden="true"
                  data-icon="inline-start"
                  className="size-3 motion-reduce:animate-none"
                />
              )}
              {t(
                update.phase === "downloading"
                  ? "Downloading update"
                  : update.phase === "installing"
                    ? "Installing update"
                    : update.phase === "permission"
                      ? "Continue installation"
                      : update.options.backgroundDownload
                        ? update.phase === "ready"
                          ? "Restart to update"
                          : "Retry download"
                        : "Download and install",
              )}
            </Button>
          )}
          {update.phase === "installing" && update.confirmationAvailable && (
            <Button
              size="sm"
              variant="outline"
              data-iori-action="update-resume-installation"
              onClick={() => void resumeInstallation()}
            >
              {t("Continue installation")}
            </Button>
          )}
        </FieldRow>
      )}
      {update.available && update.options.administratorApproval && (
        <p className="settings-note">
          {t("Updating asks for administrator approval.")}
        </p>
      )}
      {update.available && hostCount > 0 && (
        <FieldRow className="v9-settings-row v9-settings-switch-row">
          <span>
            <label htmlFor="update-connected-hosts">
              {t("Also update connected iori Hosts ({count})").replace(
                "{count}",
                String(hostCount),
              )}
            </label>
          </span>
          <Checkbox
            id="update-connected-hosts"
            data-iori-field="update-connected-hosts"
            checked={update.updateConnectedHosts}
            disabled={busy}
            onCheckedChange={(checked) =>
              selectConnectedHostUpdate(checked === true)
            }
          />
        </FieldRow>
      )}
      {update.phase === "permission" && (
        <p className="settings-note">
          {t(
            "Allow apps from this source in Android settings, then return to continue.",
          )}
        </p>
      )}
      {update.phase === "downloading" && update.progress && (
        <div className="space-y-2">
          <p className="settings-note" role="status">
            {t("Downloading update")} {progress}%
          </p>
          <Progress value={progress} aria-label={t("Downloading update")} />
        </div>
      )}
      {update.error && (
        <p
          className="connection-error"
          role="alert"
          data-iori-state="update-error"
        >
          {t(
            update.error === "host-preparation"
              ? "Could not prepare the iori Host update. Try again."
              : update.error === "appimagelocation"
                ? "Cannot update the AppImage in this location. Move it to a folder you can write to, then open it again."
                : update.error === "verification"
                  ? "The update could not be verified. Try checking for updates again."
                  : update.error === "cancelled"
                    ? "Installation cancelled. You can try again."
                    : update.error === "source"
                      ? "Could not reach the update source. Check your connection and try again."
                      : update.error === "download"
                        ? "Could not download the update. Try again."
                        : "Could not install the update. Try again.",
          )}
        </p>
      )}
    </SettingsSection>
  );
}
