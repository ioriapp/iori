import { useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import type { CSSProperties } from "react";
import { Pin, RefreshCw } from "lucide-react";
import {
  selectUsageWindow,
  statusBarUsageWindows,
  type CliSummary,
  type CliUsage,
  type UsageWindowSelection,
} from "@iori/protocol";
import { CliIcon } from "../CliIcon.tsx";
import { Button } from "../components/ui/button.tsx";
import { Progress } from "../components/ui/progress.tsx";
import {
  Popover,
  PopoverTrigger,
  PopoverContent,
} from "../components/ui/popover.tsx";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
} from "../components/ui/dropdown-menu.tsx";
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

function windowKey(window: UsageWindowSelection) {
  return JSON.stringify([window.minutes, window.name ?? ""]);
}

function windowLabel(window: UsageWindow) {
  return (
    (window.name ? window.name + " " : "") + formatUsageLength(window.minutes)
  );
}

function findSelectedWindow(
  windows: readonly UsageWindow[],
  selected?: UsageWindowSelection,
) {
  if (!selected) return undefined;
  return windows.find(
    (window) =>
      window.minutes === selected.minutes &&
      (window.name ?? "") === (selected.name ?? ""),
  );
}

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

function usageLabel(
  cli: Cli,
  language: Language,
  display: Display,
  selected?: UsageWindowSelection,
) {
  const window = selectUsageWindow(cli.windows, selected)!;
  const label =
    windowLabel(window) +
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
      className="usage-heading-action usage-refresh-button"
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

function WindowPicker({
  cli,
  language,
  selected,
  open,
  onOpenChange,
  onSelectWindow,
}: {
  cli: Cli;
  language: Language;
  selected?: UsageWindowSelection;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSelectWindow: (cliId: string, selected?: UsageWindowSelection) => void;
}) {
  const ja = language.toLowerCase().startsWith("ja");
  const triggerLabel = ja
    ? "ステータスバーに表示する枠"
    : "Window in status bar";
  const menuHeading = ja ? "ステータスバーに表示" : "Show in status bar";
  const autoLabel = ja ? "自動（残量が最少）" : "Auto (lowest remaining)";
  const matched = findSelectedWindow(cli.windows, selected);
  const hasMatch = matched !== undefined;
  const value = matched ? windowKey(matched) : "";

  return (
    <DropdownMenu modal={false} open={open} onOpenChange={onOpenChange}>
      <DropdownMenuTrigger asChild>
        <Button
          className="usage-heading-action usage-pin-button"
          variant="ghost"
          size="icon"
          data-pinned={hasMatch || undefined}
          aria-label={triggerLabel}
          title={triggerLabel}
        >
          <Pin size={14} />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        className="usage-pin-menu-content"
        align="end"
        sideOffset={4}
      >
        <DropdownMenuLabel>{menuHeading}</DropdownMenuLabel>
        <DropdownMenuRadioGroup
          value={value}
          onValueChange={(next) => {
            if (next === "") {
              onSelectWindow(cli.id, undefined);
              return;
            }
            const picked = cli.windows.find(
              (window) => windowKey(window) === next,
            );
            if (!picked) return;
            onSelectWindow(cli.id, {
              minutes: picked.minutes,
              ...(picked.name ? { name: picked.name } : {}),
            });
          }}
        >
          <DropdownMenuRadioItem value="">{autoLabel}</DropdownMenuRadioItem>
          <DropdownMenuSeparator />
          {cli.windows.map((window, index) => {
            const key = windowKey(window);
            return (
              <DropdownMenuRadioItem key={`${key}-${index}`} value={key}>
                {windowLabel(window)}
              </DropdownMenuRadioItem>
            );
          })}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function UsageDetail({
  cli,
  shape,
  display,
  language,
  updatedAt,
  selected,
  menuOpen,
  onMenuOpenChange,
  onSelectWindow,
  refresh,
}: {
  cli: Cli;
  shape: Shape;
  display: Display;
  language: Language;
  updatedAt?: number;
  selected?: UsageWindowSelection;
  menuOpen: boolean;
  onMenuOpenChange: (open: boolean) => void;
  onSelectWindow: (cliId: string, selected?: UsageWindowSelection) => void;
  refresh?: { busy: boolean; onRefresh: () => void };
}) {
  const baseId = useId();
  const headingId = `${baseId}-heading`;
  const selectable = cli.windows.length >= 2;
  const pinnedWindow = selectable
    ? findSelectedWindow(cli.windows, selected)
    : undefined;

  return (
    <section className="usage-detail" aria-labelledby={headingId}>
      <div className="usage-detail-heading">
        <h2 id={headingId}>
          <CliIcon cli={cli} hostKey={cli.hostKey} size={16} />
          {cli.name}
        </h2>
        {(selectable || refresh) && (
          <div className="usage-detail-actions">
            {selectable && (
              <WindowPicker
                cli={cli}
                language={language}
                selected={selected}
                open={menuOpen}
                onOpenChange={onMenuOpenChange}
                onSelectWindow={onSelectWindow}
              />
            )}
            {refresh && (
              <RefreshUsage
                language={language}
                busy={refresh.busy}
                onRefresh={refresh.onRefresh}
              />
            )}
          </div>
        )}
      </div>
      {updatedAt !== undefined && (
        <p className="usage-updated">{formatUpdatedAt(updatedAt, language)}</p>
      )}
      {cli.windows.map((window, index) => {
        const isPinned = window === pinnedWindow;
        const label = windowLabel(window);
        const lastSpace = label.lastIndexOf(" ");
        const labelHead = lastSpace === -1 ? "" : label.slice(0, lastSpace + 1);
        const labelTail = lastSpace === -1 ? label : label.slice(lastSpace + 1);
        return (
          <div className={"usage-window " + shape} key={index}>
            <div className="usage-window-line">
              <span className="usage-window-name">
                {isPinned ? (
                  <>
                    {labelHead}
                    <span className="usage-window-name-tail">
                      {labelTail}
                      <Pin
                        size={11}
                        className="usage-window-pin"
                        aria-hidden="true"
                      />
                    </span>
                  </>
                ) : (
                  label
                )}
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
        );
      })}
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
  selectedWindows,
  openMenuCli,
  onMenuOpenChange,
  onSelectWindow,
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
  selectedWindows: Record<string, UsageWindowSelection>;
  openMenuCli: string | null;
  onMenuOpenChange: (cliId: string, open: boolean) => void;
  onSelectWindow: (cliId: string, selected?: UsageWindowSelection) => void;
  refreshing: string[];
  onRefresh: (names: string[]) => Promise<void>;
  onEnter?: () => void;
  onLeave?: (related: EventTarget | null) => void;
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

  const [more, setMore] = useState(false);

  useLayoutEffect(() => {
    const element = body;
    if (!element) return;
    const updateMore = () =>
      setMore(
        element.scrollTop + element.clientHeight < element.scrollHeight - 1,
      );
    updateMore();
    const observer = new ResizeObserver(updateMore);
    observer.observe(element);
    for (const row of element.querySelectorAll<HTMLElement>(".usage-detail"))
      observer.observe(row);
    return () => observer.disconnect();
  }, [body, bodyLimit, clis, shape, display, language]);

  const keepOpenForMenu = (event: {
    target: EventTarget | null;
    preventDefault: () => void;
  }) => {
    if (
      openMenuCli !== null ||
      (event.target instanceof Element &&
        event.target.closest('[data-slot="dropdown-menu-content"]'))
    ) {
      event.preventDefault();
    }
  };

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
      onPointerLeave={(event) => onLeave?.(event.relatedTarget)}
      onPointerDownOutside={keepOpenForMenu}
      onInteractOutside={keepOpenForMenu}
      onFocusOutside={keepOpenForMenu}
      onOpenAutoFocus={(event) => {
        restoreFocus.current = takeFocus;
        event.preventDefault();
      }}
      onCloseAutoFocus={(event) => {
        if (!restoreFocus.current) event.preventDefault();
      }}
      aria-label={
        isAll
          ? allUsage(language)
          : usageLabel(clis[0], language, display, selectedWindows[clis[0].id])
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
        style={{ maxHeight: bodyLimit }}
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
            selected={selectedWindows[cli.id]}
            menuOpen={openMenuCli === cli.id}
            onMenuOpenChange={(next) => onMenuOpenChange(cli.id, next)}
            onSelectWindow={onSelectWindow}
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
  const {
    display,
    graph: shape,
    windows: selectedWindows,
    setWindow,
  } = useUsagePreferences();
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
  const [openMenuCli, setOpenMenuCli] = useState<string | null>(null);
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
  }, [all, shape, display, mobile, selectedWindows]);
  const cancelHover = () => clearTimeout(hoverTimer.current);
  const close = () => {
    cancelHover();
    if (pinned && opened) suppressedHover.current = opened;
    setOpenMenuCli(null);
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
      openMenuCli === null &&
      !(
        related instanceof Element &&
        related.closest(
          '.usage-status-popover, [data-slot="dropdown-menu-content"]',
        )
      )
    )
      setOpened(null);
  };
  const handleMenuOpenChange = (cliId: string, nextOpen: boolean) => {
    if (nextOpen) {
      cancelHover();
      setPinned(true);
      setOpenMenuCli(cliId);
    } else {
      setOpenMenuCli((current) => (current === cliId ? null : current));
    }
  };
  const moreLabel = (count: number) =>
    language.toLowerCase().startsWith("ja")
      ? `ほかの利用枠 ${count}件`
      : `${count} more usage limits`;
  const content = (cli: Cli) => {
    const saved = selectedWindows[cli.id];
    const pinnedMatch = findSelectedWindow(cli.windows, saved);
    const windows = statusBarUsageWindows(cli.windows, pinnedMatch);
    const active = selectUsageWindow(cli.windows, saved)!;
    return (
      <>
        <CliIcon cli={cli} hostKey={hostKey} size={14} />
        <span
          className={"usage-mini-graphs " + shape}
          style={
            {
              "--usage-mini-bar-height": "4px",
              "--usage-mini-gap": "2px",
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
        <span className="usage-number" style={{ color: numberTone(active) }}>
          {percentage(active, display)}%
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
      selectedWindows={selectedWindows}
      openMenuCli={openMenuCli}
      onMenuOpenChange={handleMenuOpenChange}
      onSelectWindow={setWindow}
      refreshing={refreshing}
      onRefresh={(ids) => refresh(ids, isAll || mobile)}
      maxHeight={popupHeight}
      onEnter={cancelHover}
      onLeave={(related) => {
        if (
          !pinned &&
          openMenuCli === null &&
          !(
            related instanceof Element &&
            related.closest(
              '.usage-item, .usage-more, [data-slot="dropdown-menu-content"]',
            )
          )
        )
          close();
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
            aria-label={usageLabel(
              cli,
              language,
              display,
              selectedWindows[cli.id],
            )}
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
                  .map((cli) =>
                    usageLabel(cli, language, display, selectedWindows[cli.id]),
                  )
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
