import { translator } from "../i18n.ts";
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent,
  type ReactNode,
} from "react";
import {
  AlertCircle,
  ChevronDown,
  ChevronRight,
  ChevronUp,
  ExternalLink,
  Search,
  X,
} from "lucide-react";
import {
  forgeCiState,
  type ForgeCiJob,
  type ForgeCiStep,
  type ForgeReadFailure,
} from "@iori/protocol";
import { AsyncState } from "../components/AsyncState.tsx";
import { connection } from "../connection.ts";
import { native } from "../native.ts";
import { Button } from "../components/ui/button";
import { Input } from "../components/ui/input";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "../components/ui/collapsible.tsx";
import { cn } from "../lib/utils.ts";
import { VirtualRows, type ScrollRequest } from "../reading/VirtualRows.tsx";
import { ansiPalette } from "../terminal/terminal-colors.ts";
import {
  extractFileLinks,
  failedStepEnd,
  findErrorLines,
  findStepLineIndices,
  lineText,
  logLines,
  parseLogLine,
  type FileLink,
  type LogColor,
  type LogLine,
  type LogStyle,
} from "./ci-log.ts";
import { ciDuration } from "./ci-format.ts";
import { CiStateIcon } from "./CiStateIcon.tsx";
import { CiFailure } from "./CiFailure.tsx";
import { ForgeNotice, type ForgeRecovery } from "./ForgeFailure.tsx";
import { useForgeTokenChange } from "./forge-token-changes.ts";

// The reading Views' code line height.
const LINE_HEIGHT = 22;

type Loaded = {
  /** The Forge gives the log only once the job is done (GitHub). */
  availableWhenDone?: true;
  /** The job finished before its first step (GitHub): it has no log. */
  notRun?: true;
  /** Byte offset of the first loaded line. */
  start: number;
  lines: LogLine[];
  steps?: ForgeCiStep[];
};

/** The Terminal's palette for the theme shown now. */
function usePalette() {
  const dark = () => document.documentElement.classList.contains("dark");
  const [palette, setPalette] = useState(() => ansiPalette(dark()));
  useEffect(() => {
    const observer = new MutationObserver(() =>
      setPalette(ansiPalette(dark())),
    );
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["class"],
    });
    return () => observer.disconnect();
  }, []);
  return palette;
}

function spanStyle(style: LogStyle, palette: string[]): CSSProperties {
  const color = (value: LogColor | undefined, bold?: boolean) =>
    value === undefined
      ? undefined
      : typeof value === "number"
        ? // A Terminal draws bold text of the first eight colors in their bright ones.
          palette[bold && value < 8 ? value + 8 : value]
        : `rgb(${value.join(" ")})`;
  let foreground = color(style.foreground, style.bold);
  let background = color(style.background);
  if (style.inverse) {
    [foreground, background] = [
      background ?? "var(--background)",
      foreground ?? "var(--foreground)",
    ];
  }
  if (style.dim)
    foreground = `color-mix(in srgb, ${foreground ?? "var(--foreground)"} 50%, transparent)`;
  const decorations = [
    style.underline && "underline",
    style.strike && "line-through",
  ].filter(Boolean);
  return {
    ...(foreground ? { color: foreground } : {}),
    ...(background ? { background } : {}),
    ...(style.bold ? { fontWeight: 600 } : {}),
    ...(style.italic ? { fontStyle: "italic" } : {}),
    ...(decorations.length ? { textDecoration: decorations.join(" ") } : {}),
  };
}

type LogMatch = { lineIndex: number; start: number; end: number };

const MARK_BASE = "rounded-xs bg-status-waiting/35 text-inherit";
const MARK_CURRENT =
  "rounded-xs bg-status-waiting/75 text-inherit outline-1 outline-status-waiting";

function renderLogLineContent(
  line: LogLine,
  query: string,
  currentMatch: LogMatch | undefined,
  onOpenFile:
    ((path: string, line?: number, column?: number) => void) | undefined,
  palette: string[],
): ReactNode {
  const plain = lineText(line);
  const links: FileLink[] = onOpenFile ? extractFileLinks(plain) : [];
  const lowerQuery = query.trim().toLowerCase();
  const matches: Array<{ start: number; end: number; current: boolean }> = [];
  if (lowerQuery) {
    const lowerPlain = plain.toLowerCase();
    if (lowerPlain.length === plain.length) {
      let at = lowerPlain.indexOf(lowerQuery);
      while (at >= 0) {
        const end = at + lowerQuery.length;
        matches.push({
          start: at,
          end,
          current: currentMatch?.start === at && currentMatch.end === end,
        });
        at = lowerPlain.indexOf(lowerQuery, end);
      }
    }
  }
  if (links.length === 0 && matches.length === 0) {
    return line.spans.map((span, at) => (
      <span key={at} style={spanStyle(span.style, palette)}>
        {span.text}
      </span>
    ));
  }

  // Build non-overlapping boundaries across ANSI spans, search matches, and file links.
  const spanRanges: Array<{ start: number; end: number; style: LogStyle }> = [];
  let offset = 0;
  for (const span of line.spans) {
    const start = offset;
    const end = start + span.text.length;
    spanRanges.push({ start, end, style: span.style });
    offset = end;
  }
  const cuts = new Set<number>([0, plain.length]);
  for (const range of spanRanges) {
    cuts.add(range.start);
    cuts.add(range.end);
  }
  for (const match of matches) {
    cuts.add(match.start);
    cuts.add(match.end);
  }
  for (const link of links) {
    cuts.add(link.start);
    cuts.add(link.end);
  }
  const points = [...cuts].sort((a, b) => a - b);

  const renderPiece = (start: number, end: number): ReactNode => {
    const text = plain.slice(start, end);
    const span = spanRanges.find(
      (item) => item.start <= start && item.end >= end,
    );
    const match = matches.find(
      (item) => item.start <= start && item.end >= end,
    );
    const styled = (
      <span
        key={start}
        style={span ? spanStyle(span.style, palette) : undefined}
      >
        {text}
      </span>
    );
    if (!match) return styled;
    return (
      <mark
        key={start}
        data-iori-part={match.current ? "search-current" : "search-match"}
        className={match.current ? MARK_CURRENT : MARK_BASE}
      >
        {styled}
      </mark>
    );
  };

  const nodes: ReactNode[] = [];
  let i = 0;
  while (i < points.length - 1) {
    const start = points[i]!;
    const end = points[i + 1]!;
    if (end <= start) {
      i += 1;
      continue;
    }
    const link = links.find((item) => item.start <= start && item.end >= end);
    if (link && onOpenFile) {
      const linkPieces: ReactNode[] = [];
      let j = i;
      while (j < points.length - 1 && points[j + 1]! <= link.end) {
        if (points[j + 1]! > points[j]!) {
          linkPieces.push(renderPiece(points[j]!, points[j + 1]!));
        }
        j += 1;
      }
      nodes.push(
        <button
          key={`link:${link.start}`}
          type="button"
          data-iori-action="ci-log-file-link"
          data-path={link.path}
          data-line={link.line}
          title={`${link.path}:${link.line}`}
          className="inline cursor-pointer border-0 bg-transparent p-0 font-mono text-inherit underline decoration-current/50 underline-offset-2 hover:text-primary focus-visible:outline-1 focus-visible:outline-ring"
          onClick={() => onOpenFile(link.path, link.line, link.column)}
        >
          {linkPieces}
        </button>,
      );
      i = j;
    } else {
      nodes.push(renderPiece(start, end));
      i += 1;
    }
  }
  return nodes;
}

/** The job's steps as the Forge lists them (GitHub), its failed step marked. */
function Steps({
  steps,
  open,
  onOpen,
  height,
  onHeight,
  locale,
  stepLines,
  onJumpStep,
}: {
  steps: ForgeCiStep[];
  open: boolean;
  onOpen: (open: boolean) => void;
  height?: number;
  onHeight?: (height: number | undefined) => void;
  locale: string;
  stepLines: ReadonlyMap<number, number>;
  onJumpStep?: (lineIndex: number) => void;
}) {
  const ja = locale.startsWith("ja");
  const now = Date.now();
  const current =
    steps.find((step) => forgeCiState(step.status) === "failed") ??
    steps.find((step) => forgeCiState(step.status) === "running");
  const root = useRef<HTMLDivElement>(null);
  const list = useRef<HTMLDivElement>(null);
  const [dragHeight, setDragHeight] = useState<number>();
  const activeHeight = dragHeight ?? height;
  useEffect(() => {
    if (!open) return;
    list.current
      ?.querySelector('[data-current="true"]')
      ?.scrollIntoView({ block: "nearest" });
  }, [open]);
  return (
    <Collapsible asChild open={open} onOpenChange={onOpen}>
      <div
        ref={root}
        className={cn(
          "shrink-0 bg-background",
          !open && "border-b border-border",
        )}
        data-iori-part="ci-steps"
        data-open={open}
      >
        <CollapsibleTrigger asChild>
          <button
            type="button"
            className="flex min-h-7 w-full cursor-pointer items-center gap-1.5 border-0 bg-transparent px-3 py-1 text-left text-xs font-semibold text-muted-foreground transition-colors [@media(hover:hover)]:hover:bg-muted [@media(pointer:coarse)]:min-h-11"
            aria-expanded={open}
            data-iori-action="ci-steps-toggle"
          >
            {open ? (
              <ChevronDown size={13} className="shrink-0" aria-hidden="true" />
            ) : (
              <ChevronRight size={13} className="shrink-0" aria-hidden="true" />
            )}
            <span>Steps</span>
            <span className="font-normal text-muted-foreground">
              {steps.length}
            </span>
            {!open && current && (
              <span className="ml-2 flex min-w-0 items-center gap-1.5 font-normal text-foreground">
                <CiStateIcon state={forgeCiState(current.status)} />
                <span className="min-w-0 truncate">{current.name}</span>
              </span>
            )}
          </button>
        </CollapsibleTrigger>
        <CollapsibleContent>
          {/* The steps take at most about eight rows by default; dragging sets an explicit height. */}
          <div
            className={cn(
              "overflow-auto divide-y divide-border-subtle/50",
              activeHeight === undefined
                ? "max-h-[min(30vh,13.75rem)]"
                : "max-h-[75vh]",
            )}
            style={
              activeHeight !== undefined
                ? { height: `${activeHeight}px` }
                : undefined
            }
            data-iori-part="ci-steps-list"
            ref={list}
          >
            {steps.map((step, index) => {
              const targetLine = stepLines.get(index);
              const content = (
                <>
                  <CiStateIcon state={forgeCiState(step.status)} />
                  <span
                    className={cn(
                      "min-w-0 flex-1 truncate text-foreground",
                      step === current && "font-semibold",
                    )}
                  >
                    {step.name}
                  </span>
                  <span className="ml-auto shrink-0 font-normal text-muted-foreground">
                    {ciDuration(step, now)}
                  </span>
                </>
              );
              if (targetLine !== undefined && onJumpStep) {
                return (
                  <button
                    key={index}
                    type="button"
                    className="flex min-h-6.5 w-full cursor-pointer items-center gap-2 border-0 bg-transparent py-0.5 pr-3 pl-7 text-left text-xs transition-colors outline-none hover:bg-muted/70 focus-visible:ring-2 focus-visible:ring-ring/40 focus-visible:ring-inset [@media(pointer:coarse)]:min-h-9"
                    data-current={step === current || undefined}
                    data-iori-action="ci-step-jump"
                    data-iori-ci-step={step.name}
                    onClick={() => onJumpStep(targetLine)}
                  >
                    {content}
                  </button>
                );
              }
              return (
                <div
                  key={index}
                  className="flex min-h-6.5 items-center gap-2 py-0.5 pr-3 pl-7 text-xs [@media(pointer:coarse)]:min-h-9"
                  data-current={step === current || undefined}
                  data-iori-ci-step={step.name}
                >
                  {content}
                </div>
              );
            })}
          </div>
          <div
            role="separator"
            aria-orientation="horizontal"
            tabIndex={0}
            aria-label={ja ? "Stepsの高さ" : "Steps height"}
            aria-valuenow={
              activeHeight !== undefined ? Math.round(activeHeight) : undefined
            }
            data-iori-action="ci-steps-resize"
            className="relative h-px flex-none cursor-row-resize touch-none bg-border transition-colors before:absolute before:inset-x-0 before:-inset-y-[3px] before:z-[2] before:content-[''] hover:bg-primary/50 focus-visible:outline-2 focus-visible:outline-ring [@media(pointer:coarse)]:before:-inset-y-2"
            onDoubleClick={() => {
              setDragHeight(undefined);
              onHeight?.(undefined);
            }}
            onPointerDown={(event) => {
              const box = list.current;
              if (!box) return;
              event.preventDefault();
              event.currentTarget.setPointerCapture(event.pointerId);
              const startY = event.clientY;
              const startHeight = box.getBoundingClientRect().height;
              const detailHeight =
                root.current?.parentElement?.getBoundingClientRect().height ??
                window.innerHeight;
              const maxHeight = Math.max(120, Math.round(detailHeight * 0.75));
              let latest = startHeight;
              const clamp = (value: number) =>
                Math.round(Math.min(maxHeight, Math.max(52, value)));
              const move = (moved: PointerEvent) => {
                latest = clamp(startHeight + (moved.clientY - startY));
                setDragHeight(latest);
              };
              const up = () => {
                window.removeEventListener("pointermove", move);
                window.removeEventListener("pointerup", up);
                window.removeEventListener("pointercancel", up);
                setDragHeight(undefined);
                onHeight?.(latest);
              };
              window.addEventListener("pointermove", move);
              window.addEventListener("pointerup", up);
              window.addEventListener("pointercancel", up);
            }}
            onKeyDown={(event) => {
              if (event.key !== "ArrowUp" && event.key !== "ArrowDown") return;
              event.preventDefault();
              const box = list.current;
              const currentHeight =
                activeHeight ?? box?.getBoundingClientRect().height ?? 160;
              const detailHeight =
                root.current?.parentElement?.getBoundingClientRect().height ??
                window.innerHeight;
              const maxHeight = Math.max(120, Math.round(detailHeight * 0.75));
              const next = Math.round(
                Math.min(
                  maxHeight,
                  Math.max(
                    52,
                    currentHeight + (event.key === "ArrowUp" ? -24 : 24),
                  ),
                ),
              );
              onHeight?.(next);
            }}
          />
        </CollapsibleContent>
      </div>
    </Collapsible>
  );
}

/**
 * A job's log: it opens at the failed step's end, or the end, and earlier
 * parts are read as the reader scrolls up.
 */
export function CiLog({
  hostKey,
  root,
  job,
  wrap,
  refresh,
  stepsOpen,
  onStepsOpen,
  stepsHeight,
  onStepsHeight,
  locale,
  recovery,
  findRequest = 0,
  onOpenFile,
  onFailureContext,
}: {
  hostKey: string;
  root: string;
  job: ForgeCiJob;
  wrap: boolean;
  /** Changes when the end of the log is to be read again. */
  refresh: string;
  stepsOpen: boolean;
  onStepsOpen: (open: boolean) => void;
  stepsHeight?: number;
  onStepsHeight?: (height: number | undefined) => void;
  locale: string;
  /** The CI View's ways to recover from a failed read besides a retry. */
  recovery: Omit<ForgeRecovery, "onRetry">;
  /** Increments when the header search button is pressed. */
  findRequest?: number;
  /** Opens a workspace-relative `file:line` reference in Files View. */
  onOpenFile?: (path: string, line?: number, column?: number) => void;
  /** Reports the loaded failure step name and error excerpt for "Send failure to Agent". */
  onFailureContext?: (
    context: { failedStepName?: string; errorExcerpt: string } | undefined,
  ) => void;
}) {
  const t = translator(locale);
  const palette = usePalette();
  const [loaded, setLoaded] = useState<Loaded>();
  const [findOpen, setFindOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [matchIndex, setMatchIndex] = useState(0);
  const [errorIndex, setErrorIndex] = useState<number>();
  const findInputRef = useRef<HTMLInputElement>(null);
  const lastFindRequestRef = useRef(findRequest);
  // A failed read, and why when the Host could tell.
  const [failed, setFailed] = useState<{ forge?: ForgeReadFailure }>();
  const [retry, setRetry] = useState(0);
  const [earlierFailed, setEarlierFailed] = useState<{
    forge?: ForgeReadFailure;
  }>();
  // A request belongs to the rows it was made for; wrapping draws new rows.
  const [scroll, setScroll] = useState<{
    request: ScrollRequest;
    wrap: boolean;
  }>();
  const scrolls = useRef(0);
  const wrapped = useRef(wrap);
  wrapped.current = wrap;
  const reading = useRef(false);
  const shownRow = useRef(0);
  const firstRow = useRef<number | undefined>(undefined);
  // Earlier parts wait until the log has moved to where it opens, or the reader scrolls.
  const armed = useRef(false);
  // A hidden log (the detail behind the list on a narrow screen) has no
  // height to place rows in; its place is chosen once it is shown.
  const area = useRef<HTMLDivElement>(null);
  const pending = useRef<ScrollRequest | undefined>(undefined);
  const scrollTo = (index: number, align: ScrollRequest["align"]) => {
    const request = { index, align, key: (scrolls.current += 1) };
    if (area.current?.clientHeight) {
      pending.current = undefined;
      setScroll({ request, wrap: wrapped.current });
    } else pending.current = request;
  };
  const hasArea = loaded !== undefined && loaded.lines.length > 0;
  useLayoutEffect(() => {
    const element = area.current;
    if (!element) return;
    const observer = new ResizeObserver(() => {
      const request = pending.current;
      if (!request || !element.clientHeight) return;
      pending.current = undefined;
      setScroll({ request, wrap: wrapped.current });
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, [hasArea]);

  // Reads stop when the job, the end being read or the View goes away; the
  // Host then stops its gh child, so another job does not wait for them.
  const earlier = useRef<AbortController | undefined>(undefined);
  useEffect(() => () => earlier.current?.abort(), []);
  useEffect(() => {
    const controller = new AbortController();
    earlier.current?.abort();
    void connection
      .requestHost(
        hostKey,
        "forge.ci.log",
        { path: root, job: job.id },
        undefined,
        controller.signal,
      )
      .then((response) => {
        if (controller.signal.aborted) return;
        if (!response?.ok) {
          setFailed({ forge: response?.error.forge });
          return;
        }
        const { start, text, steps, availableWhenDone, notRun } =
          response.result;
        const lines = logLines(text).map(parseLogLine);
        setFailed(undefined);
        setEarlierFailed(undefined);
        armed.current = false;
        setLoaded({
          start,
          lines,
          steps,
          ...(availableWhenDone ? { availableWhenDone } : {}),
          ...(notRun ? { notRun } : {}),
        });
        if (availableWhenDone || notRun) return;
        const end = failedStepEnd(lines);
        const top = start > 0 ? 1 : 0;
        // The failed step's end with the line after it, else the last line.
        const last = Math.min(
          lines.length - 1,
          end === undefined ? lines.length - 1 : end + 1,
        );
        scrollTo(Math.max(0, top + last), "nearest");
      })
      .catch(() => {
        if (!controller.signal.aborted) setFailed({});
      });
    return () => controller.abort();
  }, [hostKey, root, job.id, refresh, retry]);

  const readEarlier = useCallback(() => {
    if (!loaded || loaded.start === 0 || reading.current) return;
    reading.current = true;
    setEarlierFailed(undefined);
    const before = loaded.start;
    const controller = new AbortController();
    earlier.current = controller;
    void connection
      .requestHost(
        hostKey,
        "forge.ci.log",
        { path: root, job: job.id, before },
        undefined,
        controller.signal,
      )
      .then((response) => {
        if (controller.signal.aborted) return;
        if (!response?.ok) {
          setEarlierFailed({ forge: response?.error.forge });
          return;
        }
        const lines = logLines(response.result.text).map(parseLogLine);
        const start = response.result.start;
        setLoaded((current) =>
          current && current.start === before
            ? { ...current, start, lines: [...lines, ...current.lines] }
            : current,
        );
        // The rows already shown stay in place above the new ones' growth.
        scrollTo(
          shownRow.current - 1 + lines.length + (start > 0 ? 1 : 0),
          "start",
        );
      })
      .catch(() => {
        if (!controller.signal.aborted) setEarlierFailed({});
      })
      .finally(() => {
        if (earlier.current === controller) earlier.current = undefined;
        reading.current = false;
      });
  }, [hostKey, root, job.id, loaded]);

  // A token registered, replaced or removed may let a failed read work now.
  useForgeTokenChange(hostKey, Boolean(failed || earlierFailed), () => {
    if (failed) setRetry((value) => value + 1);
    else {
      setEarlierFailed(undefined);
      readEarlier();
    }
  });

  const earlierFailedRef = useRef(earlierFailed);
  earlierFailedRef.current = earlierFailed;
  // A failed earlier read waits for the reader's retry.
  const tryEarlier = useCallback(() => {
    if (armed.current && firstRow.current === 0 && !earlierFailedRef.current)
      readEarlier();
  }, [readEarlier]);
  const onRange = useCallback(
    (first: number) => {
      firstRow.current = first;
      tryEarlier();
    },
    [tryEarlier],
  );
  const onPosition = useCallback((index: number) => {
    shownRow.current = index;
    if (index > 0) armed.current = true;
  }, []);
  const reader = () => {
    armed.current = true;
    tryEarlier();
  };

  useEffect(() => {
    if (findRequest <= lastFindRequestRef.current) return;
    lastFindRequestRef.current = findRequest;
    setFindOpen(true);
    requestAnimationFrame(() => {
      findInputRef.current?.focus();
      findInputRef.current?.select();
    });
  }, [findRequest]);

  const errorLines = useMemo(
    () => (loaded ? findErrorLines(loaded.lines) : []),
    [loaded],
  );
  const stepLines = useMemo(
    () =>
      loaded && loaded.steps?.length
        ? findStepLineIndices(loaded.lines, loaded.steps)
        : new Map<number, number>(),
    [loaded],
  );
  const searchMatches = useMemo<LogMatch[]>(() => {
    const needle = query.trim().toLowerCase();
    if (!needle || !loaded) return [];
    const found: LogMatch[] = [];
    for (let i = 0; i < loaded.lines.length; i += 1) {
      const plain = lineText(loaded.lines[i]!);
      const lower = plain.toLowerCase();
      if (lower.length !== plain.length) continue;
      let at = lower.indexOf(needle);
      while (at >= 0) {
        found.push({ lineIndex: i, start: at, end: at + needle.length });
        at = lower.indexOf(needle, at + needle.length);
      }
    }
    return found;
  }, [loaded, query]);

  const clampedMatchIndex =
    searchMatches.length > 0 ? matchIndex % searchMatches.length : 0;
  const currentMatch =
    searchMatches.length > 0 ? searchMatches[clampedMatchIndex] : undefined;

  const failureContextRef = useRef(onFailureContext);
  failureContextRef.current = onFailureContext;
  useEffect(() => {
    setErrorIndex(undefined);
    if (!loaded || loaded.availableWhenDone || loaded.notRun) {
      failureContextRef.current?.(undefined);
      return;
    }
    const failedStepName = loaded.steps?.find(
      (step) => forgeCiState(step.status) === "failed",
    )?.name;
    const end =
      failedStepEnd(loaded.lines) ?? Math.max(0, loaded.lines.length - 1);
    const start = Math.max(0, end - 39);
    const excerpt = loaded.lines
      .slice(start, Math.min(loaded.lines.length, end + 2))
      .map(lineText)
      .join("\n");
    failureContextRef.current?.({
      ...(failedStepName ? { failedStepName } : {}),
      errorExcerpt: excerpt,
    });
    return () => failureContextRef.current?.(undefined);
  }, [loaded]);

  const top = loaded && loaded.start > 0 ? 1 : 0;

  const jumpMatch = (delta: 1 | -1) => {
    if (searchMatches.length === 0) return;
    const next =
      (clampedMatchIndex + delta + searchMatches.length) % searchMatches.length;
    setMatchIndex(next);
    const target = searchMatches[next]!;
    scrollTo(top + target.lineIndex, "center");
  };

  const jumpError = (delta: 1 | -1) => {
    if (errorLines.length === 0) return;
    const next =
      errorIndex === undefined
        ? delta === 1
          ? 0
          : errorLines.length - 1
        : (errorIndex + delta + errorLines.length) % errorLines.length;
    setErrorIndex(next);
    scrollTo(top + errorLines[next]!, "center");
  };

  const onLogKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    reader();
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "f") {
      event.preventDefault();
      setFindOpen(true);
      requestAnimationFrame(() => {
        findInputRef.current?.focus();
        findInputRef.current?.select();
      });
    } else if (event.key === "Escape" && findOpen) {
      setFindOpen(false);
    }
  };

  const steps = loaded?.steps?.length ? (
    <Steps
      steps={loaded.steps}
      open={stepsOpen}
      onOpen={onStepsOpen}
      height={stepsHeight}
      onHeight={onStepsHeight}
      locale={locale}
      stepLines={stepLines}
      onJumpStep={(lineIndex) => scrollTo(top + lineIndex, "start")}
    />
  ) : null;
  const failure = failed && (
    <CiFailure
      subject="log"
      form={loaded ? "line" : "notice"}
      className={loaded ? "mx-3 my-2" : undefined}
      failure={failed.forge}
      locale={locale}
      recovery={{ ...recovery, onRetry: () => setRetry((value) => value + 1) }}
    />
  );
  if (!loaded)
    return (
      failure || (
        <AsyncState
          mode="loading"
          compact
          t={t}
          skeletonRows={4}
          emptyTitle=""
          errorTitle=""
          className="border-t-0"
        >
          {null}
        </AsyncState>
      )
    );
  const showLogTools =
    !loaded.notRun &&
    !loaded.availableWhenDone &&
    loaded.lines.length > 0 &&
    (findOpen || errorLines.length > 0);
  return (
    <>
      {steps}
      {showLogTools && (
        <div
          className="flex flex-none flex-wrap items-center gap-1.5 border-b border-border bg-muted/40 px-2 py-1 text-xs"
          data-iori-part="ci-log-tools"
        >
          {findOpen && (
            <div
              className="flex min-w-0 flex-1 items-center gap-1"
              data-iori-part="ci-log-find"
            >
              <Search
                className="size-3.5 shrink-0 text-muted-foreground"
                aria-hidden="true"
              />
              <Input
                ref={findInputRef}
                value={query}
                onChange={(event) => {
                  const nextQuery = event.target.value;
                  setQuery(nextQuery);
                  setMatchIndex(0);
                  const trimmed = nextQuery.trim().toLowerCase();
                  if (trimmed && loaded) {
                    const firstIdx = loaded.lines.findIndex((line) =>
                      lineText(line).toLowerCase().includes(trimmed),
                    );
                    if (firstIdx >= 0) scrollTo(top + firstIdx, "center");
                  }
                }}
                onKeyDown={(event) => {
                  if (event.key === "Enter") {
                    event.preventDefault();
                    jumpMatch(event.shiftKey ? -1 : 1);
                  } else if (event.key === "Escape") {
                    event.preventDefault();
                    setFindOpen(false);
                  }
                }}
                placeholder={t("Find in log")}
                aria-label={t("Find in log")}
                data-iori-field="ci-log-find-input"
                className="h-6 min-w-32 max-w-64 text-xs [@media(pointer:coarse)]:h-9"
              />
              {query.trim().length > 0 && (
                <span
                  className="shrink-0 text-2xs text-muted-foreground tabular-nums"
                  data-iori-part="ci-log-find-count"
                >
                  {searchMatches.length > 0
                    ? `${clampedMatchIndex + 1}/${searchMatches.length}`
                    : t("No matches")}
                </span>
              )}
              <Button
                type="button"
                variant="ghost"
                size="icon-xs"
                disabled={searchMatches.length === 0}
                aria-label={t("Previous match")}
                title={t("Previous match")}
                data-iori-action="ci-log-find-prev"
                onClick={() => jumpMatch(-1)}
              >
                <ChevronUp />
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="icon-xs"
                disabled={searchMatches.length === 0}
                aria-label={t("Next match")}
                title={t("Next match")}
                data-iori-action="ci-log-find-next"
                onClick={() => jumpMatch(1)}
              >
                <ChevronDown />
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="icon-xs"
                aria-label={t("Close")}
                data-iori-action="ci-log-find-close"
                onClick={() => {
                  setFindOpen(false);
                  setQuery("");
                }}
              >
                <X />
              </Button>
            </div>
          )}
          {errorLines.length > 0 && (
            <div className="ml-auto flex shrink-0 items-center gap-1">
              <AlertCircle
                className="size-3.5 text-status-failed-text"
                aria-hidden="true"
              />
              <span
                className="text-2xs text-status-failed-text tabular-nums"
                data-iori-part="ci-log-error-count"
              >
                {errorIndex !== undefined
                  ? `${errorIndex + 1}/${errorLines.length}`
                  : `${errorLines.length}`}
              </span>
              <Button
                type="button"
                variant="ghost"
                size="icon-xs"
                aria-label={t("Previous error")}
                title={t("Previous error")}
                data-iori-action="ci-log-prev-error"
                onClick={() => jumpError(-1)}
              >
                <ChevronUp />
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="icon-xs"
                aria-label={t("Next error")}
                title={t("Next error")}
                data-iori-action="ci-log-next-error"
                onClick={() => jumpError(1)}
              >
                <ChevronDown />
              </Button>
            </div>
          )}
        </div>
      )}
      {failure}
      {loaded.notRun ? (
        <ForgeNotice data-iori-state="ci-log-not-run">
          <p>{t("This job did not run.")}</p>
        </ForgeNotice>
      ) : loaded.availableWhenDone ? (
        <ForgeNotice data-iori-state="ci-log-when-done">
          <p>{t("GitHub returns a job's log only after the job is done.")}</p>
          {job.url && (
            <Button
              variant="outline"
              size="sm"
              className="[@media(pointer:coarse)]:min-h-11"
              data-iori-action="ci-log-open-browser"
              onClick={() => void native.openUrl(job.url!)}
            >
              <ExternalLink />
              {t("Open in browser")}
            </Button>
          )}
        </ForgeNotice>
      ) : loaded.lines.length === 0 && loaded.start === 0 ? (
        <ForgeNotice data-iori-state="ci-log-empty">
          <p>{t("There is no log yet.")}</p>
        </ForgeNotice>
      ) : (
        <div
          ref={area}
          className="flex min-h-0 flex-1 bg-terminal font-mono text-xs leading-[22px] text-terminal-foreground"
          data-wrap={wrap}
          data-iori-view="ci-log"
          data-iori-log-start={loaded.start}
          onWheel={reader}
          onTouchStart={reader}
          onKeyDown={onLogKeyDown}
        >
          <VirtualRows
            count={top + loaded.lines.length}
            rowHeight={LINE_HEIGHT}
            wrap={wrap}
            dataId="ci-log"
            label={t("Job log")}
            // Turning wrapping on or off keeps the first row in view.
            initialIndex={shownRow.current}
            scrollRequest={scroll?.wrap === wrap ? scroll.request : undefined}
            onRange={onRange}
            onPosition={onPosition}
            renderRow={(index) => {
              if (index < top)
                return (
                  <div
                    className={cn(
                      "flex min-h-[22px] items-center gap-2 px-4 font-sans",
                      wrap
                        ? "whitespace-pre-wrap [overflow-wrap:anywhere]"
                        : "whitespace-pre",
                    )}
                    data-loading
                  >
                    {earlierFailed && (
                      <CiFailure
                        subject="earlier"
                        form="inline"
                        failure={earlierFailed.forge}
                        locale={locale}
                        recovery={{
                          ...recovery,
                          onRetry: () => {
                            setEarlierFailed(undefined);
                            readEarlier();
                          },
                        }}
                      />
                    )}
                  </div>
                );
              const lineIndex = index - top;
              const line = loaded.lines[lineIndex]!;
              const rowCurrentMatch =
                currentMatch?.lineIndex === lineIndex
                  ? currentMatch
                  : undefined;
              return (
                <div
                  className={cn(
                    "min-h-[22px] px-4",
                    wrap
                      ? "whitespace-pre-wrap [overflow-wrap:anywhere]"
                      : "whitespace-pre",
                    line.kind === "error" && "text-status-failed-text",
                    line.kind === "warning" && "text-status-waiting-text",
                  )}
                  data-kind={line.kind}
                  data-iori-log-line={lineIndex}
                >
                  {renderLogLineContent(
                    line,
                    query,
                    rowCurrentMatch,
                    onOpenFile,
                    palette,
                  )}
                </div>
              );
            }}
          />
        </div>
      )}
    </>
  );
}
