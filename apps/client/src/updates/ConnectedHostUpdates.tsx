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
  const confirmations = items.filter(
    (item) => item.state === "confirmation" && item.plan,
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
        className="h-[min(43.75rem,calc(100dvh-1.5rem))] max-h-[calc(100dvh-1.5rem)] w-[min(35rem,calc(100vw-1.5rem))] max-w-[calc(100vw-1.5rem)] overflow-hidden rounded-lg border border-border bg-popover text-sm shadow-md sm:max-w-[35rem] max-md:[&_button]:min-h-11 [@media(pointer:coarse)]:[&_button]:min-h-11 [&_[data-slot=dialog-footer]]:flex-wrap"
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
        <div
          data-slot="dialog-body"
          className="-mx-5 grid min-h-0 flex-1 content-start gap-0 divide-y divide-border overflow-y-auto px-5"
        >
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
          {confirmations.length >= 2 && (
            <Button
              variant="destructive"
              onClick={() => {
                for (const item of confirmations)
                  void confirmConnectedHostUpdate(item.host.publicKey);
              }}
            >
              {t("Stop all and update")}
            </Button>
          )}
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
      className="min-w-0 py-4 first:pt-0 last:pb-0"
      data-iori-update-host={item.host.publicKey}
    >
      <div className="pb-3">
        <h2
          className="m-0 truncate font-heading text-lg font-semibold text-foreground"
          title={item.host.hostName}
        >
          {item.host.hostName}
        </h2>
      </div>
      <div className="grid gap-3 [overflow-wrap:anywhere]">
        {item.state === "checking" && (
          <p
            className="m-0 inline-flex items-center gap-2 text-muted-foreground"
            role="status"
            data-iori-state="host-checking"
          >
            <Spinner aria-hidden="true" />
            {t("Checking")}
          </p>
        )}
        {item.state === "current" && (
          <p className="m-0" role="status" data-iori-state="host-current">
            {t("You are up to date")}
          </p>
        )}
        {item.state === "unknown-version" && (
          <p
            role="alert"
            className="m-0 text-xs leading-relaxed text-status-failed-text [overflow-wrap:anywhere]"
          >
            {t(
              "Could not check the iori Host version. Try updating from Version in settings.",
            )}
          </p>
        )}
        {item.state === "disconnected" && (
          <div
            className="grid grid-cols-[1rem_minmax(0,1fr)] items-start gap-2 rounded-md border border-status-failed-border bg-status-failed-bg/35 p-3 text-sm"
            role="alert"
            data-iori-state="host-disconnected"
          >
            <TriangleAlert
              className="mt-0.5 size-4 text-status-failed-text"
              aria-hidden="true"
            />
            <div className="grid min-w-0 gap-1">
              <p className="m-0 font-semibold text-status-failed-text">
                {t("Could not connect to the Host.")}
              </p>
              <p className="m-0 text-foreground">
                {t("Check that the Host is running.")}
              </p>
            </div>
          </div>
        )}
        {item.state === "confirmation" && item.plan && (
          <>
            <p className="m-0">
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
            <div className="flex justify-end">
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
        {item.error && (
          <p className="m-0" role="status">
            {t("Could not update iori Host")}
          </p>
        )}
        {reason && (
          <p
            role="alert"
            className="m-0 text-xs leading-relaxed text-status-failed-text [overflow-wrap:anywhere]"
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
