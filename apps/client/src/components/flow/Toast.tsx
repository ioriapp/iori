import { useEffect, useRef, useState } from "react";
import { cn } from "cn";
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
import { acquireLowerBandInset } from "./lower-band-inset.ts";
import { P, rich } from "./Notice.tsx";

const inlineFittedNameClass =
  "relative inline-block min-w-0 max-w-full flex-[0_1_auto] overflow-hidden whitespace-nowrap before:invisible before:pe-px before:content-[attr(data-iori-fitted-name)] [&>span]:absolute [&>span]:inset-0 [&>span]:w-full";

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
      className={cn(
        "relative flex max-w-full items-start gap-2 rounded-lg border border-border bg-popover py-3 pr-2 pl-3.5 text-sm text-popover-foreground shadow-md [word-break:auto-phrase]",
        "max-[700px]:[&_[data-slot=button]]:relative max-[700px]:[&_[data-slot=button]]:before:absolute max-[700px]:[&_[data-slot=button]]:before:top-1/2 max-[700px]:[&_[data-slot=button]]:before:left-1/2 max-[700px]:[&_[data-slot=button]]:before:h-11 max-[700px]:[&_[data-slot=button]]:before:w-[max(100%,2.75rem)] max-[700px]:[&_[data-slot=button]]:before:-translate-x-1/2 max-[700px]:[&_[data-slot=button]]:before:-translate-y-1/2 max-[700px]:[&_[data-slot=button]]:before:content-['']",
        notice.removalFailure &&
          "pointer-events-auto w-[26.25rem] min-w-0 max-[700px]:w-full",
      )}
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
      <div className="flex min-h-0 max-h-[calc(100dvh-var(--removal-lower-bands-height,1.375rem)-4rem)] min-w-0 flex-1 flex-col gap-2 max-md:max-h-[calc(100dvh-var(--removal-lower-bands-height,1.375rem)-3.5rem)] [&>*]:min-w-0 [&>[data-slot=button]]:flex-none [&>[data-slot=button]]:self-end">
        {notice.title && (
          <p
            className="m-0 flex flex-none items-baseline pr-7 font-semibold"
            title={notice.title}
          >
            {notice.titleName
              ? (() => {
                  const at = notice.titleName.at;
                  if (at < 0) return notice.title;
                  return (
                    <>
                      <span className="flex-none whitespace-pre">
                        {notice.title.slice(0, at)}
                      </span>
                      <span
                        className={cn(inlineFittedNameClass, "font-semibold")}
                        data-iori-fitted-name={notice.titleName.text}
                      >
                        <MiddleEllipsis
                          text={notice.titleName.text}
                          className="block truncate"
                        />
                      </span>
                      <span className="flex-none whitespace-pre">
                        {notice.title.slice(at + notice.titleName.text.length)}
                      </span>
                    </>
                  );
                })()
              : notice.title}
          </p>
        )}
        <div
          className={cn(
            "grid min-h-0 flex-[0_1_auto] gap-4 overflow-y-auto overscroll-contain p-0",
            "data-[overflow=true]:[mask-image:linear-gradient(to_bottom,var(--foreground)_calc(100%-2rem),transparent)]",
            "[&>p]:m-0 [&>p]:flex-none [&>p]:pr-7",
          )}
          ref={scroll}
          data-overflow={overflow}
        >
          {notice.text && (
            <P>
              {notice.text.match(/[^。]+。?/g)?.map((sentence, index) => (
                <span className="max-[700px]:block" key={index}>
                  {rich(sentence, names)}
                </span>
              ))}
            </P>
          )}
          {notice.items?.map((item, index) => (
            <div
              className="grid min-w-0 grid-cols-[minmax(0,1fr)] gap-1"
              key={index}
            >
              {item.name && (
                <p className="m-0 flex flex-none font-medium" title={item.name}>
                  <span
                    className={cn(inlineFittedNameClass, "font-medium")}
                    data-iori-fitted-name={item.name}
                  >
                    <MiddleEllipsis
                      text={item.name}
                      className="block truncate"
                    />
                  </span>
                </p>
              )}
              <p className="m-0 flex-none leading-relaxed [overflow-wrap:anywhere]">
                {item.reason}
              </p>
              {item.stopped && (
                <p className="m-0 flex-none text-muted-foreground">
                  {item.stopped}
                </p>
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
          className="absolute top-2 right-2 m-0 shrink-0"
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
  useEffect(() => acquireLowerBandInset(), []);
  return createPortal(
    <div
      className={cn(
        "fixed right-4 bottom-4 z-(--z-toast) grid max-w-[min(26.25rem,calc(100vw-2rem))] gap-2",
        "max-[700px]:right-2 max-[700px]:bottom-2 max-[700px]:left-2 max-[700px]:max-w-none",
        "has-[>[data-iori-removal-failure=true]]:bottom-[calc(var(--removal-lower-bands-height,1.375rem)+1rem)]",
        "max-md:has-[>[data-iori-removal-failure=true]]:bottom-[calc(var(--removal-lower-bands-height,1.375rem)+0.5rem)]",
      )}
    >
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
    <Collapsible className="grid gap-1.5">
      <CollapsibleTrigger asChild>
        <Button
          variant="outline"
          size="sm"
          className="justify-self-start text-muted-foreground [&[data-state=open]_svg]:rotate-180"
        >
          {t("Details")}
          <ChevronDown
            className="size-3.5 transition-transform"
            aria-hidden="true"
          />
        </Button>
      </CollapsibleTrigger>
      <div
        className={
          reserve
            ? "h-[min(6lh,30dvh)] min-h-0 overflow-y-auto text-xs leading-normal"
            : undefined
        }
      >
        <CollapsibleContent>
          <pre className="m-0 rounded-md border border-border-subtle bg-muted/40 px-2.5 py-2 font-mono text-xs leading-normal whitespace-pre-wrap [overflow-wrap:anywhere] text-muted-foreground [font-variant-ligatures:none]">
            {text}
          </pre>
        </CollapsibleContent>
      </div>
    </Collapsible>
  );
}
