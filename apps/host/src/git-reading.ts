import { fileUploadTemporaries } from "./files-upload-temporaries.ts";
import { lstat, realpath, stat } from "node:fs/promises";
import { isAbsolute, join, relative, resolve, sep } from "node:path";
import {
  MAX_PAGE_RESPONSE_BYTES,
  type GitChangeArea,
  type GitChangeEntry,
  type GitChangeKind,
  type GitCommitFile,
  type GitRepositoryStatus,
  type ReadMethod,
  type ReadParamsByMethod,
  type ReadResultByMethod,
} from "@iori/protocol";
import {
  ReadingFailure,
  throwIfAborted,
  toFailure,
} from "./reading-failure.ts";
import {
  NulReader,
  collectGit,
  decodeField,
  finishGit,
  gitFailure,
  startGit,
  stopGit,
} from "./git-process.ts";
import { handleDiffRead } from "./git-diff.ts";
import { utf8Boundary } from "./text-lines.ts";

type Signal = AbortSignal | undefined;

export type Repository = {
  root: string;
  gitDir: string;
  commonDir: string;
  hashFormat: "sha1" | "sha256";
};

// One commit message response stays far below the frame size.
const MESSAGE_CHUNK_BYTES = 256 * 1024;
const NUMSTAT_ARGUMENT_CHARS = 8000;
const areas: GitChangeArea[] = ["staged", "unstaged", "untracked", "conflict"];

function within(root: string, target: string): boolean {
  const rel = relative(root, target);
  return (
    rel === "" ||
    (!isAbsolute(rel) && rel !== ".." && !rel.startsWith(`..${sep}`))
  );
}

export async function discoverRepository(
  root: string,
  signal?: Signal,
): Promise<Repository> {
  if (!isAbsolute(root))
    throw new ReadingFailure(
      "path_outside_root",
      "Selected folder must be an absolute path",
    );
  let selected: string;
  try {
    selected = await realpath(root);
    if (!(await stat(selected)).isDirectory())
      throw new ReadingFailure(
        "not_a_directory",
        "Selected path is not a folder",
      );
  } catch (error) {
    throw toFailure(error);
  }
  const { stdout } = await collectGit(
    selected,
    [
      "rev-parse",
      "--path-format=absolute",
      "--show-toplevel",
      "--git-dir",
      "--git-common-dir",
      "--show-object-format",
    ],
    signal,
  );
  const [top, gitDir, commonDir, format] = stdout
    .toString("utf8")
    .split("\n")
    .map((line) => line.replace(/\r$/u, ""));
  if (
    !top ||
    !gitDir ||
    !commonDir ||
    (format !== "sha1" && format !== "sha256")
  )
    throw new ReadingFailure(
      "git_failed",
      "Git did not describe the repository",
    );
  try {
    return {
      root: await realpath(top),
      gitDir: resolve(gitDir),
      commonDir: resolve(commonDir),
      hashFormat: format,
    };
  } catch (error) {
    throw gitFailure(error);
  }
}

/** A repository-relative path from Git. Windows does not accept `\` inside a name. */
function validGitPath(value: string): boolean {
  return !(
    !value ||
    value.includes("\0") ||
    value.startsWith("/") ||
    /^[a-zA-Z]:/u.test(value) ||
    (process.platform === "win32" && value.includes("\\")) ||
    value
      .split("/")
      .some((part) => part === "" || part === "." || part === "..")
  );
}

function absoluteFor(repository: Repository, path: string): string {
  return validGitPath(path)
    ? join(repository.root, ...path.split("/"))
    : repository.root;
}

function historyPath(repository: Repository, value: string): string {
  if (!isAbsolute(value)) {
    if (!validGitPath(value))
      throw new ReadingFailure(
        "path_outside_root",
        "History path must stay inside the repository",
      );
    return value;
  }
  const absolute = resolve(value);
  if (!within(repository.root, absolute))
    throw new ReadingFailure(
      "path_outside_root",
      "History path is outside the Git repository",
    );
  return relative(repository.root, absolute).split(sep).join("/");
}

function changeKind(code: string): GitChangeKind {
  switch (code) {
    case "A":
      return "added";
    case "D":
      return "deleted";
    case "R":
      return "renamed";
    case "C":
      return "copied";
    case "T":
      return "typechange";
    case "U":
      return "conflict";
    default:
      return "modified";
  }
}

/** Splits `count` space-separated header fields; the rest of the record is the path. */
function splitRecord(record: Buffer, count: number) {
  const fields: string[] = [];
  let start = 0;
  for (let index = 0; index < count; index += 1) {
    const space = record.indexOf(32, start);
    if (space < 0) return undefined;
    fields.push(record.subarray(start, space).toString("latin1"));
    start = space + 1;
  }
  return { fields, path: record.subarray(start) };
}

function entryFor(
  repository: Repository,
  area: GitChangeArea,
  kind: GitChangeKind,
  pathBytes: Buffer,
  extra: Partial<GitChangeEntry> = {},
): GitChangeEntry {
  const { text, valid } = decodeField(pathBytes);
  const path = text.replace(/\/$/u, "");
  const readable = valid && validGitPath(path);
  return {
    area,
    kind,
    path,
    absolutePath: absoluteFor(repository, path),
    ...extra,
    ...(readable ? {} : { error: "read_failed" as const }),
  };
}

async function collapseLinkedUntracked(
  repository: Repository,
  entries: GitChangeEntry[],
): Promise<GitChangeEntry[]> {
  if (process.platform !== "win32") return entries;
  // Git for Windows lists files behind a junction; show the link itself instead.
  const links = new Map<string, boolean>();
  const seen = new Set<string>();
  const result: GitChangeEntry[] = [];
  for (const entry of entries) {
    const parts = entry.path.split("/");
    let link: string | undefined;
    for (let depth = 1; depth < parts.length && !link; depth += 1) {
      const prefix = parts.slice(0, depth).join("/");
      let isLink = links.get(prefix);
      if (isLink === undefined) {
        isLink = await lstat(join(repository.root, ...parts.slice(0, depth)))
          .then((info) => info.isSymbolicLink())
          .catch(() => false);
        links.set(prefix, isLink);
      }
      if (isLink) link = prefix;
    }
    if (!link) {
      result.push(entry);
      continue;
    }
    if (seen.has(link)) continue;
    seen.add(link);
    result.push({
      ...entry,
      path: link,
      absolutePath: absoluteFor(repository, link),
    });
  }
  return result;
}

async function readNumstat(
  repository: Repository,
  cached: boolean,
  entries: GitChangeEntry[],
  signal?: Signal,
): Promise<void> {
  const byPath = new Map(entries.map((entry) => [entry.path, entry]));
  const paths = entries.flatMap((entry) =>
    entry.oldPath ? [entry.oldPath, entry.path] : [entry.path],
  );
  for (let start = 0; start < paths.length;) {
    let end = start;
    let length = 0;
    while (
      end < paths.length &&
      (end === start || length < NUMSTAT_ARGUMENT_CHARS)
    )
      length += paths[end++]!.length + 1;
    const git = startGit(
      repository.root,
      [
        "diff",
        ...(cached ? ["--cached", "-M"] : []),
        "--no-ext-diff",
        "--no-textconv",
        "--numstat",
        "-z",
        "--",
        ...paths.slice(start, end),
      ],
      signal,
    );
    const reader = new NulReader(git.child.stdout);
    try {
      for (;;) {
        const field = await reader.next();
        if (field === undefined) break;
        const [added, removed, inline] = field.toString("utf8").split("\t");
        let path: string | undefined = inline;
        if (!path) {
          // A rename is "added\tremoved\t" followed by the old and new paths.
          await reader.next();
          path = (await reader.next())?.toString("utf8");
        }
        const entry = path === undefined ? undefined : byPath.get(path);
        if (!entry) continue;
        if (added === "-" && removed === "-") entry.binary = true;
        else {
          entry.addedLines = Number(added);
          entry.removedLines = Number(removed);
        }
      }
      await finishGit(git, signal);
    } catch {
      await stopGit(git);
      throwIfAborted(signal);
      // Line counts are shown only when Git could provide them.
      return;
    }
    start = end;
  }
}

async function gitStatus(
  repository: Repository,
  start: number,
  count: number,
  signal?: Signal,
): Promise<ReadResultByMethod["git.status"]> {
  const git = startGit(
    repository.root,
    ["status", "--porcelain=v2", "-z", "--branch", "--untracked-files=all"],
    signal,
  );
  const reader = new NulReader(git.child.stdout);
  const branch: GitRepositoryStatus = { root: repository.root };
  const byArea: Record<GitChangeArea, GitChangeEntry[]> = {
    staged: [],
    unstaged: [],
    untracked: [],
    conflict: [],
  };
  try {
    for (;;) {
      const record = await reader.next();
      if (record === undefined) break;
      const type = record[0];
      if (type === 0x23) {
        const line = record.toString("utf8");
        const [, key, ...rest] = line.split(" ");
        const value = rest.join(" ");
        if (key === "branch.oid" && value !== "(initial)") branch.head = value;
        else if (key === "branch.head" && value !== "(detached)")
          branch.branch = value;
        else if (key === "branch.upstream") branch.upstream = value;
        else if (key === "branch.ab") {
          const match = /^\+(\d+) -(\d+)$/u.exec(value);
          if (match) {
            branch.ahead = Number(match[1]);
            branch.behind = Number(match[2]);
          }
        }
      } else if (type === 0x3f) {
        byArea.untracked.push(
          entryFor(repository, "untracked", "untracked", record.subarray(2)),
        );
      } else if (type === 0x75) {
        const split = splitRecord(record, 10);
        if (!split) continue;
        const stages = split.fields
          .slice(7, 10)
          .flatMap((hash, index) =>
            /^0+$/u.test(hash) ? [] : [(index + 1) as 1 | 2 | 3],
          );
        byArea.conflict.push(
          entryFor(repository, "conflict", "conflict", split.path, { stages }),
        );
      } else if (type === 0x31 || type === 0x32) {
        const split = splitRecord(record, type === 0x32 ? 9 : 8);
        if (!split) continue;
        const xy = split.fields[1]!;
        let oldPath: string | undefined;
        if (type === 0x32) {
          const original = await reader.next();
          if (original) oldPath = decodeField(original).text;
        }
        const renamed = oldPath ? { oldPath } : {};
        if (xy[0] !== ".")
          byArea.staged.push(
            entryFor(
              repository,
              "staged",
              changeKind(xy[0]!),
              split.path,
              renamed,
            ),
          );
        if (xy[1] !== ".")
          byArea.unstaged.push(
            entryFor(repository, "unstaged", changeKind(xy[1]!), split.path),
          );
      }
    }
    await finishGit(git, signal);
  } catch (error) {
    await stopGit(git);
    throw gitFailure(error);
  }
  byArea.untracked = await collapseLinkedUntracked(
    repository,
    byArea.untracked.filter(
      (entry) => !fileUploadTemporaries.has(entry.absolutePath),
    ),
  );
  const ordered = areas.flatMap((area) =>
    byArea[area].sort((a, b) => a.path.localeCompare(b.path)),
  );
  const entries: GitChangeEntry[] = [];
  let bytes = 0;
  for (const entry of ordered.slice(start, start + count)) {
    bytes += Buffer.byteLength(JSON.stringify(entry), "utf8") + 64;
    if (entries.length > 0 && bytes > MAX_PAGE_RESPONSE_BYTES) break;
    entries.push(entry);
  }
  for (const area of ["staged", "unstaged"] as const) {
    const listed = entries.filter(
      (entry) => entry.area === area && !entry.error,
    );
    if (listed.length)
      await readNumstat(repository, area === "staged", listed, signal);
  }
  return {
    isRepository: true,
    repository: branch,
    counts: {
      staged: byArea.staged.length,
      unstaged: byArea.unstaged.length,
      untracked: byArea.untracked.length,
      conflict: byArea.conflict.length,
    },
    entries,
  };
}

async function hasHead(repository: Repository, signal?: Signal) {
  const { code } = await collectGit(
    repository.root,
    ["rev-parse", "--verify", "-q", "HEAD"],
    signal,
    [0, 1],
  );
  return code === 0;
}

async function gitHistory(
  repository: Repository,
  params: ReadParamsByMethod["git.history"],
  signal?: Signal,
): Promise<ReadResultByMethod["git.history"]> {
  const path =
    params.path === undefined
      ? undefined
      : historyPath(repository, params.path);
  const git = startGit(
    repository.root,
    [
      "log",
      "--no-show-signature",
      "-z",
      "--format=tformat:%H%x00%an <%ae>%x00%at%x00%s",
      `--skip=${params.start}`,
      `--max-count=${params.count + 1}`,
      "HEAD",
      "--",
      ...(path ? [path] : []),
    ],
    signal,
  );
  const reader = new NulReader(git.child.stdout);
  const commits: ReadResultByMethod["git.history"]["commits"] = [];
  let hasMore = false;
  try {
    for (;;) {
      const hash = await reader.next();
      if (hash === undefined) break;
      const author = (await reader.next()) ?? Buffer.alloc(0);
      const time = (await reader.next()) ?? Buffer.alloc(0);
      const subject = (await reader.next()) ?? Buffer.alloc(0);
      if (commits.length >= params.count) {
        hasMore = true;
        break;
      }
      commits.push({
        hash: hash.toString("latin1"),
        author: decodeField(author).text,
        authorTimeMs: Number(time.toString("latin1")) * 1000,
        subject: decodeField(subject).text,
      });
    }
    if (hasMore) await stopGit(git);
    else await finishGit(git, signal);
  } catch (error) {
    await stopGit(git);
    if (
      error instanceof ReadingFailure &&
      error.code === "git_failed" &&
      !(await hasHead(repository, signal))
    )
      return { commits: [], hasMore: false };
    throw gitFailure(error);
  }
  return { commits, hasMore };
}

function messageSlice(message: Buffer, offset: number) {
  let start = Math.min(offset, message.length);
  while (start < message.length && (message[start]! & 0xc0) === 0x80)
    start += 1;
  const end =
    message.length - start > MESSAGE_CHUNK_BYTES
      ? utf8Boundary(message, start + MESSAGE_CHUNK_BYTES)
      : message.length;
  return {
    text: decodeField(message.subarray(start, end)).text,
    ...(end < message.length ? { nextOffset: end } : {}),
  };
}

async function gitCommit(
  repository: Repository,
  hash: string,
  signal?: Signal,
): Promise<ReadResultByMethod["git.commit"]> {
  const { stdout } = await collectGit(
    repository.root,
    [
      "show",
      "-s",
      "--no-show-signature",
      "--encoding=UTF-8",
      "--format=format:%H%x00%P%x00%an <%ae>%x00%at%x00%B",
      "--end-of-options",
      hash,
    ],
    signal,
  );
  const fields: Buffer[] = [];
  let at = 0;
  for (let index = 0; index < 4; index += 1) {
    const end = stdout.indexOf(0, at);
    if (end < 0)
      throw new ReadingFailure(
        "git_failed",
        "Git returned incomplete commit details",
      );
    fields.push(stdout.subarray(at, end));
    at = end + 1;
  }
  const message = messageSlice(stdout.subarray(at), 0);
  return {
    hash: fields[0]!.toString("latin1"),
    parents: fields[1]!.toString("latin1").split(" ").filter(Boolean),
    author: decodeField(fields[2]!).text,
    authorTimeMs: Number(fields[3]!.toString("latin1")) * 1000,
    message: message.text,
    ...(message.nextOffset === undefined
      ? {}
      : { messageNextOffset: message.nextOffset }),
  };
}

async function gitCommitMessage(
  repository: Repository,
  hash: string,
  offset: number,
  signal?: Signal,
): Promise<ReadResultByMethod["git.commitMessage"]> {
  const { stdout } = await collectGit(
    repository.root,
    [
      "show",
      "-s",
      "--no-show-signature",
      "--encoding=UTF-8",
      "--format=format:%B",
      "--end-of-options",
      hash,
    ],
    signal,
  );
  return messageSlice(stdout, offset);
}

async function gitCommitFiles(
  repository: Repository,
  params: ReadParamsByMethod["git.commitFiles"],
  signal?: Signal,
): Promise<ReadResultByMethod["git.commitFiles"]> {
  const git = startGit(
    repository.root,
    [
      "diff-tree",
      "-r",
      "-M",
      "-C",
      "-z",
      "--name-status",
      ...(params.parent
        ? ["--end-of-options", params.parent, params.hash]
        : ["--root", "--no-commit-id", "--end-of-options", params.hash]),
    ],
    signal,
  );
  const reader = new NulReader(git.child.stdout);
  const files: GitCommitFile[] = [];
  let total = 0;
  try {
    for (;;) {
      const status = await reader.next();
      if (status === undefined) break;
      const code = status.toString("latin1");
      const kind = changeKind(code[0] ?? "M");
      const first = (await reader.next()) ?? Buffer.alloc(0);
      const second =
        kind === "renamed" || kind === "copied"
          ? await reader.next()
          : undefined;
      const index = total;
      total += 1;
      if (index < params.start || files.length >= params.count) continue;
      const path = decodeField(second ?? first).text;
      files.push({
        path,
        absolutePath: absoluteFor(repository, path),
        ...(second ? { oldPath: decodeField(first).text } : {}),
        kind,
      });
    }
    await finishGit(git, signal);
  } catch (error) {
    await stopGit(git);
    throw gitFailure(error);
  }
  return { files, total };
}

export async function handleGitRead<M extends ReadMethod>(
  method: M,
  params: ReadParamsByMethod[M],
  signal?: Signal,
): Promise<ReadResultByMethod[M]> {
  const root = (params as { root: string }).root;
  let repository: Repository;
  try {
    repository = await discoverRepository(root, signal);
  } catch (error) {
    if (
      method === "git.status" &&
      error instanceof ReadingFailure &&
      error.code === "not_git_repository"
    )
      return {
        isRepository: false,
        counts: { staged: 0, unstaged: 0, untracked: 0, conflict: 0 },
        entries: [],
      } satisfies ReadResultByMethod["git.status"] as unknown as ReadResultByMethod[M];
    throw error;
  }
  throwIfAborted(signal);
  switch (method) {
    case "git.status": {
      const value = params as ReadParamsByMethod["git.status"];
      return (await gitStatus(
        repository,
        value.start,
        value.count,
        signal,
      )) as ReadResultByMethod[M];
    }
    case "git.history":
      return (await gitHistory(
        repository,
        params as ReadParamsByMethod["git.history"],
        signal,
      )) as ReadResultByMethod[M];
    case "git.commit":
      return (await gitCommit(
        repository,
        (params as ReadParamsByMethod["git.commit"]).hash,
        signal,
      )) as ReadResultByMethod[M];
    case "git.commitMessage": {
      const value = params as ReadParamsByMethod["git.commitMessage"];
      return (await gitCommitMessage(
        repository,
        value.hash,
        value.offset,
        signal,
      )) as ReadResultByMethod[M];
    }
    case "git.commitFiles":
      return (await gitCommitFiles(
        repository,
        params as ReadParamsByMethod["git.commitFiles"],
        signal,
      )) as ReadResultByMethod[M];
    case "git.diffOpen":
    case "git.diffRows":
    case "git.diffRead":
    case "git.diffSearch":
      return handleDiffRead(repository, method, params, signal);
    default:
      throw new ReadingFailure("invalid_request", "Not a Git request");
  }
}
