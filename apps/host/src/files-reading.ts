import { isWithin } from "./path-boundary.ts";
export { isWithin } from "./path-boundary.ts";
import {
  forgetOutdatedFileSyntax,
  readFileSyntax,
  MAX_SYNTAX_FILE_BYTES,
  MAX_SYNTAX_FILE_LINES,
} from "./files-syntax.ts";
import { syntaxLanguage } from "./files-syntax-language.ts";
import { fileUploadTemporaries } from "./files-upload-temporaries.ts";
import { homedir } from "node:os";
import hostPath, { basename, dirname } from "node:path";
import { constants } from "node:fs";
import {
  lstat,
  open,
  opendir,
  readdir,
  realpath,
  stat,
} from "node:fs/promises";
import { extname, isAbsolute, join, relative, resolve, sep } from "node:path";
import {
  MAX_PAGE_RESPONSE_BYTES,
  type FileEntry,
  type FileInfo,
  type ReadParamsByMethod,
  type ReadResultByMethod,
  type ReadMethod,
  type WorkspaceSearchMatch,
  type SymlinkTargetKind,
  type SymlinkTargetState,
} from "@iori/protocol";
import type { FileHandle } from "node:fs/promises";
import {
  ReadingFailure,
  errorCode,
  throwIfAborted,
  toFailure,
} from "./reading-failure.ts";
import { NulReader, finishGit, startGit, stopGit } from "./git-process.ts";
import {
  READ_CHUNK,
  checkpointFor,
  continuesText,
  readAt,
  readLines,
  lineEnd,
  scanMatches,
  scanText,
  searchLines,
  seekLine,
  type LineIndex,
  type TextScan,
} from "./text-lines.ts";

export { ReadingFailure } from "./reading-failure.ts";

type Signal = AbortSignal | undefined;
type Root = { selected: string; real: string };
type OpenedFile = {
  handle: FileHandle;
  canonical: string;
  /** The device and inode: the same file even after it grew. */
  identity: string;
  revision: string;
  size: number;
  modifiedAtMs: number;
};
type ScannedFile = { revision: string; identity: string; scan: TextScan };

const INDEX_CACHE_SIZE = 8;
const scannedFiles = new Map<string, ScannedFile>();
const collator = new Intl.Collator(undefined, {
  numeric: true,
  sensitivity: "base",
});

/** Names hidden from listings and name search, matching VS Code's `files.exclude` defaults. */
const EXCLUDED_NAMES = new Set([
  ".git",
  ".svn",
  ".hg",
  ".jj",
  ".DS_Store",
  "Thumbs.db",
]);

function isExcludedName(name: string): boolean {
  return EXCLUDED_NAMES.has(name);
}

function isExcludedPath(path: string): boolean {
  return path.split("/").some((part) => isExcludedName(part));
}

export const MIME_BY_EXTENSION: Record<string, string> = {
  ".avif": "image/avif",
  ".bmp": "image/bmp",
  ".gif": "image/gif",
  ".ico": "image/x-icon",
  ".jpeg": "image/jpeg",
  ".jpg": "image/jpeg",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".tif": "image/tiff",
  ".tiff": "image/tiff",
  ".webp": "image/webp",
  ".md": "text/markdown",
  ".markdown": "text/markdown",
  ".txt": "text/plain",
  ".json": "application/json",
};

function assertRelative(path: string): string[] {
  if (
    // A backslash is a separator only on Windows; elsewhere it is part of a name.
    (process.platform === "win32" && path.includes("\\")) ||
    path.includes("\0") ||
    path.startsWith("/") ||
    /^[a-zA-Z]:/u.test(path)
  )
    throw new ReadingFailure(
      "path_outside_root",
      "Path must be relative to the selected folder",
    );
  if (path === "") return [];
  const parts = path.split("/");
  if (parts.some((part) => part === ".." || part === "." || part === ""))
    throw new ReadingFailure(
      "path_outside_root",
      "Path must stay inside the selected folder",
    );
  return parts;
}

async function selectedRoot(value: string): Promise<Root> {
  if (!isAbsolute(value))
    throw new ReadingFailure(
      "path_outside_root",
      "Selected folder must be an absolute path",
    );
  const selected = resolve(value);
  try {
    const real = await realpath(selected);
    if (!(await stat(real)).isDirectory())
      throw new ReadingFailure(
        "not_a_directory",
        "Selected path is not a folder",
      );
    return { selected, real };
  } catch (error) {
    throw toFailure(error);
  }
}

function absoluteFor(root: Root, relativePath: string): string {
  const absolutePath = resolve(root.selected, ...assertRelative(relativePath));
  if (!isWithin(root.selected, absolutePath))
    throw new ReadingFailure(
      "path_outside_root",
      "Path must stay inside the selected folder",
    );
  return absolutePath;
}

/** The real path of a target, which must stay inside the selected folder. */
async function insidePath(root: Root, relativePath: string) {
  const absolutePath = absoluteFor(root, relativePath);
  let canonical: string;
  try {
    canonical = await realpath(absolutePath);
  } catch (error) {
    throw toFailure(error);
  }
  if (!isWithin(root.real, canonical))
    throw new ReadingFailure(
      "path_outside_root",
      "Symlink target is outside the selected folder",
    );
  return { absolutePath, canonical };
}

export function revisionFor(info: {
  dev: bigint;
  ino: bigint;
  size: bigint;
  mtimeNs: bigint;
}): string {
  return `${info.dev}:${info.ino}:${info.size}:${info.mtimeNs}`;
}

async function openFile(
  root: Root,
  relativePath: string,
  signal?: Signal,
): Promise<OpenedFile> {
  throwIfAborted(signal);
  const { canonical } = await insidePath(root, relativePath);
  let handle: FileHandle;
  try {
    handle = await open(canonical, constants.O_RDONLY | constants.O_NONBLOCK);
  } catch (error) {
    throw toFailure(error);
  }
  try {
    const info = await handle.stat({ bigint: true });
    if (!info.isFile())
      throw new ReadingFailure("not_a_file", "Path is not a regular file");
    return {
      handle,
      canonical,
      identity: `${info.dev}:${info.ino}`,
      revision: revisionFor(info),
      size: Number(info.size),
      modifiedAtMs: Number(info.mtimeMs),
    };
  } catch (error) {
    await handle.close().catch(() => undefined);
    throw toFailure(error);
  }
}

async function withFile<T>(
  root: Root,
  path: string,
  signal: Signal,
  read: (file: OpenedFile) => Promise<T>,
): Promise<T> {
  const file = await openFile(root, path, signal);
  try {
    return await read(file);
  } catch (error) {
    throw toFailure(error);
  } finally {
    await file.handle.close().catch(() => undefined);
  }
}

/**
 * Scans a file once per revision; the result is kept for a few recent files.
 * A file that only grew, such as a log being written, is scanned on from the
 * end of the previous scan.
 */
async function scanned(file: OpenedFile, signal?: Signal) {
  const cached = scannedFiles.get(file.canonical);
  if (cached?.revision === file.revision) {
    scannedFiles.delete(file.canonical);
    scannedFiles.set(file.canonical, cached);
    return cached.scan;
  }
  // The previous scan stays cached meanwhile so that other reads of the grown file also go on from it.
  const scan = await scanText(
    file.handle,
    file.size,
    signal,
    cached?.identity === file.identity ? cached.scan : undefined,
  );
  scannedFiles.delete(file.canonical);
  scannedFiles.set(file.canonical, {
    revision: file.revision,
    identity: file.identity,
    scan,
  });
  while (scannedFiles.size > INDEX_CACHE_SIZE)
    scannedFiles.delete(scannedFiles.keys().next().value!);
  return scan;
}

async function textIndex(file: OpenedFile, signal?: Signal) {
  const result = await scanned(file, signal);
  if (!result.text) throw new ReadingFailure("not_a_file", "File is binary");
  return result.index;
}

async function lineStart(
  file: OpenedFile,
  index: LineIndex,
  line: number,
  signal?: Signal,
): Promise<number> {
  const base = checkpointFor(index, line);
  return seekLine(
    file.handle,
    file.size,
    { line: base, offset: index.offsets.get(base) ?? 0 },
    line,
    signal,
  );
}

async function describeEntry(
  root: Root,
  parent: string,
  name: string,
): Promise<FileEntry | undefined> {
  const path = parent ? `${parent}/${name}` : name;
  const absolutePath = absoluteFor(root, path);
  let item;
  try {
    item = await lstat(absolutePath);
  } catch {
    // The entry disappeared or cannot be inspected; the rest of the folder stays readable.
    return undefined;
  }
  const kind: FileEntry["kind"] = item.isDirectory()
    ? "directory"
    : item.isFile()
      ? "file"
      : item.isSymbolicLink()
        ? "symlink"
        : "other";
  let targetKind: SymlinkTargetKind | undefined;
  let symlinkTarget: SymlinkTargetState | undefined;
  if (kind === "symlink") {
    try {
      const canonical = await realpath(absolutePath);
      if (isWithin(root.real, canonical)) {
        symlinkTarget = "inside_root";
        const target = await stat(canonical);
        targetKind = target.isDirectory()
          ? "directory"
          : target.isFile()
            ? "file"
            : "other";
      } else symlinkTarget = "outside_root";
    } catch (error) {
      const code = errorCode(error);
      if (code === "ENOENT" || code === "ENOTDIR") symlinkTarget = "broken";
    }
  }
  return {
    name,
    path,
    absolutePath,
    kind,
    ...(targetKind ? { targetKind } : {}),
    ...(symlinkTarget ? { symlinkTarget } : {}),
  };
}

function fitsPage(entries: unknown[]): boolean {
  return (
    Buffer.byteLength(JSON.stringify(entries), "utf8") < MAX_PAGE_RESPONSE_BYTES
  );
}

/** Folders first, then names in the user's collation, like common file explorers. */
async function listDirectory(
  root: Root,
  { path, start, count, locate }: ReadParamsByMethod["files.list"],
  signal?: Signal,
): Promise<ReadResultByMethod["files.list"]> {
  const { canonical } = await insidePath(root, path);
  let names: { name: string; directory: boolean }[];
  try {
    const dirents = await readdir(canonical, { withFileTypes: true });
    names = await Promise.all(
      dirents
        .filter(
          (dirent) =>
            !isExcludedName(dirent.name) &&
            !fileUploadTemporaries.has(join(canonical, dirent.name)),
        )
        .map(async (dirent) => ({
          name: dirent.name,
          directory:
            dirent.isDirectory() ||
            (dirent.isSymbolicLink() &&
              (await stat(join(canonical, dirent.name)).then(
                (target) => target.isDirectory(),
                () => false,
              ))),
        })),
    );
  } catch (error) {
    throw toFailure(error);
  }
  throwIfAborted(signal);
  names.sort(
    (a, b) =>
      Number(b.directory) - Number(a.directory) ||
      collator.compare(a.name, b.name) ||
      (a.name < b.name ? -1 : a.name > b.name ? 1 : 0),
  );
  const entries: FileEntry[] = [];
  for (const { name } of names.slice(start, start + count)) {
    throwIfAborted(signal);
    const entry = await describeEntry(root, path, name);
    if (!entry) continue;
    entries.push(entry);
    if (!fitsPage(entries)) {
      entries.pop();
      break;
    }
  }
  const located =
    locate === undefined
      ? -1
      : names.findIndex((value) => value.name === locate);
  return {
    entries,
    total: names.length,
    ...(located >= 0 ? { located } : {}),
  };
}

/** Paths below a link stand for the link itself; Git for Windows follows junctions. */
async function linkAncestor(
  base: string,
  path: string,
  links: Map<string, boolean>,
): Promise<string | undefined> {
  const parts = path.split("/");
  for (let depth = 1; depth < parts.length; depth += 1) {
    const prefix = parts.slice(0, depth).join("/");
    let link = links.get(prefix);
    if (link === undefined) {
      link = await lstat(join(base, ...parts.slice(0, depth))).then(
        (info) => info.isSymbolicLink(),
        () => false,
      );
      links.set(prefix, link);
    }
    if (link) return prefix;
  }
  return undefined;
}

async function* gitListedFiles(root: Root, signal?: Signal) {
  const git = startGit(
    root.real,
    ["ls-files", "--cached", "--others", "--exclude-standard", "-z"],
    signal,
  );
  const reader = new NulReader(git.child.stdout);
  const links = new Map<string, boolean>();
  const seen = new Set<string>();
  try {
    for (;;) {
      const field = await reader.next();
      if (field === undefined) break;
      const path = field.toString("utf8").replace(/\/$/u, "");
      if (!path || fileUploadTemporaries.has(join(root.real, path))) continue;
      const link =
        process.platform === "win32"
          ? await linkAncestor(root.real, path, links)
          : undefined;
      const listed = link ?? path;
      if (link) {
        if (seen.has(link)) continue;
        seen.add(link);
      }
      yield listed;
    }
    await finishGit(git, signal);
  } finally {
    if (git.child.exitCode === null) await stopGit(git);
  }
}

async function* walkedFiles(root: Root, signal?: Signal) {
  const queue = [""];
  while (queue.length) {
    throwIfAborted(signal);
    const parent = queue.shift()!;
    let directory;
    try {
      directory = await opendir(parent ? join(root.real, parent) : root.real);
    } catch {
      throwIfAborted(signal);
      continue;
    }
    try {
      for await (const dirent of directory) {
        throwIfAborted(signal);
        const path = parent ? `${parent}/${dirent.name}` : dirent.name;
        if (fileUploadTemporaries.has(join(root.real, path))) continue;
        if (isExcludedName(dirent.name)) continue;
        if (dirent.isDirectory()) queue.push(path);
        else yield path;
      }
    } catch {
      throwIfAborted(signal);
      // An unreadable folder does not hide the rest of the tree.
    }
  }
}

async function* workspaceFiles(root: Root, signal?: Signal) {
  try {
    yield* gitListedFiles(root, signal);
  } catch (error) {
    if (
      !(error instanceof ReadingFailure) ||
      error.code !== "not_git_repository"
    )
      throw error;
    yield* walkedFiles(root, signal);
  }
}

/** Names that contain the query. In a Git repository, ignored files are not candidates. */
async function findFiles(
  root: Root,
  query: string,
  start: number,
  count: number,
  signal?: Signal,
): Promise<ReadResultByMethod["files.find"]> {
  const wanted = query.toLocaleLowerCase();
  const entries: FileEntry[] = [];
  let matched = 0;
  let hasMore = false;
  for await (const path of workspaceFiles(root, signal)) {
    if (isExcludedPath(path)) continue;
    const name = path.slice(path.lastIndexOf("/") + 1);
    if (wanted && !path.toLocaleLowerCase().includes(wanted)) continue;
    if (matched++ < start) continue;
    if (entries.length >= count) {
      hasMore = true;
      break;
    }
    const slash = path.lastIndexOf("/");
    const entry = await describeEntry(
      root,
      slash < 0 ? "" : path.slice(0, slash),
      name,
    );
    if (!entry) continue;
    entries.push(entry);
    if (!fitsPage(entries)) {
      entries.pop();
      hasMore = true;
      break;
    }
  }
  return { entries, hasMore };
}

// Bound the memory needed to match one logical line, independently of file size.
const MAX_SEARCH_LINE_BYTES = 8 * 1024 * 1024;

async function* workspaceLines(file: OpenedFile, signal?: Signal) {
  let parts: Buffer[] = [];
  let length = 0;
  const decoder = new TextDecoder("utf-8", { ignoreBOM: true });
  let first = true;
  function finish() {
    let text: string | undefined;
    if (length <= MAX_SEARCH_LINE_BYTES) {
      const bytes =
        parts.length === 1 ? parts[0]! : Buffer.concat(parts, length);
      text = decoder.decode(
        bytes.at(-1) === 13 ? bytes.subarray(0, -1) : bytes,
      );
      if (first && text.startsWith("\uFEFF")) text = text.slice(1);
    }
    parts = [];
    length = 0;
    first = false;
    return text;
  }
  for (let offset = 0; offset < file.size;) {
    throwIfAborted(signal);
    const block = await readAt(
      file.handle,
      offset,
      Math.min(READ_CHUNK, file.size - offset),
    );
    if (!block.length) break;
    if (offset === 0 && block.subarray(0, 8192).includes(0)) return;
    offset += block.length;
    let at = 0;
    while (at < block.length) {
      const lf = block.indexOf(10, at);
      const end = lf < 0 ? block.length : lf;
      length += end - at;
      if (length <= MAX_SEARCH_LINE_BYTES) parts.push(block.subarray(at, end));
      if (lf < 0) break;
      yield finish();
      at = lf + 1;
    }
  }
  if (length) yield finish();
}

async function searchWorkspace(
  root: Root,
  {
    folder,
    query,
    caseSensitive,
    regex,
    maxResults = 200,
  }: ReadParamsByMethod["files.searchWorkspace"],
  signal?: Signal,
): Promise<ReadResultByMethod["files.searchWorkspace"]> {
  if (folder) {
    const { canonical } = await insidePath(root, folder);
    if (!(await stat(canonical)).isDirectory())
      throw new ReadingFailure(
        "not_a_directory",
        "Search path is not a folder",
      );
  }
  let pattern: RegExp;
  try {
    const source = regex
      ? query
      : query.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
    pattern = new RegExp(source, caseSensitive ? "gu" : "giu");
  } catch {
    throw new ReadingFailure("invalid_request", "Invalid search expression");
  }
  const matches: WorkspaceSearchMatch[] = [];
  const matchedFiles = new Set<string>();
  let truncated = false;
  let pageBytes = 2; // JSON array delimiters
  for await (const path of workspaceFiles(root, signal)) {
    throwIfAborted(signal);
    if (
      isExcludedPath(path) ||
      (folder && !path.startsWith(folder + "/")) ||
      matchedFiles.has(path)
    )
      continue;
    try {
      const full = await withFile(root, path, signal, async (file) => {
        const absolutePath = absoluteFor(root, path);
        let line = 0;
        for await (const text of workspaceLines(file, signal)) {
          line++;
          if (text === undefined || (regex && text.length > 20_000)) {
            truncated = true;
            continue;
          }
          for (const hit of text.matchAll(pattern)) {
            const column = hit.index;
            const context = Math.max(0, 300 - hit[0].length);
            const start = Math.max(
              0,
              Math.min(column - Math.floor(context / 2), text.length - 300),
            );
            const match = {
              path,
              absolutePath,
              line,
              column,
              length: hit[0].length,
              text: text.slice(start, start + 300),
              previewColumn: column - start,
            };
            pageBytes +=
              Buffer.byteLength(JSON.stringify(match)) +
              (matches.length ? 1 : 0);
            if (pageBytes >= MAX_PAGE_RESPONSE_BYTES) return true;
            matches.push(match);
            matchedFiles.add(path);
            if (matches.length >= maxResults) return true;
          }
        }
        return false;
      });
      if (full) {
        truncated = true;
        break;
      }
    } catch (error) {
      throwIfAborted(signal);
      if (!(error instanceof ReadingFailure)) throw error;
      // A missing or unreadable entry does not hide matches in other files.
    }
  }
  return { matches, truncated, fileCount: matchedFiles.size };
}

async function fileInfo(
  root: Root,
  path: string,
  signal?: Signal,
): Promise<FileInfo> {
  const absolutePath = absoluteFor(root, path);
  let linkInfo;
  try {
    linkInfo = await lstat(absolutePath);
  } catch (error) {
    throw toFailure(error);
  }
  let symlinkTarget: FileInfo["symlinkTarget"];
  let target = linkInfo;
  if (linkInfo.isSymbolicLink()) {
    try {
      const canonical = await realpath(absolutePath);
      if (!isWithin(root.real, canonical))
        return {
          path,
          absolutePath,
          kind: "symlink",
          symlinkTarget: "outside_root",
        };
      symlinkTarget = "inside_root";
      target = await stat(canonical);
    } catch (error) {
      const code = errorCode(error);
      if (code === "ENOENT" || code === "ENOTDIR")
        return { path, absolutePath, kind: "symlink", symlinkTarget: "broken" };
      throw toFailure(error);
    }
  }
  const linked = symlinkTarget ? { symlinkTarget } : {};
  if (target.isDirectory())
    return { path, absolutePath, kind: "directory", ...linked };
  if (!target.isFile())
    return {
      path,
      absolutePath,
      kind: "unsupported",
      sizeBytes: target.size,
      ...linked,
    };
  return withFile(root, path, signal, async (file) => {
    const mimeType = MIME_BY_EXTENSION[extname(path).toLowerCase()];
    const common = {
      path,
      absolutePath,
      sizeBytes: file.size,
      modifiedAtMs: file.modifiedAtMs,
      revision: file.revision,
      ...linked,
    };
    if (mimeType?.startsWith("image/"))
      return { ...common, kind: "image" as const, mimeType };
    const result = await scanned(file, signal);
    return {
      ...common,
      kind: result.text ? ("text" as const) : ("binary" as const),
      ...(mimeType ? { mimeType } : {}),
      ...(result.text ? { lineCount: result.index.lines } : {}),
    };
  });
}

export function resolveLocalFilePath(
  root: string,
  candidate: string,
  home: string,
  paths = hostPath,
): string | undefined {
  let path = candidate;
  if (/^file:/iu.test(path)) {
    if (!/^file:\/\/\/(?!\/)/iu.test(path)) return undefined;
    try {
      path = decodeURIComponent(
        path.slice("file://".length).split(/[?#]/u, 1)[0]!,
      );
    } catch {
      return undefined;
    }
    if (/^\/[A-Za-z]:/u.test(path)) path = path.slice(1);
  }
  if (path.includes("\0") || /^[/\\]{2}/u.test(path)) return undefined;
  if (
    /^[A-Za-z]:/u.test(path) &&
    (paths.sep !== "\\" || !/^[A-Za-z]:[/\\]/u.test(path))
  )
    return undefined;
  if (path.startsWith("~/") || (paths.sep === "\\" && path.startsWith("~\\")))
    return paths.join(home, path.slice(2));
  return paths.resolve(root, path);
}

export async function handleFileRead<M extends ReadMethod>(
  method: M,
  params: ReadParamsByMethod[M],
  signal?: Signal,
): Promise<ReadResultByMethod[M]> {
  const root = await selectedRoot((params as { root: string }).root);
  switch (method) {
    case "files.list": {
      return (await listDirectory(
        root,
        params as ReadParamsByMethod["files.list"],
        signal,
      )) as ReadResultByMethod[M];
    }
    case "files.resolve": {
      const value = params as ReadParamsByMethod["files.resolve"];
      const home = homedir();
      const results = await Promise.all(
        value.paths.map(async (candidate) => {
          const absolutePath = resolveLocalFilePath(
            root.selected,
            candidate,
            home,
          );
          if (absolutePath === undefined)
            return {
              found: false,
              absolutePath: "",
              root: root.selected,
              path: "",
              displayPath: candidate,
            };
          const parent = dirname(absolutePath);
          const path = basename(absolutePath);
          let found = false;
          try {
            found = (await stat(absolutePath)).isFile();
          } catch {
            // A malformed or inaccessible candidate must not hide other files
            // on the same terminal line (for example ENAMETOOLONG).
            found = false;
          }
          const homeRelative = relative(home, absolutePath);
          return {
            found,
            absolutePath,
            root: parent,
            path,
            displayPath:
              homeRelative &&
              !homeRelative.startsWith(`..${sep}`) &&
              homeRelative !== ".." &&
              !isAbsolute(homeRelative)
                ? `~/${homeRelative.split(sep).join("/")}`
                : absolutePath,
          };
        }),
      );
      return { results } as ReadResultByMethod[M];
    }
    case "files.info": {
      const value = params as ReadParamsByMethod["files.info"];
      return (await fileInfo(
        root,
        value.path,
        signal,
      )) as ReadResultByMethod[M];
    }
    case "files.read": {
      const value = params as ReadParamsByMethod["files.read"];
      return (await withFile(root, value.path, signal, async (file) => {
        const bytes = await readAt(
          file.handle,
          value.offset,
          Math.min(value.length, Math.max(0, file.size - value.offset)),
        );
        return {
          offset: value.offset,
          nextOffset: value.offset + bytes.length,
          bytesBase64: bytes.toString("base64"),
          eof: value.offset + bytes.length >= file.size,
          sizeBytes: file.size,
          revision: file.revision,
        };
      })) as ReadResultByMethod[M];
    }
    case "files.syntax": {
      const value = params as ReadParamsByMethod["files.syntax"];
      return (await withFile(root, value.path, signal, async (file) => {
        forgetOutdatedFileSyntax(file);
        const plain = (endLine: number) => ({
          lines: [],
          startLine: value.startLine,
          endLine,
          revision: file.revision,
        });
        if (file.size > MAX_SYNTAX_FILE_BYTES)
          return plain(value.startLine + value.lineCount);
        const path = absoluteFor(root, value.path);
        // Most associations need no file content. Probe only the first line
        // when the name is insufficient, using the lineRange decoder.
        let language = syntaxLanguage(path, "");
        if (!language) {
          const end = await lineEnd(file.handle, file.size, 0, signal);
          const first = await readLines(file.handle, file.size, {
            startLine: 1,
            startOffset: 0,
            lineCount: 1,
            byteLimit: end,
            totalLines: 1,
          });
          language = syntaxLanguage(path, first.lines[0]?.text ?? "");
        }
        if (!language) return plain(value.startLine + value.lineCount);
        const scan = await scanned(file, signal);
        if (!scan.text)
          throw new ReadingFailure("not_a_file", "File is binary");
        const index = scan.index;
        const endLine = Math.max(
          value.startLine,
          Math.min(index.lines + 1, value.startLine + value.lineCount),
        );
        if (index.lines > MAX_SYNTAX_FILE_LINES) return plain(endLine);
        return readFileSyntax(
          {
            canonical: file.canonical,
            identity: file.identity,
            revision: file.revision,
            scan,
          },
          path,
          language,
          value,
          async (previous) => {
            const resume =
              previous?.identity === file.identity &&
              (await continuesText(file.handle, file.size, previous.scan))
                ? previous
                : undefined;
            // Re-read the former last logical line if it was unfinished,
            // including any partial UTF-8 or CR at EOF.
            const replaceFrom = resume
              ? Math.max(
                  1,
                  resume.scan.index.lines +
                    (resume.scan.finalByte === 10 ? 1 : 0),
                )
              : 1;
            const offset = resume
              ? await lineStart(file, resume.scan.index, replaceFrom, signal)
              : 0;
            // A dedicated backing store can be transferred; pooled Buffers cannot.
            const buffer = Buffer.allocUnsafeSlow(file.size - offset);
            const { bytesRead } = await file.handle.read(
              buffer,
              0,
              buffer.length,
              offset,
            );
            const bytes = buffer.subarray(0, bytesRead);
            return {
              bytes,
              replaceFrom,
              ...(resume ? { previousRevision: resume.revision } : {}),
            };
          },
          signal,
        );
      })) as ReadResultByMethod[M];
    }
    case "files.lineRange": {
      const value = params as ReadParamsByMethod["files.lineRange"];
      return (await withFile(root, value.path, signal, async (file) => {
        const index = await textIndex(file, signal);
        const continuation = value.continuation?.line === value.startLine;
        const startOffset = continuation
          ? value.continuation!.byteOffset
          : await lineStart(file, index, value.startLine, signal);
        const result = await readLines(file.handle, file.size, {
          startLine: value.startLine,
          startOffset,
          lineCount: value.lineCount,
          byteLimit: value.byteLimit,
          totalLines: index.lines,
          continuation,
        });
        return {
          lines: result.lines.map(({ marker: _marker, ...line }) => line),
          ...(result.next ? { next: result.next } : {}),
          totalLines: index.lines,
          sizeBytes: file.size,
          revision: file.revision,
        };
      })) as ReadResultByMethod[M];
    }
    case "files.search": {
      const value = params as ReadParamsByMethod["files.search"];
      return (await withFile(root, value.path, signal, async (file) => {
        const index = await textIndex(file, signal);
        const result = await searchLines(
          async (startLine, endLine, visit) =>
            scanMatches(
              file.handle,
              file.size,
              {
                startLine,
                startOffset: await lineStart(file, index, startLine, signal),
                endLine,
              },
              value,
              visit,
              signal,
            ),
          index.lines,
          value,
        );
        return { ...result, revision: file.revision };
      })) as ReadResultByMethod[M];
    }
    case "files.searchWorkspace":
      return (await searchWorkspace(
        root,
        params as ReadParamsByMethod["files.searchWorkspace"],
        signal,
      )) as ReadResultByMethod[M];
    case "files.find": {
      const value = params as ReadParamsByMethod["files.find"];
      return (await findFiles(
        root,
        value.query,
        value.start,
        value.count,
        signal,
      )) as ReadResultByMethod[M];
    }
    default:
      throw new ReadingFailure("invalid_request", "Not a Files request");
  }
}
