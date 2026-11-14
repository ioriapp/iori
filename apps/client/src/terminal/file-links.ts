import type { ILink, Terminal } from "@xterm/xterm";
import type { OpenFile } from "../workspace-panel.tsx";
import type { ReadingTransport } from "../reading/transport.ts";

export type PathCandidate = {
  text: string;
  path: string;
  start: number;
  end: number;
  line?: number;
  column?: number;
};

/** Quotes delimit paths containing spaces; bare paths end at terminal prose punctuation. */
export function pathCandidates(text: string): PathCandidate[] {
  const result: PathCandidate[] = [];
  // Quotes following prose/punctuation delimit paths, but apostrophes in
  // ASCII words (I've, it's) stay part of the word.
  const tokens =
    /(?<![A-Za-z0-9])(?:"([^"\r\n]+)"|'([^'\r\n]+)'|`([^`\r\n]+)`)|([^\s<>"`|()\[\]{}'（）「」『』【】〈〉《》〔〕［］｛｝‘’“”]+(?:(?<=[A-Za-z0-9])'[A-Za-z0-9]+)*)/gu;
  for (const match of text.matchAll(tokens)) {
    const quoted = match[1] ?? match[2] ?? match[3];
    const raw = quoted ?? match[4]!;
    const value = raw.replace(/[.,;!?:]+$/u, "");
    if (/^[a-z][a-z\d+.-]*:\/\//iu.test(value)) continue;
    const start = match.index + match[0].indexOf(raw);
    const add = (value: string) => {
      const suffix = /:(\d+)(?::(\d+))?$/u.exec(value);
      const path = suffix ? value.slice(0, suffix.index) : value;
      if (!path || path === "." || path === "..") return;
      result.push({
        text: value,
        path,
        start,
        end: start + value.length,
        ...(suffix
          ? {
              line: Number(suffix[1]),
              ...(suffix[2] ? { column: Number(suffix[2]) } : {}),
            }
          : {}),
      });
    };
    add(value);
    // Japanese punctuation can also be part of a real filename. Resolve the
    // complete candidate first, then try the prose-free version.
    const withoutPunctuation = value.replace(/[。、]+$/u, "");
    if (quoted === undefined && withoutPunctuation !== value)
      add(withoutPunctuation);
    // Keep Japanese filenames intact; try a prose-free prefix only if the
    // complete filename does not exist. Both go in the same Host request.
    const prefix =
      /^(.*\.[a-zA-Z0-9]+)(?=[\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Han}])/u.exec(
        value,
      )?.[1];
    if (quoted === undefined && prefix) add(prefix);
  }
  return result;
}

/** Map string offsets back to terminal cells, including wide characters and wrapped rows. */
function logicalLine(terminal: Terminal, y: number) {
  const buffer = terminal.buffer.active;
  let first = y - 1;
  while (first > 0 && buffer.getLine(first)?.isWrapped) first--;
  let last = y - 1;
  while (buffer.getLine(last + 1)?.isWrapped) last++;
  let text = "";
  const cells: { x: number; y: number }[] = [];
  for (let row = first; row <= last; row++) {
    const line = buffer.getLine(row)!;
    for (let col = 0; col < terminal.cols; col++) {
      const cell = line.getCell(col)!;
      if (cell.getWidth() === 0) continue;
      const chars = cell.getChars() || " ";
      for (let i = 0; i < chars.length; i++)
        cells.push({ x: col + 1, y: row + 1 });
      text += chars;
    }
  }
  return { text, cells };
}

/** A path link; a finger tap calls open() directly instead of activate. */
export type PathLink = ILink & { open: () => void };

export function terminalPathLinks(
  terminal: Terminal,
  transport: ReadingTransport,
  cwd: () => string,
  open: (file: OpenFile) => void,
  pointer: {
    opens: (event: MouseEvent) => boolean;
    hover: (event: MouseEvent) => void;
  },
) {
  // Only the most recently inspected logical line is kept. Tap and hover
  // share its in-flight request as well as the resolved result.
  type Cache = {
    text: string;
    root: string;
    result: Promise<Awaited<ReturnType<typeof resolve>>>;
  };
  let cached: Cache | undefined;
  const resolve = (root: string, candidates: PathCandidate[]) =>
    transport.request("files.resolve", {
      root,
      paths: candidates.map((candidate) => candidate.path),
    });
  const materialize = (
    { text, cells }: ReturnType<typeof logicalLine>,
    { results }: Awaited<ReturnType<typeof resolve>>,
  ): PathLink[] => {
    const candidates = pathCandidates(text);
    const found = new Set<number>();
    return candidates.flatMap((candidate, index): PathLink[] => {
      const target = results[index]!;
      if (!target.found || found.has(candidate.start)) return [];
      found.add(candidate.start);
      const openTarget = () =>
        open({ ...target, line: candidate.line, column: candidate.column });
      return [
        {
          text: candidate.text,
          range: {
            start: cells[candidate.start]!,
            end: cells[candidate.end - 1]!,
          },
          activate: (event: MouseEvent) => {
            if (pointer.opens(event)) openTarget();
          },
          hover: pointer.hover,
          open: openTarget,
        },
      ];
    });
  };
  const links = async (y: number): Promise<PathLink[]> => {
    const { text, cells } = logicalLine(terminal, y);
    const candidates = pathCandidates(text);
    if (!candidates.length) return [];
    const root = cwd();
    if (!cached || cached.text !== text || cached.root !== root) {
      const entry: Cache = { text, root, result: resolve(root, candidates) };
      cached = entry;
      void entry.result.catch(() => {
        if (cached === entry) cached = undefined;
      });
    }
    try {
      const { results } = await cached.result;
      return materialize({ text, cells }, { results });
    } catch {
      return [];
    }
  };
  return links;
}

// Based on @xterm/addon-web-links (MIT), with Japanese prose boundaries.
// Shared with the desktop addon so touch and pointer use the same boundaries.
export const terminalUrlRegex =
  /(https?|HTTPS?):[/]{2}[^\s"'!*(){}|\\\^<>`（）「」『』【】〈〉《》〔〕［］｛｝‘’“”]*[^\s"':,.!?{}|\\\^~\[\]`()<>。、（）「」『』【】〈〉《》〔〕［］｛｝‘’“”]/;

type OscTerminal = {
  _core?: {
    _oscLinkService?: { getLinkData?(id: number): { uri: string } | undefined };
  };
};

/** Returns synchronously for URL/plain cells; only filesystem candidates need I/O. */
export function tapTerminalLink(
  terminal: Terminal,
  event: Event,
  paths: ReturnType<typeof terminalPathLinks>,
  openUrl: (url: string) => void,
): boolean | Promise<boolean> {
  const point = event as Event & { pageX: number; pageY: number };
  const bounds = terminal
    .element!.querySelector(".xterm-screen")!
    .getBoundingClientRect();
  const x =
    Math.floor(
      (point.pageX - window.scrollX - bounds.left) /
        (bounds.width / terminal.cols),
    ) + 1;
  const y =
    Math.floor(
      (point.pageY - window.scrollY - bounds.top) /
        (bounds.height / terminal.rows),
    ) +
    terminal.buffer.active.viewportY +
    1;
  const contains = (link: Pick<ILink, "range">) =>
    (y > link.range.start.y ||
      (y === link.range.start.y && x >= link.range.start.x)) &&
    (y < link.range.end.y || (y === link.range.end.y && x <= link.range.end.x));
  // xterm's public buffer cell is its CellData object. urlId and the service
  // resolving it are internal until xterm exposes OSC 8 lookup publicly.
  const cell = terminal.buffer.active
    .getLine(y - 1)
    ?.getCell(x - 1) as unknown as
    { extended?: { urlId?: number } } | undefined;
  const urlId = cell?.extended?.urlId;
  if (urlId) {
    const uri = (
      terminal as unknown as OscTerminal
    )._core?._oscLinkService?.getLinkData?.(urlId)?.uri;
    if (uri) {
      if (!/^https?:\/\//iu.test(uri)) return false;
      openUrl(uri);
      return true;
    }
  }
  const { text, cells } = logicalLine(terminal, y);
  let at = cells.length - 1;
  while (at >= 0 && (cells[at]!.y !== y || cells[at]!.x > x)) at--;
  if (at < 0) return false;
  for (const match of text.matchAll(new RegExp(terminalUrlRegex.source, "g"))) {
    if (at >= match.index && at < match.index + match[0].length) {
      openUrl(match[0]);
      return true;
    }
  }
  const candidates = pathCandidates(text).filter(
    (candidate) => at >= candidate.start && at < candidate.end,
  );
  if (!candidates.length) return false;
  const activate = (links: PathLink[]) => {
    const link = links.find(contains);
    if (!link) return false;
    link.open();
    return true;
  };
  // Bare words always focus input on touch; pointer links still resolve them.
  if (!candidates.some((candidate) => /[/\\.~]/u.test(candidate.path)))
    return false;
  return paths(y).then(activate);
}
