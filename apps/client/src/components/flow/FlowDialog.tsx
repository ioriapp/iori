import { useEffect, useRef, type ReactNode } from "react";
import { Button } from "../ui/button.tsx";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "../ui/dialog.tsx";
import { rich } from "./Notice.tsx";
import "./flow.css";

export type FooterSpec = {
  focusCancel?: boolean;
  note?: string;
  cancel?: string;
  cancelDisabled?: boolean;
  primary?: string | null;
  primaryDisabled?: boolean;
  primaryOutline?: boolean;
  secondary?: { label: string; variant?: "destructive"; onClick: () => void };
  onCancel?: () => void;
  onPrimary?: () => void;
};

export function FlowDialog({
  kind,
  title,
  description,
  fields,
  panel,
  footer,
  t,
  names,
  open = true,
  onOpenChange,
}: {
  kind: "setup" | "uninstall";
  title: string;
  description?: ReactNode;
  fields?: ReactNode;
  panel: ReactNode;
  footer: FooterSpec;
  t: (key: string) => string;
  names?: readonly string[];
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
}) {
  const cancelRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (open && footer.focusCancel) cancelRef.current?.focus();
  }, [open, footer.focusCancel]);
  const cleanup = useRef<(() => void) | undefined>(undefined);
  const panelRef = (element: HTMLDivElement | null) => {
    cleanup.current?.();
    cleanup.current = undefined;
    if (!element) return;
    const update = () => {
      element.dataset.overflow = String(
        element.scrollTop + element.clientHeight < element.scrollHeight - 1,
      );
    };
    const observer = new ResizeObserver(update);
    observer.observe(element);
    for (const child of element.children) observer.observe(child);
    element.addEventListener("scroll", update);
    const frame = requestAnimationFrame(update);
    cleanup.current = () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
      element.removeEventListener("scroll", update);
    };
  };
  const variant = footer.primaryOutline
    ? "outline"
    : kind === "uninstall"
      ? "destructive"
      : "default";
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className={`worktree-create-dialog dialog-full-screen host-flow-dialog is-${kind}`}
        data-iori-view={
          kind === "setup" ? "host-setup" : "host-maintenance-confirmation"
        }
        showCloseButton={false}
        onOpenAutoFocus={(event) => {
          if (footer.focusCancel) {
            event.preventDefault();
            cancelRef.current?.focus();
          }
        }}
      >
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription className="host-desc">
            {rich(description, names)}
          </DialogDescription>
        </DialogHeader>
        <div className="host-flow-fields">{fields}</div>
        <div className="host-flow-panel" ref={panelRef}>
          {panel}
        </div>
        <DialogFooter>
          {footer.note && (
            <span className="host-footer-note" role="status">
              {footer.note}
            </span>
          )}
          <Button
            data-iori-action={
              kind === "setup" ? "ssh-cancel" : "host-maintenance-close"
            }
            ref={cancelRef}
            variant="outline"
            size="lg"
            disabled={footer.cancelDisabled}
            onClick={footer.onCancel}
          >
            {footer.cancel ?? t("Cancel")}
          </Button>
          {footer.secondary && (
            <Button
              data-iori-action="host-uninstall-without-ssh"
              variant={footer.secondary.variant ?? "outline"}
              size="lg"
              onClick={footer.secondary.onClick}
            >
              {footer.secondary.label}
            </Button>
          )}
          {footer.primary !== null && (
            <Button
              size="lg"
              data-iori-action={
                kind === "setup" ? "setup-submit" : "host-maintenance-confirm"
              }
              variant={variant}
              disabled={footer.primaryDisabled}
              onClick={footer.onPrimary}
            >
              {footer.primary ?? t(kind === "setup" ? "Install" : "Uninstall")}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export { FlowDialog as DialogShell };
