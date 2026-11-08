import { useEffect, useRef } from "react";
import { X } from "lucide-react";
import { createPortal } from "react-dom";
import { notices, useNotices, type Notice } from "../../notices.ts";
import { Button } from "../ui/button.tsx";
import { P, rich } from "./Notice.tsx";
import "./flow.css";

export function Toast({
  notice,
  t,
  names,
}: {
  notice: Notice;
  t: (key: string) => string;
  names?: readonly string[];
}) {
  const remaining = useRef(4000);
  const started = useRef(0);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const hovered = useRef(false);
  const start = () => {
    if (notice.detail || hovered.current || timer.current !== undefined) return;
    started.current = Date.now();
    timer.current = setTimeout(() => {
      timer.current = undefined;
      notices.dismiss(notice.key);
    }, remaining.current);
  };
  const pause = () => {
    if (timer.current === undefined) return;
    clearTimeout(timer.current);
    timer.current = undefined;
    remaining.current -= Date.now() - started.current;
  };
  useEffect(() => {
    remaining.current = 4000;
    start();
    return pause;
    // 同じ key の知らせが置き換わった時も、表示時間を初めから数える。
  }, [notice]);
  return (
    <div
      className="host-toast"
      data-iori-view="host-notice"
      data-iori-notice-key={notice.key}
      role="status"
      onPointerEnter={() => {
        hovered.current = true;
        pause();
      }}
      onPointerLeave={() => {
        hovered.current = false;
        start();
      }}
    >
      <div className="host-toast-body">
        <P>
          {notice.text.match(/[^。]+。?/g)?.map((sentence, index) => (
            <span className="host-toast-sentence" key={index}>
              {rich(sentence, names)}
            </span>
          ))}
        </P>
        {notice.detail && (
          <Button
            data-iori-action="host-notice-details"
            variant="outline"
            size="sm"
            onClick={() => {
              notices.dismiss(notice.key);
              notice.detail?.open();
            }}
          >
            {t("Details")}
          </Button>
        )}
      </div>
      {notice.dismissible !== false && (
        <Button
          className="host-toast-close"
          data-iori-action="host-notice-close"
          variant="ghost"
          size="icon-sm"
          aria-label={t("Close")}
          onClick={() => {
            notices.dismiss(notice.key);
            notice.onClose?.();
          }}
        >
          <X />
        </Button>
      )}
    </div>
  );
}
export function NoticeStack({
  t,
  names,
}: {
  t: (key: string) => string;
  names?: readonly string[];
}) {
  const items = useNotices();
  return createPortal(
    <div className="host-notice-stack">
      {items.map((notice) => (
        <Toast key={notice.key} notice={notice} t={t} names={names} />
      ))}
    </div>,
    document.body,
  );
}
