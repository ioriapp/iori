import { translator } from "../i18n.ts";
import { useEffect, useRef, useSyncExternalStore } from "react";
import { Button } from "../components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "../components/ui/dialog";
import { ReadingError } from "../reading/ReadingError.tsx";
import type { ReadingTransport } from "../reading/transport.ts";
import { formatBytes } from "../reading/format.ts";
import { fileTransfers, failureFolder } from "./transfers.ts";

/** The app owns this dialog; closing a Files View cannot answer it or cancel IO. */
export function FileTransferDialogs() {
  const { confirmation } = useSyncExternalStore(
    fileTransfers.subscribe,
    fileTransfers.getSnapshot,
  );
  useEffect(() => fileTransfers.start(), []);
  const t = translator(confirmation?.locale ?? "");
  return (
    <Dialog
      open={Boolean(confirmation)}
      onOpenChange={(open) => {
        if (!open) confirmation?.answer(false);
      }}
    >
      <DialogContent data-iori-dialog="files-replace">
        <DialogHeader>
          <DialogTitle>{t("Replace files")}</DialogTitle>
          <DialogDescription>
            {t("Files with the same names already exist.")}
          </DialogDescription>
        </DialogHeader>
        <ul className="max-h-[45dvh] space-y-1 overflow-auto text-xs text-foreground [overflow-wrap:anywhere]">
          {confirmation?.names.map((name) => (
            <li key={name}>{name}</li>
          ))}
        </ul>
        <DialogFooter>
          <Button variant="outline" onClick={() => confirmation?.answer(false)}>
            {t("Cancel")}
          </Button>
          <Button
            data-iori-action="files-put-replace"
            onClick={() => confirmation?.answer(true)}
          >
            {t("Replace")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
export function useFileUploads(
  transport: ReadingTransport,
  host: string,
  root: string,
  locale: string,
) {
  const t = translator(locale);
  const snapshot = useSyncExternalStore(
    fileTransfers.subscribe,
    fileTransfers.getSnapshot,
  );
  const transfers = snapshot.transfers.filter(
    (item) => item.host === host && item.root === root,
  );
  const failures = snapshot.failures.filter(
    (item) => item.host === host && item.root === root,
  );
  const input = useRef<HTMLInputElement>(null);
  const directory = useRef("");
  const put = (files: File[], folder: string) => {
    directory.current = folder;
    fileTransfers.put(transport, host, root, locale, files, folder);
  };
  const choose = (folder: string) => {
    directory.current = folder;
    input.current?.click();
  };
  const save = (path: string) =>
    fileTransfers.save(transport, host, root, locale, path);
  const controls = (
    <>
      <input
        ref={input}
        type="file"
        multiple
        hidden
        data-iori-field="files-put"
        onChange={(event) => {
          const files = Array.from(event.target.files ?? []);
          event.target.value = "";
          if (files.length) put(files, directory.current);
        }}
      />
      {failures.map((failure) => (
        <ReadingError
          key={JSON.stringify([
            failure.kind,
            failure.kind === "put" ? failureFolder(failure) : failure.path,
            failure.message,
          ])}
          retryLabel={t("Retry")}
          onRetry={() => {
            fileTransfers.clearFailure(failure);
            if (failure.kind === "save") save(failure.path);
            else choose(failureFolder(failure));
          }}
        >
          {failure.message}
        </ReadingError>
      ))}
      {transfers.map((transfer) => {
        const name = transfer.path.split("/").at(-1)!;
        return (
          <div
            className="flex items-center gap-2 border-t border-border bg-background px-2.5 py-2"
            key={transfer.id}
            data-iori-put={transfer.kind === "put" ? name : undefined}
            data-iori-save={transfer.kind === "save" ? name : undefined}
          >
            <div className="flex min-w-0 flex-1 flex-col gap-0.5 text-xs tabular-nums">
              <span className="truncate text-foreground" title={transfer.path}>
                {name}
              </span>
              <span className="text-muted-foreground">
                {transfer.size === undefined
                  ? ""
                  : `${formatBytes(transfer.size, locale)} · ${transfer.size ? Math.floor((transfer.written / transfer.size) * 100) : 0}%`}
              </span>
              <progress
                className="h-1 w-full accent-primary"
                value={
                  transfer.size === undefined ? undefined : transfer.written
                }
                max={transfer.size || 1}
                aria-label={name}
              />
            </div>
            <Button
              variant="outline"
              size="sm"
              className="[@media(pointer:coarse)]:min-h-11"
              data-iori-action={
                transfer.kind === "put"
                  ? "files-put-cancel"
                  : "files-save-cancel"
              }
              onClick={() => fileTransfers.cancel(transfer)}
            >
              {t("Cancel")}
            </Button>
          </div>
        );
      })}
    </>
  );
  return {
    put,
    choose,
    save,
    controls,
    folderError: () =>
      fileTransfers.fail({
        host,
        root,
        path: directory.current,
        folder: directory.current,
        kind: "put",
        message: t("Folders cannot be uploaded. Upload files only."),
      }),
  };
}
