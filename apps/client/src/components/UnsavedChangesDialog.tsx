import { Button } from "./ui/button.tsx";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "./ui/dialog.tsx";

export interface UnsavedChangesDialogProps {
  open: boolean;
  onCancel: () => void;
  onDiscard: () => void;
  onSave: () => void;
  saving?: boolean;
  t?: (key: string) => string;
  title?: string;
  description?: string;
  cancelLabel?: string;
  discardLabel?: string;
  saveLabel?: string;
  view?: string;
}

export function UnsavedChangesDialog({
  open,
  onCancel,
  onDiscard,
  onSave,
  saving = false,
  t,
  title,
  description,
  cancelLabel,
  discardLabel,
  saveLabel,
  view = "unsaved-changes-confirmation",
}: UnsavedChangesDialogProps) {
  const translate = (key: string) => (t ? t(key) : key);
  const resolvedTitle = title ?? translate("Save changes?");
  const resolvedDescription =
    description ??
    translate("Your changes will be lost if you don't save them.");
  const resolvedCancel = cancelLabel ?? translate("Cancel");
  const resolvedDiscard = discardLabel ?? translate("Don't save");
  const resolvedSave = saveLabel ?? translate("Save");

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next && !saving) onCancel();
      }}
    >
      <DialogContent
        showCloseButton={false}
        data-iori-view={view}
        className="max-md:top-auto max-md:bottom-3 max-md:w-[calc(100%-1.5rem)] max-md:max-w-none max-md:translate-y-0 max-md:p-4 sm:max-w-md"
      >
        <DialogHeader className="pr-0">
          <DialogTitle>{resolvedTitle}</DialogTitle>
          <DialogDescription>{resolvedDescription}</DialogDescription>
        </DialogHeader>
        {/* DOM order puts Cancel first (initial focus on open per dialogs.md).
            PC renders Cancel / Don't save / Save left-to-right; Mobile stacks
            flex-col-reverse with Save on top, each at 44px touch height. */}
        <DialogFooter className="mt-1 flex flex-col-reverse gap-2 md:flex-row md:justify-end">
          <Button
            type="button"
            variant="outline"
            disabled={saving}
            data-iori-action="unsaved-cancel"
            className="max-md:min-h-11 max-md:w-full max-md:text-sm"
            onClick={onCancel}
          >
            {resolvedCancel}
          </Button>
          <Button
            type="button"
            variant="destructive"
            disabled={saving}
            data-iori-action="unsaved-discard"
            className="max-md:min-h-11 max-md:w-full max-md:text-sm"
            onClick={onDiscard}
          >
            {resolvedDiscard}
          </Button>
          <Button
            type="button"
            variant="default"
            pending={saving}
            data-iori-action="unsaved-save"
            className="max-md:min-h-11 max-md:w-full max-md:text-sm"
            onClick={onSave}
          >
            {resolvedSave}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
