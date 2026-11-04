import {
  failures,
  stages,
  HostMaintenanceStopWarning,
  HostMaintenanceProgress,
  HostMaintenanceWork,
} from "./HostMaintenanceDetails.tsx";
import { SettingsSection, FieldRow } from "../components/page-layout.tsx";
import { Checkbox } from "../components/ui/checkbox.tsx";
import { HostRemovalResult } from "./HostRemovalResult.tsx";
import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import {
  compareVersions,
  type HostInfo,
  type MaintenanceKind,
  type MaintenancePlan,
} from "@iori/protocol";
import { ScrollArea } from "../components/ui/scroll-area.tsx";
import "../worktree-creator.css";
import { Button } from "../components/ui/button.tsx";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "../components/ui/dialog.tsx";
import { connection } from "../connection.ts";
import { native } from "../native.ts";
import {
  clientVersion,
  hostNeedsUpdate,
  hostReleaseNotes,
  prepareHostMaintenance,
  performHostMaintenance,
  useHostMaintenance,
} from "./host-controller.ts";

const completedStages: Record<string, string> = {
  terminals: "Terminals and agents stopped",
  hooks: "iori CLI hooks removed",
  registration: "Automatic startup removed",
  stop: "iori Host stopped",
  program: "iori Host program files removed",
  data: "iori Host saved data removed",
  "forge-tokens":
    "Forgejo and Gitea tokens removed from the OS credential store",
};
export function HostVersionSettings({
  onOpenTerminal,
  host,
  t,
  onClientUpdate,
  onNestedBack,
  disconnectedSeconds,
}: {
  host: HostInfo;
  onOpenTerminal: (hostKey: string, terminalId: string) => void;
  t: (key: string) => string;
  onClientUpdate: () => void;
  onNestedBack: (close?: () => void) => void;
  disconnectedSeconds: number;
}) {
  const state = useSyncExternalStore(
    connection.subscribe,
    connection.getSnapshot,
  );
  const [deleteData, setDeleteData] = useState(false);
  const removal = state.removals[host.publicKey];
  const paused =
    removal?.status?.phase === "removing" ||
    removal?.status?.phase === "succeeded";
  const operation = useHostMaintenance(host.publicKey);
  const status = operation?.status;
  const removalFilesFailed =
    status?.kind === "uninstall" &&
    status.phase === "failed" &&
    (status.stage === "program" || status.stage === "data");
  const cancelConfirmation = useRef<HTMLButtonElement>(null);
  const [confirmation, setConfirmation] = useState<{
    kind: MaintenanceKind;
    plan: MaintenancePlan;
  }>();
  const [preparing, setPreparing] = useState<MaintenanceKind>();
  const [startingUninstall, setStartingUninstall] = useState(false);
  const [error, setError] = useState<string>();
  const pending = Boolean(
    status &&
    !status.plan &&
    status.phase !== "failed" &&
    status.phase !== "succeeded" &&
    status.phase !== "removing",
  );
  const sending =
    pending &&
    Boolean(operation?.sentOn) &&
    operation?.sentOn === connection.connectionIdOf(host.publicKey);
  const unavailable = paused || host.maintenanceAvailable === false;
  useEffect(() => {
    onNestedBack(confirmation ? () => setConfirmation(undefined) : undefined);
    return () => onNestedBack(undefined);
  }, [confirmation, onNestedBack]);
  async function prepare(kind: MaintenanceKind) {
    if (kind === "uninstall") setDeleteData(false);
    setPreparing(kind);
    setError(undefined);
    try {
      const plan = await prepareHostMaintenance(host.publicKey, kind);
      if (plan.error) setError(plan.error);
      else setConfirmation({ kind, plan });
    } catch {
      setError("request");
    } finally {
      setPreparing(undefined);
    }
  }
  const reason = error ?? status?.reason;
  const waitingForHost =
    status?.kind !== "uninstall" && pending && disconnectedSeconds > 10;
  const showReconnect =
    status?.kind !== "uninstall" && (waitingForHost || reason === "restore");
  return (
    <SettingsSection data-iori-view="host-version">
      {host.version && (
        <FieldRow className="v9-settings-row">
          <span>{t("Current version")}</span>
          <span data-iori-value="host-version">{host.version}</span>
        </FieldRow>
      )}
      {status && (
        <HostMaintenanceProgress
          status={status}
          pending={pending}
          waitingForHost={waitingForHost}
          showReconnect={showReconnect}
          t={t}
        />
      )}
      {!paused && (!host.version || hostNeedsUpdate(host)) && (
        <FieldRow
          description={
            host.maintenanceAvailable === false
              ? t(failures.service!)
              : undefined
          }
          label={
            <>
              {t("Update to")} {clientVersion}
            </>
          }
        >
          <Button
            variant="link"
            size="sm"
            onClick={() => void native.openUrl(hostReleaseNotes)}
          >
            {t("Release notes")}
          </Button>
          <Button
            data-iori-action="host-update"
            disabled={Boolean(preparing) || sending || unavailable}
            pending={
              preparing === "update" || (sending && status?.kind === "update")
            }
            onClick={() => void prepare("update")}
          >
            {t("Update iori Host")}
          </Button>
        </FieldRow>
      )}
      {!paused &&
        host.version &&
        compareVersions(host.version, clientVersion) > 0 && (
          <>
            <p className="settings-note">
              {t(
                "This Host is newer than this Client. Update the Client in General settings.",
              )}
            </p>
            <Button variant="outline" onClick={onClientUpdate}>
              {t("Open Client updates")}
            </Button>
          </>
        )}
      {!paused && (
        <>
          <FieldRow
            label={t("Restart iori Host")}
            description={t(
              host.maintenanceAvailable === false
                ? failures.service!
                : "Restart iori Host from this Client.",
            )}
          >
            <Button
              variant="outline"
              data-iori-action="host-restart"
              disabled={Boolean(preparing) || sending || unavailable}
              pending={
                preparing === "restart" ||
                (sending && status?.kind === "restart")
              }
              onClick={() => void prepare("restart")}
            >
              {t("Restart iori Host")}
            </Button>
          </FieldRow>
          <FieldRow
            label={t("Uninstall iori Host on “{name}”").replace(
              "{name}",
              host.hostName,
            )}
            description={t(
              host.maintenanceAvailable === false
                ? "This iori Host is not running as a service. Uninstall it on the Host machine."
                : "Remove the iori Host program and automatic startup.",
            )}
          >
            {state.initial?.mobile ? (
              host.maintenanceAvailable !== false && (
                <p>{t("Use iori on a PC to uninstall iori Host.")}</p>
              )
            ) : (
              <Button
                variant="destructive"
                data-iori-action="host-uninstall"
                disabled={Boolean(preparing) || sending || unavailable}
                pending={
                  startingUninstall ||
                  preparing === "uninstall" ||
                  (sending && status?.kind === "uninstall")
                }
                onClick={() => void prepare("uninstall")}
              >
                {t("Uninstall")}
              </Button>
            )}
          </FieldRow>
        </>
      )}
      <HostRemovalResult hostKey={host.publicKey} t={t} />
      {!paused && host.terminalDaemonCanContinue === false && (
        <p className="text-destructive">
          {t("Running Terminals will stop, and work in progress will be lost.")}
        </p>
      )}
      {preparing && <p role="status">{t("Preparing confirmation")}</p>}
      {status?.kind === "uninstall" && Boolean(status.completed?.length) && (
        <div className="settings-note">
          <p>{t("Completed steps")}</p>
          <ul className="list-disc pl-5">
            {status.completed!.map((stage) => (
              <li key={stage}>{t(completedStages[stage] ?? stage)}</li>
            ))}
          </ul>
        </div>
      )}
      {Boolean(status?.forgeTokensRemaining?.length) && (
        <p role="alert" data-iori-state="forge-tokens-remaining">
          {t(
            "Could not remove the tokens of these sites from the OS credential store:",
          )}
          {status!.forgeTokensRemaining!.map((site) => (
            <span key={site} className="block wrap-anywhere">
              {site}
            </span>
          ))}
          <span className="block">
            {t(
              "Remove them in the OS credential store. A token stays usable until it is revoked on its site.",
            )}
          </span>
        </p>
      )}
      {Boolean(status?.rollbackFailed?.length) && (
        <p role="alert">
          {t("Could not restore:")}{" "}
          {status!
            .rollbackFailed!.map((stage) =>
              t(
                stage === "terminals"
                  ? "Terminals and agents"
                  : stage === "hooks"
                    ? "CLI hooks"
                    : "Automatic startup",
              ),
            )
            .join(t(", "))}
        </p>
      )}
      {reason && (
        <p
          role="alert"
          className="connection-error"
          data-iori-state="host-maintenance-error"
        >
          {t(
            removalFilesFailed
              ? "Could not delete all iori Host files."
              : (failures[reason] ?? failures.request!),
          )}
          {status?.stage && stages[status.stage] && (
            <span className="block">
              {t(stages[status.stage]!)}
              {status.osError && status.osError !== "unknown"
                ? ` (${status.osError})`
                : ""}
            </span>
          )}
          {removalFilesFailed && (
            <>
              {status.processErrors?.length ? (
                <span className="block">
                  {t("Could not stop these processes:")}
                  {status.processErrors.map((error) => (
                    <span key={error} className="block wrap-anywhere">
                      {error}
                    </span>
                  ))}
                </span>
              ) : null}
              {status.failedPaths?.map((path) => (
                <span key={path} className="block wrap-anywhere">
                  {path}
                </span>
              ))}
              <span className="block">
                {t(
                  !status.failedPaths?.length
                    ? "Reinstall using “Set up iori Host”."
                    : host.os === "Windows"
                      ? "Restart the PC, then delete those folders, or reinstall using “Set up iori Host”."
                      : "Delete the remaining folders, or reinstall using “Set up iori Host”.",
                )}
              </span>
              <span className="block">
                {t(
                  "You can remove this Host from the list in Settings → Connection.",
                )}
              </span>
            </>
          )}
        </p>
      )}
      <Dialog
        open={Boolean(confirmation)}
        onOpenChange={(open) => !open && setConfirmation(undefined)}
      >
        <DialogContent
          className="folder-dialog worktree-create-dialog"
          showCloseButton={false}
          data-iori-view="host-maintenance-confirmation"
          onOpenAutoFocus={(event) => {
            event.preventDefault();
            cancelConfirmation.current?.focus();
          }}
        >
          <DialogHeader>
            <DialogTitle>
              {t(
                confirmation?.kind === "uninstall"
                  ? "Uninstall iori Host"
                  : confirmation?.kind === "update"
                    ? "Update iori Host"
                    : "Restart iori Host",
              ).replace("{name}", host.hostName)}
            </DialogTitle>
            <DialogDescription className="worktree-removal-summary">
              {confirmation?.kind === "uninstall"
                ? t("{name}'s iori Host will be uninstalled.").replace(
                    "{name}",
                    host.hostName,
                  )
                : t(
                    confirmation?.kind === "update"
                      ? "{name} will be updated from {from} to {to}."
                      : "{name} will be restarted.",
                  )
                    .replace("{name}", host.hostName)
                    .replace("{from}", host.version ?? "")
                    .replace("{to}", clientVersion)}
            </DialogDescription>
          </DialogHeader>
          {confirmation &&
            (confirmation.kind === "uninstall" ||
              (!confirmation.plan.canContinue &&
                confirmation.plan.hasOpenTerminals)) && (
              <div data-slot="dialog-body" className="worktree-removal-body">
                <ScrollArea type="always" className="worktree-removal-scroll">
                  {confirmation.kind === "uninstall" && (
                    <p>
                      {t(
                        deleteData
                          ? "iori Host saved data (device registrations, the Host identity, iori work records and Terminal history, and Forgejo and Gitea tokens, including those in the OS credential store) will also be deleted. Development files and CLI conversations, settings, and sign-ins will remain."
                          : "Development files, CLI conversations, settings, and sign-ins, and iori Host saved data will remain.",
                      )}
                    </p>
                  )}
                  <HostMaintenanceStopWarning
                    plan={confirmation.plan}
                    kind={confirmation.kind}
                    t={t}
                  />
                  {confirmation.kind === "uninstall" && (
                    <label className="flex items-center worktree-removal-branch-toggle">
                      <Checkbox
                        data-iori-field="host-uninstall-data"
                        checked={deleteData}
                        onCheckedChange={(checked) =>
                          setDeleteData(checked === true)
                        }
                      />
                      {t("Also delete iori Host saved data")}
                    </label>
                  )}
                  <HostMaintenanceWork
                    plan={confirmation.plan}
                    hostKey={host.publicKey}
                    onOpenTerminal={onOpenTerminal}
                    t={t}
                  />
                </ScrollArea>
              </div>
            )}
          <DialogFooter>
            <DialogClose asChild>
              <Button variant="outline" ref={cancelConfirmation}>
                {t("Cancel")}
              </Button>
            </DialogClose>
            <Button
              data-iori-action="host-maintenance-confirm"
              variant={
                confirmation?.kind === "uninstall" ||
                confirmation?.plan.targets.length
                  ? "destructive"
                  : "default"
              }
              onClick={() => {
                if (!confirmation) return;
                const selected = confirmation;
                setConfirmation(undefined);
                if (selected.kind === "uninstall") setStartingUninstall(true);
                void performHostMaintenance(
                  host.publicKey,
                  selected.kind,
                  selected.plan,
                  deleteData,
                )
                  .then((plan) => {
                    if (plan) setConfirmation({ kind: selected.kind, plan });
                  })
                  .finally(() => {
                    if (selected.kind === "uninstall")
                      setStartingUninstall(false);
                  });
              }}
            >
              {t(
                confirmation?.kind === "uninstall"
                  ? confirmation.plan.targets.length
                    ? "Stop and uninstall"
                    : "Uninstall"
                  : confirmation?.kind === "update"
                    ? confirmation.plan.targets.length
                      ? "Stop and update"
                      : "Update"
                    : confirmation?.plan.targets.length
                      ? "Stop and restart"
                      : "Restart",
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </SettingsSection>
  );
}
