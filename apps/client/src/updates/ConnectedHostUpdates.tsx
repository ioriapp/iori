import { useEffect, useRef, useState } from "react";
import type { HostInfo, MaintenancePlan } from "@iori/protocol";
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
import { ScrollArea } from "../components/ui/scroll-area.tsx";
import { resumeConnectedHostUpdate } from "./connected-hosts.ts";
import {
  clientVersion,
  prepareHostMaintenance,
  performHostMaintenance,
  useHostMaintenance,
} from "./host-controller.ts";
import {
  failures,
  stages,
  HostMaintenanceStopWarning,
  HostMaintenanceProgress,
  HostMaintenanceWork,
} from "./HostMaintenanceDetails.tsx";
import "../worktree-creator.css";

type Item = {
  order: number;
  host: HostInfo;
  plan?: MaintenancePlan;
  error?: string;
  submitted?: boolean;
};
export function ConnectedHostUpdates({
  t,
  onOpenTerminal,
}: {
  t: (key: string) => string;
  onOpenTerminal: (hostKey: string, terminalId: string) => void;
}) {
  const [items, setItems] = useState<Item[]>([]);
  const cancel = useRef<HTMLButtonElement>(null);
  const dismissed = useRef(false);
  function dismiss() {
    dismissed.current = true;
    setItems([]);
  }
  useEffect(() => {
    let disposed = false;
    void resumeConnectedHostUpdate()
      .then((hosts) => {
        for (const [order, pending] of hosts.entries()) {
          void pending.then(async (candidate) => {
            if (disposed || dismissed.current || !candidate) return;
            let item: Item = { ...candidate, order };
            if (!item.error) {
              try {
                const plan = await prepareHostMaintenance(
                  item.host.publicKey,
                  "update",
                );
                item = plan.error
                  ? { ...item, error: plan.error }
                  : { ...item, plan };
              } catch {
                item = { ...item, error: "request" };
              }
            }
            if (!disposed && !dismissed.current)
              setItems((current) =>
                [...current, item].sort((a, b) => a.order - b.order),
              );
          });
        }
      })
      .catch(() => {});
    return () => {
      disposed = true;
    };
  }, []);
  const ready = items.filter((item) => item.plan && !item.submitted);
  const interrupted = ready.some((item) => item.plan!.targets.length);
  function confirm() {
    setItems((current) =>
      current.map((item) =>
        ready.includes(item) ? { ...item, submitted: true } : item,
      ),
    );
    for (const item of ready) {
      // Each request proceeds independently; reconnection of one Host must not
      // hold up another Host's update.
      void performHostMaintenance(
        item.host.publicKey,
        "update",
        item.plan!,
      ).then((plan) => {
        if (plan)
          setItems((current) =>
            current.map((entry) =>
              entry.host.publicKey === item.host.publicKey
                ? { ...entry, plan, submitted: false }
                : entry,
            ),
          );
      });
    }
  }
  return (
    <Dialog open={items.length > 0} onOpenChange={(open) => !open && dismiss()}>
      <DialogContent
        className="folder-dialog worktree-create-dialog"
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
        <div data-slot="dialog-body" className="worktree-removal-body">
          <ScrollArea type="auto" className="worktree-removal-scroll">
            {items.map((item) => (
              <HostUpdateRow
                key={item.host.publicKey}
                item={item}
                t={t}
                onOpenTerminal={(hostKey, terminalId) => {
                  dismiss();
                  onOpenTerminal(hostKey, terminalId);
                }}
              />
            ))}
          </ScrollArea>
        </div>
        <DialogFooter>
          <DialogClose asChild>
            <Button variant="outline" ref={cancel}>
              {/* Once no update waits for confirmation, nothing is left to
                  cancel (dialogs.md). */}
              {t(ready.length > 0 ? "Cancel" : "Close")}
            </Button>
          </DialogClose>
          {ready.length > 0 && (
            <Button
              data-iori-action="connected-hosts-confirm"
              variant={interrupted ? "destructive" : "default"}
              onClick={confirm}
            >
              {t(interrupted ? "Stop and update" : "Update")}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function HostUpdateRow({
  item,
  t,
  onOpenTerminal,
}: {
  item: Item;
  t: (key: string) => string;
  onOpenTerminal: (hostKey: string, terminalId: string) => void;
}) {
  const operation = useHostMaintenance(item.host.publicKey);
  const status = item.submitted ? operation?.status : undefined;
  const reason = item.error ?? status?.reason;
  const pending = Boolean(
    status && status.phase !== "failed" && status.phase !== "succeeded",
  );
  return (
    <section
      className="layout-section"
      data-iori-update-host={item.host.publicKey}
    >
      <p className="worktree-removal-summary">
        {t("{name} will be updated from {from} to {to}.")
          .replace("{name}", item.host.hostName)
          .replace("{from}", item.host.version ?? "")
          .replace("{to}", clientVersion)}
      </p>
      {!item.submitted && item.plan && (
        <>
          <HostMaintenanceStopWarning plan={item.plan} kind="update" t={t} />
          <HostMaintenanceWork
            plan={item.plan}
            hostKey={item.host.publicKey}
            t={t}
            onOpenTerminal={onOpenTerminal}
          />
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
    </section>
  );
}
