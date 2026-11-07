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
  type MaintenancePlan,
} from "@iori/protocol";
import {
  failures,
  HostMaintenanceStopWarning,
  HostMaintenanceProgress,
  HostMaintenanceWork,
} from "./HostMaintenanceDetails.tsx";
import {
  HostUninstallDialog,
  type UninstallActions,
} from "./HostUninstallDialog.tsx";
import type { UninstallFlow } from "./uninstall-flow-types.ts";
import { SettingsSection, FieldRow } from "../components/page-layout.tsx";
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

/** store の購読と、設定を閉じる・結果を開く配線は Settings / App が持つ。 */
export type HostUninstallSettings = {
  flow?: UninstallFlow;
  actions: UninstallActions;
  onClose: () => void;
};

export function HostVersionSettings({
  onOpenTerminal,
  host,
  t,
  onClientUpdate,
  onNestedBack,
  disconnectedSeconds,
  uninstall,
}: {
  host: HostInfo;
  onOpenTerminal: (hostKey: string, terminalId: string) => void;
  t: (key: string) => string;
  onClientUpdate: () => void;
  onNestedBack: (close?: () => void) => void;
  disconnectedSeconds: number;
  uninstall: HostUninstallSettings;
}) {
  const state = useSyncExternalStore(
    connection.subscribe,
    connection.getSnapshot,
  );
  const connected = state.connectedHosts.includes(host.publicKey);
  const operation = useHostMaintenance(host.publicKey);
  const status =
    operation?.status?.kind !== "uninstall" ? operation?.status : undefined;
  const pending = Boolean(
    status &&
    !status.plan &&
    status.phase !== "failed" &&
    status.phase !== "succeeded",
  );
  const sending =
    pending &&
    Boolean(operation?.sentOn) &&
    operation?.sentOn === connection.connectionIdOf(host.publicKey);
  const [confirmation, setConfirmation] = useState<{
    kind: "update" | "restart";
    plan: MaintenancePlan;
  }>();
  const [preparing, setPreparing] = useState<"update" | "restart">();
  const [error, setError] = useState<string>();
  const preparation = useRef(0);
  const cancelConfirmation = useRef<HTMLButtonElement>(null);
  const unavailable = !connected || host.maintenanceAvailable === false;
  const busy = Boolean(preparing) || sending;
  const flow = uninstall.flow;
  const closeConfirmation = useCallback(() => {
    preparation.current++;
    setPreparing(undefined);
    setConfirmation(undefined);
  }, []);
  const closeUninstall = useCallback(() => {
    if (!uninstall.flow) return;
    const phase = uninstall.flow.phase.type;
    if (
      ["confirming", "sshConnecting", "sshPrompt", "sshFailed"].includes(phase)
    )
      void uninstall.actions.cancel(host.publicKey);
    else uninstall.actions.close(host.publicKey);
    uninstall.onClose();
  }, [uninstall, host.publicKey]);
  useEffect(() => {
    onNestedBack(
      flow && !flow.closed
        ? closeUninstall
        : confirmation
          ? closeConfirmation
          : undefined,
    );
    return () => onNestedBack(undefined);
  }, [flow, confirmation, onNestedBack, closeUninstall, closeConfirmation]);
  async function prepare(kind: "update" | "restart") {
    const request = ++preparation.current;
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
  async function start() {
    if (!confirmation) return;
    const selected = confirmation;
    const request = preparation.current;
    setConfirmation(undefined);
    try {
      const plan = await performHostMaintenance(
        host.publicKey,
        selected.kind,
        selected.plan,
        false,
      );
      if (plan && request === preparation.current)
        setConfirmation({ kind: selected.kind, plan });
    } catch {
      setError("request");
    }
  }
  const reason = error ?? status?.reason;
  const waitingForHost = pending && disconnectedSeconds > 10;
  const showReconnect = waitingForHost || reason === "restore";
  const needsUpdate = !host.version || hostNeedsUpdate(host);
  return (
    <SettingsSection data-iori-view="host-version" title="iori Host">
      <FieldRow className="v9-settings-row" label={t("Current version")}>
        <span data-iori-value="host-version">{host.version}</span>
      </FieldRow>
      {status && (
        <HostMaintenanceProgress
          status={status}
          pending={pending}
          waitingForHost={waitingForHost}
          showReconnect={showReconnect}
          t={t}
        />
      )}
      <FieldRow
        label={t("Update iori Host")}
        description={
          host.maintenanceAvailable === false
            ? t(failures.service!)
            : needsUpdate
              ? `${t("Update to")} ${clientVersion}`
              : host.version &&
                  compareVersions(host.version, clientVersion) === 0
                ? t("You are up to date")
                : undefined
        }
      >
        {needsUpdate && (
          <Button
            variant="link"
            size="sm"
            disabled={!connected}
            onClick={() => void native.openUrl(hostReleaseNotes)}
          >
            {t("Release notes")}
          </Button>
        )}
        <Button
          variant="outline"
          size="lg"
          data-iori-action="host-update"
          disabled={!needsUpdate || busy || unavailable}
          pending={
            preparing === "update" || (sending && status?.kind === "update")
          }
          onClick={() => void prepare("update")}
        >
          {t("Update iori Host")}
        </Button>
      </FieldRow>
      {host.version && compareVersions(host.version, clientVersion) > 0 && (
        <>
          <p className="settings-note">
            {t(
              "This Host is newer than this Client. Update the Client in General settings.",
            )}
          </p>
          <Button
            variant="outline"
            disabled={!connected}
            onClick={onClientUpdate}
          >
            {t("Open Client updates")}
          </Button>
        </>
      )}
      <FieldRow
        label={t("Restart iori Host")}
        description={
          host.maintenanceAvailable === false
            ? t(failures.service!)
            : t("Restart iori Host on {host}.").replace(
                "{host}",
                () => host.hostName,
              )
        }
      >
        <Button
          variant="outline"
          size="lg"
          data-iori-action="host-restart"
          disabled={busy || unavailable}
          pending={
            preparing === "restart" || (sending && status?.kind === "restart")
          }
          onClick={() => void prepare("restart")}
        >
          {t("Restart")}
        </Button>
      </FieldRow>
      <FieldRow
        label={t("Uninstall iori Host")}
        description={t(
          state.initial?.mobile
            ? "Uninstall iori Host from a PC using iori."
            : host.maintenanceAvailable === false
              ? "This iori Host is not running as a service. Uninstall it on the Host machine."
              : "Remove the iori Host program and automatic startup registration from {host}.",
        ).replace("{host}", () => host.hostName)}
      >
        {!state.initial?.mobile && (
          <Button
            variant="destructive"
            size="lg"
            data-iori-action="host-uninstall"
            disabled={busy || unavailable}
            onClick={() => void uninstall.actions.open(host.publicKey)}
          >
            {t("Uninstall")}
          </Button>
        )}
      </FieldRow>
      {host.terminalDaemonCanContinue === false && (
        <p className="text-destructive">
          {t("Running Terminals will stop, and work in progress will be lost.")}
        </p>
      )}
      {preparing && <p role="status">{t("Preparing confirmation")}</p>}
      {reason && (
        <p
          role="alert"
          className="connection-error"
          data-iori-state="host-maintenance-error"
        >
          {t(failures[reason] ?? failures.request!)}
        </p>
      )}
      {flow && !flow.closed && (
        <HostUninstallDialog
          key={flow.hostKey}
          flow={flow}
          actions={uninstall.actions}
          connected={connected}
          onOpenTerminal={onOpenTerminal}
          onClose={uninstall.onClose}
          t={t}
        />
      )}
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
                confirmation?.kind === "update"
                  ? "Update iori Host"
                  : "Restart iori Host",
              )}
            </DialogTitle>
            <DialogDescription className="worktree-removal-summary">
              {t(
                confirmation?.kind === "update"
                  ? "{name} will be updated from {from} to {to}."
                  : "{name} will be restarted.",
              )
                .replace("{name}", () => host.hostName)
                .replace("{from}", () => host.version ?? "")
                .replace("{to}", clientVersion)}
            </DialogDescription>
          </DialogHeader>
          {confirmation &&
            !confirmation.plan.canContinue &&
            confirmation.plan.hasOpenTerminals && (
              <div data-slot="dialog-body" className="worktree-removal-body">
                <ScrollArea type="auto" className="worktree-removal-scroll">
                  <HostMaintenanceStopWarning
                    plan={confirmation.plan}
                    kind={confirmation.kind}
                    t={t}
                  />
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
              <Button
                variant="outline"
                ref={cancelConfirmation}
                data-iori-action="host-maintenance-close"
              >
                {t("Cancel")}
              </Button>
            </DialogClose>
            <Button
              data-iori-action="host-maintenance-confirm"
              variant={
                confirmation?.plan.targets.length ? "destructive" : "default"
              }
              disabled={busy || !connected}
              onClick={() => void start()}
            >
              {t(
                confirmation?.kind === "update"
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
