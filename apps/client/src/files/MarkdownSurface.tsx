import { translator } from "../i18n.ts";
import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { Streamdown, defaultRehypePlugins, type Components } from "streamdown";
import { ClipboardCopy } from "lucide-react";
import GithubSlugger from "github-slugger";
import type { OpenFile } from "../workspace-panel.tsx";
import type { FileInfo } from "@iori/protocol";
import { native } from "../native.ts";
import { FindBar } from "../reading/FindBar.tsx";
import { PathMenu, type MenuAction } from "../reading/PathMenu.tsx";
import {
  ReadConnectionLost,
  isAbort,
  readErrorCopy,
  type ReadingTransport,
} from "../reading/transport.ts";
import { InlineImage } from "./ImageSurface.tsx";
import { markdownRemarkPlugins } from "../reading/markdown-plugins.ts";
import { ReadingError } from "../reading/ReadingError.tsx";
import { readFileChunks } from "./read-file-chunks.ts";
import { useConnectionRetry } from "../reading/useConnectionRetry.ts";

/** Larger documents open as source; drawing them whole would stall scrolling. */
export const MAX_RENDERED_MARKDOWN_BYTES = 2 * 1024 * 1024;
const RefreshContext = createContext(0);

/** Relative Markdown targets stay in the open folder and pass through the Host path boundary. */
export function markdownPath(base: string, target: string): string | undefined {
  if (
    /^[a-z][a-z\d+.-]*:/iu.test(target) ||
    target.startsWith("//") ||
    target.startsWith("/")
  )
    return undefined;
  const parts = base.split("/");
  parts.pop();
  let decoded: string;
  try {
    decoded = decodeURIComponent(target.split(/[?#]/u)[0]!);
  } catch {
    return undefined;
  }
  for (const part of decoded.split("/")) {
    if (part === "..") {
      if (!parts.length) return undefined;
      parts.pop();
    } else if (part && part !== ".") parts.push(part);
  }
  return parts.join("/");
}

type HastNode = {
  type?: string;
  value?: string;
  children?: HastNode[];
  position?: { start: { line: number } };
};
const textOf = (node: HastNode | undefined): string =>
  node?.type === "text"
    ? (node.value ?? "")
    : (node?.children ?? []).map(textOf).join("");

function LocalImage({
  transport,
  root,
  path,
  alt,
  locale,
  standalone,
}: {
  standalone?: boolean;
  transport: ReadingTransport;
  root: string;
  path: string;
  alt?: string;
  locale: string;
}) {
  const refresh = useContext(RefreshContext);
  const [info, setInfo] = useState<FileInfo>();
  const [imageRoot, setImageRoot] = useState(root);
  const { attempt, begin } = useConnectionRetry(refresh);
  useEffect(() => {
    const controller = new AbortController();
    const lost = begin();
    void (async () => {
      const target = standalone
        ? (
            await transport.request(
              "files.resolve",
              { root, paths: [path] },
              controller.signal,
            )
          ).results[0]!
        : { root, path };
      const info = await transport.request(
        "files.info",
        target,
        controller.signal,
      );
      setImageRoot(target.root);
      setInfo(info);
    })().catch((cause: unknown) => {
      if (!controller.signal.aborted && cause instanceof ReadConnectionLost)
        lost();
    });
    return () => controller.abort();
  }, [transport, root, path, standalone, attempt, begin]);
  return info?.kind === "image" ? (
    <InlineImage
      transport={transport}
      root={imageRoot}
      info={info}
      alt={alt}
      locale={locale}
      refresh={refresh}
    />
  ) : (
    <span className="reading-inline-note">{alt}</span>
  );
}

function findRanges(container: HTMLElement, query: string): Range[] {
  const ranges: Range[] = [];
  const needle = query.toLowerCase();
  if (!needle) return ranges;
  const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT);
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    const text = (node as Text).data.toLowerCase();
    for (
      let at = text.indexOf(needle);
      at >= 0;
      at = text.indexOf(needle, at + needle.length)
    ) {
      const range = document.createRange();
      range.setStart(node, at);
      range.setEnd(node, at + needle.length);
      ranges.push(range);
    }
  }
  return ranges;
}

function paint(name: string, ranges: Range[]) {
  if (!("highlights" in CSS)) return;
  if (ranges.length) CSS.highlights.set(name, new Highlight(...ranges));
  else CSS.highlights.delete(name);
}

export type MarkdownPosition = { line: number; query: string; match?: number };

/**
 * A Markdown document drawn whole. Raw HTML is shown as text, links open only
 * on an explicit click, and remote images are never fetched.
 */
export function MarkdownSurface({
  transport,
  root,
  info,
  position,
  onPosition,
  onOpen,
  standalone,
  onOpenFile,
  locale,
  findRequest = 0,
  extraActions,
  refresh,
}: {
  transport: ReadingTransport;
  root: string;
  info: FileInfo;
  position: MarkdownPosition;
  onPosition: (value: MarkdownPosition) => void;
  onOpen: (path: string) => void;
  standalone?: boolean;
  onOpenFile?: (file: OpenFile, standalone?: boolean) => void;
  locale: string;
  findRequest?: number;
  extraActions?: MenuAction[];
  refresh: number;
}) {
  const t = translator(locale);
  const [text, setText] = useState<string>();
  const [error, setError] = useState<string>();
  const [retry, setRetry] = useState(0);
  const [findOpen, setFindOpen] = useState(Boolean(position.query));
  const [findFocus, setFindFocus] = useState(0);
  const [status, setStatus] = useState<string>();
  const [selectedText, setSelectedText] = useState("");
  const scroller = useRef<HTMLDivElement>(null);
  const content = useRef<HTMLDivElement>(null);
  const latest = useRef(position);
  latest.current = position;
  const restored = useRef(false);
  const { attempt, begin } = useConnectionRetry(refresh);

  useEffect(() => {
    const controller = new AbortController();
    const lost = begin();
    void (async () => {
      const parts = await readFileChunks(
        transport,
        root,
        info.path,
        controller.signal,
      );
      const value = new TextDecoder().decode(
        await new Blob(parts).arrayBuffer(),
      );
      if (controller.signal.aborted) return;
      // The previous version stays on screen until this one is read.
      setText(value);
      setError(undefined);
    })().catch((cause: unknown) => {
      if (controller.signal.aborted || isAbort(cause)) return;
      if (cause instanceof ReadConnectionLost) return lost();
      setError(readErrorCopy(cause, locale));
    });
    return () => controller.abort();
  }, [transport, root, info.path, info.revision, retry, attempt, begin]);

  useEffect(() => {
    if (!findRequest) return;
    setFindOpen(true);
    setFindFocus((value) => value + 1);
  }, [findRequest]);

  // Blocks carry their source line so the reading position survives a switch to source.
  const blocks = () => [
    ...(content.current?.querySelectorAll<HTMLElement>(
      "[data-iori-markdown-line]",
    ) ?? []),
  ];
  useEffect(() => {
    if (text === undefined || restored.current) return;
    restored.current = true;
    const target = blocks().find(
      (node) => Number(node.dataset.ioriMarkdownLine) >= latest.current.line,
    );
    if (target && scroller.current)
      scroller.current.scrollTop =
        target.offsetTop - scroller.current.offsetTop;
  }, [text]);

  // The first block in view is found by binary search, so this stays cheap per scroll event.
  const onScroll = () => {
    const box = scroller.current;
    // A hidden view resets its scroll position; that is not the reader moving.
    if (!box || box.clientHeight === 0) return;
    const top = box.getBoundingClientRect().top;
    const list = blocks();
    let low = 0;
    let high = list.length - 1;
    while (low < high) {
      const middle = (low + high) >> 1;
      if (list[middle]!.getBoundingClientRect().bottom <= top) low = middle + 1;
      else high = middle;
    }
    const line = Number(list[low]?.dataset.ioriMarkdownLine ?? 1);
    if (line !== latest.current.line) onPosition({ ...latest.current, line });
  };

  const ranges = useRef<Range[]>([]);
  useEffect(() => {
    if (!content.current) return;
    ranges.current = findOpen
      ? findRanges(content.current, position.query)
      : [];
    paint("iori-find", ranges.current);
    const current =
      position.match === undefined ? undefined : ranges.current[position.match];
    paint("iori-find-current", current ? [current] : []);
    return () => {
      paint("iori-find", []);
      paint("iori-find-current", []);
    };
  }, [text, position.query, position.match, findOpen]);
  const step = (direction: 1 | -1) => {
    const count = ranges.current.length;
    if (!count) {
      setStatus(t("No matches"));
      return;
    }
    setStatus(undefined);
    const now = latest.current.match;
    const next =
      now === undefined
        ? direction === 1
          ? 0
          : count - 1
        : (now + direction + count) % count;
    onPosition({ ...latest.current, match: next });
    const rect = ranges.current[next]!.getBoundingClientRect();
    const box = scroller.current;
    if (box)
      box.scrollTop +=
        rect.top - box.getBoundingClientRect().top - box.clientHeight / 3;
  };

  const link = async (href: string) => {
    try {
      if (href.startsWith("#")) {
        const target = content.current?.querySelector(
          `#${CSS.escape(decodeURIComponent(href.slice(1)))}`,
        );
        if (target instanceof HTMLElement && scroller.current) {
          scroller.current.scrollTop =
            target.offsetTop - scroller.current.offsetTop;
          // The scroll event may come after the view changes; record the position now.
          onScroll();
        }
      } else if (/^(https?:|mailto:)/iu.test(href)) await native.openUrl(href);
      else {
        if (standalone && !/^(?:[a-z][a-z\d+.-]*:|\/\/)/iu.test(href)) {
          const {
            results: [target],
          } = await transport.request("files.resolve", {
            root,
            paths: [decodeURIComponent(href.split(/[?#]/u)[0]!)],
          });
          onOpenFile?.(target!, true);
        } else {
          const path = markdownPath(info.path, href);
          if (path !== undefined) onOpen(path);
        }
      }
    } catch {
      setError(t("Could not open the link."));
    }
  };

  const rendered = useMemo(() => {
    if (text === undefined) return null;
    // Headings get GitHub's anchors once, in document order; renders reuse them.
    const slugger = new GithubSlugger();
    const anchors = new Map<number, string>();
    const anchor = (node?: HastNode) => {
      const line = node?.position?.start.line ?? -1;
      let value = anchors.get(line);
      if (value === undefined) {
        value = slugger.slug(textOf(node));
        anchors.set(line, value);
      }
      return value;
    };
    const block =
      (tag: "p" | "li" | "blockquote" | "table" | "pre") =>
      ({ node, children }: { node?: HastNode; children?: ReactNode }) => {
        const Tag = tag;
        return (
          <Tag data-iori-markdown-line={node?.position?.start.line}>
            {children}
          </Tag>
        );
      };
    const heading =
      (Tag: "h1" | "h2" | "h3" | "h4" | "h5" | "h6") =>
      ({ node, children }: { node?: HastNode; children?: ReactNode }) => (
        <Tag
          id={anchor(node)}
          data-iori-markdown-line={node?.position?.start.line}
        >
          {children}
        </Tag>
      );
    const components = {
      h1: heading("h1"),
      h2: heading("h2"),
      h3: heading("h3"),
      h4: heading("h4"),
      h5: heading("h5"),
      h6: heading("h6"),
      p: block("p"),
      li: block("li"),
      blockquote: block("blockquote"),
      table: block("table"),
      // Code is one plain surface, not Streamdown's frame, header row and inner frame.
      pre: block("pre"),
      code: ({
        className,
        children,
      }: {
        className?: string;
        children?: ReactNode;
      }) => <code className={className}>{children}</code>,
      a: ({ href, children }: { href?: string; children?: ReactNode }) => (
        // No href: middle-click and Ctrl+click cannot open a new WebView window.
        <a
          role="link"
          tabIndex={0}
          data-iori-href={href}
          onClick={(event) => {
            event.preventDefault();
            if (href) void link(href);
          }}
          onKeyDown={(event) => {
            if (event.key === "Enter" && href) void link(href);
          }}
        >
          {children}
        </a>
      ),
      img: ({ src, alt }: { src?: string | Blob; alt?: string }) => {
        const path =
          typeof src === "string"
            ? standalone && !/^(?:[a-z][a-z\d+.-]*:|\/\/)/iu.test(src)
              ? decodeURIComponent(src.split(/[?#]/u)[0]!)
              : markdownPath(info.path, src)
            : undefined;
        return path === undefined ? (
          <span className="reading-inline-note">{alt}</span>
        ) : (
          <LocalImage
            standalone={standalone}
            transport={transport}
            root={root}
            path={path}
            alt={alt}
            locale={locale}
          />
        );
      },
    } as Components;
    return (
      <Streamdown
        mode="static"
        controls={false}
        parseIncompleteMarkdown={false}
        linkSafety={{ enabled: false }}
        remarkPlugins={markdownRemarkPlugins}
        rehypePlugins={[defaultRehypePlugins.sanitize!]}
        components={components}
      >
        {text}
      </Streamdown>
    );
  }, [text, transport, root, info.path, locale]);

  return (
    <div className="reading-surface">
      {findOpen && (
        <FindBar
          query={position.query}
          onQuery={(query) => {
            setStatus(undefined);
            onPosition({ ...latest.current, query, match: undefined });
          }}
          onNext={() => step(1)}
          onPrevious={() => step(-1)}
          onClose={() => setFindOpen(false)}
          status={status}
          locale={locale}
          focusKey={findFocus}
        />
      )}
      {error && (
        <ReadingError
          centered={text === undefined}
          retryLabel={t("Retry")}
          onRetry={() => setRetry((value) => value + 1)}
        >
          {error}
        </ReadingError>
      )}
      <PathMenu
        selectable
        path={info.absolutePath}
        lines={{ start: position.line, end: position.line }}
        actions={[
          ...(selectedText
            ? [
                {
                  label: t("Copy"),
                  icon: <ClipboardCopy />,
                  shortcut: "Ctrl+C",
                  action: "copy-text",
                  run: () => native.clipboardWrite(selectedText),
                },
              ]
            : []),
          ...(extraActions ?? []),
        ]}
        locale={locale}
      >
        <div
          ref={scroller}
          className="reading-markdown-scroll"
          data-iori-scroll="file-markdown"
          tabIndex={0}
          onContextMenuCapture={() => {
            const selection = window.getSelection();
            setSelectedText(
              selection?.anchorNode &&
                selection.focusNode &&
                content.current?.contains(selection.anchorNode) &&
                content.current.contains(selection.focusNode)
                ? selection.toString()
                : "",
            );
          }}
          onScroll={onScroll}
          onKeyDown={(event) => {
            if (
              (event.ctrlKey || event.metaKey) &&
              event.key.toLowerCase() === "f"
            ) {
              event.preventDefault();
              setFindOpen(true);
              setFindFocus((value) => value + 1);
            } else if (event.key === "Escape") setFindOpen(false);
          }}
        >
          <div
            ref={content}
            className="reading-markdown"
            data-iori-part="markdown-rendered"
          >
            <RefreshContext.Provider value={refresh}>
              {rendered}
            </RefreshContext.Provider>
          </div>
        </div>
      </PathMenu>
    </div>
  );
}
