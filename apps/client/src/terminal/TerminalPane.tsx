import { terminalFontFamily } from "./terminal-font-family.ts";
import {
  terminalPathLinks,
  tapTerminalLink,
  terminalUrlRegex,
} from "./file-links.ts";
import {
  hoveredLink,
  linkClickOpens,
  linkLooksClickable,
  type LinkPress,
  type TerminalLinkOpen,
} from "./link-click.ts";
import { createReadingTransport } from "../reading/transport.ts";
import type { OpenFile } from "../workspace-panel.tsx";
import { pinchedTerminalFontSize } from "./terminal-font-size.ts";
import {
  attachTerminalTouchCoordinates,
  terminalRowAtClientY,
} from "./terminal-touch-coordinates.ts";
import { terminalText, type TerminalText } from "./terminal-text.ts";
import { TerminalTextSheet } from "./TerminalTextSheet.tsx";
import {
  terminalImageExtension,
  sendTerminalImages,
} from "./terminal-images.ts";
import {
  MAX_FRAME_BYTES,
  MOBILE_TERMINAL_SNAPSHOT_BYTES,
  MOBILE_TERMINAL_SNAPSHOT_LINES,
  MAX_TERMINAL_SNAPSHOT_BYTES,
  MAX_TERMINAL_SNAPSHOT_LINES,
  buildTerminalSnapshotRestoreSequence,
  terminalServerMessageSchema,
  type TerminalViewAttributes,
  type TerminalServerMessage,
  type TerminalSummary,
  type TerminalWindowsPty,
} from "@iori/protocol";
import { ClipboardAddon } from "@xterm/addon-clipboard";
import { FitAddon } from "@xterm/addon-fit";
import { SearchAddon } from "@xterm/addon-search";
import { Unicode11Addon } from "@xterm/addon-unicode11";
import { WebLinksAddon } from "@xterm/addon-web-links";
import { WebglAddon } from "@xterm/addon-webgl";
import { Terminal, type ITheme } from "@xterm/xterm";
import {
  ANSI_COLOR_KEYS,
  DARK_ANSI_COLORS,
  DEFAULT_EXTENDED_ANSI_COLORS,
  LIGHT_ANSI_COLORS,
} from "./terminal-colors.ts";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
} from "react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { connection } from "../connection.ts";
import { native } from "../native.ts";
import { useClientWindowForeground } from "../window-presence.ts";
import { focusAfterDockLayout } from "../workspace-panel.tsx";
import {
  MobileInputControls,
  type MobileInputHandle,
} from "./MobileInputControls.tsx";
import { useTerminalModifiers } from "./use-terminal-modifiers.ts";
import {
  getVisibleTerminalAccessoryKeys,
  terminalAccessoryEntries,
  type TerminalAccessoryLayout,
} from "./terminal-accessory-layout.ts";
import { installTerminalImeCandidateAnchor } from "./terminal-ime-candidate-anchor.ts";
import { isWindowsTerminalImeEvent } from "./terminal-windows-ime-policy.ts";
import { activateOrcaTerminalUnicodeProvider } from "./terminal-unicode-provider.ts";
import { subscribeToTerminalInputData } from "./terminal-user-input-signal.ts";
import { registerTerminalInput } from "./terminal-input.ts";
import { writeTerminal } from "./terminal-write.ts";
import { buildWindowsPtyCompatibilityOptions } from "./windows-pty-compatibility.ts";
import "@xterm/xterm/css/xterm.css";
import "./terminal.css";
import { trimTerminalCopyMargin } from "./terminal-copy.ts";

type Props = {
  /** Stable for this Client's logical Terminal view across PC/Mobile layouts. */
  viewId: string;
  hostKey: string;
  onBackHandler: (handler: (() => boolean) | undefined) => void;
  child?: boolean;
  onStopChild?: () => void;
  onResume: () => Promise<boolean>;
  onCloseTerminal: () => void;
  connectionId: string;
  connected: boolean;
  foreground: boolean;
  mobile: boolean;
  claimSizeOnOpen: boolean;
  /** Changes when the user opens this Terminal; it then takes focus. */
  focusNonce?: number;
  onFocusConsumed: (nonce: number) => void;
  /** Whether the view is on screen. A hidden retained view neither measures
   * nor claims the size; showing it claims the size like opening it. */
  visible: boolean;
  onOpenFile: (file: OpenFile) => void;
  terminal: TerminalSummary;
  windowsPty?: TerminalWindowsPty;
  onClosed: (terminalId: string) => void;
  onOpenClaimConsumed: (terminalId: string) => void;
  /** The key band; it comes from this device's Client settings. */
  accessoryLayout: TerminalAccessoryLayout;
  fontSize: number;
  fontFamily: string;
  onFontSize: (size: number, save: boolean) => void;
  rightClick: "menu" | "copyPaste";
  linkOpen: TerminalLinkOpen;
  /** Undefined until this device's Client settings have been read. */
  inputPreferences?: TerminalInputPreferences;
  onInputPreferences: UpdateTerminalInputPreferences;
  t: (key: string) => string;
};

export type TerminalInputPreferences = {
  desktopWidth: boolean;
  terminals?: Record<
    string,
    Record<string, { live?: boolean; draft?: string }>
  >;
};
export type UpdateTerminalInputPreferences = (
  update: (current: TerminalInputPreferences) => TerminalInputPreferences,
) => void;
type ContextPosition = { left: number; top: number; bufferRow: number };
type TerminalDimensions = { cols: number; rows: number };
type TerminalViewRgb = [number, number, number];

// xterm dispatches this on its screen element for a finger tap.
const XTERM_TAP_EVENT = "-xterm-gesturetap";

function hexRgb(value: string): TerminalViewRgb {
  return [1, 3, 5].map((index) =>
    Number.parseInt(value.slice(index, index + 2), 16),
  ) as TerminalViewRgb;
}

function viewAttributes(
  theme: ITheme,
  colorSchemeMode: "dark" | "light",
): TerminalViewAttributes {
  const ansi = ANSI_COLOR_KEYS.map((key) => hexRgb(theme[key] ?? "#000000"));
  const extended = theme.extendedAnsi ?? DEFAULT_EXTENDED_ANSI_COLORS;
  ansi.push(...extended.map((color) => hexRgb(color)));
  return {
    foreground: hexRgb(theme.foreground ?? "#e8e8ec"),
    background: hexRgb(theme.background ?? "#17181d"),
    cursor: hexRgb(theme.cursor ?? "#8786e8"),
    ansi,
    colorSchemeMode,
    cursorStyle: "block",
    cursorBlink: true,
  };
}

function desktopDimensions(summary: TerminalSummary): TerminalDimensions {
  return summary.lastDesktopSize ?? { cols: summary.cols, rows: summary.rows };
}

function splitTerminalInput(data: string, origin?: "scroll") {
  const encoder = new TextEncoder();
  const maxDataBytes =
    MAX_FRAME_BYTES -
    encoder.encode(
      JSON.stringify({
        kind: "terminal.input",
        data: "",
        ...(origin ? { origin } : {}),
      }),
    ).byteLength;
  const chunks: string[] = [];
  let current = "";
  let currentBytes = 0;
  for (const character of data) {
    const characterBytes =
      encoder.encode(JSON.stringify(character)).byteLength - 2;
    if (current && currentBytes + characterBytes > maxDataBytes) {
      chunks.push(current);
      current = "";
      currentBytes = 0;
    }
    current += character;
    currentBytes += characterBytes;
  }
  if (current) chunks.push(current);
  return chunks;
}

function validLink(value: string) {
  try {
    const url = new URL(value);
    return url.protocol === "https:" || url.protocol === "http:";
  } catch {
    return false;
  }
}

function colorHex(value: string, fallback: string) {
  const canvas = document.createElement("canvas");
  canvas.width = 1;
  canvas.height = 1;
  const context = canvas.getContext("2d");
  if (!context) return fallback;
  context.fillStyle = fallback;
  context.fillStyle = value;
  context.fillRect(0, 0, 1, 1);
  const [red, green, blue] = context.getImageData(0, 0, 1, 1).data;
  return `#${[red, green, blue]
    .map((channel) => channel.toString(16).padStart(2, "0"))
    .join("")}`;
}

function terminalTheme(element: HTMLElement) {
  const css = getComputedStyle(element);
  const value = (name: string, fallback: string) =>
    css.getPropertyValue(name).trim() || fallback;
  const background = colorHex(value("--background", "#17181d"), "#17181d");
  const foreground = colorHex(value("--foreground", "#e8e8ec"), "#e8e8ec");
  const [red, green, blue] = [1, 3, 5].map((index) =>
    Number.parseInt(background.slice(index, index + 2), 16),
  );
  const isDark = red * 0.299 + green * 0.587 + blue * 0.114 < 128;
  const colors = isDark ? DARK_ANSI_COLORS : LIGHT_ANSI_COLORS;
  const theme: ITheme = {
    background,
    foreground,
    cursor: colorHex(value("--primary", "#8786e8"), "#8786e8"),
    selectionBackground: colorHex(value("--primary", "#8786e8"), "#8786e8"),
    // The scrollbar thumb uses the colors of the app's scroll areas.
    scrollbarSliderBackground: colorHex(
      value("--border", "#3a3b44"),
      "#3a3b44",
    ),
    scrollbarSliderHoverBackground: `${colorHex(value("--muted-foreground", "#9a9aa6"), "#9a9aa6")}99`,
    scrollbarSliderActiveBackground: `${colorHex(value("--muted-foreground", "#9a9aa6"), "#9a9aa6")}cc`,
    ...colors,
    extendedAnsi: DEFAULT_EXTENDED_ANSI_COLORS,
  };
  return {
    viewAttributes: viewAttributes(theme, isDark ? "dark" : "light"),
    theme,
  };
}

async function copySelection(
  terminal: Terminal | undefined,
  t: (key: string) => string,
  report: (message: string) => void,
) {
  if (!terminal?.hasSelection()) return;
  try {
    await native.clipboardWrite(
      trimTerminalCopyMargin(terminal.getSelection()),
    );
    terminal.clearSelection();
  } catch {
    report(t("Could not copy terminal selection."));
  }
}

export function TerminalPane({
  viewId,
  connectionId,
  connected,
  foreground,
  mobile,
  claimSizeOnOpen,
  focusNonce,
  onFocusConsumed,
  visible,
  hostKey,
  onBackHandler,
  child,
  onStopChild,
  onResume,
  onCloseTerminal,
  onOpenFile,
  terminal: summary,
  windowsPty,
  onClosed,
  onOpenClaimConsumed,
  accessoryLayout,
  fontSize,
  fontFamily,
  onFontSize,
  rightClick,
  linkOpen,
  inputPreferences,
  onInputPreferences,
  t,
}: Props) {
  const openFileRef = useRef(onOpenFile);
  openFileRef.current = onOpenFile;
  const refreshFontRef = useRef<(() => void) | undefined>(undefined);
  const fontSizeRef = useRef(fontSize);
  fontSizeRef.current = fontSize;
  const onFontSizeRef = useRef(onFontSize);
  onFontSizeRef.current = onFontSize;
  const pinchGestureRef = useRef(false);
  const [readingHistory, setReadingHistory] = useState(false);
  // The pressed action while it waits for the Host.
  const [resumingOn, setResumingOn] = useState<"retry" | "skip" | "resume">();
  const resuming = resumingOn !== undefined;
  const [resumeError, setResumeError] = useState(false);
  const windowForeground = useClientWindowForeground();
  const pasteTargetRef = useRef({ connectionId, summary });
  pasteTargetRef.current = { connectionId, summary };
  const displayRef = useRef<HTMLDivElement>(null);
  const paneRef = useRef<HTMLElement>(null);
  const linkOpenRef = useRef(linkOpen);
  linkOpenRef.current = linkOpen;
  const linkPressRef = useRef<LinkPress | undefined>(undefined);
  const mountRef = useRef<HTMLDivElement>(null);
  const terminalRef = useRef<Terminal | undefined>(undefined);
  const fitRef = useRef<FitAddon | undefined>(undefined);
  const fitTimerRef = useRef<ReturnType<typeof setTimeout> | undefined>(
    undefined,
  );
  const fitWaitersRef = useRef(new Set<(fitted: boolean) => void>());
  const paneResizingRef = useRef(false);
  const searchRef = useRef<SearchAddon | undefined>(undefined);
  const claimSizeOnOpenRef = useRef(claimSizeOnOpen);
  const onOpenClaimConsumedRef = useRef(onOpenClaimConsumed);
  // Callbacks are read through refs so a parent's re-render never reopens the
  // stream (the stream effect depends on the message handler).
  const onClosedRef = useRef(onClosed);
  onClosedRef.current = onClosed;
  const visibleRef = useRef(visible);
  visibleRef.current = visible;
  const receiving = !mobile || foreground;
  const receivingRef = useRef(receiving);
  receivingRef.current = receiving;
  claimSizeOnOpenRef.current = claimSizeOnOpen;
  onOpenClaimConsumedRef.current = onOpenClaimConsumed;
  const sizeOwnerViewIdRef = useRef<string | undefined>(undefined);
  const viewAttributesRef = useRef<TerminalViewAttributes | undefined>(
    undefined,
  );
  const streamIdRef = useRef<string | undefined>(undefined);
  const streamOpenedRef = useRef(false);
  const streamOpeningRef = useRef<Promise<void>>(Promise.resolve());
  const connectedRef = useRef(connected);
  const allowedInputRef = useRef(
    summary.state !== "exited" && summary.state !== "error",
  );
  const localDimensionsRef = useRef({ cols: 80, rows: 24 });
  const desktopDimensionsRef = useRef(desktopDimensions(summary));
  const applyingHostSizeRef = useRef(false);
  const mobileRef = useRef(mobile);
  const desktopWidthRef = useRef(false);
  const fullHistoryRef = useRef(!mobile);
  const fullHistoryLoadedRef = useRef(!mobile);
  const hasSnapshotRef = useRef(false);
  const pendingHistorySearchRef = useRef<boolean | undefined>(undefined);
  const sendQueueRef = useRef<Promise<void>>(Promise.resolve());
  const incomingQueueRef = useRef<Promise<void>>(Promise.resolve());
  const terminalEndedRef = useRef(false);
  const searchTextRef = useRef("");
  const searchCaseSensitiveRef = useRef(false);
  const tRef = useRef(t);
  const openStreamRef = useRef<(fullHistory: boolean) => void>(() => undefined);
  const fullHistoryReloadRef = useRef<() => void>(() => undefined);
  // Whether the Host kept scrollback that the last snapshot left out, and
  // whether a snapshot is being restored (its reset and writes scroll too).
  const historyTruncatedRef = useRef(false);
  const restoringRef = useRef(false);
  const [mounted, setMounted] = useState(false);
  const [streamOpened, setStreamOpened] = useState(false);
  const [streamReady, setStreamReady] = useState(false);
  const [terminalEnded, setTerminalEnded] = useState(false);
  const readyStreamIdRef = useRef<string | undefined>(undefined);
  const [transportError, setTransportError] = useState<string>();
  const [actionError, setActionError] = useState<string>();
  const mobileInputRef = useRef<MobileInputHandle>(null);
  // Reserve the send before reading/uploading: hiding the pane must drain
  // asynchronous paste work too. Use xterm's current bracketed-paste mode.
  function pasteData(text: string, bracketed: boolean) {
    const normalized = text.replace(/\r?\n/g, "\r");
    return bracketed && normalized
      ? `\x1b[200~${normalized.replace(/\x1b/g, "\u241b")}\x1b[201~`
      : normalized;
  }

  function pasteClipboard() {
    const terminal = terminalRef.current;
    if (!terminal) return;
    setActionError(undefined);
    if (mobileRef.current && !liveInputRef.current) {
      void native
        .clipboardContent()
        .then((content) => {
          if ("text" in content) mobileInputRef.current?.paste(content.text);
          else
            pasteImages([
              new File([content.image], `clipboard.${content.extension}`, {
                type: content.image.type,
              }),
            ]);
        })
        .catch(() =>
          setActionError(tRef.current("Could not read the clipboard.")),
        );
      return;
    }
    if (!connectedRef.current || !allowedInputRef.current) return;
    const bracketed = terminal.modes.bracketedPasteMode;
    const target = pasteTargetRef.current;
    setActionError(undefined);
    sendInput(
      (async () => {
        let content: Awaited<ReturnType<typeof native.clipboardContent>>;
        try {
          content = await native.clipboardContent();
        } catch {
          setActionError(tRef.current("Could not read the clipboard."));
          return "";
        }
        if ("text" in content) {
          return pasteData(content.text, bracketed);
        }
        try {
          return pasteData(
            await sendTerminalImages(target, [
              { blob: content.image, extension: content.extension },
            ]),
            bracketed,
          );
        } catch {
          setActionError(tRef.current("Could not send the image."));
          return "";
        }
      })(),
    );
  }

  function pasteImages(files: File[]) {
    const terminal = terminalRef.current;
    if (!terminal || !connectedRef.current || !allowedInputRef.current) return;
    const bracketed = terminal.modes.bracketedPasteMode;
    const target = pasteTargetRef.current;
    setActionError(undefined);
    sendInput(
      (async () => {
        try {
          const images = files.map((file) => ({
            blob: file,
            extension: terminalImageExtension(file),
          }));
          return pasteData(await sendTerminalImages(target, images), bracketed);
        } catch {
          setActionError(tRef.current("Could not send the image."));
          return "";
        }
      })(),
    );
  }

  const [searchOpen, setSearchOpen] = useState(false);
  const [searchText, setSearchText] = useState("");
  const [searchCaseSensitive, setSearchCaseSensitive] = useState(false);
  const [contextMenu, setContextMenu] = useState<ContextPosition>();
  const [selectedText, setSelectedText] = useState<TerminalText>();
  const savedInput = inputPreferences?.terminals?.[hostKey]?.[summary.id];
  const liveInput = savedInput?.live ?? !summary.cli;
  const liveInputRef = useRef(liveInput);
  liveInputRef.current = liveInput;
  const [inputExpanded, setInputExpanded] = useState(false);
  // One back handler per View: the sheet on top closes first.
  const back = useRef(onBackHandler);
  back.current = onBackHandler;
  useEffect(() => {
    back.current(
      selectedText
        ? () => {
            setSelectedText(undefined);
            return true;
          }
        : inputExpanded
          ? () => {
              setInputExpanded(false);
              return true;
            }
          : undefined,
    );
  }, [selectedText, inputExpanded]);
  useEffect(() => () => back.current(undefined), []);
  const [desktopWidth, setDesktopWidth] = useState(false);
  // The shown size, including sizes applied from the Host, for the view's marks.
  const [cols, setCols] = useState(summary.cols);
  const [rows, setRows] = useState(summary.rows);
  const [desktopHostDimensions, setDesktopHostDimensions] = useState(
    desktopDimensions(summary),
  );
  const [desktopScale, setDesktopScale] = useState(1);
  const [batchText, setLocalBatchText] = useState(savedInput?.draft ?? "");
  const batchTextRef = useRef(batchText);
  const updateInput = (change: { live?: boolean; draft?: string }) => {
    onInputPreferences((current) => {
      const next = { ...current.terminals?.[hostKey]?.[summary.id], ...change };
      if (!next.draft) delete next.draft;
      return {
        ...current,
        terminals: {
          ...current.terminals,
          [hostKey]: {
            ...current.terminals?.[hostKey],
            [summary.id]: next,
          },
        },
      };
    });
  };
  const updateInputRef = useRef(updateInput);
  updateInputRef.current = updateInput;
  const draftSaveTimer = useRef<ReturnType<typeof setTimeout> | undefined>(
    undefined,
  );
  const flushBatchText = useCallback(() => {
    if (draftSaveTimer.current === undefined) return;
    clearTimeout(draftSaveTimer.current);
    draftSaveTimer.current = undefined;
    updateInputRef.current({ draft: batchTextRef.current });
  }, []);
  const setBatchText = (draft: string) => {
    batchTextRef.current = draft;
    setLocalBatchText(draft);
    clearTimeout(draftSaveTimer.current);
    draftSaveTimer.current = setTimeout(flushBatchText, 400);
  };
  useEffect(() => {
    window.addEventListener("pagehide", flushBatchText);
    return () => {
      window.removeEventListener("pagehide", flushBatchText);
      flushBatchText();
    };
  }, [flushBatchText]);
  useEffect(() => {
    if (!foreground || !visible) flushBatchText();
  }, [foreground, visible, flushBatchText]);
  const [settingsReady, setSettingsReady] = useState(false);

  connectedRef.current = connected;
  allowedInputRef.current =
    summary.state !== "exited" && summary.state !== "error";
  mobileRef.current = mobile;
  desktopWidthRef.current = desktopWidth;
  tRef.current = t;
  searchTextRef.current = searchText;
  searchCaseSensitiveRef.current = searchCaseSensitive;

  useEffect(() => {
    const dimensions = desktopDimensions(summary);
    desktopDimensionsRef.current = dimensions;
    setDesktopHostDimensions(dimensions);
  }, [
    summary.cols,
    summary.lastDesktopSize.cols,
    summary.lastDesktopSize.rows,
    summary.rows,
  ]);

  const sendMessage = useCallback(
    (
      value: object | Promise<object[]>,
      allowStopped = false,
      input = false,
    ) => {
      const streamId = streamIdRef.current;
      const kind = (value as { kind?: string }).kind;
      const claimsSize =
        input ||
        kind === "terminal.focus" ||
        kind === "terminal.resize" ||
        kind === "terminal.input" ||
        kind === "terminal.submit";
      if (
        !streamId ||
        !receivingRef.current ||
        !connectedRef.current ||
        (!allowStopped && !allowedInputRef.current)
      ) {
        return false;
      }
      if (claimsSize) sizeOwnerViewIdRef.current = viewId;
      const opening = streamOpeningRef.current;
      const sizingOnOpen =
        kind === "terminal.focus" && !streamOpenedRef.current;
      sendQueueRef.current = sendQueueRef.current
        .then(async () => {
          await opening;
          const messages = value instanceof Promise ? await value : [value];
          // Once handed to native, delivery is unknown on failure: never replay.
          for (const message of messages) {
            const size =
              mobileRef.current && desktopWidthRef.current
                ? desktopDimensionsRef.current
                : localDimensionsRef.current;
            await native.terminalWrite(
              streamId,
              JSON.stringify(sizingOnOpen ? { ...message, ...size } : message),
            );
          }
          if (claimsSize && streamIdRef.current === streamId)
            sizeOwnerViewIdRef.current = viewId;
        })
        .catch(() => {
          if (streamIdRef.current === streamId) {
            if (claimsSize && sizeOwnerViewIdRef.current === viewId)
              sizeOwnerViewIdRef.current = undefined;
            setTransportError(
              tRef.current(
                "Input could not be sent. Check the connection before continuing.",
              ),
            );
          }
        });
      return true;
    },
    [viewId],
  );

  const detachAfterInput = useCallback((streamId: string | undefined) => {
    // Opening itself must finish before detach, even with no accepted input:
    // native has to register this stream before it can be closed.
    if (streamId)
      void Promise.allSettled([streamOpeningRef.current, sendQueueRef.current])
        .then(() => native.terminalDetach(streamId))
        .catch(() => undefined);
  }, []);

  const focusTerminal = useCallback(
    (forceClaim = false) => {
      const terminal = terminalRef.current;
      const size =
        mobileRef.current && desktopWidthRef.current
          ? desktopDimensionsRef.current
          : localDimensionsRef.current;
      if (
        terminal &&
        (terminal.cols !== size.cols || terminal.rows !== size.rows)
      ) {
        applyingHostSizeRef.current = true;
        terminal.resize(size.cols, size.rows);
        applyingHostSizeRef.current = false;
      }
      if (forceClaim || sizeOwnerViewIdRef.current !== viewId) {
        sendMessage({
          kind: "terminal.focus",
          cols: size.cols,
          rows: size.rows,
        });
      }
    },
    [sendMessage],
  );

  const fitNow = useCallback(() => {
    // Divider motion changes the pane's box, not the terminal grid. Fit once
    // on release so neither xterm nor the CLI reflows through intermediate sizes.
    if (paneResizingRef.current) return false;
    // A hidden view has no size of its own; measuring it would shrink the
    // shared PTY to a few columns.
    if (!visibleRef.current || !receivingRef.current) return false;
    const terminal = terminalRef.current;
    const fit = fitRef.current;
    const display = displayRef.current;
    if (
      !terminal ||
      !fit ||
      !display ||
      display.clientWidth === 0 ||
      display.clientHeight === 0
    )
      return false;
    const proposed = fit.proposeDimensions();
    if (!proposed) return false;
    localDimensionsRef.current = { cols: proposed.cols, rows: proposed.rows };
    // A passive layout measurement must not take the shared PTY's size away
    // from another pane. The current owner still follows its measured size;
    // opening, focusing, and user input claim size through their explicit paths.
    if (streamOpenedRef.current && sizeOwnerViewIdRef.current !== viewId) {
      return true;
    }
    if (mobileRef.current && desktopWidthRef.current && terminal) {
      const size = desktopDimensionsRef.current;
      if (terminal.cols !== size.cols || terminal.rows !== size.rows) {
        applyingHostSizeRef.current = true;
        terminal.resize(size.cols, size.rows);
        applyingHostSizeRef.current = false;
      }
      return true;
    }
    try {
      fit.fit();
      return true;
    } catch {
      // The next measurable layout notification will retry this fit.
      return false;
    }
  }, [viewId]);

  const flushFit = useCallback(() => {
    clearTimeout(fitTimerRef.current);
    fitTimerRef.current = undefined;
    const fitted = fitNow();
    if (fitted || !visibleRef.current || !receivingRef.current) {
      for (const resolve of fitWaitersRef.current) resolve(fitted);
      fitWaitersRef.current.clear();
    }
  }, [fitNow]);

  const fitTerminal = useCallback(
    (immediate = false) =>
      new Promise<boolean>((resolve) => {
        fitWaitersRef.current.add(resolve);
        clearTimeout(fitTimerRef.current);
        if (immediate) flushFit();
        else fitTimerRef.current = setTimeout(flushFit, 100);
      }),
    [flushFit],
  );

  useEffect(() => {
    if (!visible || !receiving) flushFit();
  }, [visible, receiving, flushFit]);

  const sendInput = useCallback(
    (data: string | Promise<string>, origin?: "scroll") => {
      if (
        !data ||
        !streamIdRef.current ||
        !receivingRef.current ||
        !connectedRef.current ||
        !allowedInputRef.current
      ) {
        return false;
      }
      focusTerminal();
      if (mobileRef.current && origin !== "scroll")
        terminalRef.current?.scrollToBottom();
      const messages = (text: string) =>
        splitTerminalInput(text, origin).map((part) => ({
          kind: "terminal.input",
          data: part,
          ...(origin ? { origin } : {}),
        }));
      if (typeof data === "string") {
        for (const message of messages(data)) sendMessage(message);
      } else {
        sendMessage(data.then(messages), false, true);
      }
      return true;
    },
    [focusTerminal, sendMessage],
  );

  const { modifiers, sendKey, attachInput, modifyInput } = useTerminalModifiers(
    mobile,
    sendInput,
  );

  useEffect(
    () => registerTerminalInput(summary.id, sendInput),
    [summary.id, sendInput],
  );

  const runSearch = useCallback((forward: boolean) => {
    const query = searchTextRef.current;
    if (!query) return;
    const addon = searchRef.current;
    if (!addon) return;
    const options = { caseSensitive: searchCaseSensitiveRef.current };
    if (forward) addon.findNext(query, options);
    else addon.findPrevious(query, options);
  }, []);

  const applyServerMessage = useCallback(
    async (message: TerminalServerMessage) => {
      const terminal = terminalRef.current;
      if (!terminal) return;
      if (message.kind === "terminal.snapshot") {
        sizeOwnerViewIdRef.current = message.sizeOwnerViewId;
        const desktopSize = desktopDimensions(message.terminal);
        desktopDimensionsRef.current = desktopSize;
        setDesktopHostDimensions(desktopSize);
        terminalEndedRef.current = false;
        setTerminalEnded(false);
        historyTruncatedRef.current =
          message.snapshot.scrollbackTruncated === true;
        const activeBuffer = terminal.buffer.active;
        const viewport =
          hasSnapshotRef.current && activeBuffer.viewportY < activeBuffer.baseY
            ? activeBuffer.viewportY
            : undefined;
        const viewportText =
          viewport === undefined
            ? undefined
            : activeBuffer.getLine(viewport)?.translateToString();
        const selection = terminal.getSelectionPosition();
        const selectionText = terminal.getSelection();
        const selectionLine = selection
          ? activeBuffer.getLine(selection.start.y)?.translateToString()
          : undefined;
        restoringRef.current = true;
        try {
          terminal.reset();
          applyingHostSizeRef.current = true;
          terminal.resize(message.snapshot.cols, message.snapshot.rows);
          applyingHostSizeRef.current = false;
          await writeTerminal(
            terminal,
            buildTerminalSnapshotRestoreSequence(message.snapshot),
          );
          if (
            mobileRef.current &&
            (fullHistoryRef.current || !historyTruncatedRef.current)
          )
            fullHistoryLoadedRef.current = true;
          const buffer = terminal.buffer.active;
          const findLine = (text: string | undefined, previous: number) => {
            if (text === undefined) return undefined;
            let found: number | undefined;
            for (let row = 0; row < buffer.length; row++) {
              if (buffer.getLine(row)?.translateToString() !== text) continue;
              if (
                found === undefined ||
                Math.abs(row - previous) < Math.abs(found - previous)
              )
                found = row;
            }
            return found;
          };
          if (selection) {
            const row = findLine(selectionLine, selection.start.y);
            if (row !== undefined)
              terminal.select(
                selection.start.x,
                row,
                (selection.end.y - selection.start.y) * terminal.cols +
                  selection.end.x -
                  selection.start.x,
              );
            if (terminal.getSelection() !== selectionText)
              terminal.clearSelection();
          }
          if (viewport !== undefined) {
            const row = findLine(viewportText, viewport);
            if (row === undefined) terminal.scrollToBottom();
            else terminal.scrollToLine(row);
          }
          hasSnapshotRef.current = true;
        } finally {
          restoringRef.current = false;
        }
        readyStreamIdRef.current = streamIdRef.current;
        setStreamReady(true);
        setTransportError(undefined);
        setActionError(undefined);
        if (pendingHistorySearchRef.current !== undefined) {
          const direction = pendingHistorySearchRef.current;
          pendingHistorySearchRef.current = undefined;
          runSearch(direction);
        }
        return;
      }
      if (message.kind === "terminal.output") {
        await writeTerminal(terminal, message.data);
        return;
      }
      if (message.kind === "terminal.size") {
        sizeOwnerViewIdRef.current = message.sizeOwnerViewId;
        const desktopSize = message.lastDesktopSize;
        desktopDimensionsRef.current = desktopSize;
        setDesktopHostDimensions(desktopSize);
        applyingHostSizeRef.current = true;
        terminal.resize(message.cols, message.rows);
        applyingHostSizeRef.current = false;
        return;
      }
      if (message.kind === "terminal.exit") {
        terminalEndedRef.current = true;
        setTerminalEnded(true);
        if (message.code === 0 && !summary.teamConversation)
          onClosedRef.current(summary.id);
        return;
      }
      terminalEndedRef.current = true;
      setTerminalEnded(true);
      setTransportError(
        tRef.current("Could not display this terminal. Reopen it to continue."),
      );
    },
    [runSearch, summary.id, summary.teamConversation],
  );

  const openStream = useCallback(
    async (streamId: string, fullHistory: boolean, claimSize: boolean) => {
      // The first open must use the same settled, measurable layout as later fits.
      const fitted =
        visibleRef.current && receivingRef.current
          ? await fitTerminal()
          : false;
      // A passive fit must use the owner from this stream's snapshot, not the
      // old owner from before the phone went into the background/disconnected.
      sizeOwnerViewIdRef.current = undefined;
      const dimensions =
        mobile && desktopWidthRef.current
          ? desktopDimensionsRef.current
          : localDimensionsRef.current;
      const open = {
        kind: "terminal",
        operationId: crypto.randomUUID(),
        action: "open",
        viewId,
        claimSize:
          claimSize && fitted && visibleRef.current && receivingRef.current,
        viewAttributes:
          viewAttributesRef.current ??
          terminalTheme(mountRef.current!).viewAttributes,
        deviceClass: mobile ? "mobile" : "desktop",
        terminalId: summary.id,
        cols: dimensions.cols,
        rows: dimensions.rows,
        snapshotMaxLines:
          mobile && !fullHistory
            ? MOBILE_TERMINAL_SNAPSHOT_LINES
            : MAX_TERMINAL_SNAPSHOT_LINES,
        snapshotMaxBytes:
          mobile && !fullHistory
            ? MOBILE_TERMINAL_SNAPSHOT_BYTES
            : MAX_TERMINAL_SNAPSHOT_BYTES,
      };
      await native.terminalOpen(connectionId, streamId, JSON.stringify(open));
    },
    [connectionId, mobile, summary.id, viewId, fitTerminal],
  );
  const markStreamOpened = useCallback((streamId: string) => {
    if (streamIdRef.current !== streamId) return;
    streamOpenedRef.current = true;
    setStreamOpened(true);
  }, []);

  openStreamRef.current = (fullHistory) => {
    const streamId = crypto.randomUUID();
    streamIdRef.current = streamId;
    streamOpenedRef.current = false;
    setStreamOpened(false);
    setStreamReady(false);
    const opening = streamOpeningRef.current
      .catch(() => undefined)
      .then(() => openStream(streamId, fullHistory, false));
    streamOpeningRef.current = opening;
    void opening
      .then(() => markStreamOpened(streamId))
      .catch(() => {
        if (streamIdRef.current === streamId) {
          streamIdRef.current = undefined;
          streamOpenedRef.current = false;
          setStreamOpened(false);
          setStreamReady(false);
          setTransportError(
            tRef.current(
              "Could not open this terminal. Refresh the list to check its state.",
            ),
          );
        }
        void native.terminalDetach(streamId).catch(() => undefined);
      });
  };

  // A hidden retained view keeps no stream (see the stream effect). Showing it
  // is opening it: it measures again and its new stream takes the shared size.
  useEffect(() => {
    if (
      visible &&
      windowForeground &&
      streamOpened &&
      summary.cliStatus?.state === "done"
    )
      sendMessage({ kind: "terminal.seen" });
  }, [
    visible,
    streamOpened,
    summary.cliStatus?.state,
    summary.cliStatus?.since,
    windowForeground,
    sendMessage,
  ]);

  const wasVisibleRef = useRef(visible);
  const claimOnShowRef = useRef(false);
  useEffect(() => {
    const wasVisible = wasVisibleRef.current;
    wasVisibleRef.current = visible;
    if (!visible || wasVisible) return;
    claimOnShowRef.current = true;
    fitTerminal();
  }, [visible, fitTerminal]);

  const reloadFullHistory = useCallback(() => {
    if (
      !mobileRef.current ||
      fullHistoryRef.current ||
      !historyTruncatedRef.current ||
      !connectedRef.current
    )
      return;
    const terminal = terminalRef.current;
    if (!terminal) return;
    fullHistoryRef.current = true;
    fullHistoryLoadedRef.current = false;
    const previous = streamIdRef.current;
    streamIdRef.current = undefined;
    streamOpenedRef.current = false;
    setStreamOpened(false);
    setStreamReady(false);
    detachAfterInput(previous);
    openStreamRef.current(true);
  }, [detachAfterInput]);
  fullHistoryReloadRef.current = reloadFullHistory;

  // Width is a device preference; each open view keeps its own width choice.
  useEffect(() => {
    if (!inputPreferences || settingsReady) return;
    desktopWidthRef.current = inputPreferences.desktopWidth;
    setDesktopWidth(inputPreferences.desktopWidth);
    const draft =
      inputPreferences.terminals?.[hostKey]?.[summary.id]?.draft ?? "";
    batchTextRef.current = draft;
    setLocalBatchText(draft);
    setSettingsReady(true);
  }, [inputPreferences, settingsReady, hostKey, summary.id]);

  useEffect(() => {
    const mount = mountRef.current;
    if (!mount) return;
    const openLink = (uri: string) => {
      if (!validLink(uri)) return;
      void native
        .openUrl(uri)
        .catch(() => setActionError(tRef.current("Could not open this link.")));
    };
    const opensLink = (event: MouseEvent) =>
      linkClickOpens(event, {
        mode: linkOpenRef.current,
        selected: terminal.hasSelection(),
        press: linkPressRef.current,
      });
    const activateLink = (event: MouseEvent, uri: string) => {
      if (opensLink(event)) openLink(uri);
    };
    // xterm draws a hovered link's underline and hand cursor first and makes
    // its decorations settable right after the hover callback returns, all
    // before the next frame. Ctrl, focus and the selection change them later.
    let ctrlHeld = false;
    const showLinkClickable = (ctrlKey = ctrlHeld) => {
      ctrlHeld = ctrlKey;
      const decorations = hoveredLink(terminal)?.decorations;
      if (!decorations) return;
      const clickable = linkLooksClickable(linkOpenRef.current, ctrlKey, {
        focused: !!paneRef.current?.contains(document.activeElement),
        selected: terminal.hasSelection(),
      });
      decorations.underline = clickable;
      decorations.pointerCursor = clickable;
    };
    const hoverLink = (event: MouseEvent) =>
      queueMicrotask(() => showLinkClickable(event.ctrlKey));
    const initialTheme = terminalTheme(mount);
    const terminal = new Terminal({
      linkHandler: { activate: activateLink, hover: hoverLink },
      allowProposedApi: true,
      vtExtensions: { kittyKeyboard: true },
      convertEol: false,
      cursorBlink: true,
      cursorStyle: "block",
      fontFamily: terminalFontFamily(fontFamily),
      fontSize,
      lineHeight: 1.25,
      scrollback: MAX_TERMINAL_SNAPSHOT_LINES,
      theme: initialTheme.theme,
      allowTransparency: false,
      ...buildWindowsPtyCompatibilityOptions(windowsPty),
    });
    const fit = new FitAddon();
    const search = new SearchAddon();
    const unicode = new Unicode11Addon();
    const links = new WebLinksAddon(activateLink, {
      urlRegex: terminalUrlRegex,
      hover: hoverLink,
    });
    terminal.loadAddon(fit);
    terminal.loadAddon(search);
    terminal.loadAddon(unicode);
    terminal.loadAddon(links);
    const pathLinks = terminalPathLinks(
      terminal,
      createReadingTransport(hostKey),
      () => pasteTargetRef.current.summary.cwd,
      (file) => openFileRef.current(file),
      { opens: opensLink, hover: hoverLink },
    );
    terminal.registerLinkProvider({
      provideLinks: (y, callback) => {
        void pathLinks(y).then(callback);
      },
    });
    terminal.loadAddon(
      new ClipboardAddon(undefined, {
        // Read queries are consumed below; never expose the native clipboard.
        readText: () => "",
        writeText: (_selection, text) =>
          native.clipboardWrite(text).catch(() => {
            setActionError(tRef.current("Could not copy terminal selection."));
          }),
      }),
    );
    // xterm dispatches OSC handlers newest first. The shared size owner
    // follows explicit input (including mouse reports) across Clients. Keep
    // accepting its copy even if focus moves before the CLI output arrives.
    const clipboardPolicy = terminal.parser.registerOscHandler(
      52,
      (data) =>
        data.split(";")[1] === "?" ||
        restoringRef.current ||
        sizeOwnerViewIdRef.current !== viewId,
    );
    terminal.open(mount);
    // Native copy shortcuts (such as Ctrl+Insert) reach xterm's DOM listener
    // instead of copySelection. Capture on the mount before xterm writes it.
    const onNativeCopy = (event: ClipboardEvent) => {
      if (!terminal.hasSelection() || !event.clipboardData) return;
      event.clipboardData.setData(
        "text/plain",
        trimTerminalCopyMargin(terminal.getSelection()),
      );
      event.preventDefault();
      event.stopImmediatePropagation();
    };
    mount.addEventListener("copy", onNativeCopy, true);
    const detachTouchCoordinates = attachTerminalTouchCoordinates(terminal);
    // A lost WebGL context (an app sent to the background, too many contexts)
    // falls back to xterm's DOM renderer instead of leaving a frozen screen.
    const webgl = new WebglAddon();
    let webglActive = true;
    webgl.onContextLoss(() => {
      webglActive = false;
      webgl.dispose();
    });
    terminal.loadAddon(webgl);
    refreshFontRef.current = () => {
      if (webglActive) webgl.clearTextureAtlas();
      terminal.refresh(0, terminal.rows - 1);
    };
    activateOrcaTerminalUnicodeProvider(terminal as never);
    const imeHandler = installTerminalImeCandidateAnchor(terminal);
    terminalRef.current = terminal;
    viewAttributesRef.current = initialTheme.viewAttributes;
    const syncTheme = () => {
      const nextTheme = terminalTheme(mount);
      terminal.options.theme = nextTheme.theme;
      const previousAttributes = viewAttributesRef.current;
      viewAttributesRef.current = nextTheme.viewAttributes;
      if (
        previousAttributes &&
        JSON.stringify(previousAttributes) ===
          JSON.stringify(nextTheme.viewAttributes)
      )
        return;
      sendMessage(
        {
          kind: "terminal.theme",
          viewAttributes: nextTheme.viewAttributes,
        },
        true,
      );
    };
    const themeObserver = new MutationObserver(syncTheme);
    let themeAncestor: Element | null = mount;
    while (themeAncestor) {
      themeObserver.observe(themeAncestor, {
        attributes: true,
        attributeFilter: ["class", "style", "data-theme"],
      });
      if (themeAncestor === document.documentElement) break;
      themeAncestor = themeAncestor.parentElement;
    }
    fitRef.current = fit;
    searchRef.current = search;
    setMounted(true);

    let compositionActive = false;
    const isWindows = navigator.userAgent.includes("Windows");
    terminal.attachCustomKeyEventHandler((event) => {
      // Radix dismisses menus during document capture. Focus may still be on
      // xterm while the menu animates, so do not send its consumed Esc to PTY.
      if (event.defaultPrevented) return false;
      if (event.type !== "keydown") return true;
      if (isWindowsTerminalImeEvent(event, isWindows, compositionActive)) {
        return false;
      }
      if (event.isComposing || event.keyCode === 229) return true;
      const modifier = event.ctrlKey || event.metaKey;
      const key = event.key.toLowerCase();
      if (modifier && event.shiftKey && key === "f") {
        event.preventDefault();
        setSearchOpen(true);
        if (mobileRef.current) fullHistoryReloadRef.current();
        return false;
      }
      if (modifier && event.shiftKey && key === "c") {
        event.preventDefault();
        void copySelection(terminal, tRef.current, setActionError);
        return false;
      }
      if (modifier && event.shiftKey && key === "v") {
        event.preventDefault();
        pasteClipboard();
        return false;
      }
      if (modifier && key === "c" && terminal.hasSelection()) {
        event.preventDefault();
        void copySelection(terminal, tRef.current, setActionError);
        return false;
      }
      if (modifier && key === "v") {
        event.preventDefault();
        pasteClipboard();
        return false;
      }
      return true;
    });
    const onCompositionStart = () => {
      compositionActive = true;
    };
    const onCompositionEnd = () => {
      compositionActive = false;
    };
    terminal.element?.addEventListener("compositionstart", onCompositionStart);
    terminal.element?.addEventListener("compositionend", onCompositionEnd);
    const onData = subscribeToTerminalInputData(
      terminal,
      (data, wasUserInput, origin) => {
        if (wasUserInput && connectedRef.current)
          sendInput(modifyInput(data), origin);
      },
    );
    const onResize = terminal.onResize(({ cols, rows }) => {
      setCols(cols);
      setRows(rows);
      if (applyingHostSizeRef.current) return;
      localDimensionsRef.current = { cols, rows };
      if (streamOpenedRef.current && sizeOwnerViewIdRef.current === viewId) {
        sendMessage({ kind: "terminal.resize", cols, rows });
      }
    });
    const textarea = terminal.textarea;
    if (textarea) textarea.dataset.ioriField = "terminal-input";
    const onFocus = () => {
      if (streamOpenedRef.current) focusTerminal();
    };
    textarea?.addEventListener("focus", onFocus);
    // xterm turns a finger's touch into its own gesture events and cancels the
    // mouse events a tap would make, so nothing focuses the terminal. A tap
    // (not a swipe or a long press) focuses it and opens the OS keyboard.
    const screenElement =
      terminal.element?.querySelector<HTMLElement>(".xterm-screen");
    const onTap = (event: Event) => {
      const opened = tapTerminalLink(terminal, event, pathLinks, openLink);
      if (typeof opened === "boolean") {
        if (!opened) focusFromTap();
      } else
        void opened.then((opened) => {
          if (!opened) focusFromTap();
        });
    };
    const focusFromTap = () => {
      if (mobileRef.current && !liveInputRef.current) {
        if (document.activeElement instanceof HTMLElement)
          document.activeElement.blur();
        focusTerminal();
        return;
      }
      if (terminal.options.disableStdin) return;
      // Keep an active IME composition intact. Native showSoftInput also
      // reopens the keyboard after Back without a blur/focus cycle.
      terminal.focus();
      focusTerminal();
      // The touch was cancelled, so the WebView does not open the keyboard itself.
      void native.showKeyboard().catch(() => undefined);
    };
    screenElement?.addEventListener(XTERM_TAP_EVENT, onTap);
    // The rest of the history loads when the user scrolls to the top of a
    // shortened one, not on the scrolls a restore itself causes.
    const onScroll = terminal.onScroll((viewportY) => {
      setReadingHistory(viewportY < terminal.buffer.active.baseY);
      if (
        viewportY === 0 &&
        terminal.buffer.active.baseY > 0 &&
        !restoringRef.current &&
        mobileRef.current &&
        !fullHistoryRef.current &&
        historyTruncatedRef.current
      )
        fullHistoryReloadRef.current();
    });
    // Coalesce sidebar transitions and window resizing in the same fit path.
    // Divider release already supplies an explicit end gesture; do not delay it twice.
    const resizeObserver = new ResizeObserver(() => {
      void fitTerminal();
      const display = displayRef.current;
      const container = mountRef.current;
      if (mobileRef.current && desktopWidthRef.current) {
        const width = container?.offsetWidth ?? 0;
        const viewportWidth = display?.clientWidth ?? 0;
        if (width && viewportWidth)
          setDesktopScale(Math.min(1, viewportWidth / width));
      }
    });
    let restorePaneFocus = false;
    let sidebarResizing = false;
    const beginPaneResize = (event: PointerEvent) => {
      const target = event.target;
      if (
        target instanceof Element &&
        target.closest(".dv-sash, .workspace-resize-handle")
      ) {
        clearTimeout(fitTimerRef.current);
        paneResizingRef.current = true;
        sidebarResizing = Boolean(target.closest(".sidebar-resize-handle"));
        restorePaneFocus = Boolean(
          terminal.element?.contains(document.activeElement),
        );
      }
    };
    const finishPaneResize = () => {
      if (!paneResizingRef.current) return;
      paneResizingRef.current = false;
      void fitTerminal(!sidebarResizing);
      if (restorePaneFocus) {
        restorePaneFocus = false;
        terminal.focus();
      }
    };
    // Capture the start before Dockview's pointer handler changes geometry.
    // Release outside the divider too; cancellation/focus loss ends the gesture.
    document.addEventListener("pointerdown", beginPaneResize, true);
    document.addEventListener("pointerup", finishPaneResize);
    document.addEventListener("pointercancel", finishPaneResize);
    document.addEventListener("contextmenu", finishPaneResize);
    window.addEventListener("blur", finishPaneResize);
    const onLinkModifier = (event: KeyboardEvent) => {
      if (event.key === "Control") showLinkClickable(event.ctrlKey);
    };
    const onLinkPointer = (event: MouseEvent) =>
      showLinkClickable(event.ctrlKey);
    const onLinkFocus = () => showLinkClickable();
    const pane = paneRef.current;
    window.addEventListener("keydown", onLinkModifier, true);
    window.addEventListener("keyup", onLinkModifier, true);
    mount.addEventListener("mousemove", onLinkPointer);
    pane?.addEventListener("focusin", onLinkFocus);
    pane?.addEventListener("focusout", onLinkFocus);
    const onLinkSelection = terminal.onSelectionChange(onLinkFocus);
    if (displayRef.current) resizeObserver.observe(displayRef.current);
    resizeObserver.observe(mount);
    fitTerminal();

    return () => {
      refreshFontRef.current = undefined;
      setMounted(false);
      clearTimeout(fitTimerRef.current);
      for (const resolve of fitWaitersRef.current) resolve(false);
      fitWaitersRef.current.clear();
      resizeObserver.disconnect();
      document.removeEventListener("pointerdown", beginPaneResize, true);
      document.removeEventListener("pointerup", finishPaneResize);
      document.removeEventListener("pointercancel", finishPaneResize);
      document.removeEventListener("contextmenu", finishPaneResize);
      window.removeEventListener("blur", finishPaneResize);
      window.removeEventListener("keydown", onLinkModifier, true);
      window.removeEventListener("keyup", onLinkModifier, true);
      mount.removeEventListener("mousemove", onLinkPointer);
      pane?.removeEventListener("focusin", onLinkFocus);
      pane?.removeEventListener("focusout", onLinkFocus);
      onLinkSelection.dispose();
      themeObserver.disconnect();
      onScroll.dispose();
      clipboardPolicy.dispose();
      onData.dispose();
      onResize.dispose();
      terminal.attachCustomKeyEventHandler(() => true);
      textarea?.removeEventListener("focus", onFocus);
      screenElement?.removeEventListener(XTERM_TAP_EVENT, onTap);
      terminal.element?.removeEventListener(
        "compositionstart",
        onCompositionStart,
      );
      terminal.element?.removeEventListener("compositionend", onCompositionEnd);
      if (imeHandler && terminal.element) {
        terminal.element.removeEventListener("compositionstart", imeHandler);
        terminal.element.removeEventListener("compositionupdate", imeHandler);
      }
      mount.removeEventListener("copy", onNativeCopy, true);
      detachTouchCoordinates();
      terminal.dispose();
      terminalRef.current = undefined;
      fitRef.current = undefined;
      searchRef.current = undefined;
    };
    // Host PTY compatibility must be present when xterm is constructed. The
    // workspace keys this pane by backend/build, so a Host metadata change
    // unmounts it and the stream opens again from the Host snapshot.
  }, []);

  useEffect(() => {
    const terminal = terminalRef.current;
    if (!terminal) return;
    terminal.options.fontSize = fontSize;
    const family = terminalFontFamily(fontFamily);
    terminal.options.fontFamily = family;
    fitTerminal();
    let active = true;
    // Rebuild fallback glyphs and measure again once the selected fonts load.
    void document.fonts.load(`${fontSize}px ${family}`, "Mあ\uf418").then(
      () => {
        if (!active) return;
        refreshFontRef.current?.();
        fitTerminal();
      },
      () => undefined,
    );
    return () => {
      active = false;
    };
  }, [fontSize, fontFamily, fitTerminal]);

  useEffect(() => {
    const terminal = terminalRef.current;
    if (!terminal || !mounted) return;
    terminal.options.disableStdin =
      !connected ||
      (mobile && !liveInput) ||
      summary.state === "exited" ||
      summary.state === "error";
    fitTerminal();
  }, [
    connected,
    liveInput,
    mobile,
    desktopWidth,
    mounted,
    streamOpened,
    // The snapshot restores both the Host grid and its owner. Fit again once
    // that owner is known; a passive view still cannot claim another's size.
    streamReady,
    summary.state,
    fitTerminal,
  ]);

  useEffect(() => {
    if (!mobile || !visible) return;
    // Android's IME insets shrink the WebView itself. Back/Gboard dismisses
    // the keyboard without blurring the DOM input, so release focus once the
    // full height returns. Intermediate keyboard animation sizes keep focus.
    let width = window.innerWidth;
    let fullHeight = window.innerHeight;
    let height = fullHeight;
    const onResize = () => {
      const nextHeight = window.innerHeight;
      if (window.innerWidth !== width) {
        width = window.innerWidth;
        fullHeight = nextHeight;
      } else if (nextHeight > height && nextHeight >= fullHeight) {
        const active = document.activeElement;
        if (
          active instanceof HTMLElement &&
          (paneRef.current?.contains(active) ||
            mobileInputRef.current?.contains(active))
        )
          active.blur();
      }
      fullHeight = Math.max(fullHeight, nextHeight);
      height = nextHeight;
    };
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, [mobile, visible]);

  // The user opened this Terminal: keys go to it, as in VS Code.
  useEffect(() => {
    if (focusNonce === undefined || !mounted || !visible) return;
    const panel =
      mountRef.current?.closest<HTMLElement>("[data-iori-workspace-panel]") ??
      mountRef.current;
    if (!panel) return;
    return focusAfterDockLayout(panel, (takeFocus) => {
      if (takeFocus) terminalRef.current?.focus();
      onFocusConsumed(focusNonce);
    });
  }, [focusNonce, mounted, visible, onFocusConsumed]);

  // Selecting an already shown Terminal is an operation now, not an instruction
  // for a later foreground/reconnect. The first open consumes its own claim.
  useEffect(() => {
    if (!claimSizeOnOpenRef.current || !visible) return;
    if (connected && receiving && !streamOpened) return;
    claimSizeOnOpenRef.current = false;
    onOpenClaimConsumedRef.current(summary.id);
    if (connected && receiving && streamOpened) focusTerminal(true);
  }, [
    claimSizeOnOpen,
    connected,
    receiving,
    streamOpened,
    visible,
    focusTerminal,
    summary.id,
  ]);

  useEffect(() => {
    // Only a view on screen streams: hidden tabs would otherwise keep receiving
    // every Terminal's output and slow the shown one and the Host.
    if (
      !mounted ||
      !connected ||
      !connectionId ||
      !settingsReady ||
      !visible ||
      !receiving
    ) {
      streamIdRef.current = undefined;
      streamOpenedRef.current = false;
      setStreamOpened(false);
      setStreamReady(false);
      return;
    }
    let active = true;
    let frameStop: (() => void) | undefined;
    let endedStop: (() => void) | undefined;
    const onFrame = (frame: {
      connectionId: string;
      streamId: string;
      json: string;
    }) => {
      if (
        !active ||
        frame.connectionId !== connectionId ||
        frame.streamId !== streamIdRef.current
      )
        return;
      incomingQueueRef.current = incomingQueueRef.current
        .then(async () => {
          if (!active || frame.streamId !== streamIdRef.current) return;
          const message = terminalServerMessageSchema.parse(
            JSON.parse(frame.json),
          );
          if (message) await applyServerMessage(message);
        })
        .catch(() => {
          if (
            active &&
            frame.streamId === streamIdRef.current &&
            readyStreamIdRef.current !== frame.streamId
          )
            setTransportError(
              tRef.current(
                "Could not display this terminal. Reopen it to continue.",
              ),
            );
        })
        .finally(async () => {
          await native
            .terminalAcknowledge(frame.streamId)
            .catch(() => undefined);
        });
    };
    const onEnded = (frame: {
      connectionId: string;
      streamId: string;
      reason?: string | null;
    }) => {
      if (!active || frame.connectionId !== connectionId) return;
      if (frame.streamId !== streamIdRef.current) return;
      detachAfterInput(frame.streamId);
      streamIdRef.current = undefined;
      streamOpenedRef.current = false;
      setStreamOpened(false);
      setStreamReady(false);
      if (!connectedRef.current || terminalEndedRef.current) return;
      // Reopening from a saved screen is normal flow control, not a failure.
      // Only the failed reopen below needs an alert.
      const nextId = crypto.randomUUID();
      streamIdRef.current = nextId;
      const opening = streamOpeningRef.current
        .catch(() => undefined)
        .then(() => openStream(nextId, fullHistoryRef.current, false));
      streamOpeningRef.current = opening;
      void opening
        .then(() => {
          if (active) markStreamOpened(nextId);
        })
        .catch(() => {
          if (active && streamIdRef.current === nextId) {
            streamIdRef.current = undefined;
            streamOpenedRef.current = false;
            setStreamOpened(false);
            setStreamReady(false);
            setTransportError(
              tRef.current(
                "Could not reopen this terminal. Refresh the list to check its state.",
              ),
            );
          }
          void native.terminalDetach(nextId).catch(() => undefined);
        });
    };
    const initialStreamId = crypto.randomUUID();
    streamIdRef.current = initialStreamId;
    const listening = Promise.all([
      native.onTerminalFrame(onFrame),
      native.onTerminalEnded(onEnded),
      // Keep open requests in intent order, including an opening cancelled
      // before its listeners were registered. A later view supersedes it.
      streamOpeningRef.current.catch(() => undefined),
    ]).catch((error: unknown) => {
      if (active && streamIdRef.current === initialStreamId) {
        streamIdRef.current = undefined;
        streamOpenedRef.current = false;
        setStreamOpened(false);
        setStreamReady(false);
        setTransportError(
          tRef.current("Could not listen for terminal updates."),
        );
      }
      throw error;
    });
    const opening = listening.then(([stopFrames, stopEnds]) => {
      if (!active) {
        stopFrames();
        stopEnds();
      }
      frameStop = stopFrames;
      endedStop = stopEnds;
      const claimSize =
        active && (claimSizeOnOpenRef.current || claimOnShowRef.current);
      if (active) claimOnShowRef.current = false;
      if (active && claimSizeOnOpenRef.current) {
        claimSizeOnOpenRef.current = false;
        onOpenClaimConsumedRef.current(summary.id);
      }
      return openStream(initialStreamId, fullHistoryRef.current, claimSize)
        .then(() => {
          if (active) markStreamOpened(initialStreamId);
        })
        .catch(() => {
          if (active && streamIdRef.current === initialStreamId) {
            streamIdRef.current = undefined;
            streamOpenedRef.current = false;
            setStreamOpened(false);
            setStreamReady(false);
            setTransportError(
              tRef.current(
                "Could not open this terminal. Refresh the list to check its state.",
              ),
            );
          }
          void native.terminalDetach(initialStreamId).catch(() => undefined);
          throw new Error("terminal stream could not open");
        });
    });
    streamOpeningRef.current = opening;
    void opening.catch(() => undefined);
    return () => {
      active = false;
      const streamId = streamIdRef.current;
      streamIdRef.current = undefined;
      streamOpenedRef.current = false;
      setStreamOpened(false);
      setStreamReady(false);
      frameStop?.();
      endedStop?.();
      detachAfterInput(streamId);
    };
  }, [
    applyServerMessage,
    connectionId,
    connected,
    detachAfterInput,
    markStreamOpened,
    mounted,
    openStream,
    settingsReady,
    summary.id,
    visible,
    receiving,
  ]);

  useEffect(() => {
    const display = displayRef.current;
    if (!mobile || !display) return;
    let pinch: { distance: number; size: number; current: number } | undefined;
    const distance = (touches: TouchList) =>
      Math.hypot(
        touches[0]!.clientX - touches[1]!.clientX,
        touches[0]!.clientY - touches[1]!.clientY,
      );
    const finish = () => {
      if (!pinch) return;
      if (pinch.current !== pinch.size)
        onFontSizeRef.current(pinch.current, true);
      pinch = undefined;
    };
    const touch = (event: TouchEvent) => {
      if (event.type === "touchstart" && event.touches.length === 1)
        pinchGestureRef.current = false;
      if (event.touches.length >= 2) {
        pinchGestureRef.current = true;
        setContextMenu(undefined);
        if (!pinch) {
          pinch = {
            distance: distance(event.touches),
            size: fontSizeRef.current,
            current: fontSizeRef.current,
          };
        } else {
          const next = pinchedTerminalFontSize(
            pinch.size,
            distance(event.touches) / pinch.distance,
          );
          if (next !== pinch.current) {
            pinch.current = next;
            onFontSizeRef.current(next, false);
          }
        }
      } else finish();
      if (pinchGestureRef.current) event.preventDefault();
    };
    // Let xterm retire its touch records, but stop the gestures it derives from
    // two fingers (including release taps and inertia) until the next touch.
    const suppressGesture = (event: Event) => {
      if (!pinchGestureRef.current) return;
      event.preventDefault();
      event.stopImmediatePropagation();
    };
    const touches = [
      "touchstart",
      "touchmove",
      "touchend",
      "touchcancel",
    ] as const;
    const gestures = [
      "-xterm-gesturestart",
      "-xterm-gesturechange",
      XTERM_TAP_EVENT,
      "-xterm-gesturecontextmenu",
    ];
    for (const type of touches)
      display.addEventListener(type, touch, { capture: true, passive: false });
    for (const type of gestures)
      display.addEventListener(type, suppressGesture, true);
    return () => {
      finish();
      for (const type of touches)
        display.removeEventListener(type, touch, true);
      for (const type of gestures)
        display.removeEventListener(type, suppressGesture, true);
      pinchGestureRef.current = false;
    };
  }, [mobile]);

  const visibleKeys = useMemo(
    () => getVisibleTerminalAccessoryKeys(accessoryLayout),
    [accessoryLayout],
  );
  const swipeKeys = useMemo(() => {
    const keys = new Map(
      terminalAccessoryEntries(accessoryLayout).map(({ key }) => [key.id, key]),
    );
    return new Map(
      Object.entries(accessoryLayout.swipeUp).flatMap(([source, target]) => {
        const key = target ? keys.get(target) : undefined;
        return key ? [[source, key] as const] : [];
      }),
    );
  }, [accessoryLayout]);

  const openContextMenu = useCallback(
    (clientX: number, clientY: number) => {
      const host = displayRef.current;
      if (!host) return;
      const rect = host.getBoundingClientRect();
      setContextMenu({
        bufferRow:
          mobile && terminalRef.current
            ? terminalRowAtClientY(terminalRef.current, clientY)
            : 0,
        left: Math.max(8, Math.min(clientX - rect.left, rect.width - 190)),
        top: Math.max(8, Math.min(clientY - rect.top, rect.height - 150)),
      });
    },
    [mobile],
  );
  useEffect(() => {
    const display = displayRef.current;
    if (!mobile || !display) return;
    const onLongPress = (event: Event) => {
      if (pinchGestureRef.current) return;
      // xterm cancels native touch/contextmenu and emits this non-bubbling
      // gesture on release. Its coordinates are page pixels; the row lookup
      // applies the shrunk view's scale from the screen's own rectangle.
      const gesture = event as Event & { pageX: number; pageY: number };
      event.preventDefault();
      event.stopPropagation();
      openContextMenu(
        gesture.pageX - window.scrollX,
        gesture.pageY - window.scrollY,
      );
    };
    display.addEventListener("-xterm-gesturecontextmenu", onLongPress, true);
    return () =>
      display.removeEventListener(
        "-xterm-gesturecontextmenu",
        onLongPress,
        true,
      );
  }, [mobile, openContextMenu]);

  const search = (forward: boolean) => {
    if (
      mobile &&
      !fullHistoryLoadedRef.current &&
      historyTruncatedRef.current
    ) {
      pendingHistorySearchRef.current = forward;
      reloadFullHistory();
      return;
    }
    runSearch(forward);
  };

  const setInputMode = (live: boolean) => {
    updateInput({ live });
  };
  const setWidthMode = (desktop: boolean) => {
    desktopWidthRef.current = desktop;
    setDesktopWidth(desktop);
    onInputPreferences((current) => ({ ...current, desktopWidth: desktop }));
    requestAnimationFrame(() => {
      applyingHostSizeRef.current = true;
      void fitTerminal(true);
      applyingHostSizeRef.current = false;
      const dimensions = desktop
        ? desktopDimensionsRef.current
        : localDimensionsRef.current;
      const terminal = terminalRef.current;
      if (
        terminal &&
        (terminal.cols !== dimensions.cols || terminal.rows !== dimensions.rows)
      ) {
        applyingHostSizeRef.current = true;
        terminal.resize(dimensions.cols, dimensions.rows);
        applyingHostSizeRef.current = false;
      }
      sendMessage({
        kind: "terminal.resize",
        cols: dimensions.cols,
        rows: dimensions.rows,
      });
    });
  };
  const resolveSetup = (action: "retry" | "skip") => {
    setResumingOn(action);
    setActionError(undefined);
    void connection
      .requestHost(hostKey, "terminal.setup", {
        terminalId: summary.id,
        action,
      })
      .then((result) => {
        if (result && !result.ok)
          setActionError(
            t(
              "Could not start the CLI or team. Check its settings and try again.",
            ),
          );
      })
      .catch(() => {})
      .finally(() => setResumingOn(undefined));
  };
  const disabledInput =
    !connected || summary.state === "exited" || summary.state === "error";
  const screenWidthClass = mobile && desktopWidth ? "is-desktop-width" : "";
  const scaleStyle = {
    "--terminal-scale": String(desktopScale),
    "--terminal-desktop-cols": String(desktopHostDimensions.cols),
    "--terminal-desktop-rows": String(desktopHostDimensions.rows),
  } as CSSProperties;

  // Runs before xterm and the width claim see the press.
  const pressLink = (event: MouseEvent) => {
    const terminal = terminalRef.current;
    const press = {
      focused: !!paneRef.current?.contains(document.activeElement),
      selected: !!terminal?.hasSelection(),
      clicks: event.detail,
    };
    linkPressRef.current = press;
    if (
      !terminal ||
      terminal.modes.mouseTrackingMode === "none" ||
      !hoveredLink(terminal) ||
      !linkClickOpens(event, {
        mode: linkOpenRef.current,
        selected: press.selected,
        press,
      })
    )
      return;
    // A click that opens the link does not reach a CLI reading the mouse.
    // While this option is on, xterm reports the mouse only with Alt held.
    terminal.options.mouseEventsRequireAlt = true;
    const release = new AbortController();
    const restore = () => {
      terminal.options.mouseEventsRequireAlt = false;
      release.abort();
    };
    window.addEventListener("mouseup", restore, { signal: release.signal });
    window.addEventListener("blur", restore, { signal: release.signal });
  };

  return (
    <section
      ref={paneRef}
      onPasteCapture={(event) => {
        if (!mobile || event.clipboardData.getData("text/plain")) return;
        const files = Array.from(event.clipboardData.files);
        if (!files.length) return;
        event.preventDefault();
        event.stopPropagation();
        pasteImages(files);
      }}
      className="terminal-workspace terminal-pane cli-view"
      data-iori-view="terminal"
      data-iori-terminal-id={summary.id}
      data-iori-host-key={hostKey}
      data-iori-displayed={visible ? "true" : "false"}
      data-iori-state={summary.state}
      data-iori-cols={cols}
      data-iori-rows={rows}
      data-iori-stream-id={streamIdRef.current}
      data-iori-stream-state={
        !connected
          ? "disconnected"
          : terminalEnded
            ? "ended"
            : streamOpened && streamReady
              ? "ready"
              : streamOpened
                ? "restoring"
                : "opening"
      }
    >
      {!summary.setup &&
        summary.state === "error" &&
        typeof summary.exitCode === "number" && (
          <div className="terminal-exit-label" data-iori-state="terminal-exit">
            {t("Exited with code")} {summary.exitCode}
          </div>
        )}

      {summary.setup?.state === "failed" && (
        <div
          className="terminal-resume-row"
          role="alert"
          data-iori-state="setup-failed"
        >
          <span>
            {summary.setup.exitCode === undefined
              ? t("Setup command was interrupted")
              : t("Setup command failed (exit {code})").replace(
                  "{code}",
                  String(summary.setup.exitCode),
                )}
          </span>
          {!child && (
            <div className="terminal-setup-actions">
              <Button
                variant="outline"
                size="sm"
                disabled={!connected || resuming}
                pending={resumingOn === "retry"}
                data-iori-action="setup-retry"
                onClick={() => resolveSetup("retry")}
              >
                {t("Run again")}
              </Button>
              <Button
                variant="outline"
                size="sm"
                disabled={!connected || resuming}
                pending={resumingOn === "skip"}
                data-iori-action="setup-skip"
                onClick={() => resolveSetup("skip")}
              >
                {t("Start anyway")}
              </Button>
            </div>
          )}
        </div>
      )}
      {actionError && (
        <p className="terminal-inline-error" role="alert">
          {actionError}
        </p>
      )}
      {transportError && (
        <p className="terminal-inline-error" role="alert">
          {transportError}
          <Button
            variant="outline"
            size="xs"
            data-iori-action="terminal-reopen"
            onClick={() => {
              setTransportError(undefined);
              terminalEndedRef.current = false;
              setTerminalEnded(false);
              const previous = streamIdRef.current;
              detachAfterInput(previous);
              openStreamRef.current(fullHistoryRef.current);
            }}
          >
            {t("Reopen")}
          </Button>
        </p>
      )}
      {summary.restartPending && (
        <div className="terminal-notice" data-iori-state="restart-pending">
          {t(
            "The previous shell ended when the Host restarted. A new shell will start when this terminal is opened.",
          )}
        </div>
      )}

      {searchOpen && (
        <div
          className="terminal-search-bar cli-search-row"
          data-iori-panel="terminal-search"
        >
          <Input
            autoFocus
            aria-label={t("Search terminal output")}
            data-iori-field="terminal-search"
            value={searchText}
            onChange={(event) => setSearchText(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault();
                search(!event.shiftKey);
              }
              if (event.key === "Escape") {
                setSearchOpen(false);
                terminalRef.current?.focus();
              }
            }}
          />
          <label className="terminal-search-case">
            <Switch
              checked={searchCaseSensitive}
              onCheckedChange={setSearchCaseSensitive}
              aria-label={t("Case sensitive")}
            />
            {t("Case sensitive")}
          </label>
          <Button
            variant="ghost"
            size="icon-sm"
            data-iori-action="terminal-search-previous"
            onClick={() => search(false)}
            aria-label={t("Previous match")}
          >
            ↑
          </Button>
          <Button
            variant="ghost"
            size="icon-sm"
            data-iori-action="terminal-search-next"
            onClick={() => search(true)}
            aria-label={t("Next match")}
          >
            ↓
          </Button>
          <Button
            variant="ghost"
            size="icon-sm"
            data-iori-action="terminal-search-close"
            onClick={() => {
              setSearchOpen(false);
              terminalRef.current?.focus();
            }}
            aria-label={t("Close")}
          >
            ×
          </Button>
        </div>
      )}

      <div
        className={`terminal-display cli-screen-frame cli-terminal-screen ${screenWidthClass}`}
        ref={displayRef}
        data-iori-part="terminal-viewport"
        data-iori-mobile={mobile ? "true" : undefined}
        onClick={() => setContextMenu(undefined)}
        onMouseDownCapture={(event) => {
          if (event.button === 0) pressLink(event.nativeEvent);
          if (!mobile && event.button === 0) focusTerminal();
          if (event.button === 2 && event.ctrlKey) {
            event.preventDefault();
            event.stopPropagation();
          }
        }}
        onMouseUpCapture={(event) => {
          if (event.button === 2 && event.ctrlKey) {
            event.preventDefault();
            event.stopPropagation();
          }
        }}
        onContextMenuCapture={(event) => {
          event.preventDefault();
          if (pinchGestureRef.current) {
            event.stopPropagation();
            return;
          }
          const terminal = terminalRef.current;
          if (!mobile && !event.ctrlKey) {
            if (
              terminal &&
              terminal.modes.mouseTrackingMode !== "none" &&
              !event.shiftKey
            )
              return;
            if (rightClick === "copyPaste") {
              event.stopPropagation();
              if (terminal?.hasSelection()) {
                void copySelection(terminal, t, setActionError);
              } else {
                pasteClipboard();
              }
              return;
            }
          }
          event.stopPropagation();
          openContextMenu(event.clientX, event.clientY);
        }}
      >
        <div
          className={`terminal-fit ${screenWidthClass}`}
          ref={mountRef}
          style={scaleStyle}
          data-iori-part="terminal-screen"
        />
        {mobile && readingHistory && (
          <Button
            className="terminal-jump-latest"
            variant="secondary"
            size="sm"
            data-iori-action="terminal-jump-latest"
            onClick={() => terminalRef.current?.scrollToBottom()}
          >
            {t("Jump to latest")}
          </Button>
        )}
        {!mounted && !transportError && (
          <div className="terminal-loading">{t("Opening terminal…")}</div>
        )}
        <DropdownMenu
          open={Boolean(contextMenu)}
          onOpenChange={(open) => {
            if (!open) setContextMenu(undefined);
          }}
        >
          <DropdownMenuTrigger asChild>
            <Button
              variant="ghost"
              size="icon-sm"
              className="terminal-context-anchor"
              style={
                contextMenu
                  ? { left: contextMenu.left, top: contextMenu.top }
                  : undefined
              }
              aria-label={t("Terminal actions")}
              data-iori-action="terminal-context-menu"
            />
          </DropdownMenuTrigger>
          <DropdownMenuContent
            className="terminal-context-menu"
            side="bottom"
            align="start"
          >
            <DropdownMenuItem
              disabled={!terminalRef.current?.hasSelection()}
              onSelect={() => {
                setContextMenu(undefined);
                void copySelection(terminalRef.current, t, setActionError);
              }}
              data-iori-action="terminal-copy"
            >
              {t("Copy")}
            </DropdownMenuItem>
            <DropdownMenuItem
              disabled={disabledInput}
              onSelect={() => {
                setContextMenu(undefined);
                pasteClipboard();
              }}
              data-iori-action="terminal-paste-menu"
            >
              {t("Paste")}
            </DropdownMenuItem>
            {onStopChild && (
              <DropdownMenuItem
                data-iori-action="child-tab-stop"
                onSelect={onStopChild}
              >
                {t("Stop child")}
              </DropdownMenuItem>
            )}
            {mobile && (
              <DropdownMenuItem
                data-iori-action="terminal-select-text"
                onSelect={() => {
                  const terminal = terminalRef.current;
                  if (terminal && contextMenu) {
                    setSelectedText(
                      terminalText(
                        terminal.buffer.active,
                        terminal.rows,
                        contextMenu.bufferRow,
                      ),
                    );
                  }
                  setContextMenu(undefined);
                }}
              >
                {t("Select as text")}
              </DropdownMenuItem>
            )}
            <DropdownMenuItem
              onSelect={() => {
                setContextMenu(undefined);
                setSearchOpen(true);
                if (mobile) reloadFullHistory();
              }}
              data-iori-action="terminal-search-open"
            >
              {t("Search")}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      {selectedText && (
        <TerminalTextSheet
          text={selectedText}
          onClose={() => setSelectedText(undefined)}
          t={t}
        />
      )}

      {!child && summary.cliResumePending && (
        <div
          className="terminal-resume-row"
          data-iori-state="cli-resume-pending"
        >
          <span>
            {t(
              summary.cliResumeReason === "exit"
                ? "The CLI has exited"
                : "The CLI was interrupted",
            )}
          </span>
          <Button
            variant="ghost"
            size="sm"
            disabled={
              !connected ||
              (!summary.teamConversation && !streamReady) ||
              resuming
            }
            pending={resumingOn === "resume"}
            data-iori-action="cli-resume"
            onClick={() => {
              setResumingOn("resume");
              setResumeError(false);
              void onResume()
                .then((ok) => {
                  setResumeError(!ok);
                  if (ok) {
                    if (summary.teamConversation)
                      openStreamRef.current(fullHistoryRef.current);
                    focusTerminal();
                  }
                })
                .finally(() => setResumingOn(undefined));
            }}
          >
            {t("Resume")}
          </Button>
          <Button
            variant="ghost"
            size="sm"
            data-iori-action="cli-resume-close"
            disabled={!connected}
            onClick={onCloseTerminal}
          >
            {t("Close")}
          </Button>
        </div>
      )}
      {resumeError && (
        <p className="terminal-inline-error" role="alert">
          {t("Could not resume the CLI. Retry.")}
        </p>
      )}
      {mobile && (
        <MobileInputControls
          handle={mobileInputRef}
          visible={visible}
          expanded={inputExpanded}
          setExpanded={setInputExpanded}
          keys={visibleKeys}
          swipeKeys={swipeKeys}
          modifiers={modifiers}
          attachInput={attachInput}
          showButtonNames={accessoryLayout.showButtonNames}
          live={liveInput}
          desktopWidth={desktopWidth}
          disabled={disabledInput || !settingsReady}
          pasteDisabled={!settingsReady || (liveInput && disabledInput)}
          batchText={batchText}
          onLive={setInputMode}
          onWidth={setWidthMode}
          onBatchText={setBatchText}
          onBatchBlur={flushBatchText}
          onBatchSend={() => {
            const value = batchText;
            if (!value) return false;
            focusTerminal();
            const sent = sendMessage({ kind: "terminal.submit", data: value });
            if (sent) {
              terminalRef.current?.scrollToBottom();
              setBatchText("");
              flushBatchText();
            }
            return sent;
          }}
          onImages={pasteImages}
          onPaste={pasteClipboard}
          onKey={sendKey}
          t={t}
        />
      )}
    </section>
  );
}
