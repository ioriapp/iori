import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { Button } from "../components/ui/button.tsx";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "../components/ui/dialog.tsx";
import { Spinner } from "../components/ui/spinner.tsx";
import { TriangleAlert } from "lucide-react";
import {
  resumeConnectedHostUpdate,
  connectedHostUpdates,
  confirmConnectedHostUpdate,
  watchConnectedHostUpdates,
  type ConnectedHostUpdate,
} from "./connected-hosts.ts";
import { clientVersion, useHostMaintenance } from "./host-controller.ts";
import {
  failures,
  stages,
  HostMaintenanceStopWarning,
  HostMaintenanceProgress,
  HostMaintenanceWork,
} from "./HostMaintenanceDetails.tsx";
import "../worktree-creator.css";
import "./connected-hosts.css";

export function ConnectedHostUpdates({
  t,
  onOpenTerminal,
}: {
  t: (key: string) => string;
  onOpenTerminal: (hostKey: string, terminalId: string) => void;
}) {
  const items = useSyncExternalStore(
    connectedHostUpdates.subscribe,
    connectedHostUpdates.getSnapshot,
  );
  const cancel = useRef<HTMLButtonElement>(null);
  const [dismissed, setDismissed] = useState(false);
  const dismiss = () => setDismissed(true);
  useEffect(() => {
    void resumeConnectedHostUpdate().catch(() => {});
  }, []);
  useEffect(() => {
    if (dismissed) return;
    return watchConnectedHostUpdates();
  }, [dismissed]);
  return (
    <Dialog
      open={!dismissed && items.length > 0}
      onOpenChange={(open) => !open && dismiss()}
    >
      <DialogContent
        className="folder-dialog worktree-create-dialog connected-update-dialog"
        showCloseButton={false}
        data-iori-view="connected-host-updates"
        onOpenAutoFocus={(event) => {
          event.preventDefault();
          cancel.current?.focus();
        }}
      >
        <DialogHeader>
          <DialogTitle>{t("Update iori Host")}</DialogTitle>
          <DialogDescription className="sr-only">
            {t("Update iori Host")}
          </DialogDescription>
        </DialogHeader>
        <div data-slot="dialog-body" className="connected-update-body">
          {items.map((item) => (
            <HostUpdateRow
              key={item.host.publicKey}
              item={item}
              t={t}
              onConfirm={() =>
                void confirmConnectedHostUpdate(item.host.publicKey)
              }
              onOpenTerminal={(hostKey, terminalId) => {
                dismiss();
                onOpenTerminal(hostKey, terminalId);
              }}
            />
          ))}
        </div>
        <DialogFooter>
          <DialogClose asChild>
            <Button variant="outline" ref={cancel}>
              {t("Close")}
            </Button>
          </DialogClose>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function HostUpdateRow({
  item,
  t,
  onOpenTerminal,
  onConfirm,
}: {
  item: ConnectedHostUpdate;
  onConfirm: () => void;
  t: (key: string) => string;
  onOpenTerminal: (hostKey: string, terminalId: string) => void;
}) {
  const operation = useHostMaintenance(item.host.publicKey);
  const status = item.state === "submitted" ? operation?.status : undefined;
  const reason = item.error ?? status?.reason;
  const pending = Boolean(
    status && status.phase !== "failed" && status.phase !== "succeeded",
  );
  return (
    <section
      className="layout-section"
      data-iori-update-host={item.host.publicKey}
    >
      <div className="section-heading">
        <h2 title={item.host.hostName}>{item.host.hostName}</h2>
      </div>
      <div className="host-update-content">
        {item.state === "checking" && (
          <p
            className="inline-flex items-center gap-2"
            role="status"
            data-iori-state="host-checking"
          >
            <Spinner aria-hidden="true" />
            {t("Checking")}
          </p>
        )}
        {item.state === "current" && (
          <p role="status" data-iori-state="host-current">
            {t("You are up to date")}
          </p>
        )}
        {item.state === "disconnected" && (
          <div
            className="host-notice is-error"
            role="alert"
            data-iori-state="host-disconnected"
          >
            <TriangleAlert aria-hidden="true" />
            <div className="body">
              <p className="heading">{t("Could not connect to the Host.")}</p>
              <p>{t("Check that the Host is running.")}</p>
            </div>
          </div>
        )}
        {item.state === "confirmation" && item.plan && (
          <>
            <p>
              {t("{name} will be updated from {from} to {to}.")
                .replace("{name}", item.host.hostName)
                .replace("{from}", item.host.version ?? "")
                .replace("{to}", clientVersion)}
            </p>
            <HostMaintenanceStopWarning plan={item.plan} kind="update" t={t} />
            <HostMaintenanceWork
              plan={item.plan}
              hostKey={item.host.publicKey}
              t={t}
              onOpenTerminal={onOpenTerminal}
            />
            <div className="host-update-confirm">
              <Button
                variant="destructive"
                data-iori-action="connected-hosts-confirm"
                onClick={onConfirm}
              >
                {t("Stop and update")}
              </Button>
            </div>
          </>
        )}
        {status && (
          <HostMaintenanceProgress status={status} pending={pending} t={t} />
        )}
        {item.error && <p role="status">{t("Could not update iori Host")}</p>}
        {reason && (
          <p
            role="alert"
            className="connection-error"
            data-iori-state="host-maintenance-error"
          >
            {t(failures[reason] ?? failures.request!)}
            {status?.stage && stages[status.stage] && (
              <span className="block">
                {t(stages[status.stage]!)}
                {status.osError && status.osError !== "unknown"
                  ? ` (${status.osError})`
                  : ""}
              </span>
            )}
          </p>
        )}
      </div>
    </section>
  );
}
