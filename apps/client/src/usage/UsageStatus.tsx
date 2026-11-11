import { useEffect, useLayoutEffect, useRef, useState } from "react";
import type { CSSProperties } from "react";
import { RefreshCw } from "lucide-react";
import type { CliSummary, CliUsage } from "@iori/protocol";
import { CliIcon } from "../CliIcon.tsx";
import { Button } from "../components/ui/button.tsx";
import { Progress } from "../components/ui/progress.tsx";
import {
  Popover,
  PopoverTrigger,
  PopoverContent,
} from "../components/ui/popover.tsx";
import { useCliList } from "../cli-list.ts";
import {
  formatUsageLength,
  formatUsageDuration,
  formatUpdatedAt,
} from "../usage-format.ts";
import { useUsagePreferences } from "./preferences.tsx";
import { refreshUsage, useUsageRefresh } from "./refresh.ts";
import "./usage-status.css";
type Shape = "circle" | "bar";
type Display = "remaining" | "used";
type Language = string;
type UsageWindow = CliUsage["windows"][number];
type Cli = CliSummary & { windows: UsageWindow[]; hostKey: string };
const hoverDelay = /Mac/.test(navigator.platform) ? 1500 : 500;
const allUsage = (language: string) =>
  language.toLowerCase().startsWith("ja") ? "利用枠" : "Usage";
const percentage = (window: UsageWindow, display: Display) =>
  Math.round(
    display === "remaining" ? window.remaining : 100 - window.remaining,
  );
function resetLabel(at: number, language: string) {
  const minutes = Math.max(0, Math.ceil((at - Date.now()) / 60000));
  const date = new Intl.DateTimeFormat(
    language.toLowerCase().startsWith("ja") ? "ja-JP" : "en-US",
    {
      ...(minutes >= 1440
        ? ({
            month: language.toLowerCase().startsWith("ja")
              ? "numeric"
              : "short",
            day: "numeric",
          } as const)
        : {}),
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    },
  ).format(at);
  return `resets ${formatUsageDuration(minutes)} · ${date}`;
}
function strictest(cli: Cli) {
  return cli.windows.reduce((worst, window) =>
    window.remaining < worst.remaining ? window : worst,
  );
}
function usageLabel(cli: Cli, language: Language, display: Display) {
  const window = strictest(cli);
  const label =
    (window.name ? window.name + " " : "") +
    formatUsageLength(window.minutes) +
    " " +
    percentage(window, display) +
    "% " +
    (display === "remaining" ? "left" : "used");
  return (
    (language.toLowerCase().startsWith("ja")
      ? `${cli.name}の利用枠 `
      : `${cli.name} usage `) + label
  );
}
function tone(window: UsageWindow) {
  return window.remaining === 0
    ? "var(--status-failed)"
    : window.remaining <= 20
      ? "var(--status-waiting)"
      : "var(--muted-foreground)";
}
function numberTone(window: UsageWindow) {
  return window.remaining === 0
    ? "var(--status-failed-text)"
    : window.remaining <= 20
      ? "var(--status-waiting-text)"
      : undefined;
}
function Graph({
  window,
  shape,
  display,
  detail = false,
}: {
  window: UsageWindow;
  shape: Shape;
  display: Display;
  detail?: boolean;
}) {
  const value = percentage(window, display);
  const track =
    window.remaining === 0
      ? "color-mix(in oklch, var(--status-failed) 35%, transparent)"
      : "color-mix(in oklch, var(--muted-foreground) 35%, transparent)";
  const style = {
    "--usage-color": tone(window),
    "--usage-track": track,
  } as CSSProperties;
  return shape === "circle" ? (
    <svg
      className={"usage-ring" + (detail ? " detail" : "")}
      viewBox="0 0 16 16"
      aria-hidden="true"
      style={style}
    >
      <circle cx="8" cy="8" r="6" className="usage-ring-track" />
      <circle
        cx="8"
        cy="8"
        r="6"
        className="usage-ring-fill"
        pathLength="100"
        strokeDasharray={`${value} 100`}
        transform="rotate(-90 8 8)"
      />
    </svg>
  ) : (
    <span
      className={"usage-bar" + (detail ? " detail" : "")}
      aria-hidden="true"
      style={style}
    >
      <Progress value={value} />
    </span>
  );
}
function RefreshUsage({
  language,
  busy,
  onRefresh,
}: {
  language: Language;
  busy: boolean;
  onRefresh: () => void;
}) {
  const label = language.toLowerCase().startsWith("ja")
    ? "利用枠を更新"
    : "Refresh usage";
  return (
    <Button
      variant="ghost"
      size="icon"
      disabled={busy}
      aria-busy={busy || undefined}
      aria-label={label}
      title={label}
      onClick={onRefresh}
    >
      <RefreshCw
        size={14}
        className={busy ? "animate-spin motion-reduce:animate-none" : undefined}
      />
    </Button>
  );
}
function UsageDetail({
  cli,
  shape,
  display,
  language,
  updatedAt,
  refresh,
}: {
  cli: Cli;
  shape: Shape;
  display: Display;
  language: Language;
  updatedAt?: number;
  refresh?: { busy: boolean; onRefresh: () => void };
}) {
  return (
    <section className="usage-detail">
      <div className="usage-detail-heading">
        <h2>
          <CliIcon cli={cli} hostKey={cli.hostKey} size={16} />
          {cli.name}
        </h2>
        {refresh && (
          <RefreshUsage
            language={language}
            busy={refresh.busy}
            onRefresh={refresh.onRefresh}
          />
        )}
      </div>
      {updatedAt !== undefined && (
        <p className="usage-updated">{formatUpdatedAt(updatedAt, language)}</p>
      )}
      {cli.windows.map((window, index) => (
        <div className={"usage-window " + shape} key={index}>
          <div className="usage-window-line">
            <span className="usage-window-name">
              {window.name ? window.name + " " : ""}
              {formatUsageLength(window.minutes)}
            </span>
            <Graph window={window} shape={shape} display={display} detail />
            <span
              className="usage-window-percentage"
              style={{ color: numberTone(window) }}
            >
              {percentage(window, display)}%{" "}
              {display === "remaining" ? "left" : "used"}
            </span>
          </div>
          {window.resetsAt !== undefined && (
            <p className="usage-reset">
              {resetLabel(window.resetsAt, language)}
            </p>
          )}
        </div>
      ))}
    </section>
  );
}

function UsagePopup({
  clis,
  shape,
  display,
  language,
  maxHeight,
  mobile,
  all = false,
  takeFocus = false,
  updatedAt,
  refreshing,
  onRefresh,
  onEnter,
  onLeave,
}: {
  clis: Cli[];
  shape: Shape;
  display: Display;
  language: Language;
  maxHeight: number;
  mobile: boolean;
  all?: boolean;
  takeFocus?: boolean;
  updatedAt: Record<string, number | undefined>;
  refreshing: string[];
  onRefresh: (names: string[]) => Promise<void>;
  onEnter?: () => void;
  onLeave?: () => void;
}) {
  const isAll = all || mobile || clis.length > 1;
  const bodyLimit = maxHeight - (isAll ? 48 : 0);
  const [body, setBody] = useState<HTMLDivElement | null>(null);
  const restoreFocus = useRef(false);
  const [, redrawTime] = useState(0);
  useEffect(() => {
    if (!body) return;
    const timer = setInterval(() => redrawTime((value) => value + 1), 60000);
    return () => clearInterval(timer);
  }, [body]);
  useLayoutEffect(() => {
    if (!body || !takeFocus) return;
    restoreFocus.current = true;
    const root = body.closest<HTMLElement>(".usage-status-popover")!;
    (
      root.querySelector<HTMLButtonElement>("button:not(:disabled)") ?? root
    ).focus();
  }, [body, takeFocus]);
  const [height, setHeight] = useState<number>();
  const [more, setMore] = useState(false);
  useLayoutEffect(() => {
    const element = body;
    if (!element) return;
    const fit = () => {
      const rows = [...element.querySelectorAll<HTMLElement>(".usage-detail")];
      const style = getComputedStyle(element);
      const padding =
        parseFloat(style.paddingTop) + parseFloat(style.paddingBottom);
      const rowHeight = (row: HTMLElement) =>
        row.getBoundingClientRect().height +
        parseFloat(getComputedStyle(row).marginTop);
      const natural =
        rows.reduce((sum, row) => sum + rowHeight(row), 0) + padding;
      let used = padding;
      if (natural > bodyLimit) {
        for (const row of rows) {
          const next = used + rowHeight(row);
          if (next > bodyLimit) break;
          used = next;
        }
        setHeight(used > padding ? used : undefined);
      } else setHeight(undefined);
      setMore(
        element.scrollTop + element.clientHeight < element.scrollHeight - 1,
      );
    };
    fit();
    const observer = new ResizeObserver(fit);
    observer.observe(element);
    for (const row of element.querySelectorAll<HTMLElement>(".usage-detail"))
      observer.observe(row);
    return () => observer.disconnect();
  }, [body, bodyLimit, clis, shape, display, language]);
  return (
    <PopoverContent
      className="usage-status-popover"
      data-mobile={mobile || undefined}
      side="top"
      align="end"
      collisionPadding={10}
      sideOffset={10}
      style={{ maxHeight }}
      onPointerEnter={onEnter}
      onPointerLeave={onLeave}
      onOpenAutoFocus={(event) => {
        restoreFocus.current = takeFocus;
        event.preventDefault();
      }}
      onCloseAutoFocus={(event) => {
        if (!restoreFocus.current) event.preventDefault();
      }}
      aria-label={
        isAll ? allUsage(language) : usageLabel(clis[0], language, display)
      }
    >
      {isAll && (
        <div className="usage-popup-global-heading">
          <h2>{allUsage(language)}</h2>
          <RefreshUsage
            language={language}
            busy={clis.some((cli) => refreshing.includes(cli.id))}
            onRefresh={() => void onRefresh(clis.map((cli) => cli.id))}
          />
        </div>
      )}
      <div
        className="usage-popup-scroll"
        ref={setBody}
        style={{ maxHeight: bodyLimit, height }}
        data-more={more || undefined}
        onScroll={(event) => {
          const element = event.currentTarget;
          setMore(
            element.scrollTop + element.clientHeight < element.scrollHeight - 1,
          );
        }}
      >
        {clis.map((cli) => (
          <UsageDetail
            key={cli.id}
            cli={cli}
            shape={shape}
            display={display}
            language={language}
            updatedAt={updatedAt[cli.id]}
            refresh={
              isAll
                ? undefined
                : {
                    busy: refreshing.includes(cli.id),
                    onRefresh: () => void onRefresh([cli.id]),
                  }
            }
          />
        ))}
      </div>
    </PopoverContent>
  );
}

export function UsageStatus({
  hostKey,
  connected,
  revision,
  language,
}: {
  hostKey: string;
  connected: boolean;
  revision?: unknown;
  language: string;
}) {
  const { display, graph: shape } = useUsagePreferences();
  const { all } = useCliList(hostKey, revision);
  const clis = all.clis
    .filter((cli) => !cli.hidden && cli.usage?.windows.length)
    .map((cli) => ({ ...cli, hostKey, windows: cli.usage!.windows }));
  useUsageRefresh(hostKey, connected);
  const [mobile, setMobile] = useState(matchMedia("(max-width:639px)").matches);
  useEffect(() => {
    const media = matchMedia("(max-width:639px)");
    const update = () => setMobile(media.matches);
    media.addEventListener("change", update);
    return () => media.removeEventListener("change", update);
  }, []);
  const [opened, setOpened] = useState<string | null>(null);
  const [pinned, setPinned] = useState(false);
  const [takeFocus, setTakeFocus] = useState(false);
  const [refreshing, setRefreshing] = useState<string[]>([]);
  const refresh = async (ids: string[], all = false) => {
    setRefreshing((current) => [...new Set([...current, ...ids])]);
    await refreshUsage(hostKey, all ? undefined : ids[0]);
    setRefreshing((current) => current.filter((id) => !ids.includes(id)));
  };
  const updatedAt = Object.fromEntries(
    clis.map((cli) => [cli.id, cli.usage?.observedAt]),
  );
  const suppressedHover = useRef<string | null>(null);
  const hoverTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
  useEffect(() => () => clearTimeout(hoverTimer.current), []);
  const [popupHeight, setPopupHeight] = useState(innerHeight - 100);
  useLayoutEffect(() => {
    const update = () => {
      const header = document.querySelector(
        ".workspace .dv-tabs-and-actions-container, .mobile-location",
      );
      setPopupHeight(
        innerHeight - (header?.getBoundingClientRect().bottom ?? 0) - 42,
      );
    };
    update();
    addEventListener("resize", update);
    return () => removeEventListener("resize", update);
  }, []);
  const line = useRef<HTMLDivElement>(null);
  const buttons = useRef<HTMLDivElement>(null);
  const [visible, setVisible] = useState(clis.length);
  useLayoutEffect(() => {
    const element = line.current,
      measure = buttons.current;
    if (!element || !measure) return;
    const fit = () => {
      const items = [...measure.querySelectorAll<HTMLElement>(".usage-item")];
      const total =
        items.reduce(
          (sum, item) => sum + item.getBoundingClientRect().width,
          0,
        ) +
        Math.max(0, items.length - 1) * 6;
      if (total <= element.clientWidth) {
        setVisible(items.length);
        return;
      }
      const more = measure.querySelector<HTMLElement>(".usage-more")!;
      let width = more.getBoundingClientRect().width,
        count = 0;
      for (const item of items) {
        const next = width + 6 + item.getBoundingClientRect().width;
        if (next > element.clientWidth) break;
        width = next;
        count++;
      }
      setVisible(count);
    };
    fit();
    const observer = new ResizeObserver(fit);
    observer.observe(element);
    observer.observe(measure);
    void document.fonts.ready.then(fit);
    return () => observer.disconnect();
  }, [all, shape, display, mobile]);
  const cancelHover = () => clearTimeout(hoverTimer.current);
  const close = () => {
    cancelHover();
    if (pinned && opened) suppressedHover.current = opened;
    setOpened(null);
    setPinned(false);
    setTakeFocus(false);
  };
  const open = (key: string) => {
    cancelHover();
    setPinned(true);
    setTakeFocus(true);
    setOpened(key);
  };
  const activate = (key: string, isOpen: boolean) => {
    if (pinned && isOpen) close();
    else open(key);
  };
  const hover = (key: string) => {
    if (suppressedHover.current === key) return;
    if (!pinned) {
      cancelHover();
      hoverTimer.current = setTimeout(() => setOpened(key), hoverDelay);
    }
  };
  const leave = (related: EventTarget | null, key: string) => {
    if (suppressedHover.current === key) suppressedHover.current = null;
    cancelHover();
    if (
      !pinned &&
      !(related instanceof Element && related.closest(".usage-status-popover"))
    )
      setOpened(null);
  };
  const moreLabel = (count: number) =>
    language.toLowerCase().startsWith("ja")
      ? `ほかの利用枠 ${count}件`
      : `${count} more usage limits`;
  const content = (cli: Cli) => {
    const windows =
      shape === "bar" && cli.windows.length > 8
        ? [...cli.windows].sort((a, b) => a.remaining - b.remaining).slice(0, 8)
        : cli.windows;
    const count = windows.length;
    const barHeight =
      count <= 3
        ? 4
        : Math.max(count >= 6 ? 1 : 2, Math.floor((16 - (count - 1)) / count));
    return (
      <>
        <CliIcon cli={cli} hostKey={hostKey} size={14} />
        <span
          className={"usage-mini-graphs " + shape}
          style={
            {
              "--usage-mini-bar-height": `${barHeight}px`,
              "--usage-mini-gap": count <= 3 ? "2px" : "1px",
            } as CSSProperties
          }
        >
          {windows.map((window, index) => (
            <Graph
              window={window}
              shape={shape}
              display={display}
              key={index}
            />
          ))}
        </span>
        <span
          className="usage-number"
          style={{ color: numberTone(strictest(cli)) }}
        >
          {percentage(strictest(cli), display)}%
        </span>
      </>
    );
  };
  const popup = (values: Cli[], isAll = false) => (
    <UsagePopup
      clis={values}
      all={isAll}
      shape={shape}
      display={display}
      language={language}
      mobile={mobile}
      takeFocus={takeFocus}
      updatedAt={updatedAt}
      refreshing={refreshing}
      onRefresh={(ids) => refresh(ids, isAll || mobile)}
      maxHeight={popupHeight}
      onEnter={cancelHover}
      onLeave={() => {
        if (!pinned) close();
      }}
    />
  );
  const item = (cli: Cli, measuring = false) => {
    if (measuring)
      return (
        <Button
          className="usage-item"
          variant="ghost"
          size="sm"
          tabIndex={-1}
          key={cli.id}
        >
          {content(cli)}
        </Button>
      );
    return (
      <Popover
        key={cli.id}
        open={opened === cli.id}
        onOpenChange={(value) => (value ? open(cli.id) : close())}
      >
        <PopoverTrigger asChild>
          <Button
            className="usage-item"
            variant="ghost"
            size="sm"
            aria-label={usageLabel(cli, language, display)}
            onPointerEnter={(event) => {
              if (event.pointerType === "mouse") hover(cli.id);
            }}
            onPointerLeave={(event) => leave(event.relatedTarget, cli.id)}
            onClick={(event) => {
              event.preventDefault();
              activate(cli.id, opened === cli.id);
            }}
          >
            {content(cli)}
          </Button>
        </PopoverTrigger>
        {popup([cli])}
      </Popover>
    );
  };
  if (!clis.length) return null;
  return (
    <>
      <div className="usage-status-items" ref={line}>
        {mobile ? (
          <Popover
            open={opened !== null}
            onOpenChange={(value) => (value ? open("all") : close())}
          >
            <PopoverTrigger asChild>
              <Button
                variant="ghost"
                size="sm"
                className="usage-mobile-trigger"
                aria-label={clis
                  .slice(0, visible)
                  .map((cli) => usageLabel(cli, language, display))
                  .concat(
                    visible < clis.length
                      ? [moreLabel(clis.length - visible)]
                      : [],
                  )
                  .join(" · ")}
                onClick={(event) => {
                  event.preventDefault();
                  activate("all", opened !== null);
                }}
              >
                {clis.slice(0, visible).map((cli) => (
                  <span className="usage-mobile-cli" key={cli.id}>
                    {content(cli)}
                  </span>
                ))}
                {visible < clis.length && (
                  <Button
                    asChild
                    variant="outline"
                    size="sm"
                    className="usage-more"
                  >
                    <span aria-hidden="true">+{clis.length - visible}</span>
                  </Button>
                )}
              </Button>
            </PopoverTrigger>
            {popup(clis, true)}
          </Popover>
        ) : (
          <>
            {clis.slice(0, visible).map((cli) => item(cli))}
            {visible < clis.length && (
              <Popover
                open={opened === "all"}
                onOpenChange={(value) => (value ? open("all") : close())}
              >
                <PopoverTrigger asChild>
                  <Button
                    className="usage-more"
                    variant="outline"
                    size="sm"
                    aria-label={moreLabel(clis.length - visible)}
                    onPointerEnter={(event) => {
                      if (event.pointerType === "mouse") hover("all");
                    }}
                    onPointerLeave={(event) =>
                      leave(event.relatedTarget, "all")
                    }
                    onClick={(event) => {
                      event.preventDefault();
                      activate("all", opened === "all");
                    }}
                  >
                    +{clis.length - visible}
                  </Button>
                </PopoverTrigger>
                {popup(clis, true)}
              </Popover>
            )}
          </>
        )}
      </div>
      <div className="usage-measure" ref={buttons} aria-hidden="true" inert>
        {clis.map((cli) => item(cli, true))}
        <Button
          variant="outline"
          size="sm"
          className="usage-more"
          tabIndex={-1}
        >
          +{clis.length}
        </Button>
      </div>
    </>
  );
}
