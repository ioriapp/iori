import { useState, useSyncExternalStore } from "react";
import { connection } from "../connection.ts";
import { FieldRow } from "../components/page-layout.tsx";
import { Button } from "../components/ui/button.tsx";
import { SshPrompt } from "../host-setup/SshPrompt.tsx";
import { Spinner } from "../components/ui/spinner.tsx";
import {
  Dialog,
  DialogContent,
  DialogTitle,
  DialogDescription,
} from "../components/ui/dialog.tsx";
import { removalReader, readRemovalResult } from "./removal-reader.ts";

export function HostRemovalPrompt({
  hostKey,
  t,
}: {
  hostKey?: string;
  t: (key: string) => string;
}) {
  const { prompt } = useSyncExternalStore(
    removalReader.subscribe,
    removalReader.getSnapshot,
  );
  if (!prompt || (hostKey && prompt.hostKey !== hostKey)) return null;
  const password = /^(?:\(.*?\)\s*)?([^\s@]+)@(.+?)'s password: ?$/i.exec(
    prompt.text,
  );
  const key = /Enter passphrase for key ['"](.+?)['"]:/i.exec(prompt.text);
  const label = password
    ? t("Password for {user}@{host}")
        .replace("{user}", password[1]!)
        .replace("{host}", password[2]!)
    : key
      ? t("Passphrase for {key}").replace("{key}", key[1]!)
      : undefined;
  return (
    <SshPrompt
      key={prompt.id}
      prompt={prompt}
      label={label}
      t={t}
      onAnswer={removalReader.answerPrompt}
      onCancel={() => removalReader.cancelPrompt()}
      cancelLabel={t("Cancel")}
    />
  );
}
export function HostRemovalFeedback({
  t,
  inline,
}: {
  t: (key: string) => string;
  inline: boolean;
}) {
  const { prompt, hosts } = useSyncExternalStore(
    removalReader.subscribe,
    removalReader.getSnapshot,
  );
  return (
    <>
      {Object.values(hosts).some((value) => value.cleanupFailed) && (
        <div className="storage-retry" role="status">
          <p>
            {t(
              "The uninstall result was saved, but its receipt file could not be deleted.",
            )}
          </p>
          <Button
            variant="ghost"
            onClick={() => removalReader.dismissCleanupWarnings()}
          >
            {t("Close")}
          </Button>
        </div>
      )}
      <Dialog
        open={Boolean(prompt) && !inline}
        onOpenChange={(open) => {
          if (!open) removalReader.cancelPrompt();
        }}
      >
        <DialogContent>
          <DialogTitle>{t("Check uninstall result")}</DialogTitle>
          <DialogDescription>{t("Checking")}</DialogDescription>
          <HostRemovalPrompt t={t} />
        </DialogContent>
      </Dialog>
    </>
  );
}
export function HostRemovalResult({
  hostKey,
  t,
  active = false,
}: {
  active?: boolean;
  hostKey: string;
  t: (key: string) => string;
}) {
  const state = useSyncExternalStore(
    connection.subscribe,
    connection.getSnapshot,
  );
  const reads = useSyncExternalStore(
    removalReader.subscribe,
    removalReader.getSnapshot,
  );
  const [error, setError] = useState<string>();
  const removal = state.removals[hostKey];
  if (!removal?.status) return null;
  const paused =
    removal.status.phase === "removing" || removal.status.phase === "succeeded";
  const busy = reads.hosts[hostKey]?.busy;
  const prompt = reads.prompt?.hostKey === hostKey;
  const missing = !busy && reads.hosts[hostKey]?.missing;
  return (
    <div data-iori-view="host-removal-result">
      {prompt && <HostRemovalPrompt hostKey={hostKey} t={t} />}
      {removal.status.phase === "removing" && !prompt && (
        <p
          role="status"
          className="flex items-center gap-2"
          data-iori-state={
            missing ? "host-uninstall-result-missing" : undefined
          }
        >
          {!missing && (removal.local || removal.sshDestination) && (
            <Spinner
              aria-hidden="true"
              data-icon="inline-start"
              className="size-3.5 shrink-0 motion-reduce:animate-none"
            />
          )}
          <span>
            {t(
              missing
                ? "No result is available yet. Wait a moment, then select “Check uninstall result”."
                : removal.local || removal.sshDestination
                  ? busy
                    ? "Checking"
                    : "Waiting for iori Host to stop and remove its files"
                  : "Uninstall of {name}'s iori Host started.",
            ).replace(
              "{name}",
              state.initial?.hosts.find((host) => host.publicKey === hostKey)
                ?.hostName ?? "",
            )}
          </span>
        </p>
      )}
      {(error || reads.hosts[hostKey]?.error) && (
        <p role="alert">{t(error ?? reads.hosts[hostKey]!.error!)}</p>
      )}
      {removal.status.phase === "removing" &&
        (removal.local || removal.sshDestination) && (
          <Button
            variant="outline"
            pending={Boolean(busy)}
            data-iori-action="host-uninstall-result"
            onClick={() => {
              setError(undefined);
              void readRemovalResult(connection, hostKey);
            }}
          >
            {t(
              reads.hosts[hostKey]?.error ? "Retry" : "Check uninstall result",
            )}
          </Button>
        )}
      {paused && !active && (
        <FieldRow
          label={
            <span
              role="status"
              data-iori-state={`host-${removal.status.phase}`}
            >
              {t(
                removal.status.phase === "succeeded"
                  ? "iori Host uninstalled"
                  : "Uninstall requested",
              )}
            </span>
          }
        >
          <Button
            variant="outline"
            data-iori-action="host-uninstall-connect"
            onClick={() => {
              setError(undefined);
              void connection
                .connectRemovedHost(hostKey)
                .catch(() =>
                  setError(
                    "Could not connect to this Host. Reinstall iori Host, then retry.",
                  ),
                );
            }}
          >
            {t("Connect")}
          </Button>
          <Button
            variant="outline"
            data-iori-action="host-forget"
            onClick={() => {
              setError(undefined);
              void connection
                .forgetHost(hostKey)
                .catch(() =>
                  setError("Could not remove this Host from the list. Retry."),
                );
            }}
          >
            {t("Remove from list")}
          </Button>
        </FieldRow>
      )}
    </div>
  );
}
