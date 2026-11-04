import { useCallback, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { terminalRequest, TerminalRequestError } from "./terminal-api.ts";

type Pending = { connectionId: string; terminalId: string; command?: string };

/**
 * "Close" for a Terminal: ends its process and removes its screen, history and
 * row. The Host asks for one confirmation while a command is running. The same
 * operation id is reused for the confirmed request, and a failure is reported
 * beside the Terminal instead of being retried.
 */
export function useTerminalClose({
  onClosed,
  onRefresh,
  t,
}: {
  onClosed: (terminalId: string) => void;
  onRefresh: () => void;
  t: (key: string) => string;
}) {
  const [confirmation, setConfirmation] = useState<Pending>();
  const [busy, setBusy] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const operationIds = useRef(new Map<string, string>());

  const close = useCallback(
    async (connectionId: string, terminalId: string, confirm: boolean) => {
      const operationId =
        operationIds.current.get(terminalId) ?? crypto.randomUUID();
      operationIds.current.set(terminalId, operationId);
      setBusy(true);
      setErrors(({ [terminalId]: _removed, ...rest }) => rest);
      try {
        const result = await terminalRequest(
          connectionId,
          "terminal.close",
          { terminalId, ...(confirm ? { confirm: true } : {}) },
          operationId,
        );
        if (result.confirmationRequired === true && !confirm) {
          setConfirmation({
            connectionId,
            terminalId,
            command: result.command,
          });
          return;
        }
        operationIds.current.delete(terminalId);
        setConfirmation(undefined);
        onClosed(terminalId);
      } catch (error) {
        if (!(error instanceof TerminalRequestError)) {
          setConfirmation(undefined);
          onRefresh();
          return;
        }
        setErrors((current) => ({
          ...current,
          [terminalId]: t(
            "Could not close this terminal. Choose Close terminal again.",
          ),
        }));
      } finally {
        setBusy(false);
      }
    },
    [onClosed, onRefresh, t],
  );

  const request = useCallback(
    (connectionId: string, terminalId: string) =>
      void close(connectionId, terminalId, false),
    [close],
  );

  const cancel = () => {
    if (confirmation) operationIds.current.delete(confirmation.terminalId);
    setConfirmation(undefined);
  };

  const dialog = (
    <Dialog
      open={Boolean(confirmation)}
      onOpenChange={(open) => {
        if (!open && !busy) cancel();
      }}
    >
      <DialogContent
        data-iori-dialog="terminal-close-confirmation"
        showCloseButton={false}
      >
        <DialogHeader>
          <DialogTitle>
            {confirmation?.command
              ? t("{command} is running").replace(
                  "{command}",
                  () => confirmation.command!,
                )
              : t("A command is running")}
          </DialogTitle>
          <DialogDescription>
            {t(
              "Closing this terminal will stop its process and remove its saved screen.",
            )}
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button
            variant="outline"
            data-iori-action="terminal-cancel-close"
            disabled={busy}
            onClick={cancel}
          >
            {t("Cancel")}
          </Button>
          <Button
            variant="destructive"
            data-iori-action="terminal-confirm-close"
            pending={busy}
            onClick={() =>
              confirmation &&
              void close(
                confirmation.connectionId,
                confirmation.terminalId,
                true,
              )
            }
          >
            {t("Close terminal")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );

  return { request, busy, errors, dialog };
}
