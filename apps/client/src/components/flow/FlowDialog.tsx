import { useEffect, useRef, type ReactNode } from "react";
import { cn } from "cn";
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
        className={cn(
          "dialog-full-screen grid max-h-[calc(100dvh-1.5rem)] w-[min(35rem,calc(100vw-1.5rem))] max-w-[calc(100vw-1.5rem)] gap-4 overflow-hidden text-sm [word-break:auto-phrase] sm:max-w-[35rem]",
          "max-md:h-dvh max-md:max-h-dvh max-md:w-full max-md:max-w-full max-md:border-0",
          "max-md:[&_[data-slot=button]]:min-h-11 max-md:[&_[data-slot=input]]:min-h-11 max-md:[&_[data-slot=tabs-trigger]]:min-h-11 max-md:[&_[data-slot=toggle-group-item]]:min-h-11",
          "[&_code]:[font-variant-ligatures:none] [&_pre]:[font-variant-ligatures:none]",
          kind === "setup"
            ? "h-[min(43.75rem,calc(100dvh-1.5rem))] grid-rows-[auto_auto_minmax(0,1fr)_auto]"
            : "h-[min(36.25rem,calc(100dvh-1.5rem))] grid-rows-[auto_minmax(0,1fr)_auto]",
        )}
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
        <DialogHeader className="min-w-0 pr-0">
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription className="min-h-[1lh] [overflow-wrap:anywhere]">
            {rich(description, names)}
          </DialogDescription>
        </DialogHeader>
        <div
          className={cn(
            "min-w-0 empty:-mt-4",
            kind === "uninstall" && "hidden",
          )}
        >
          {fields}
        </div>
        <div
          className={cn(
            "grid min-h-0 min-w-0 content-start gap-3 overflow-y-auto text-sm",
            "data-[overflow=true]:[mask-image:linear-gradient(to_bottom,var(--foreground)_calc(100%-2rem),transparent)]",
            "has-[>[data-iori-view=host-progress]]:grid-rows-[minmax(0,1fr)] has-[>[data-iori-view=host-progress]]:content-stretch",
          )}
          ref={panelRef}
        >
          {panel}
        </div>
        <DialogFooter className="flex-wrap items-center max-md:items-stretch">
          {footer.note && (
            <span
              className="mr-auto text-xs text-muted-foreground max-md:order-99 max-md:mr-0 max-md:text-center"
              role="status"
            >
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
