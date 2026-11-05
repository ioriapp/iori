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
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
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
import { removalReader } from "./removal-reader.ts";
import {
  clientVersion,
  hostNeedsUpdate,
  hostReleaseNotes,
  prepareHostMaintenance,
  performHostMaintenance,
  useHostMaintenance,
} from "./host-controller.ts";

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
    plan?: MaintenancePlan;
  }>();
  const [preparing, setPreparing] = useState<MaintenanceKind>();
  const [startingUninstall, setStartingUninstall] = useState(false);
  const [uninstallStarted, setUninstallStarted] = useState(false);
  const preparation = useRef(0);
  const uninstallConfirmation = confirmation?.kind === "uninstall";
  const uninstallRunning = uninstallConfirmation && uninstallStarted;
  const connected = state.connectedHosts.includes(host.publicKey);
  const [error, setError] = useState<string>();
  const uninstallLocked =
    uninstallRunning &&
    !error &&
    (startingUninstall || status?.phase !== "failed");
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
  const unavailable =
    paused || startingUninstall || host.maintenanceAvailable === false;
  const closeConfirmation = useCallback(() => {
    preparation.current++;
    setPreparing(undefined);
    setConfirmation(undefined);
    if (removalReader.getSnapshot().prompt?.hostKey === host.publicKey)
      removalReader.cancelPrompt();
  }, [host.publicKey]);
  useEffect(() => {
    onNestedBack(confirmation ? closeConfirmation : undefined);
    return () => onNestedBack(undefined);
  }, [confirmation, onNestedBack, closeConfirmation]);
  async function prepare(kind: MaintenanceKind) {
    const request = ++preparation.current;
    if (kind === "uninstall") {
      setDeleteData(false);
      setUninstallStarted(false);
      setConfirmation({ kind });
    }
    setPreparing(kind);
    setError(undefined);
    try {
      const plan = await prepareHostMaintenance(host.publicKey, kind);
      if (request !== preparation.current) return;
      if (plan.error) setError(plan.error);
      else setConfirmation({ kind, plan });
    } catch {
      if (request === preparation.current) setError("request");
    } finally {
      if (request === preparation.current) setPreparing(undefined);
    }
  }
  const reason =
    error ??
    (!uninstallConfirmation || uninstallRunning ? status?.reason : undefined);
  const waitingForHost =
    status?.kind !== "uninstall" && pending && disconnectedSeconds > 10;
  const showReconnect =
    status?.kind !== "uninstall" && (waitingForHost || reason === "restore");
  async function start() {
    if (!confirmation?.plan) return;
    const selected = confirmation;
    const request = preparation.current;
    if (selected.kind === "uninstall") {
      setStartingUninstall(true);
      setUninstallStarted(true);
      setError(undefined);
    } else setConfirmation(undefined);
    try {
      const plan = await performHostMaintenance(
        host.publicKey,
        selected.kind,
        selected.plan!,
        deleteData,
      );
      if (plan && request === preparation.current) {
        setUninstallStarted(false);
        setConfirmation({ kind: selected.kind, plan });
      }
    } catch {
      setError("save-removal");
    } finally {
      setStartingUninstall(false);
    }
  }
  const removalDetails = (
    <>
      {Boolean(status?.forgeTokensRemaining?.length) && (
        <p role="alert" data-iori-state="forge-tokens-remaining">
          {t(
            "The tokens for these sites could not be deleted. Delete them manually from the OS credential store.",
          )}
          {status!.forgeTokensRemaining!.map((site) => (
            <span key={site} className="block wrap-anywhere">
              {site}
            </span>
          ))}
          <span className="block">
            {t("A token can still be used until you revoke it on the site.")}
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
    </>
  );
  return (
    <SettingsSection data-iori-view="host-version">
      {host.version && (
        <FieldRow className="v9-settings-row">
          <span>{t("Current version")}</span>
          <span data-iori-value="host-version">{host.version}</span>
        </FieldRow>
      )}
      {status &&
        !uninstallConfirmation &&
        !(paused && status.kind === "uninstall") && (
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
              <>
                {!connected && (
                  <span
                    role="status"
                    data-iori-state="host-uninstall-connecting"
                  >
                    {t("Connecting")}
                  </span>
                )}
                <Button
                  variant="destructive"
                  data-iori-action="host-uninstall"
                  disabled={
                    !connected || Boolean(preparing) || sending || unavailable
                  }
                  onClick={() => void prepare("uninstall")}
                >
                  {t("Uninstall")}
                </Button>
              </>
            )}
          </FieldRow>
        </>
      )}
      {!uninstallConfirmation && (
        <HostRemovalResult hostKey={host.publicKey} t={t} />
      )}
      {!paused && host.terminalDaemonCanContinue === false && (
        <p className="text-destructive">
          {t("Running Terminals will stop, and work in progress will be lost.")}
        </p>
      )}
      {preparing && !uninstallConfirmation && (
        <p role="status">{t("Preparing confirmation")}</p>
      )}
      {!uninstallConfirmation && removalDetails}
      <Dialog
        open={Boolean(confirmation)}
        onOpenChange={(open) => {
          if (!open) closeConfirmation();
        }}
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
              (!confirmation.plan?.canContinue &&
                confirmation.plan?.hasOpenTerminals)) && (
              <div data-slot="dialog-body" className="worktree-removal-body">
                <ScrollArea type="auto" className="worktree-removal-scroll">
                  {confirmation.kind === "uninstall" && !uninstallRunning && (
                    <p>
                      {t(
                        deleteData
                          ? "iori Host saved data (device registrations, the Host identity, iori work records and Terminal history, and Forgejo and Gitea tokens, including those in the OS credential store) will also be deleted. Development files and CLI conversations, settings, and sign-ins will remain."
                          : "Development files, CLI conversations, settings, and sign-ins, and iori Host saved data will remain.",
                      )}
                    </p>
                  )}
                  {!uninstallRunning && confirmation.plan && (
                    <HostMaintenanceStopWarning
                      plan={confirmation.plan}
                      kind={confirmation.kind}
                      t={t}
                    />
                  )}
                  {confirmation.kind === "uninstall" && !uninstallRunning && (
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
                  {uninstallConfirmation && preparing === "uninstall" && (
                    <SettingsSection title={t("Work that will be interrupted")}>
                      <p role="status">{t("Checking")}</p>
                    </SettingsSection>
                  )}
                  {uninstallRunning && (
                    <>
                      {(status?.kind !== "uninstall" ||
                        status.phase !== "removing") && (
                        <p
                          role="status"
                          data-iori-state={`host-${error ? "failed" : status?.kind === "uninstall" ? status.phase : "uninstalling"}`}
                        >
                          {t(
                            error ||
                              (status?.kind === "uninstall" &&
                                status.phase === "failed")
                              ? "Could not uninstall iori Host"
                              : status?.stage === "terminals"
                                ? "Stopping Terminals and agents"
                                : "Uninstalling iori Host",
                          )}
                        </p>
                      )}
                      <HostRemovalResult
                        hostKey={host.publicKey}
                        active
                        t={t}
                      />
                      {removalDetails}
                    </>
                  )}
                  {!uninstallRunning && confirmation.plan && (
                    <HostMaintenanceWork
                      plan={confirmation.plan}
                      hostKey={host.publicKey}
                      onOpenTerminal={onOpenTerminal}
                      t={t}
                    />
                  )}
                  {uninstallConfirmation &&
                    !uninstallRunning &&
                    reason &&
                    removalDetails}
                </ScrollArea>
              </div>
            )}
          <DialogFooter>
            <DialogClose asChild>
              <Button
                variant="outline"
                ref={cancelConfirmation}
                data-iori-action="host-maintenance-close"
              >
                {t(
                  uninstallStarted && uninstallConfirmation
                    ? "Close"
                    : "Cancel",
                )}
              </Button>
            </DialogClose>
            {uninstallConfirmation && !uninstallRunning && !connected && (
              <span role="status" data-iori-state="host-maintenance-connecting">
                {t("Connecting")}
              </span>
            )}
            {!uninstallLocked && !(uninstallRunning && removalFilesFailed) && (
              <Button
                data-iori-action="host-maintenance-confirm"
                variant={
                  confirmation?.kind === "uninstall" ||
                  confirmation?.plan?.targets.length
                    ? "destructive"
                    : "default"
                }
                disabled={
                  Boolean(preparing) ||
                  uninstallLocked ||
                  startingUninstall ||
                  (!confirmation?.plan && !error) ||
                  (uninstallConfirmation && !connected && !uninstallRunning)
                }
                pending={startingUninstall}
                onClick={() => {
                  if (
                    uninstallConfirmation &&
                    (error || status?.phase === "failed")
                  ) {
                    if (!confirmation.plan) void prepare("uninstall");
                    else void start();
                  } else void start();
                }}
              >
                {t(
                  uninstallConfirmation &&
                    (error || (uninstallRunning && status?.phase === "failed"))
                    ? "Retry"
                    : confirmation?.kind === "uninstall"
                      ? confirmation.plan?.targets.length
                        ? "Stop and uninstall"
                        : "Uninstall"
                      : confirmation?.kind === "update"
                        ? confirmation.plan?.targets.length
                          ? "Stop and update"
                          : "Update"
                        : confirmation?.plan?.targets.length
                          ? "Stop and restart"
                          : "Restart",
                )}
              </Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </SettingsSection>
  );
}
