import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import {
  CaseSensitive,
  ChevronDown,
  ChevronRight,
  CircleAlert,
  FileCode,
  Folder,
  Regex,
  Search,
  X,
} from "lucide-react";
import { cn } from "cn";
import { Button } from "../components/ui/button";
import { Input } from "../components/ui/input";
import { translator } from "../i18n.ts";
import { ReadingEmpty, ReadingLoading } from "../reading/ReadingStates.tsx";
import { isAbort, ReadError, readErrorCopy } from "../reading/transport.ts";

export type WorkspaceSearchMatchItem = {
  path: string;
  absolutePath: string;
  line: number;
  column: number;
  length: number;
  text: string;
  previewColumn: number;
};

export type WorkspaceSearchPaneProps = {
  folder?: string;
  onClearFolder?: () => void;
  locale: string;
  focusRequest?: number;
  searchWorkspace: (
    params: {
      folder?: string;
      query: string;
      caseSensitive: boolean;
      regex: boolean;
    },
    signal: AbortSignal,
  ) => Promise<{
    matches: WorkspaceSearchMatchItem[];
    truncated: boolean;
    fileCount: number;
  }>;
  onSelectMatch: (path: string, line: number) => void;
  onClose?: () => void;
};

type SearchFileGroup = {
  path: string;
  name: string;
  parent: string;
  matches: WorkspaceSearchMatchItem[];
};

const SEARCH_DEBOUNCE_MS = 250;

function isJapanese(locale: string): boolean {
  return locale.toLowerCase().startsWith("ja");
}

function splitFilePath(path: string): { name: string; parent: string } {
  const slash = path.lastIndexOf("/");
  if (slash < 0) return { name: path, parent: "" };
  return { name: path.slice(slash + 1), parent: path.slice(0, slash) };
}

function highlightMatchText(
  text: string,
  previewColumn: number,
  length: number,
): ReactNode {
  const start = Math.max(0, Math.min(previewColumn, text.length));
  const end = Math.max(
    start,
    Math.min(start + Math.max(0, length), text.length),
  );
  if (end <= start) return text;
  return (
    <>
      {text.slice(0, start)}
      <mark className="rounded-xs bg-status-waiting/35 text-foreground">
        {text.slice(start, end)}
      </mark>
      {text.slice(end)}
    </>
  );
}

/**
 * Full-text search panel across the open workspace or a selected folder
 * (`Ctrl+Shift+F`). Results are grouped by file path with highlighted matches.
 */
export function WorkspaceSearchPane({
  folder,
  onClearFolder,
  locale,
  focusRequest = 0,
  searchWorkspace,
  onSelectMatch,
  onClose,
}: WorkspaceSearchPaneProps) {
  const t = translator(locale);
  const ja = isJapanese(locale);

  const [query, setQuery] = useState("");
  const [caseSensitive, setCaseSensitive] = useState(false);
  const [regex, setRegex] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string>();
  const [matches, setMatches] = useState<WorkspaceSearchMatchItem[]>([]);
  const [truncated, setTruncated] = useState(false);
  const [fileCount, setFileCount] = useState(0);
  const [hasSearched, setHasSearched] = useState(false);
  const [collapsed, setCollapsed] = useState<ReadonlySet<string>>(
    () => new Set(),
  );

  const inputRef = useRef<HTMLInputElement>(null);
  const abortRef = useRef<AbortController | null>(null);
  const debounceTimerRef = useRef<number | undefined>(undefined);
  const searchWorkspaceRef = useRef(searchWorkspace);
  searchWorkspaceRef.current = searchWorkspace;

  useEffect(() => {
    inputRef.current?.focus({ preventScroll: true });
    inputRef.current?.select();
  }, [focusRequest]);

  const cancelPending = useCallback(() => {
    if (debounceTimerRef.current !== undefined) {
      window.clearTimeout(debounceTimerRef.current);
      debounceTimerRef.current = undefined;
    }
    abortRef.current?.abort();
    abortRef.current = null;
  }, []);

  const executeSearch = useCallback(
    async (params: {
      query: string;
      folder?: string;
      caseSensitive: boolean;
      regex: boolean;
    }) => {
      cancelPending();
      const trimmed = params.query;
      if (!trimmed) {
        setLoading(false);
        setError(undefined);
        setMatches([]);
        setTruncated(false);
        setFileCount(0);
        setHasSearched(false);
        return;
      }

      const controller = new AbortController();
      abortRef.current = controller;
      setLoading(true);
      setError(undefined);
      try {
        const result = await searchWorkspaceRef.current(
          {
            ...(params.folder ? { folder: params.folder } : {}),
            query: trimmed,
            caseSensitive: params.caseSensitive,
            regex: params.regex,
          },
          controller.signal,
        );
        if (controller.signal.aborted) return;
        setMatches(result.matches);
        setTruncated(result.truncated);
        setFileCount(result.fileCount);
        setHasSearched(true);
        setCollapsed(new Set());
      } catch (cause) {
        if (controller.signal.aborted || isAbort(cause)) return;
        const message =
          cause instanceof ReadError &&
          cause.code === "invalid_request" &&
          params.regex
            ? ja
              ? "正規表現が正しくありません。"
              : "Invalid regular expression."
            : (readErrorCopy(cause, locale) ??
              (cause instanceof Error && cause.message
                ? cause.message
                : ja
                  ? "検索できませんでした。"
                  : "Could not search."));
        setError(message);
        setMatches([]);
        setTruncated(false);
        setFileCount(0);
        setHasSearched(true);
      } finally {
        if (abortRef.current === controller) {
          abortRef.current = null;
        }
        if (!controller.signal.aborted) {
          setLoading(false);
        }
      }
    },
    [cancelPending, ja, locale],
  );

  // Debounced search when query changes; immediate reset when cleared.
  useEffect(() => {
    if (!query) {
      cancelPending();
      setLoading(false);
      setError(undefined);
      setMatches([]);
      setTruncated(false);
      setFileCount(0);
      setHasSearched(false);
      return;
    }
    if (debounceTimerRef.current !== undefined) {
      window.clearTimeout(debounceTimerRef.current);
    }
    debounceTimerRef.current = window.setTimeout(() => {
      debounceTimerRef.current = undefined;
      void executeSearch({ query, folder, caseSensitive, regex });
    }, SEARCH_DEBOUNCE_MS);
    return () => {
      if (debounceTimerRef.current !== undefined) {
        window.clearTimeout(debounceTimerRef.current);
        debounceTimerRef.current = undefined;
      }
    };
  }, [query, folder, caseSensitive, regex, cancelPending, executeSearch]);

  useEffect(() => () => cancelPending(), [cancelPending]);

  const groups = useMemo<SearchFileGroup[]>(() => {
    const byPath = new Map<string, SearchFileGroup>();
    for (const match of matches) {
      let group = byPath.get(match.path);
      if (!group) {
        const { name, parent } = splitFilePath(match.path);
        group = { path: match.path, name, parent, matches: [] };
        byPath.set(match.path, group);
      }
      group.matches.push(match);
    }
    return [...byPath.values()];
  }, [matches]);

  const toggleGroup = (path: string) => {
    setCollapsed((previous) => {
      const next = new Set(previous);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });
  };

  const searchPlaceholder = folder
    ? ja
      ? "フォルダー内を検索"
      : "Search in folder"
    : ja
      ? "ワークスペース内を検索"
      : "Search in workspace";
  const caseLabel = ja ? "大文字と小文字を区別" : "Match case";
  const regexLabel = ja ? "正規表現を使用" : "Use regular expression";
  const clearFolderLabel = ja ? "フォルダー指定を解除" : "Clear folder filter";
  const emptyPrompt = ja ? "検索語を入力してください" : "Type to search files";
  const summaryText = ja
    ? `${fileCount}ファイルで${matches.length}件一致`
    : `${matches.length} ${matches.length === 1 ? "result" : "results"} in ${fileCount} ${fileCount === 1 ? "file" : "files"}`;
  const truncatedText = ja
    ? "件数の上限に達しました。検索語を絞り込んでください。"
    : "Result limit reached. Refine your search.";

  return (
    <div
      className="flex min-h-0 flex-1 flex-col bg-background"
      data-iori-view="workspace-search"
    >
      <div className="flex flex-none flex-col gap-1.5 border-b border-border-subtle px-2.5 py-2">
        <div className="flex items-center gap-1">
          <div className="relative flex min-w-0 flex-1 items-center">
            <Search
              className="pointer-events-none absolute left-2 size-3.5 text-muted-foreground"
              aria-hidden="true"
            />
            <Input
              ref={inputRef}
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  event.preventDefault();
                  void executeSearch({ query, folder, caseSensitive, regex });
                } else if (event.key === "Escape") {
                  event.preventDefault();
                  if (query) {
                    setQuery("");
                  } else {
                    onClose?.();
                  }
                }
              }}
              placeholder={searchPlaceholder}
              aria-label={searchPlaceholder}
              data-iori-field="workspace-search-input"
              className="h-7 pl-7 pr-2 text-xs [@media(pointer:coarse)]:h-10"
            />
          </div>
          <Button
            variant={caseSensitive ? "secondary" : "ghost"}
            size="icon-sm"
            type="button"
            aria-label={caseLabel}
            aria-pressed={caseSensitive}
            title={caseLabel}
            data-iori-action="workspace-search-case"
            className={cn(
              "[@media(pointer:coarse)]:size-11",
              caseSensitive &&
                "border border-ring/50 bg-accent text-accent-foreground",
            )}
            onClick={() => setCaseSensitive((value) => !value)}
          >
            <CaseSensitive />
          </Button>
          <Button
            variant={regex ? "secondary" : "ghost"}
            size="icon-sm"
            type="button"
            aria-label={regexLabel}
            aria-pressed={regex}
            title={regexLabel}
            data-iori-action="workspace-search-regex"
            className={cn(
              "[@media(pointer:coarse)]:size-11",
              regex && "border border-ring/50 bg-accent text-accent-foreground",
            )}
            onClick={() => setRegex((value) => !value)}
          >
            <Regex />
          </Button>
          {onClose && (
            <Button
              variant="ghost"
              size="icon-sm"
              type="button"
              aria-label={t("Close")}
              title={t("Close")}
              data-iori-action="workspace-search-close"
              className="[@media(pointer:coarse)]:size-11"
              onClick={onClose}
            >
              <X />
            </Button>
          )}
        </div>

        {folder && (
          <div className="flex items-center gap-1.5 text-xs">
            <span
              className="inline-flex min-w-0 max-w-full items-center gap-1 rounded-sm border border-border-subtle bg-muted px-1.5 py-0.5 text-muted-foreground"
              title={folder}
            >
              <Folder className="size-3 shrink-0" aria-hidden="true" />
              <span className="truncate font-mono text-2xs">{folder}</span>
              {onClearFolder && (
                <button
                  type="button"
                  aria-label={clearFolderLabel}
                  title={clearFolderLabel}
                  data-iori-action="workspace-search-clear-folder"
                  className="ml-0.5 inline-flex size-4 shrink-0 cursor-pointer items-center justify-center rounded-xs text-muted-foreground hover:bg-accent hover:text-foreground [@media(pointer:coarse)]:size-7"
                  onClick={onClearFolder}
                >
                  <X className="size-3" />
                </button>
              )}
            </span>
          </div>
        )}

        {hasSearched && !loading && !error && matches.length > 0 && (
          <div className="flex flex-wrap items-center justify-between gap-1 text-2xs text-muted-foreground">
            <span>{summaryText}</span>
            {truncated && (
              <span className="text-status-waiting-text">{truncatedText}</span>
            )}
          </div>
        )}
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto">
        {!query ? (
          <ReadingEmpty
            compact
            state="empty-query"
            icon={<Search className="size-4" />}
            title={emptyPrompt}
          />
        ) : error ? (
          <div
            role="alert"
            className="m-2.5 flex items-start gap-2 rounded-md border border-status-failed-border bg-status-failed-bg/35 px-3 py-2 text-xs text-foreground"
          >
            <CircleAlert
              className="mt-0.5 size-3.5 shrink-0 text-status-failed-text"
              aria-hidden="true"
            />
            <span className="min-w-0 [overflow-wrap:anywhere]">{error}</span>
          </div>
        ) : loading && matches.length === 0 ? (
          <ReadingLoading compact label={t("Loading")} rows={5} />
        ) : hasSearched && matches.length === 0 ? (
          <ReadingEmpty compact state="no-matches" title={t("No matches")} />
        ) : (
          <div className="flex flex-col py-1" role="list">
            {groups.map((group) => {
              const isCollapsed = collapsed.has(group.path);
              return (
                <div key={group.path} className="flex flex-col" role="listitem">
                  <button
                    type="button"
                    aria-expanded={!isCollapsed}
                    className="flex w-full cursor-pointer items-center gap-1.5 px-2 py-1 text-left text-xs hover:bg-accent/60 focus-visible:bg-accent focus-visible:outline-none [@media(pointer:coarse)]:min-h-11"
                    onClick={() => toggleGroup(group.path)}
                    title={group.path}
                  >
                    {isCollapsed ? (
                      <ChevronRight
                        className="size-3.5 shrink-0 text-muted-foreground"
                        aria-hidden="true"
                      />
                    ) : (
                      <ChevronDown
                        className="size-3.5 shrink-0 text-muted-foreground"
                        aria-hidden="true"
                      />
                    )}
                    <FileCode
                      className="size-3.5 shrink-0 text-muted-foreground"
                      aria-hidden="true"
                    />
                    <span className="shrink-0 font-medium text-foreground">
                      {group.name}
                    </span>
                    {group.parent && (
                      <span className="min-w-0 truncate text-muted-foreground">
                        {group.parent}
                      </span>
                    )}
                    <span className="ml-auto shrink-0 rounded-sm bg-muted px-1.5 py-0.25 text-2xs tabular-nums text-muted-foreground">
                      {group.matches.length}
                    </span>
                  </button>
                  {!isCollapsed && (
                    <div className="flex flex-col">
                      {group.matches.map((match) => (
                        <button
                          key={`${match.path}:${match.line}:${match.column}`}
                          type="button"
                          data-iori-action="workspace-search-match"
                          data-iori-file={match.path}
                          data-iori-line={match.line}
                          className="flex w-full cursor-pointer items-baseline gap-2 py-0.5 pr-2.5 pl-7 text-left font-mono text-xs text-foreground hover:bg-accent/60 focus-visible:bg-accent focus-visible:outline-none [@media(pointer:coarse)]:min-h-11 [@media(pointer:coarse)]:items-center"
                          onClick={() => onSelectMatch(match.path, match.line)}
                        >
                          <span className="w-8 shrink-0 text-right text-2xs tabular-nums text-muted-foreground">
                            {match.line}
                          </span>
                          <span className="min-w-0 flex-1 truncate whitespace-pre">
                            {highlightMatchText(
                              match.text,
                              match.previewColumn,
                              match.length,
                            )}
                          </span>
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
