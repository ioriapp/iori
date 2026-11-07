import { useRef, useState } from "react";
import { native } from "./native.ts";
import { ErrorMessage } from "./Settings.tsx";
import { Button } from "./components/ui/button.tsx";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "./components/ui/dialog.tsx";

export function ClientInitialization({
  error,
  t,
  onRetry,
  onReset,
}: {
  error?: string;
  t: (key: string) => string;
  onRetry: () => Promise<void>;
  onReset: () => Promise<void>;
}) {
  const [confirm, setConfirm] = useState(false);
  const [resetError, setResetError] = useState(false);
  const [resetting, setResetting] = useState(false);
  const resetButton = useRef<HTMLButtonElement>(null);
  const canReset =
    error === "Cannot read iori's key from the system keyring." ||
    error === "Cannot read iori's key on this device.";
  async function reset() {
    setResetting(true);
    setResetError(false);
    try {
      await native.resetRegistration();
      setConfirm(false);
      await onReset();
    } catch {
      setResetError(true);
    } finally {
      setResetting(false);
    }
  }
  return (
    <main className="onboarding-screen" data-iori-view="initializing">
      <section className="onboarding-panel">
        <span className="app-wordmark">iori</span>
        <ErrorMessage message={error ? t(error) : undefined} />
        {canReset && (
          <p className="onboarding-guidance">
            {t(
              "To use iori on this device again, reset its registration. You will need to register with each Host again from its invitation.",
            )}
          </p>
        )}
        {error && (
          <div className="initialization-actions flex flex-wrap gap-2">
            <Button
              onClick={() => void onRetry()}
              data-iori-action="retry-initial"
            >
              {t("Retry")}
            </Button>
            {canReset && (
              <Button
                ref={resetButton}
                variant="destructive"
                onClick={() => {
                  setResetError(false);
                  setConfirm(true);
                }}
                data-iori-action="reset-registration"
              >
                {t("Reset registration…")}
              </Button>
            )}
          </div>
        )}
      </section>
      <Dialog
        open={confirm}
        onOpenChange={(open) => {
          if (!resetting) setConfirm(open);
        }}
      >
        <DialogContent
          className="registration-reset-dialog"
          showCloseButton={false}
          onCloseAutoFocus={(event) => {
            event.preventDefault();
            resetButton.current?.focus();
          }}
        >
          <DialogHeader>
            <DialogTitle>{t("Reset this device's registration?")}</DialogTitle>
            <DialogDescription>
              {t(
                "This deletes the list of Hosts and the settings saved on this device. To connect to a Host, register again from its invitation.",
              )}
            </DialogDescription>
          </DialogHeader>
          <div
            className={resetError ? undefined : "invisible"}
            aria-hidden={!resetError}
          >
            <ErrorMessage
              message={t(
                "Could not reset this device's registration. Reset it again.",
              )}
            />
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              disabled={resetting}
              onClick={() => setConfirm(false)}
            >
              {t("Cancel")}
            </Button>
            <Button
              variant="destructive"
              pending={resetting}
              onClick={() => void reset()}
              data-iori-action="confirm-reset-registration"
            >
              {t("Reset")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </main>
  );
}
