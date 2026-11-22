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
import type { Confirm, Removal } from "./cli-definition-types.ts";

const commandLabels = {
  launch: "Launch",
  models: "Model list",
  tokens: "Tokens",
  usage: "Usage limits",
} as const;

export function CliDefinitionConfirmDialog({
  confirm,
  busy,
  dialogMessage,
  onClose,
  onConfirm,
}: {
  confirm: Confirm | null;
  busy: boolean;
  dialogMessage: string;
  onClose: () => void;
  onConfirm: () => void;
}) {
  const { t } = useI18n();
  const summary = confirm?.summary;
  const hasEffects = !!(
    summary?.commands.length ||
    summary?.settings.length ||
    summary?.files.length
  );

  return (
    <Dialog
      open={!!confirm}
      onOpenChange={(yes) => {
        if (!yes) onClose();
      }}
    >
      <DialogContent
        className="sm:max-w-lg"
        data-iori-view="cli-definition-confirmation"
        {...(!hasEffects ? { "aria-describedby": undefined } : {})}
        showCloseButton={false}
      >
        {confirm && summary && (
          <>
            <DialogHeader className="pr-0">
              <DialogTitle>
                {t(
                  confirm.kind === "add"
                    ? "Add the definition of {name}?"
                    : confirm.kind === "replace"
                      ? "Overwrite the definition of {name}?"
                      : "Save the definition of {name}?",
                ).replace("{name}", summary.name)}
              </DialogTitle>
              {hasEffects && (
                <DialogDescription>
                  {t("Using this definition does the following on the Host.")}
                </DialogDescription>
              )}
            </DialogHeader>
            {(hasEffects || dialogMessage) && (
              <DialogBody>
                {hasEffects && (
                  <dl className="m-0 grid gap-3.5 text-xs">
                    {!!summary.commands.length && (
                      <div>
                        <dt className="font-medium text-muted-foreground">
                          {t("Commands to run")}
                        </dt>
                        <dd className="mt-1.5 grid gap-1.5 text-foreground [overflow-wrap:anywhere]">
                          {summary.commands.map((command) => (
                            <div
                              key={command.kind}
                              className="grid grid-cols-[7em_minmax(0,1fr)] items-baseline gap-2"
                              data-iori-command={command.kind}
                            >
                              <span className="text-muted-foreground">
                                {t(commandLabels[command.kind])}
                              </span>
                              <code className="rounded-xs bg-muted px-1.5 py-0.5 font-mono text-xs text-foreground">
                                {command.line}
                              </code>
                            </div>
                          ))}
                        </dd>
                      </div>
                    )}
                    {!!summary.settings.length && (
                      <div data-iori-state="cli-confirm-settings">
                        <dt className="font-medium text-muted-foreground">
                          {t("Settings files to change")}
                        </dt>
                        <dd className="mt-1.5 grid gap-1 text-foreground [overflow-wrap:anywhere]">
                          {summary.settings.map((path) => (
                            <code
                              key={path}
                              className="rounded-xs bg-muted px-1.5 py-0.5 font-mono text-xs"
                            >
                              {path}
                            </code>
                          ))}
                        </dd>
                      </div>
                    )}
                    {!!summary.files.length && (
                      <div data-iori-state="cli-confirm-files">
                        <dt className="font-medium text-muted-foreground">
                          {t("CLI plugins")}
                        </dt>
                        <dd className="mt-1.5 grid gap-1 text-foreground [overflow-wrap:anywhere]">
                          {summary.files.map((file) => (
                            <code
                              key={file}
                              className="rounded-xs bg-muted px-1.5 py-0.5 font-mono text-xs"
                            >
                              {file}
                            </code>
                          ))}
                        </dd>
                      </div>
                    )}
                  </dl>
                )}
                {dialogMessage && (
                  <p
                    className="rounded-md border border-status-failed-border bg-status-failed-bg/35 px-3 py-2 text-xs text-status-failed-text"
                    role="alert"
                  >
                    {dialogMessage}
                  </p>
                )}
              </DialogBody>
            )}
            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                className="max-md:min-h-11 max-md:w-full"
                onClick={onClose}
              >
                {t("Cancel")}
              </Button>
              <Button
                type="button"
                pending={busy}
                className="max-md:min-h-11 max-md:w-full"
                data-iori-action="cli-definition-confirm"
                onClick={onConfirm}
              >
                {t(
                  confirm.kind === "add"
                    ? "Add"
                    : confirm.kind === "replace"
                      ? "Overwrite"
                      : "Save",
                )}
              </Button>
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}

export function CliDefinitionRemovalDialog({
  removal,
  busy,
  dialogMessage,
  onClose,
  onRemove,
}: {
  removal: Removal | null;
  busy: boolean;
  dialogMessage: string;
  onClose: () => void;
  onRemove: () => void;
}) {
  const { t } = useI18n();
  return (
    <Dialog
      open={!!removal}
      onOpenChange={(yes) => {
        if (!yes) onClose();
      }}
    >
      <DialogContent
        className="sm:max-w-md"
        data-iori-view="cli-definition-removal"
        showCloseButton={false}
      >
        {removal && (
          <>
            <DialogHeader className="pr-0">
              <DialogTitle>
                {removal.kind === "delete"
                  ? t("Delete the definition of {name}?").replace(
                      "{name}",
                      removal.name,
                    )
                  : t("Revert to the bundled definition?")}
              </DialogTitle>
              <DialogDescription>
                {t(
                  removal.kind === "delete"
                    ? "Hooks that iori added to settings files are also deleted. The CLI's own settings and conversations, and running Terminals, are not affected."
                    : "The user definition is deleted.",
                )}
              </DialogDescription>
            </DialogHeader>
            {dialogMessage && (
              <p
                className="rounded-md border border-status-failed-border bg-status-failed-bg/35 px-3 py-2 text-xs text-status-failed-text"
                role="alert"
              >
                {dialogMessage}
              </p>
            )}
            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                className="max-md:min-h-11 max-md:w-full"
                onClick={onClose}
              >
                {t("Cancel")}
              </Button>
              <Button
                type="button"
                variant="destructive"
                pending={busy}
                className="max-md:min-h-11 max-md:w-full"
                data-iori-action="cli-definition-remove"
                onClick={onRemove}
              >
                {t(
                  removal.kind === "delete"
                    ? "Delete"
                    : "Revert to the bundled definition",
                )}
              </Button>
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
