import { useEffect, useRef, useState } from "react";
import QRCode from "qrcode";
import { XIcon } from "lucide-react";
import { inviteQrSegments, type Invite } from "@iori/protocol";
import { Button } from "./components/ui/button.tsx";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogTitle,
} from "./components/ui/dialog.tsx";

function QrImage({
  url,
  modules,
  fullscreen,
}: {
  url: string;
  modules: number;
  fullscreen?: boolean;
}) {
  const container = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState(0);
  useEffect(() => {
    const element = container.current;
    if (!element) return;
    const observer = new ResizeObserver(() => {
      const header = element.parentElement?.querySelector<HTMLElement>(
        ".invitation-qr-dialog-header",
      );
      const available = fullscreen
        ? Math.min(
            window.innerWidth - 48,
            window.innerHeight - 48 - (header?.clientHeight ?? 0),
          )
        : element.clientWidth;
      setSize(Math.floor(available / modules) * modules);
    });
    observer.observe(fullscreen ? document.documentElement : element);
    if (fullscreen) {
      const header = element.parentElement?.querySelector<HTMLElement>(
        ".invitation-qr-dialog-header",
      );
      if (header) observer.observe(header);
    }
    return () => observer.disconnect();
  }, [fullscreen, modules]);
  return (
    <div
      ref={container}
      className={
        fullscreen ? "invitation-qr-dialog-area" : "invitation-qr-container"
      }
    >
      {size > 0 && (
        <img
          className="invitation-qr"
          src={url}
          alt=""
          width={size}
          height={size}
        />
      )}
    </div>
  );
}

export function InviteQr({
  invite,
  t,
  onNestedBack,
}: {
  invite: Invite;
  t: (key: string) => string;
  onNestedBack: (close?: () => void) => void;
}) {
  const [qr, setQr] = useState<{ url: string; modules: number }>();
  const [open, setOpen] = useState(false);
  useEffect(() => {
    if (!open) return;
    onNestedBack(() => setOpen(false));
    return () => onNestedBack(undefined);
  }, [onNestedBack, open]);
  useEffect(() => {
    let active = true;
    void Promise.resolve()
      .then(async () => {
        const segments = inviteQrSegments(invite);
        const modules =
          QRCode.create(segments, { errorCorrectionLevel: "M" }).modules.size +
          8;
        const url = await QRCode.toDataURL(segments, {
          scale: 1,
          margin: 4,
          errorCorrectionLevel: "M",
        });
        if (active) setQr({ url, modules });
      })
      .catch(() => {
        if (active) setQr(undefined);
      });
    return () => {
      active = false;
    };
  }, [invite]);
  if (!qr) return null;
  return (
    <>
      <button
        type="button"
        className="invitation-qr-button invitation-qr-container"
        aria-label={t("Enlarge QR code")}
        title={t("Enlarge QR code")}
        onClick={() => setOpen(true)}
      >
        <QrImage {...qr} />
      </button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent
          className="invitation-qr-dialog"
          showCloseButton={false}
          aria-describedby={undefined}
          onClick={(event) => {
            if (
              event.target === event.currentTarget ||
              (event.target as HTMLElement).classList.contains(
                "invitation-qr-dialog-area",
              )
            )
              setOpen(false);
          }}
        >
          <DialogTitle className="sr-only">{t("Invitation")}</DialogTitle>
          <div className="invitation-qr-dialog-header" />
          <DialogClose asChild>
            <Button
              variant="ghost"
              className="absolute top-2 right-2"
              size="icon-sm"
              aria-label={t("Close")}
            >
              <XIcon aria-hidden="true" />
            </Button>
          </DialogClose>
          <QrImage {...qr} fullscreen />
        </DialogContent>
      </Dialog>
    </>
  );
}
