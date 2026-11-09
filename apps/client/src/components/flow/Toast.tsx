import { useEffect, useRef, useState } from "react";
import { ChevronDown, X } from "lucide-react";
import { createPortal } from "react-dom";
import { notices, useNotices, type Notice } from "../../notices.ts";
import { Button } from "../ui/button.tsx";
import { MiddleEllipsis } from "../../MiddleEllipsis.tsx";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "../ui/collapsible.tsx";
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
  const scroll = useRef<HTMLDivElement>(null);
  const [overflow, setOverflow] = useState(false);
  useEffect(() => {
    const node = scroll.current;
    if (!node) return;
    const update = () =>
      setOverflow(node.scrollTop + node.clientHeight < node.scrollHeight - 1);
    const observer = new ResizeObserver(update);
    observer.observe(node);
    Array.from(node.children).forEach((child) => observer.observe(child));
    node.addEventListener("scroll", update);
    update();
    return () => {
      observer.disconnect();
      node.removeEventListener("scroll", update);
    };
  }, [notice]);
  const remaining = useRef(4000);
  const started = useRef(0);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const hovered = useRef(false);
  const start = () => {
    if (
      notice.persistent ||
      notice.detail ||
      hovered.current ||
      timer.current !== undefined
    )
      return;
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
      className={`host-toast ${notice.removalFailure ? "removal-toast" : ""}`}
      data-iori-removal-failure={notice.removalFailure || undefined}
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
        {notice.title && (
          <p className="removal-toast-title" title={notice.title}>
            {notice.titleName
              ? (() => {
                  const at = notice.titleName.at;
                  if (at < 0) return notice.title;
                  return (
                    <>
                      <span className="removal-template-affix">
                        {notice.title.slice(0, at)}
                      </span>
                      <span
                        className="removal-inline-name"
                        data-iori-fitted-name={notice.titleName.text}
                      >
                        <MiddleEllipsis
                          text={notice.titleName.text}
                          className="removal-fitted-name"
                        />
                      </span>
                      <span className="removal-template-affix">
                        {notice.title.slice(at + notice.titleName.text.length)}
                      </span>
                    </>
                  );
                })()
              : notice.title}
          </p>
        )}
        <div
          className="host-toast-scroll host-flow-panel"
          ref={scroll}
          data-overflow={overflow}
        >
          {notice.text && (
            <P>
              {notice.text.match(/[^。]+。?/g)?.map((sentence, index) => (
                <span className="host-toast-sentence" key={index}>
                  {rich(sentence, names)}
                </span>
              ))}
            </P>
          )}
          {notice.items?.map((item, index) => (
            <div className="removal-failure" key={index}>
              {item.name && (
                <p className="removal-failure-name" title={item.name}>
                  <span
                    className="removal-inline-name"
                    data-iori-fitted-name={item.name}
                  >
                    <MiddleEllipsis
                      text={item.name}
                      className="removal-fitted-name"
                    />
                  </span>
                </p>
              )}
              <p className="removal-reason">{item.reason}</p>
              {item.stopped && (
                <p className="removal-stopped">{item.stopped}</p>
              )}
              {item.gitOutput && <NoticeOriginal text={item.gitOutput} t={t} />}
            </div>
          ))}
        </div>
        {notice.action && (
          <Button
            variant="outline"
            size="sm"
            data-iori-action={
              notice.removalFailure ? "worktree-removal-retry" : undefined
            }
            onClick={() => {
              notices.dismiss(notice.key);
              notice.action?.run();
            }}
          >
            {notice.action.label}
          </Button>
        )}
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
  useEffect(() => {
    const update = () => {
      const bands = [
        ...document.querySelectorAll<HTMLElement>(
          ".status-bar, .mobile-terminal-controls",
        ),
      ].filter((node) => node.getClientRects().length > 0);
      const top = Math.min(
        window.innerHeight,
        ...bands.map((node) => node.getBoundingClientRect().top),
      );
      document.documentElement.style.setProperty(
        "--removal-lower-bands-height",
        `${window.innerHeight - top}px`,
      );
    };
    const resize = new ResizeObserver(update);
    const observe = () => {
      resize.disconnect();
      document
        .querySelectorAll(".status-bar, .mobile-terminal-controls")
        .forEach((node) => resize.observe(node));
      update();
    };
    const mutation = new MutationObserver((records) => {
      if (
        records.some((record) =>
          [...record.addedNodes, ...record.removedNodes].some(
            (node) =>
              node instanceof Element &&
              (node.matches(".status-bar, .mobile-terminal-controls") ||
                node.querySelector(".status-bar, .mobile-terminal-controls")),
          ),
        )
      )
        observe();
    });
    mutation.observe(document.body, { childList: true, subtree: true });
    window.addEventListener("resize", update);
    observe();
    return () => {
      resize.disconnect();
      mutation.disconnect();
      window.removeEventListener("resize", update);
      document.documentElement.style.removeProperty(
        "--removal-lower-bands-height",
      );
    };
  }, []);
  return createPortal(
    <div className="host-notice-stack">
      {items.map((notice) => (
        <Toast key={notice.key} notice={notice} t={t} names={names} />
      ))}
    </div>,
    document.body,
  );
}

export function NoticeOriginal({
  text,
  t,
  reserve = false,
}: {
  text: string;
  t: (key: string) => string;
  reserve?: boolean;
}) {
  return (
    <Collapsible className="host-ssh-original">
      <CollapsibleTrigger asChild>
        <Button
          variant="outline"
          size="sm"
          className="host-ssh-original-trigger"
        >
          {t("Details")}
          <ChevronDown />
        </Button>
      </CollapsibleTrigger>
      <div className={reserve ? "removal-original-slot" : undefined}>
        <CollapsibleContent>
          <pre className="host-setup-original">{text}</pre>
        </CollapsibleContent>
      </div>
    </Collapsible>
  );
}
