import type { AutomationReceived } from "@iori/protocol";
import { ErrorMessage } from "../../Settings.tsx";
import { Button } from "../../components/ui/button.tsx";
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "../../components/ui/dialog.tsx";
import { useI18n } from "../context.tsx";

export function AutomationDialogs({
  draftName,
  working,
  regenerating,
  regeneratingPending,
  regenerateError,
  onRegenerateOpenChange,
  onRegenerate,
  received,
  onCloseReceived,
  deleting,
  deletingPending,
  onDeletingChange,
  onDelete,
  formatDate,
}: {
  draftName?: string;
  working: boolean;
  regenerating: boolean;
  regeneratingPending: boolean;
  regenerateError: string;
  onRegenerateOpenChange: (open: boolean) => void;
  onRegenerate: () => void;
  received?: AutomationReceived;
  onCloseReceived: () => void;
  deleting: boolean;
  deletingPending: boolean;
  onDeletingChange: (open: boolean) => void;
  onDelete: () => void;
  formatDate: (at: number) => string;
}) {
  const { t } = useI18n();

  return (
    <>
      <Dialog open={regenerating} onOpenChange={onRegenerateOpenChange}>
        <DialogContent className="max-md:top-auto max-md:bottom-3 max-md:w-[calc(100%-1.5rem)] max-md:max-w-none max-md:translate-y-0 sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{t("Regenerate the token?")}</DialogTitle>
            <DialogDescription>
              {t("The current token will stop working.")}
            </DialogDescription>
            <ErrorMessage
              message={regenerateError ? t(regenerateError) : undefined}
            />
          </DialogHeader>
          <DialogFooter className="flex flex-col-reverse gap-2 md:flex-row md:justify-end">
            <Button
              type="button"
              variant="outline"
              className="max-md:min-h-11 max-md:w-full"
              onClick={() => onRegenerateOpenChange(false)}
            >
              {t("Cancel")}
            </Button>
            <Button
              type="button"
              disabled={working}
              pending={regeneratingPending}
              className="max-md:min-h-11 max-md:w-full"
              onClick={onRegenerate}
            >
              {t("Regenerate")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={!!received}
        onOpenChange={(open) => {
          if (!open) onCloseReceived();
        }}
      >
        <DialogContent
          className="overflow-hidden sm:max-w-[640px]"
          data-iori-view="automation-received"
        >
          <DialogHeader>
            <DialogTitle>{t("Received content")}</DialogTitle>
          </DialogHeader>
          {received && (
            <DialogBody>
              <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs tabular-nums text-muted-foreground">
                <span>
                  {t("Received at")}: {formatDate(received.receivedAt)}
                </span>
                <span>
                  {t("From")}: {received.from}
                </span>
              </div>
              {(
                [
                  ["Query", JSON.stringify(received.query, null, 2)],
                  ["Headers", JSON.stringify(received.headers, null, 2)],
                  ["Body", received.body],
                ] as const
              ).map(([label, value]) => (
                <div className="flex min-w-0 flex-col gap-1.5" key={label}>
                  <div className="text-xs font-medium text-foreground">
                    {t(label)}
                  </div>
                  <pre className="m-0 block min-w-0 overflow-x-auto rounded-md border border-border-subtle bg-terminal p-2.5 font-mono text-2xs leading-relaxed whitespace-pre-wrap [overflow-wrap:anywhere] text-terminal-foreground">
                    {value}
                  </pre>
                </div>
              ))}
            </DialogBody>
          )}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onCloseReceived}>
              {t("Close")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={deleting} onOpenChange={onDeletingChange}>
        <DialogContent
          data-iori-view="automation-delete"
          className="max-md:top-auto max-md:bottom-3 max-md:w-[calc(100%-1.5rem)] max-md:max-w-none max-md:translate-y-0 sm:max-w-md"
        >
          <DialogHeader>
            <DialogTitle>{t("Delete automation")}</DialogTitle>
            <DialogDescription>
              {draftName}{" "}
              {t(
                "The automation and its history will be deleted. Started conversations will remain.",
              )}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="flex flex-col-reverse gap-2 md:flex-row md:justify-end">
            <Button
              type="button"
              variant="outline"
              className="max-md:min-h-11 max-md:w-full"
              onClick={() => onDeletingChange(false)}
            >
              {t("Cancel")}
            </Button>
            <Button
              type="button"
              variant="destructive"
              data-iori-action="automation-delete-confirm"
              className="max-md:min-h-11 max-md:w-full"
              onClick={onDelete}
              disabled={working}
              pending={deletingPending}
            >
              {t("Delete")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
