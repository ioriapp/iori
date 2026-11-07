import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
} from "react";
import { ChevronDown, ChevronRight, ExternalLink } from "lucide-react";
import {
  forgeCiState,
  type ForgeCiJob,
  type ForgeCiStep,
  type ForgeReadFailure,
} from "@iori/protocol";
import { connection } from "../connection.ts";
import { native } from "../native.ts";
import { Button } from "../components/ui/button";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "../components/ui/collapsible.tsx";
import { VirtualRows, type ScrollRequest } from "../reading/VirtualRows.tsx";
import { ansiPalette } from "../terminal/terminal-colors.ts";
import {
  failedStepEnd,
  logLines,
  parseLogLine,
  type LogColor,
  type LogLine,
  type LogStyle,
} from "./ci-log.ts";
import { ciDuration } from "./ci-format.ts";
import { CiStateIcon } from "./CiStateIcon.tsx";
import { CiFailure } from "./CiFailure.tsx";
import type { ForgeRecovery } from "./ForgeFailure.tsx";
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

/** The job's steps as the Forge lists them (GitHub), its failed step marked. */
function Steps({
  steps,
  open,
  onOpen,
}: {
  steps: ForgeCiStep[];
  open: boolean;
  onOpen: (open: boolean) => void;
}) {
  const now = Date.now();
  const current =
    steps.find((step) => forgeCiState(step.status) === "failed") ??
    steps.find((step) => forgeCiState(step.status) === "running");
  const list = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    list.current
      ?.querySelector('[data-current="true"]')
      ?.scrollIntoView({ block: "nearest" });
  }, [open]);
  return (
    <Collapsible asChild open={open} onOpenChange={onOpen}>
      <div className="ci-steps" data-iori-part="ci-steps" data-open={open}>
        <CollapsibleTrigger asChild>
          <button
            type="button"
            className="ci-steps-toggle"
            aria-expanded={open}
            data-iori-action="ci-steps-toggle"
          >
            {open ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
            <span>Steps</span>
            <span className="ci-meta">{steps.length}</span>
            {!open && current && (
              <span className="ci-steps-current">
                <CiStateIcon state={forgeCiState(current.status)} />
                <span className="reading-truncate">{current.name}</span>
              </span>
            )}
          </button>
        </CollapsibleTrigger>
        <CollapsibleContent>
          <div className="ci-step-list" ref={list}>
            {steps.map((step, index) => (
              <div
                key={index}
                className="ci-step"
                data-current={step === current || undefined}
                data-iori-ci-step={step.name}
              >
                <CiStateIcon state={forgeCiState(step.status)} />
                <span className="ci-name">{step.name}</span>
                <span className="ci-meta">{ciDuration(step, now)}</span>
              </div>
            ))}
          </div>
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
  locale,
  recovery,
}: {
  hostKey: string;
  root: string;
  job: ForgeCiJob;
  wrap: boolean;
  /** Changes when the end of the log is to be read again. */
  refresh: string;
  stepsOpen: boolean;
  onStepsOpen: (open: boolean) => void;
  locale: string;
  /** The CI View's ways to recover from a failed read besides a retry. */
  recovery: Omit<ForgeRecovery, "onRetry">;
}) {
  const ja = locale.startsWith("ja");
  const palette = usePalette();
  const [loaded, setLoaded] = useState<Loaded>();
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

  const steps = loaded?.steps?.length ? (
    <Steps steps={loaded.steps} open={stepsOpen} onOpen={onStepsOpen} />
  ) : null;
  const failure = failed && (
    <CiFailure
      subject="log"
      form={loaded ? "line" : "notice"}
      failure={failed.forge}
      locale={locale}
      recovery={{ ...recovery, onRetry: () => setRetry((value) => value + 1) }}
    />
  );
  if (!loaded) return failure || null;
  const top = loaded.start > 0 ? 1 : 0;
  return (
    <>
      {steps}
      {failure}
      {loaded.notRun ? (
        <p className="reading-empty" data-iori-state="ci-log-not-run">
          {ja ? "このジョブは実行されませんでした。" : "This job did not run."}
        </p>
      ) : loaded.availableWhenDone ? (
        <div className="ci-browser-only" data-iori-state="ci-log-when-done">
          <p>
            {ja
              ? "ジョブが完了するまで、ログは表示されません。"
              : "GitHub returns a job's log only after the job is done."}
          </p>
          {job.url && (
            <Button
              variant="outline"
              size="sm"
              data-iori-action="ci-log-open-browser"
              onClick={() => void native.openUrl(job.url!)}
            >
              <ExternalLink />
              {ja ? "ブラウザーで開く" : "Open in browser"}
            </Button>
          )}
        </div>
      ) : loaded.lines.length === 0 && loaded.start === 0 ? (
        <p className="reading-empty" data-iori-state="ci-log-empty">
          {ja ? "ログはまだありません。" : "There is no log yet."}
        </p>
      ) : (
        <div
          ref={area}
          className="ci-log"
          data-wrap={wrap}
          data-iori-view="ci-log"
          data-iori-log-start={loaded.start}
          onWheel={reader}
          onTouchStart={reader}
          onKeyDown={reader}
        >
          <VirtualRows
            count={top + loaded.lines.length}
            rowHeight={LINE_HEIGHT}
            wrap={wrap}
            dataId="ci-log"
            label={ja ? "ジョブのログ" : "Job log"}
            // Turning wrapping on or off keeps the first row in view.
            initialIndex={shownRow.current}
            scrollRequest={scroll?.wrap === wrap ? scroll.request : undefined}
            onRange={onRange}
            onPosition={onPosition}
            renderRow={(index) => {
              if (index < top)
                return (
                  <div className="ci-log-line ci-log-earlier" data-loading>
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
              const line = loaded.lines[index - top]!;
              return (
                <div
                  className="ci-log-line"
                  data-kind={line.kind}
                  data-iori-log-line={index - top}
                >
                  {line.spans.map((span, at) => (
                    <span key={at} style={spanStyle(span.style, palette)}>
                      {span.text}
                    </span>
                  ))}
                </div>
              );
            }}
          />
        </div>
      )}
    </>
  );
}
