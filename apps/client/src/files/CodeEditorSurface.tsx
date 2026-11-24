import {
  useCallback,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
  type Ref,
} from "react";
import {
  Compartment,
  EditorSelection,
  EditorState,
  RangeSetBuilder,
  StateEffect,
  StateField,
  type Extension,
} from "@codemirror/state";
import {
  Decoration,
  EditorView,
  ViewPlugin,
  drawSelection,
  highlightActiveLine,
  highlightActiveLineGutter,
  keymap,
  lineNumbers,
  type DecorationSet,
  type ViewUpdate,
} from "@codemirror/view";
import {
  defaultKeymap,
  history,
  historyKeymap,
  indentWithTab,
} from "@codemirror/commands";
import {
  highlightSelectionMatches,
  openSearchPanel,
  search,
  searchKeymap,
} from "@codemirror/search";
import {
  LanguageDescription,
  bracketMatching,
  indentOnInput,
} from "@codemirror/language";
import { languages } from "@codemirror/language-data";
import {
  AlertTriangle,
  CircleAlert,
  ClipboardCopy,
  Copy,
  CornerDownLeft,
  Search,
  X,
} from "lucide-react";
import type { FileInfo } from "@iori/protocol";
import { Button } from "../components/ui/button";
import { Input } from "../components/ui/input";
import { translator } from "../i18n.ts";
import { native } from "../native.ts";
import { PathMenu, type MenuAction } from "../reading/PathMenu.tsx";
import { ReadingError } from "../reading/ReadingError.tsx";
import { ReadingLoading } from "../reading/ReadingStates.tsx";
import type { TextPosition } from "../reading/TextRows.tsx";
import {
  ReadError,
  decodeBytes,
  isAbort,
  readErrorCopy,
  type ReadingTransport,
} from "../reading/transport.ts";
import {
  editorPhrasesExtension,
  ioriEditorExtensions,
} from "./codemirror-theme.ts";

export const MAX_EDIT_BYTES = 2 * 1024 * 1024;
export const MAX_EDIT_LINE_LENGTH = 20_000;

const READ_CHUNK_BYTES = 524_288;
const AUTOSAVE_DEBOUNCE_MS = 800;
const MAX_READ_RETRIES = 3;

export type FileSaveParams = {
  contentBase64: string;
  expectedRevision?: string;
  force?: boolean;
};

export type FileSaveResult = {
  revision: string;
  sizeBytes: number;
  modifiedAtMs: number;
};

export type CodeEditorStatus = {
  dirty: boolean;
  saving: boolean;
  conflict: boolean;
  saveError?: string;
  editing: boolean;
  readOnly: boolean;
};

export type CodeEditorHandle = {
  save(force?: boolean): Promise<boolean>;
  reload(): Promise<void>;
  isDirty(): boolean;
  hasConflict(): boolean;
  hasSaveError(): boolean;
  setEditing(editing: boolean): void;
  goToLine(line: number): void;
  openFind(replace?: boolean): void;
};

export type CodeEditorSurfaceProps = {
  handle?: Ref<CodeEditorHandle>;
  transport: ReadingTransport;
  root: string;
  info: FileInfo;
  position: TextPosition;
  onPosition: (value: TextPosition) => void;
  wrap: boolean;
  locale: string;
  editing: boolean;
  onEditingChange?: (editing: boolean) => void;
  findRequest?: number;
  replaceRequest?: number;
  goToRequest?: number;
  jumpRequest?: { id: number; line: number };
  extraActions?: MenuAction[];
  refresh: number;
  saveFile: (params: FileSaveParams) => Promise<FileSaveResult>;
  onSaved?: (result: FileSaveResult) => void;
  onStatusChange?: (status: CodeEditorStatus) => void;
  onFallbackReadOnly: (
    reason: "too_large" | "invalid_utf8" | "long_line",
  ) => void;
};

type DecodedFile = {
  text: string;
  revision: string | undefined;
  hasBom: boolean;
  eol: "\n" | "\r\n";
};

function isJapanese(locale: string): boolean {
  return locale.toLowerCase().startsWith("ja");
}

function encodeBase64(bytes: Uint8Array): string {
  const chunkSize = 0x8000;
  const parts: string[] = [];
  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    const slice = bytes.subarray(
      offset,
      Math.min(offset + chunkSize, bytes.length),
    );
    parts.push(String.fromCharCode(...slice));
  }
  return btoa(parts.join(""));
}

function encodeDocumentToBase64(
  text: string,
  eol: "\n" | "\r\n",
  hasBom: boolean,
): string {
  const normalized = eol === "\r\n" ? text.replaceAll("\n", "\r\n") : text;
  const body = new TextEncoder().encode(normalized);
  if (!hasBom) return encodeBase64(body);
  const withBom = new Uint8Array(body.length + 3);
  withBom[0] = 0xef;
  withBom[1] = 0xbb;
  withBom[2] = 0xbf;
  withBom.set(body, 3);
  return encodeBase64(withBom);
}

function hasOversizedLine(text: string): boolean {
  let start = 0;
  for (let index = 0; index <= text.length; index += 1) {
    if (index === text.length || text.charCodeAt(index) === 10) {
      if (index - start > MAX_EDIT_LINE_LENGTH) return true;
      start = index + 1;
    }
  }
  return false;
}

function concatBytes(parts: Uint8Array[], totalLength: number): Uint8Array {
  const combined = new Uint8Array(totalLength);
  let offset = 0;
  for (const part of parts) {
    combined.set(part, offset);
    offset += part.length;
  }
  return combined;
}

async function readFullEditableFile(
  transport: ReadingTransport,
  root: string,
  path: string,
  signal: AbortSignal,
): Promise<
  | { ok: true; file: DecodedFile }
  | { ok: false; reason: "too_large" | "invalid_utf8" | "long_line" }
> {
  for (let attempt = 0; attempt <= MAX_READ_RETRIES; attempt += 1) {
    const parts: Uint8Array[] = [];
    let totalBytes = 0;
    let offset = 0;
    let readRevision: string | undefined;
    let restarted = false;

    for (;;) {
      const result = await transport.request(
        "files.read",
        { root, path, offset, length: READ_CHUNK_BYTES },
        signal,
      );
      if (readRevision === undefined) {
        readRevision = result.revision;
      } else if (result.revision !== readRevision) {
        restarted = true;
        break;
      }
      const chunk = decodeBytes(result.bytesBase64);
      totalBytes += chunk.byteLength;
      if (totalBytes > MAX_EDIT_BYTES) {
        return { ok: false, reason: "too_large" };
      }
      parts.push(chunk);
      offset = result.nextOffset;
      if (result.eof) break;
    }

    if (restarted) continue;

    const allBytes = concatBytes(parts, totalBytes);
    const hasBom =
      allBytes.length >= 3 &&
      allBytes[0] === 0xef &&
      allBytes[1] === 0xbb &&
      allBytes[2] === 0xbf;
    const contentBytes = hasBom ? allBytes.subarray(3) : allBytes;

    let decoded: string;
    try {
      decoded = new TextDecoder("utf-8", { fatal: true }).decode(contentBytes);
    } catch {
      return { ok: false, reason: "invalid_utf8" };
    }

    let crlfCount = 0;
    let lfOnlyCount = 0;
    for (let index = 0; index < decoded.length; index += 1) {
      if (decoded.charCodeAt(index) === 10) {
        if (index > 0 && decoded.charCodeAt(index - 1) === 13) crlfCount += 1;
        else lfOnlyCount += 1;
      }
    }
    const eol: "\n" | "\r\n" = crlfCount > lfOnlyCount ? "\r\n" : "\n";
    const text = decoded.replaceAll("\r\n", "\n");
    if (hasOversizedLine(text)) {
      return { ok: false, reason: "long_line" };
    }
    return {
      ok: true,
      file: { text, revision: readRevision, hasBom, eol },
    };
  }
  throw new ReadError("read_failed");
}

function fileNameOf(path: string): string {
  const slash = Math.max(path.lastIndexOf("/"), path.lastIndexOf("\\"));
  return slash < 0 ? path : path.slice(slash + 1);
}

const setSelectedLinesEffect = StateEffect.define<
  { start: number; end: number } | undefined
>();

const selectedLinesField = StateField.define<
  { start: number; end: number } | undefined
>({
  create: () => undefined,
  update(value, transaction) {
    for (const effect of transaction.effects) {
      if (effect.is(setSelectedLinesEffect)) return effect.value;
    }
    return value;
  },
});

function visibleLineAttributes(view: EditorView): DecorationSet {
  const builder = new RangeSetBuilder<Decoration>();
  const selected = view.state.field(selectedLinesField, false);
  const selectedStart = selected
    ? Math.min(selected.start, selected.end) + 1
    : undefined;
  const selectedEnd = selected
    ? Math.max(selected.start, selected.end) + 1
    : undefined;
  let lastLine = 0;
  for (const { from, to } of view.visibleRanges) {
    let pos = from;
    while (pos <= to) {
      const line = view.state.doc.lineAt(pos);
      if (line.number > lastLine) {
        const isSelected =
          selectedStart !== undefined &&
          selectedEnd !== undefined &&
          line.number >= selectedStart &&
          line.number <= selectedEnd;
        builder.add(
          line.from,
          line.from,
          Decoration.line({
            attributes: {
              "data-iori-line": String(line.number),
              ...(isSelected ? { "data-selected": "true" } : {}),
            },
          }),
        );
        lastLine = line.number;
      }
      if (line.to >= to) break;
      pos = line.to + 1;
    }
  }
  return builder.finish();
}

const lineNumberAttributePlugin = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet;
    constructor(view: EditorView) {
      this.decorations = visibleLineAttributes(view);
    }
    update(update: ViewUpdate) {
      if (
        update.docChanged ||
        update.viewportChanged ||
        update.transactions.some((tr) =>
          tr.effects.some((effect) => effect.is(setSelectedLinesEffect)),
        )
      ) {
        this.decorations = visibleLineAttributes(update.view);
      }
    }
  },
  { decorations: (value) => value.decorations },
);

/**
 * CodeMirror 6 text editor surface for Files View: always-editable on desktop,
 * read-only toggleable on touch devices, debounced autosave, external conflict
 * detection and recovery, search/replace, go-to-line, and gutter line selection.
 */
export function CodeEditorSurface({
  handle,
  transport,
  root,
  info,
  position,
  onPosition,
  wrap,
  locale,
  editing,
  onEditingChange,
  findRequest = 0,
  replaceRequest = 0,
  goToRequest = 0,
  jumpRequest,
  extraActions = [],
  refresh,
  saveFile,
  onSaved,
  onStatusChange,
  onFallbackReadOnly,
}: CodeEditorSurfaceProps) {
  const t = translator(locale);
  const ja = isJapanese(locale);

  const [loading, setLoading] = useState(
    () =>
      info.sizeBytes !== 0 &&
      !(info.sizeBytes !== undefined && info.sizeBytes > MAX_EDIT_BYTES),
  );
  const [loadError, setLoadError] = useState<string>();
  const [loaded, setLoaded] = useState(false);
  const [editingState, setEditingState] = useState(editing);
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [conflict, setConflict] = useState(false);
  const [saveError, setSaveError] = useState<string>();
  const [goToOpen, setGoToOpen] = useState(false);
  const [docLineCount, setDocLineCount] = useState(1);
  const [contextSnapshot, setContextSnapshot] = useState<{
    hasText: boolean;
    lines?: { start: number; end: number };
    hasLineSelection: boolean;
  }>({ hasText: false, hasLineSelection: false });

  const hostRef = useRef<HTMLDivElement>(null);
  const goToInputRef = useRef<HTMLInputElement>(null);
  const viewRef = useRef<EditorView | null>(null);

  // Compartments for dynamic CodeMirror reconfiguration.
  const readOnlyCompartment = useRef(new Compartment());
  const editableCompartment = useRef(new Compartment());
  const wrapCompartment = useRef(new Compartment());
  const languageCompartment = useRef(new Compartment());
  const phrasesCompartment = useRef(new Compartment());

  // Mutable refs for async callbacks and CodeMirror event handlers.
  const latestPositionRef = useRef(position);
  latestPositionRef.current = position;
  const onPositionRef = useRef(onPosition);
  onPositionRef.current = onPosition;
  const saveFileRef = useRef(saveFile);
  saveFileRef.current = saveFile;
  const onSavedRef = useRef(onSaved);
  onSavedRef.current = onSaved;
  const onFallbackRef = useRef(onFallbackReadOnly);
  onFallbackRef.current = onFallbackReadOnly;
  const onEditingChangeRef = useRef(onEditingChange);
  onEditingChangeRef.current = onEditingChange;
  const localeRef = useRef(locale);
  localeRef.current = locale;

  const editingRef = useRef(editingState);
  editingRef.current = editingState;
  const dirtyRef = useRef(dirty);
  dirtyRef.current = dirty;
  const savingRef = useRef(saving);
  savingRef.current = saving;
  const conflictRef = useRef(conflict);
  conflictRef.current = conflict;
  const saveErrorRef = useRef(saveError);
  saveErrorRef.current = saveError;

  const savedTextRef = useRef("");
  const savedRevisionRef = useRef<string | undefined>(info.revision);
  const latestInfoRevisionRef = useRef<string | undefined>(info.revision);
  latestInfoRevisionRef.current = info.revision;
  const pendingJumpRef = useRef<{ id: number; line: number } | undefined>(
    jumpRequest,
  );
  const appliedJumpIdRef = useRef<number | undefined>(undefined);
  const hasBomRef = useRef(false);
  const eolRef = useRef<"\n" | "\r\n">("\n");
  const loadedRef = useRef(false);
  const suppressingChangesRef = useRef(false);
  const autosaveTimerRef = useRef<number | undefined>(undefined);
  const inFlightSaveRef = useRef<Promise<boolean> | null>(null);
  const readAbortRef = useRef<AbortController | null>(null);
  const lineAnchorRef = useRef<number | undefined>(undefined);
  const scrollRafRef = useRef<number | undefined>(undefined);
  const fallbackSentRef = useRef(false);
  const initialTopAppliedRef = useRef(false);

  const clearAutosaveTimer = useCallback(() => {
    if (autosaveTimerRef.current !== undefined) {
      window.clearTimeout(autosaveTimerRef.current);
      autosaveTimerRef.current = undefined;
    }
  }, []);

  const triggerFallback = useCallback(
    (reason: "too_large" | "invalid_utf8" | "long_line") => {
      if (fallbackSentRef.current) return;
      fallbackSentRef.current = true;
      clearAutosaveTimer();
      onFallbackRef.current(reason);
    },
    [clearAutosaveTimer],
  );

  // Sync controlled `editing` prop into internal state.
  useEffect(() => {
    setEditingState(editing);
  }, [editing]);

  // Report status transitions to parent.
  useEffect(() => {
    onStatusChange?.({
      dirty,
      saving,
      conflict,
      saveError,
      editing: editingState,
      readOnly: !editingState,
    });
  }, [onStatusChange, dirty, saving, conflict, saveError, editingState]);

  const scheduleAutosaveRef = useRef<() => void>(() => {});
  const loadFromHostRef = useRef<
    (options: {
      preserveView: boolean;
      clearConflict: boolean;
      emptyFastPath?: boolean;
    }) => Promise<void>
  >(async () => {});

  const performSave = useCallback(
    async (force = false): Promise<boolean> => {
      clearAutosaveTimer();
      if (inFlightSaveRef.current) {
        await inFlightSaveRef.current;
      }
      const view = viewRef.current;
      if (!view || !loadedRef.current) return false;
      if (conflictRef.current && !force) return false;

      const currentText = view.state.doc.toString();
      if (!force && currentText === savedTextRef.current) {
        dirtyRef.current = false;
        setDirty(false);
        return true;
      }

      const task = (async (): Promise<boolean> => {
        savingRef.current = true;
        setSaving(true);
        const previousRevision = savedRevisionRef.current;
        try {
          const contentBase64 = encodeDocumentToBase64(
            currentText,
            eolRef.current,
            hasBomRef.current,
          );
          const result = await saveFileRef.current({
            contentBase64,
            ...(force
              ? { force: true }
              : previousRevision !== undefined
                ? { expectedRevision: previousRevision }
                : {}),
          });
          savedRevisionRef.current = result.revision;
          savedTextRef.current = currentText;
          if (force) {
            conflictRef.current = false;
            setConflict(false);
          }
          saveErrorRef.current = undefined;
          setSaveError(undefined);
          onSavedRef.current?.(result);

          const latestView = viewRef.current;
          const stillDirty =
            latestView !== null &&
            latestView.state.doc.toString() !== savedTextRef.current;
          dirtyRef.current = stillDirty;
          setDirty(stillDirty);
          const watchedRevision = latestInfoRevisionRef.current;
          if (
            watchedRevision &&
            watchedRevision !== result.revision &&
            watchedRevision !== previousRevision
          ) {
            // A real external change arrived while this save was in flight.
            if (stillDirty) {
              clearAutosaveTimer();
              conflictRef.current = true;
              setConflict(true);
              return true;
            }
            void loadFromHostRef.current({
              preserveView: true,
              clearConflict: false,
              emptyFastPath: true,
            });
            return true;
          }
          if (stillDirty && !conflictRef.current && editingRef.current) {
            scheduleAutosaveRef.current();
          }
          return true;
        } catch (error) {
          if (error instanceof ReadError && error.code === "file_conflict") {
            clearAutosaveTimer();
            conflictRef.current = true;
            setConflict(true);
            saveErrorRef.current = undefined;
            setSaveError(undefined);
            return false;
          }
          const jaNow = isJapanese(localeRef.current);
          const message =
            error instanceof ReadError && error.code === "permission_denied"
              ? jaNow
                ? "ファイルを保存する権限がありません。"
                : "Permission denied to save this file."
              : error instanceof ReadError && error.code === "path_not_found"
                ? jaNow
                  ? "ファイルが見つかりません。"
                  : "File not found."
                : jaNow
                  ? "保存できませんでした。"
                  : "Could not save.";
          saveErrorRef.current = message;
          setSaveError(message);
          return false;
        } finally {
          savingRef.current = false;
          setSaving(false);
          inFlightSaveRef.current = null;
        }
      })();

      inFlightSaveRef.current = task;
      const ok = await task;
      // If user typed more while this save was running and caller asked to save,
      // flush the newer text as well when not in conflict.
      if (
        ok &&
        !conflictRef.current &&
        viewRef.current &&
        viewRef.current.state.doc.toString() !== savedTextRef.current
      ) {
        return performSave(force);
      }
      return ok;
    },
    [clearAutosaveTimer],
  );

  const scheduleAutosave = useCallback(() => {
    clearAutosaveTimer();
    if (conflictRef.current || !editingRef.current) return;
    autosaveTimerRef.current = window.setTimeout(() => {
      autosaveTimerRef.current = undefined;
      if (!conflictRef.current && editingRef.current && dirtyRef.current) {
        void performSave(false);
      }
    }, AUTOSAVE_DEBOUNCE_MS);
  }, [clearAutosaveTimer, performSave]);
  scheduleAutosaveRef.current = scheduleAutosave;

  const applyDocumentContent = useCallback(
    (
      file: DecodedFile,
      options: { preserveView: boolean; clearConflict: boolean },
    ) => {
      const view = viewRef.current;
      savedTextRef.current = file.text;
      savedRevisionRef.current = file.revision;
      hasBomRef.current = file.hasBom;
      eolRef.current = file.eol;
      dirtyRef.current = false;
      setDirty(false);
      saveErrorRef.current = undefined;
      setSaveError(undefined);
      if (options.clearConflict) {
        conflictRef.current = false;
        setConflict(false);
      }
      if (!view) return;

      const prevScrollTop = view.scrollDOM.scrollTop;
      const prevScrollLeft = view.scrollDOM.scrollLeft;
      const prevSel = view.state.selection.main;
      const nextLen = file.text.length;
      const anchor = Math.min(prevSel.anchor, nextLen);
      const head = Math.min(prevSel.head, nextLen);

      suppressingChangesRef.current = true;
      try {
        view.dispatch({
          changes: { from: 0, to: view.state.doc.length, insert: file.text },
          selection: options.preserveView
            ? EditorSelection.single(anchor, head)
            : EditorSelection.cursor(0),
        });
      } finally {
        suppressingChangesRef.current = false;
      }

      setDocLineCount(view.state.doc.lines);
      if (options.preserveView) {
        view.scrollDOM.scrollTop = prevScrollTop;
        view.scrollDOM.scrollLeft = prevScrollLeft;
      } else if (!initialTopAppliedRef.current) {
        initialTopAppliedRef.current = true;
        const targetLine = Math.min(
          Math.max(1, latestPositionRef.current.top + 1),
          view.state.doc.lines,
        );
        if (targetLine > 1) {
          const line = view.state.doc.line(targetLine);
          view.dispatch({
            effects: EditorView.scrollIntoView(line.from, { y: "start" }),
          });
        }
      }
    },
    [],
  );

  const loadFromHost = useCallback(
    async (options: {
      preserveView: boolean;
      clearConflict: boolean;
      emptyFastPath?: boolean;
    }): Promise<void> => {
      if (info.sizeBytes !== undefined && info.sizeBytes > MAX_EDIT_BYTES) {
        triggerFallback("too_large");
        return;
      }
      readAbortRef.current?.abort();
      if (options.emptyFastPath && info.sizeBytes === 0) {
        setLoading(false);
        setLoadError(undefined);
        loadedRef.current = true;
        setLoaded(true);
        applyDocumentContent(
          {
            text: "",
            revision: info.revision,
            hasBom: false,
            eol: "\n",
          },
          options,
        );
        return;
      }

      const controller = new AbortController();
      readAbortRef.current = controller;
      if (!loadedRef.current) setLoading(true);
      setLoadError(undefined);
      try {
        const result = await readFullEditableFile(
          transport,
          root,
          info.path,
          controller.signal,
        );
        if (controller.signal.aborted) return;
        if (!result.ok) {
          triggerFallback(result.reason);
          return;
        }
        loadedRef.current = true;
        setLoaded(true);
        setLoading(false);
        applyDocumentContent(result.file, options);
      } catch (error) {
        if (controller.signal.aborted || isAbort(error)) return;
        setLoading(false);
        setLoadError(
          readErrorCopy(error, localeRef.current) ??
            translator(localeRef.current)("Could not read this."),
        );
      } finally {
        if (readAbortRef.current === controller) {
          readAbortRef.current = null;
        }
      }
    },
    [
      applyDocumentContent,
      info.path,
      info.revision,
      info.sizeBytes,
      root,
      transport,
      triggerFallback,
    ],
  );
  loadFromHostRef.current = loadFromHost;

  const goToLine = useCallback((lineNumber: number) => {
    const view = viewRef.current;
    if (!view) return;
    const clamped = Math.min(
      Math.max(1, Math.trunc(lineNumber)),
      view.state.doc.lines,
    );
    const line = view.state.doc.line(clamped);
    lineAnchorRef.current = undefined;
    view.dispatch({
      selection: EditorSelection.cursor(line.from),
      effects: EditorView.scrollIntoView(line.from, { y: "center" }),
    });
    view.focus();
    onPositionRef.current({
      ...latestPositionRef.current,
      top: clamped - 1,
      selection: { start: clamped - 1, end: clamped - 1 },
    });
  }, []);

  const openFind = useCallback((replace = false) => {
    const view = viewRef.current;
    if (!view) return;
    openSearchPanel(view);
    if (replace) {
      window.requestAnimationFrame(() => {
        const replaceInput =
          view.dom.querySelector<HTMLInputElement>('[name="replace"]');
        if (replaceInput) {
          replaceInput.focus();
          replaceInput.select();
        }
      });
    }
  }, []);

  const setEditing = useCallback((next: boolean) => {
    setEditingState(next);
    onEditingChangeRef.current?.(next);
  }, []);

  useImperativeHandle(
    handle,
    () => ({
      save: (force?: boolean) => performSave(Boolean(force)),
      reload: () => loadFromHost({ preserveView: true, clearConflict: true }),
      isDirty: () => dirtyRef.current,
      hasConflict: () => conflictRef.current,
      hasSaveError: () => Boolean(saveErrorRef.current),
      setEditing,
      goToLine,
      openFind,
    }),
    [goToLine, loadFromHost, openFind, performSave, setEditing],
  );

  // Mount CodeMirror EditorView once per file path.
  useEffect(() => {
    const container = hostRef.current;
    if (!container) return;

    const extensions: Extension[] = [
      lineNumbers({
        domEventHandlers: {
          mousedown(view, line, event) {
            if (!(event instanceof MouseEvent) || event.button !== 0)
              return false;
            event.preventDefault();
            view.focus();
            const clickedLine = view.state.doc.lineAt(line.from).number;
            const clickedIndex = clickedLine - 1;
            const anchorIndex =
              event.shiftKey && lineAnchorRef.current !== undefined
                ? lineAnchorRef.current
                : clickedIndex;
            lineAnchorRef.current = anchorIndex;
            const startIndex = Math.min(anchorIndex, clickedIndex);
            const endIndex = Math.max(anchorIndex, clickedIndex);
            const startLine = view.state.doc.line(startIndex + 1);
            const endLine = view.state.doc.line(endIndex + 1);
            view.dispatch({
              selection: EditorSelection.range(startLine.from, endLine.to),
            });
            onPositionRef.current({
              ...latestPositionRef.current,
              selection: { start: startIndex, end: endIndex },
            });
            return true;
          },
        },
      }),
      highlightActiveLineGutter(),
      history(),
      drawSelection(),
      indentOnInput(),
      bracketMatching(),
      highlightActiveLine(),
      highlightSelectionMatches(),
      selectedLinesField,
      lineNumberAttributePlugin,
      search({ top: true }),
      keymap.of([
        {
          key: "Mod-s",
          run: () => {
            if (!conflictRef.current) void performSave(false);
            return true;
          },
        },
        {
          key: "Mod-g",
          run: () => {
            setGoToOpen(true);
            return true;
          },
        },
        {
          key: "Mod-h",
          run: () => {
            openFind(true);
            return true;
          },
        },
        ...searchKeymap,
        ...defaultKeymap,
        ...historyKeymap,
        indentWithTab,
      ]),
      readOnlyCompartment.current.of(
        EditorState.readOnly.of(!editingRef.current),
      ),
      editableCompartment.current.of(
        EditorView.editable.of(editingRef.current),
      ),
      wrapCompartment.current.of(wrap ? EditorView.lineWrapping : []),
      languageCompartment.current.of([]),
      phrasesCompartment.current.of(editorPhrasesExtension(localeRef.current)),
      ...ioriEditorExtensions,
      EditorView.updateListener.of((update) => {
        if (update.docChanged) {
          setDocLineCount(update.state.doc.lines);
          if (!suppressingChangesRef.current) {
            const nextDirty =
              update.state.doc.toString() !== savedTextRef.current;
            dirtyRef.current = nextDirty;
            setDirty(nextDirty);
            if (nextDirty && !conflictRef.current && editingRef.current) {
              scheduleAutosaveRef.current();
            } else if (!nextDirty) {
              clearAutosaveTimer();
            }
          }
        }
      }),
      EditorView.domEventHandlers({
        blur: () => {
          if (dirtyRef.current && !conflictRef.current && editingRef.current) {
            void performSave(false);
          }
          return false;
        },
        mousedown: (event) => {
          if (
            event.button === 0 &&
            !(event.target as Element | null)?.closest(".cm-gutters")
          ) {
            lineAnchorRef.current = undefined;
            if (latestPositionRef.current.selection) {
              onPositionRef.current({
                ...latestPositionRef.current,
                selection: undefined,
              });
            }
          }
          return false;
        },
      }),
    ];

    const state = EditorState.create({ doc: "", extensions });
    const view = new EditorView({ state, parent: container });
    viewRef.current = view;

    const handleScroll = () => {
      if (scrollRafRef.current !== undefined) return;
      scrollRafRef.current = window.requestAnimationFrame(() => {
        scrollRafRef.current = undefined;
        const currentView = viewRef.current;
        if (!currentView || !loadedRef.current) return;
        const block = currentView.lineBlockAtHeight(
          currentView.scrollDOM.scrollTop,
        );
        const top = currentView.state.doc.lineAt(block.from).number - 1;
        if (top !== latestPositionRef.current.top) {
          onPositionRef.current({ ...latestPositionRef.current, top });
        }
      });
    };
    view.scrollDOM.addEventListener("scroll", handleScroll, { passive: true });

    return () => {
      clearAutosaveTimer();
      readAbortRef.current?.abort();
      if (scrollRafRef.current !== undefined) {
        window.cancelAnimationFrame(scrollRafRef.current);
        scrollRafRef.current = undefined;
      }
      view.scrollDOM.removeEventListener("scroll", handleScroll);
      view.destroy();
      viewRef.current = null;
      loadedRef.current = false;
      initialTopAppliedRef.current = false;
      fallbackSentRef.current = false;
    };
    // Editor instance belongs to one root + file path.
  }, [root, info.path]);

  // Initial load for this file.
  useEffect(() => {
    void loadFromHost({
      preserveView: false,
      clearConflict: true,
      emptyFastPath: true,
    });
    // Only run when root or path changes; external revisions are handled below.
  }, [root, info.path]);

  // Retry initial load on reconnect / refresh signal if load failed.
  useEffect(() => {
    if (refresh > 0 && loadError && !loadedRef.current) {
      void loadFromHost({
        preserveView: false,
        clearConflict: false,
        emptyFastPath: true,
      });
    }
  }, [refresh, loadError, loadFromHost]);

  // External revision updates from file watcher.
  useEffect(() => {
    if (!loadedRef.current) return;
    if (!info.revision || info.revision === savedRevisionRef.current) return;
    // Wait for an in-flight save to finish; Host returns authoritative result
    // (either matching revision on success, or file_conflict on real collision).
    if (savingRef.current) return;
    if (dirtyRef.current) {
      clearAutosaveTimer();
      conflictRef.current = true;
      setConflict(true);
      return;
    }
    void loadFromHost({
      preserveView: true,
      clearConflict: false,
      emptyFastPath: true,
    });
  }, [info.revision, clearAutosaveTimer, loadFromHost]);

  // Reconfigure editing / read-only mode.
  useEffect(() => {
    const view = viewRef.current;
    if (!view) return;
    view.dispatch({
      effects: [
        readOnlyCompartment.current.reconfigure(
          EditorState.readOnly.of(!editingState),
        ),
        editableCompartment.current.reconfigure(
          EditorView.editable.of(editingState),
        ),
      ],
    });
  }, [editingState]);

  // Sync selected line range decoration (from gutter selection or jump-to-line).
  useEffect(() => {
    const view = viewRef.current;
    if (!view || !loaded) return;
    view.dispatch({
      effects: setSelectedLinesEffect.of(position.selection),
    });
  }, [position.selection, loaded]);

  // Reconfigure line wrapping.
  useEffect(() => {
    const view = viewRef.current;
    if (!view) return;
    view.dispatch({
      effects: wrapCompartment.current.reconfigure(
        wrap ? EditorView.lineWrapping : [],
      ),
    });
  }, [wrap]);

  // Reconfigure localized CodeMirror phrases.
  useEffect(() => {
    const view = viewRef.current;
    if (!view) return;
    view.dispatch({
      effects: phrasesCompartment.current.reconfigure(
        editorPhrasesExtension(locale),
      ),
    });
  }, [locale]);

  // Lazy-load language grammar by filename.
  useEffect(() => {
    const view = viewRef.current;
    if (!view) return;
    let cancelled = false;
    const filename = fileNameOf(info.path);
    const description = LanguageDescription.matchFilename(languages, filename);
    if (!description) {
      view.dispatch({ effects: languageCompartment.current.reconfigure([]) });
      return;
    }
    void description
      .load()
      .then((support) => {
        if (cancelled || viewRef.current !== view) return;
        view.dispatch({
          effects: languageCompartment.current.reconfigure(support),
        });
      })
      .catch(() => {
        // Keep plain text if grammar fails to load.
      });
    return () => {
      cancelled = true;
    };
  }, [info.path]);

  // Respond to external find / replace / go-to-line triggers.
  useEffect(() => {
    if (findRequest > 0) openFind(false);
  }, [findRequest, openFind]);

  useEffect(() => {
    if (replaceRequest > 0) openFind(true);
  }, [replaceRequest, openFind]);

  useEffect(() => {
    if (goToRequest > 0) setGoToOpen(true);
  }, [goToRequest]);

  useEffect(() => {
    pendingJumpRef.current = jumpRequest;
    if (jumpRequest && loaded && appliedJumpIdRef.current !== jumpRequest.id) {
      appliedJumpIdRef.current = jumpRequest.id;
      goToLine(jumpRequest.line);
    }
  }, [jumpRequest, loaded, goToLine]);

  useEffect(() => {
    if (goToOpen) {
      goToInputRef.current?.focus({ preventScroll: true });
      goToInputRef.current?.select();
    }
  }, [goToOpen]);

  const captureContextSnapshot = () => {
    const view = viewRef.current;
    if (!view) {
      setContextSnapshot({ hasText: false, hasLineSelection: false });
      return;
    }
    const sel = view.state.selection.main;
    const hasText = !sel.empty;
    const lineSelection = latestPositionRef.current.selection;
    if (lineSelection) {
      const start = Math.min(lineSelection.start, lineSelection.end) + 1;
      const end = Math.max(lineSelection.start, lineSelection.end) + 1;
      setContextSnapshot({
        hasText,
        lines: { start, end },
        hasLineSelection: true,
      });
      return;
    }
    const startLine = view.state.doc.lineAt(sel.from).number;
    const endLine = view.state.doc.lineAt(sel.to).number;
    setContextSnapshot({
      hasText,
      lines: { start: startLine, end: endLine },
      hasLineSelection: false,
    });
  };

  const copySelectedText = async () => {
    const view = viewRef.current;
    if (!view) return;
    const sel = view.state.selection.main;
    if (sel.empty) return;
    await native.clipboardWrite(view.state.sliceDoc(sel.from, sel.to));
  };

  const copySelectedLines = async () => {
    const view = viewRef.current;
    const lines = contextSnapshot.lines;
    if (!view || !lines) return;
    const startLine = view.state.doc.line(
      Math.min(Math.max(1, lines.start), view.state.doc.lines),
    );
    const endLine = view.state.doc.line(
      Math.min(Math.max(1, lines.end), view.state.doc.lines),
    );
    await native.clipboardWrite(
      view.state.sliceDoc(startLine.from, endLine.to),
    );
  };

  const leadingActions: MenuAction[] = [
    ...(contextSnapshot.hasText
      ? [
          {
            label: t("Copy"),
            icon: <Copy />,
            shortcut: "Ctrl+C",
            action: "copy-text",
            run: copySelectedText,
          },
        ]
      : []),
    ...(contextSnapshot.hasLineSelection
      ? [
          {
            label: t("Copy selected lines"),
            icon: <ClipboardCopy />,
            shortcut: "Ctrl+C",
            action: "copy-lines",
            run: copySelectedLines,
          },
        ]
      : []),
  ];

  const menuActions: MenuAction[] = [
    {
      label: t("Find"),
      icon: <Search />,
      shortcut: "Ctrl+F",
      action: "open-find",
      run: () => openFind(false),
    },
    {
      label: t("Go to line"),
      icon: <CornerDownLeft />,
      shortcut: "Ctrl+G",
      action: "open-go-to-line",
      run: () => setGoToOpen(true),
    },
    ...extraActions,
  ];

  const conflictMessage = ja
    ? "このファイルは外部で変更されました。"
    : "This file changed outside iori.";
  const overwriteLabel = ja ? "上書き" : "Overwrite";

  return (
    <div
      className="relative flex min-h-0 flex-1 flex-col bg-background"
      data-iori-view="file-editor"
      data-iori-editing={editingState ? "true" : "false"}
      data-iori-dirty={dirty ? "true" : "false"}
      data-iori-conflict={conflict ? "true" : "false"}
    >
      {conflict && (
        <div
          className="flex flex-none flex-wrap items-center gap-x-2.5 gap-y-1.5 border-b border-status-waiting-border bg-status-waiting-bg/50 px-3 py-1.5 text-xs text-foreground"
          role="alert"
          data-iori-part="file-conflict-bar"
        >
          <AlertTriangle
            className="size-3.5 flex-none text-status-waiting-text"
            aria-hidden="true"
          />
          <span className="min-w-0 flex-1 [overflow-wrap:anywhere]">
            {conflictMessage}
          </span>
          <div className="flex items-center gap-1.5">
            <Button
              variant="outline"
              size="sm"
              className="[@media(pointer:coarse)]:min-h-11"
              data-iori-action="file-conflict-reload"
              onClick={() =>
                void loadFromHost({ preserveView: true, clearConflict: true })
              }
            >
              {t("Reload")}
            </Button>
            <Button
              variant="destructive"
              size="sm"
              pending={saving}
              className="[@media(pointer:coarse)]:min-h-11"
              data-iori-action="file-conflict-overwrite"
              onClick={() => void performSave(true)}
            >
              {overwriteLabel}
            </Button>
          </div>
        </div>
      )}

      {!conflict && saveError && (
        <div
          className="flex flex-none flex-wrap items-center gap-x-2.5 gap-y-1.5 border-b border-status-failed-border bg-status-failed-bg/35 px-3 py-1.5 text-xs text-foreground"
          role="alert"
          data-iori-part="file-save-error"
        >
          <CircleAlert
            className="size-3.5 flex-none text-status-failed-text"
            aria-hidden="true"
          />
          <span className="min-w-0 flex-1 [overflow-wrap:anywhere]">
            {saveError}
          </span>
          <Button
            variant="outline"
            size="sm"
            pending={saving}
            className="[@media(pointer:coarse)]:min-h-11"
            data-iori-action="file-save-retry"
            onClick={() => void performSave(false)}
          >
            {t("Retry")}
          </Button>
        </div>
      )}

      {goToOpen && (
        <form
          className="absolute top-2 right-4 z-(--z-popover) flex items-center gap-1 rounded-lg border border-border bg-popover p-1 text-popover-foreground shadow-md"
          data-iori-view="editor-goto"
          onSubmit={(event) => {
            event.preventDefault();
            const parsed = Number(goToInputRef.current?.value);
            if (Number.isSafeInteger(parsed) && parsed > 0) {
              setGoToOpen(false);
              goToLine(parsed);
            }
          }}
        >
          <Input
            ref={goToInputRef}
            inputMode="numeric"
            className="h-7 w-[min(16rem,50vw)] text-xs text-popover-foreground [@media(pointer:coarse)]:h-10"
            data-iori-field="editor-goto-line"
            aria-label={t("Go to line")}
            placeholder={t("Line (1–{value1})").replace("{value1}", () =>
              String(Math.max(1, docLineCount)),
            )}
            onKeyDown={(event) => {
              if (event.key === "Escape") {
                event.preventDefault();
                setGoToOpen(false);
                viewRef.current?.focus();
              }
            }}
          />
          <Button
            variant="ghost"
            size="icon-sm"
            className="[@media(pointer:coarse)]:size-11"
            aria-label={t("Close")}
            onClick={() => {
              setGoToOpen(false);
              viewRef.current?.focus();
            }}
            type="button"
          >
            <X />
          </Button>
        </form>
      )}

      {loadError && !loaded && (
        <ReadingError
          centered
          retryLabel={t("Retry")}
          action="reading-retry"
          onRetry={() =>
            void loadFromHost({
              preserveView: false,
              clearConflict: false,
              emptyFastPath: true,
            })
          }
        >
          {loadError}
        </ReadingError>
      )}

      {loading && !loaded && !loadError && (
        <ReadingLoading label={t("Loading")} rows={8} />
      )}

      <PathMenu
        selectable
        path={info.absolutePath}
        relativePath={info.path}
        lines={contextSnapshot.lines}
        leadingActions={leadingActions}
        actions={menuActions}
        locale={locale}
      >
        <div
          ref={hostRef}
          onContextMenuCapture={captureContextSnapshot}
          className={
            loaded
              ? "min-h-0 flex-1 overflow-hidden"
              : "hidden min-h-0 flex-1 overflow-hidden"
          }
        />
      </PathMenu>
    </div>
  );
}
