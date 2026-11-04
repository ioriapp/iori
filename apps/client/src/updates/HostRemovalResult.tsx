import { useState, useSyncExternalStore } from "react";
import { connection } from "../connection.ts";
import { native } from "../native.ts";
import { Button } from "../components/ui/button.tsx";
import { Input } from "../components/ui/input.tsx";
import { Spinner } from "../components/ui/spinner.tsx";
import {
  Dialog,
  DialogContent,
  DialogTitle,
  DialogDescription,
} from "../components/ui/dialog.tsx";
import { removalReader, readRemovalResult } from "./removal-reader.ts";

export function HostRemovalFeedback({ t }: { t: (key: string) => string }) {
  const { prompt, hosts } = useSyncExternalStore(
    removalReader.subscribe,
    removalReader.getSnapshot,
  );
  const [answer, setAnswer] = useState("");
  const yesNo = prompt?.text.includes("(yes/no");
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
        open={Boolean(prompt)}
        onOpenChange={(open) => {
          if (!open && prompt) void native.sshCancel(prompt.session);
        }}
      >
        <DialogContent data-iori-state="ssh-prompt">
          <DialogTitle>{t("Check uninstall result")}</DialogTitle>
          <DialogDescription>{prompt?.text}</DialogDescription>
          {!yesNo && !prompt?.notification && (
            <Input
              type="password"
              autoComplete="off"
              aria-label={t("SSH response")}
              data-iori-field="ssh-answer"
              value={answer}
              onChange={(event) => setAnswer(event.target.value)}
            />
          )}
          {!prompt?.notification && (
            <Button
              data-iori-action="ssh-answer"
              onClick={() => {
                if (prompt)
                  void native.sshAnswer(prompt.id, yesNo ? "yes" : answer);
                setAnswer("");
              }}
            >
              {t(yesNo ? "Connect" : "Send")}
            </Button>
          )}
          <Button
            variant="outline"
            onClick={() => {
              if (prompt) void native.sshCancel(prompt.session);
            }}
          >
            {t("Cancel")}
          </Button>
        </DialogContent>
      </Dialog>
    </>
  );
}
export function HostRemovalResult({
  hostKey,
  t,
}: {
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
  const missing = !busy && reads.hosts[hostKey]?.missing;
  return (
    <div data-iori-view="host-removal-result">
      {removal.status.phase === "removing" && (
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
                  ? "Waiting for iori Host to stop and remove its files"
                  : "Uninstall requested. Program files will be removed after iori Host stops.",
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
            {t("Check uninstall result")}
          </Button>
        )}
      {paused && (
        <div className="connection-actions">
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
        </div>
      )}
    </div>
  );
}
