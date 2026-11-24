import { useEffect, useState } from "react";
import { Button } from "../components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "../components/ui/dialog";

export type CiCancelDialogProps = {
  runName?: string;
  locale: string;
  busy?: boolean;
  onOpenChange: (open: boolean) => void;
  onConfirm: () => Promise<void>;
};

export function CiCancelDialog({
  runName,
  locale,
  busy = false,
  onOpenChange,
  onConfirm,
}: CiCancelDialogProps) {
  const ja = locale.startsWith("ja");
  const [localBusy, setLocalBusy] = useState(false);

  useEffect(() => {
    if (runName !== undefined) {
      setLocalBusy(false);
    }
  }, [runName]);

  const submitting = busy || localBusy;

  const confirm = async () => {
    if (runName === undefined || submitting) return;
    setLocalBusy(true);
    try {
      await onConfirm();
    } finally {
      setLocalBusy(false);
    }
  };

  const title = runName
    ? ja
      ? `${runName} をキャンセルしますか？`
      : `Cancel ${runName}?`
    : ja
      ? "このワークフローをキャンセルしますか？"
      : "Cancel this workflow?";

  const description = ja
    ? "実行中のジョブは途中で停止します。"
    : "Running jobs in this workflow will be stopped.";

  return (
    <Dialog
      open={runName !== undefined}
      onOpenChange={(next) => {
        if (!next && !submitting) onOpenChange(false);
      }}
    >
      <DialogContent
        data-iori-dialog="ci-cancel"
        showCloseButton={false}
        className="max-md:top-auto max-md:bottom-3 max-md:w-[calc(100%-1.5rem)] max-md:max-w-none max-md:translate-y-0 max-md:p-4 sm:max-w-md"
      >
        <DialogHeader className="pr-0">
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>
        <DialogFooter className="mt-1 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <Button
            type="button"
            variant="outline"
            autoFocus
            disabled={submitting}
            className="max-md:min-h-11 max-md:w-full max-md:text-sm"
            onClick={() => onOpenChange(false)}
          >
            {ja ? "キャンセル" : "Cancel"}
          </Button>
          <Button
            type="button"
            variant="destructive"
            pending={submitting}
            data-iori-action="ci-cancel-confirm"
            className="max-md:min-h-11 max-md:w-full max-md:text-sm"
            onClick={() => void confirm()}
          >
            {ja ? "ワークフローをキャンセル" : "Cancel workflow"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
