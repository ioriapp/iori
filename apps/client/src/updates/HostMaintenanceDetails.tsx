import type {
  CliSummary,
  MaintenanceKind,
  MaintenancePlan,
  MaintenanceStatus,
} from "@iori/protocol";
import { createContext, useContext } from "react";
import { CliIcon } from "../CliIcon.tsx";
import { Bot, Terminal, TriangleAlert } from "lucide-react";
import { WorkRow } from "../components/flow/WorkRow.tsx";
import { SettingsSection, FieldRow } from "../components/page-layout.tsx";
import { Button } from "../components/ui/button.tsx";
import { Spinner } from "../components/ui/spinner.tsx";
import { Progress } from "../components/ui/progress.tsx";
import { connection } from "../connection.ts";

export const failures: Record<string, string> = {
  service:
    "This iori Host is not running as a service. Start it using the installation script to update or restart it here.",
  source:
    "The Host could not reach the release source. Retry, or run the installation script on the Host machine.",
  verification: "The Host update could not be verified. Retry the update.",
  download: "The Host could not download the update. Retry the update.",
  startup:
    "The new version of iori Host could not start, so iori Host was returned to the previous version. Saved data is unchanged.",
  restore:
    "The previous iori Host could not start. Check the service on the Host machine, then reconnect.",
  "restore-data":
    "The saved data could not be restored. Check the Host and its backup on the Host machine before retrying.",
  install:
    "The Host update could not be installed. Check the service on the Host machine, then retry.",
  restart:
    "Could not restart iori Host. On the iori Host's machine, check that iori Host is running, then try again.",
  updater:
    "The Host update process exited without leaving a result. Retry the update.",
  request: "The Host could not complete this operation. Retry.",
  uninstall:
    "Could not finish uninstalling iori Host. Check the failed step, then retry.",
};
export const stages: Record<string, string> = {
  "prepare-removal": "Could not prepare the uninstall request",
  "save-removal": "Could not save uninstall progress",
  download: "Downloading the Host update",
  extract: "Extracting the Host update",
  prepare: "Preparing the Host update",
  stop: "Stopping iori Host",
  backup: "Backing up iori Host",
  replace: "Replacing iori Host",
  start: "Starting iori Host",
  restore: "Restoring iori Host",
  terminals: "Stopping Terminals and agents",
  hooks: "Removing iori CLI hooks",
  registration: "Removing automatic startup",
  program: "Removing iori Host program files",
  data: "Removing iori Host saved data",
};
export function HostMaintenanceProgress({
  status,
  pending,
  waitingForHost = false,
  showReconnect = false,
  t,
}: {
  status: MaintenanceStatus;
  pending: boolean;
  waitingForHost?: boolean;
  showReconnect?: boolean;
  t: (key: string) => string;
}) {
  return (
    <>
      {status && !status.plan && (
        <FieldRow
          className="host-maintenance-status"
          description={
            waitingForHost
              ? t(
                  "The Host has not reconnected yet. You can keep waiting, or check the service on the Host machine.",
                )
              : undefined
          }
          label={
            <span
              className="inline-flex items-center gap-2"
              key={status.phase}
              role="status"
              data-iori-state={`host-${status.phase}`}
            >
              {pending && (
                <Spinner
                  aria-hidden="true"
                  className="size-3.5 shrink-0 motion-reduce:animate-none"
                />
              )}
              {t(
                status.kind === "uninstall"
                  ? status.phase === "failed"
                    ? "Could not uninstall iori Host"
                    : status.phase === "succeeded"
                      ? "iori Host uninstalled"
                      : status.phase === "removing"
                        ? "Uninstall requested"
                        : "Uninstalling iori Host"
                  : status.phase === "failed"
                    ? status.kind === "update"
                      ? "Could not update iori Host"
                      : "Could not restart iori Host"
                    : status.phase === "succeeded"
                      ? status.kind === "update"
                        ? "iori Host updated"
                        : "iori Host restarted"
                      : status.kind === "update"
                        ? "Updating iori Host"
                        : "Restarting iori Host",
              )}
              {status.phase === "downloading" && status.total
                ? ` ${Math.floor(((status.received ?? 0) * 100) / status.total)}%`
                : ""}
            </span>
          }
        >
          {showReconnect && (
            <Button
              variant="outline"
              size="sm"
              data-iori-action="host-maintenance-reconnect"
              onClick={() => void connection.reconnect()}
            >
              {t("Reconnect")}
            </Button>
          )}
        </FieldRow>
      )}
      {status &&
        !status.plan &&
        status.phase === "downloading" &&
        Boolean(status.total) && (
          <div>
            <Progress
              value={Math.floor(((status.received ?? 0) * 100) / status.total!)}
              aria-label={t("Downloading the Host update")}
            />
          </div>
        )}
    </>
  );
}

export const MaintenanceClisContext = createContext<
  () => Record<string, Record<string, CliSummary>>
>(() => ({}));

export function HostMaintenanceWork({
  plan,
  hostKey,
  onOpenTerminal,
  t,
}: {
  plan: MaintenancePlan;
  hostKey: string;
  onOpenTerminal: (hostKey: string, terminalId: string) => void;
  t: (key: string) => string;
}) {
  const clis = useContext(MaintenanceClisContext)()[hostKey];
  return (
    <>
      {plan.targets.length > 0 && (
        <SettingsSection
          data-iori-maintenance-working="true"
          title={
            <span className="worktree-removal-warning-heading">
              {t("Work that will be interrupted")}
              <TriangleAlert aria-hidden="true" />
            </span>
          }
        >
          <div className="section-rows">
            {plan.targets.map((target) => (
              <WorkRow
                key={target.id}
                icon={
                  clis?.[target.id] ? (
                    <CliIcon
                      hostKey={hostKey}
                      cli={clis[target.id]}
                      size={15}
                    />
                  ) : target.command ? (
                    <Terminal size={15} />
                  ) : (
                    <Bot size={15} />
                  )
                }
                className="wrap-anywhere"
                title={
                  target.command
                    ? `${target.title} · ${target.command}`
                    : target.title
                }
                state={target.state}
                label={
                  {
                    running: "Running",
                    approval: "Approval",
                    question: "Question",
                  }[target.state]
                }
                data-iori-maintenance-work={target.id}
                data-iori-maintenance-work-state={target.state}
                onClick={() => onOpenTerminal(hostKey, target.id)}
              />
            ))}
          </div>
        </SettingsSection>
      )}
    </>
  );
}

export function HostMaintenanceStopWarning({
  plan,
  kind,
  t,
}: {
  plan: MaintenancePlan;
  kind: MaintenanceKind;
  t: (key: string) => string;
}) {
  return (
    <>
      {!plan.canContinue && plan.hasOpenTerminals && (
        <p data-iori-maintenance-open="true">
          {t(
            kind === "uninstall"
              ? "All open CLIs and Terminals will stop."
              : "All open CLIs and Terminals will stop. CLI conversations can be resumed later.",
          )}
        </p>
      )}
    </>
  );
}
