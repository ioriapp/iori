import { isWithin } from "./path-boundary.ts";
import { fileUploadTemporaries } from "./files-upload-temporaries.ts";
import { constants } from "node:fs";
import { lstat, open, realpath, stat } from "node:fs/promises";
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
import { readAt, utf8Boundary } from "./text-lines.ts";

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
const STATUS_SNAPSHOT_MS = 2_000;
const MAX_STATUS_SNAPSHOTS = 4;
const MAX_STATUS_SNAPSHOT_ENTRIES = 16_384;
const MAX_STATUS_SNAPSHOT_BYTES = 4 * 1024 * 1024;

type StatusSnapshot = {
  branch: GitRepositoryStatus;
  counts: ReadResultByMethod["git.status"]["counts"];
  ordered: GitChangeEntry[];
};
const statusSnapshots = new Map<
  string,
  { snapshot?: StatusSnapshot; expires?: number; timer?: NodeJS.Timeout }
>();

export function invalidateGitStatus(root: string): void {
  clearTimeout(statusSnapshots.get(root)?.timer);
  statusSnapshots.delete(root);
}

async function statusSnapshot(
  repository: Repository,
  start: number,
  signal?: Signal,
): Promise<StatusSnapshot> {
  const { root } = repository;
  const cached = statusSnapshots.get(root);
  if (start !== 0 && cached?.snapshot && cached.expires! > performance.now())
    return cached.snapshot;

  invalidateGitStatus(root);
  if (statusSnapshots.size >= MAX_STATUS_SNAPSHOTS)
    invalidateGitStatus(statusSnapshots.keys().next().value!);
  const entry: NonNullable<ReturnType<typeof statusSnapshots.get>> = {};
  statusSnapshots.set(root, entry);
  try {
    const snapshot = await readStatus(repository, signal);
    // An invalidation or a newer read might have superseded this one.
    if (statusSnapshots.get(root) === entry) {
      let bytes = 0;
      if (
        snapshot.ordered.length <= MAX_STATUS_SNAPSHOT_ENTRIES &&
        snapshot.ordered.every((change) => {
          bytes += Buffer.byteLength(JSON.stringify(change), "utf8");
          return bytes <= MAX_STATUS_SNAPSHOT_BYTES;
        })
      ) {
        entry.snapshot = snapshot;
        entry.expires = performance.now() + STATUS_SNAPSHOT_MS;
        entry.timer = setTimeout(
          () => invalidateGitStatus(root),
          STATUS_SNAPSHOT_MS,
        ).unref();
      } else invalidateGitStatus(root);
    }
    return snapshot;
  } catch (error) {
    if (statusSnapshots.get(root) === entry) invalidateGitStatus(root);
    throw error;
  }
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
  if (!isWithin(repository.root, absolute))
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

function untrackedReader(repository: Repository) {
  // Git for Windows lists files behind a junction; show the link itself instead.
  const links = new Map<string, boolean>();
  const seen = new Set<string>();
  return async (path: Buffer): Promise<GitChangeEntry | undefined> => {
    const entry = entryFor(repository, "untracked", "untracked", path);
    if (fileUploadTemporaries.has(entry.absolutePath)) return undefined;
    if (process.platform !== "win32") return entry;
    const parts = entry.path.split("/");
    for (let depth = 1; depth < parts.length; depth++) {
      const prefix = parts.slice(0, depth).join("/");
      let isLink = links.get(prefix);
      if (isLink === undefined) {
        isLink = await lstat(absoluteFor(repository, prefix))
          .then((info) => info.isSymbolicLink())
          .catch(() => false);
        links.set(prefix, isLink);
      }
      if (isLink) {
        if (seen.has(prefix)) return undefined;
        seen.add(prefix);
        return {
          ...entry,
          path: prefix,
          absolutePath: absoluteFor(repository, prefix),
        };
      }
    }
    return entry;
  };
}

export function parseNumstatField(value: string): {
  added: string;
  removed: string;
  path: string;
} {
  const [added = "", removed = "", ...path] = value.split("\t");
  return { added, removed, path: path.join("\t") };
}

async function fillNumstat(
  repository: Repository,
  byPath: Map<string, GitChangeEntry>,
  args: string[],
  signal?: Signal,
): Promise<void> {
  const git = startGit(
    repository.root,
    ["diff", "--no-ext-diff", "--no-textconv", "--numstat", "-z", ...args],
    signal,
  );
  const reader = new NulReader(git.child.stdout);
  try {
    for (;;) {
      const field = await reader.next();
      if (field === undefined) break;
      const {
        added,
        removed,
        path: inline,
      } = parseNumstatField(field.toString("utf8"));
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
    await fillNumstat(
      repository,
      byPath,
      [...(cached ? ["--cached", "-M"] : []), "--", ...paths.slice(start, end)],
      signal,
    );
    start = end;
  }
}

async function readStatus(
  repository: Repository,
  signal?: Signal,
): Promise<StatusSnapshot> {
  const git = startGit(
    repository.root,
    ["status", "--porcelain=v2", "-z", "--branch", "--untracked-files=all"],
    signal,
  );
  const reader = new NulReader(git.child.stdout);
  const readUntracked = untrackedReader(repository);
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
        const entry = await readUntracked(record.subarray(2));
        if (entry) byArea.untracked.push(entry);
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
  const ordered = areas.flatMap((area) =>
    byArea[area].sort((a, b) => a.path.localeCompare(b.path)),
  );
  return {
    branch,
    counts: {
      staged: byArea.staged.length,
      unstaged: byArea.unstaged.length,
      untracked: byArea.untracked.length,
      conflict: byArea.conflict.length,
    },
    ordered,
  };
}

async function gitStatus(
  repository: Repository,
  start: number,
  count: number,
  signal?: Signal,
): Promise<ReadResultByMethod["git.status"]> {
  const { branch, counts, ordered } = await statusSnapshot(
    repository,
    start,
    signal,
  );
  throwIfAborted(signal);
  const entries: GitChangeEntry[] = [];
  let bytes = 0;
  for (const entry of ordered.slice(start, start + count)) {
    bytes += Buffer.byteLength(JSON.stringify(entry), "utf8") + 64;
    if (entries.length > 0 && bytes > MAX_PAGE_RESPONSE_BYTES) break;
    entries.push({ ...entry });
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
    counts,
    entries,
  };
}

async function recordedBase(
  repository: Repository,
): Promise<string | undefined> {
  const marker = join(repository.gitDir, "iori-base-commit");
  const length = repository.hashFormat === "sha256" ? 64 : 40;
  try {
    if (!(await lstat(marker)).isFile()) return undefined;
    const file = await open(marker, constants.O_RDONLY | constants.O_NONBLOCK);
    try {
      const bytes = await readAt(file, 0, length + 3);
      const hex = bytes.toString("utf8").trim();
      if (
        bytes.length <= length + 2 &&
        hex.length === length &&
        /^[0-9a-f]+$/u.test(hex)
      )
        return hex;
    } finally {
      await file.close();
    }
  } catch {
    // A repository need not have an iori worktree origin.
  }
  return undefined;
}

async function gitBranches(
  repository: Repository,
  signal?: Signal,
): Promise<ReadResultByMethod["git.branches"]> {
  const [refs, head, recorded] = await Promise.all([
    collectGit(
      repository.root,
      [
        "for-each-ref",
        "--sort=refname",
        "--format=%(refname:short)%09%(objectname)%09%(symref)",
        "refs/heads",
        "refs/remotes",
      ],
      signal,
    ),
    collectGit(
      repository.root,
      ["symbolic-ref", "--quiet", "--short", "HEAD"],
      signal,
      [0, 1],
    ),
    recordedBase(repository),
  ]);
  const current = head.stdout.toString("utf8").trim() || undefined;
  const tips = new Map<string, string>();
  let originHead: string | undefined;
  for (const line of refs.stdout.toString("utf8").split("\n")) {
    const [name, sha, symref] = line.split("\t");
    if (!name || !sha) continue;
    if (!symref) tips.set(name, sha);
    else if (name === "origin/HEAD")
      originHead = symref.replace(/^refs\/remotes\//u, "");
  }
  const branches = [...tips.keys()];
  const matching = new Set(
    branches.filter((name) => name !== current && tips.get(name) === recorded),
  );
  const preferred = [
    originHead,
    "main",
    "origin/main",
    "master",
    "origin/master",
  ];
  let defaultBase: string | undefined =
    preferred.find((name) => name && matching.has(name)) ??
    matching.values().next().value;
  defaultBase ??= [
    originHead,
    "origin/main",
    "main",
    "origin/master",
    "master",
    ...branches,
  ].find((name) => name && name !== current && tips.has(name));
  if (!defaultBase && recorded) {
    const commit = await collectGit(
      repository.root,
      ["rev-parse", "--verify", "--quiet", recorded + "^{commit}"],
      signal,
      [0, 1],
    );
    if (commit.code === 0) {
      defaultBase = recorded;
      branches.push(recorded);
    }
  }
  return { current, defaultBase, branches };
}

export async function branchMergeBase(
  repository: Repository,
  base: string,
  signal?: Signal,
): Promise<string> {
  const result = await collectGit(
    repository.root,
    ["merge-base", "--end-of-options", base, "HEAD"],
    signal,
  );
  return result.stdout.toString("utf8").trim();
}

async function gitBranchChanges(
  repository: Repository,
  params: ReadParamsByMethod["git.branchChanges"],
  signal?: Signal,
): Promise<ReadResultByMethod["git.branchChanges"]> {
  const mergeBase = await branchMergeBase(repository, params.base, signal);
  const seen = new Set<string>();
  const entries: GitChangeEntry[] = [];
  let bytes = 0;
  const visit = (entry: GitChangeEntry) => {
    if (seen.has(entry.path)) return;
    seen.add(entry.path);
    if (seen.size <= params.start || entries.length >= params.count) return;
    bytes += Buffer.byteLength(JSON.stringify(entry)) + 64;
    if (!entries.length || bytes <= MAX_PAGE_RESPONSE_BYTES)
      entries.push(entry);
  };
  await readNameStatus(
    repository,
    [
      "diff",
      "-M",
      "--name-status",
      "-z",
      "--no-ext-diff",
      "--no-textconv",
      "--end-of-options",
      mergeBase,
      "--",
    ],
    visit,
    signal,
  );
  const tracked = new Map(
    entries.filter((entry) => !entry.error).map((entry) => [entry.path, entry]),
  );
  if (tracked.size)
    await fillNumstat(
      repository,
      tracked,
      ["-M", "--end-of-options", mergeBase, "--"],
      signal,
    );
  const git = startGit(
    repository.root,
    ["ls-files", "--others", "--exclude-standard", "-z"],
    signal,
  );
  const reader = new NulReader(git.child.stdout);
  const readUntracked = untrackedReader(repository);
  try {
    for (;;) {
      const path = await reader.next();
      if (!path) break;
      const entry = await readUntracked(path);
      if (entry) visit(entry);
    }
    await finishGit(git, signal);
  } catch (error) {
    await stopGit(git);
    throw gitFailure(error);
  }
  return { base: params.base, mergeBase, total: seen.size, entries };
}

export async function hasHead(root: string, signal?: Signal): Promise<boolean> {
  const { code } = await collectGit(
    root,
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
      !(await hasHead(repository.root, signal))
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

async function readNameStatus(
  repository: Repository,
  args: string[],
  visit: (entry: GitChangeEntry) => void,
  signal?: Signal,
) {
  const git = startGit(repository.root, args, signal);
  const reader = new NulReader(git.child.stdout);
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
      visit(
        entryFor(
          repository,
          "unstaged",
          kind,
          second ?? first,
          second ? { oldPath: decodeField(first).text } : {},
        ),
      );
    }
    await finishGit(git, signal);
  } catch (error) {
    await stopGit(git);
    throw gitFailure(error);
  }
}

async function gitCommitFiles(
  repository: Repository,
  params: ReadParamsByMethod["git.commitFiles"],
  signal?: Signal,
): Promise<ReadResultByMethod["git.commitFiles"]> {
  const files: GitCommitFile[] = [];
  let total = 0;
  await readNameStatus(
    repository,
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
    ({ path, absolutePath, oldPath, kind }) => {
      if (total++ >= params.start && files.length < params.count)
        files.push({
          path,
          absolutePath,
          ...(oldPath ? { oldPath } : {}),
          kind,
        });
    },
    signal,
  );
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
    case "git.branches":
      return (await gitBranches(repository, signal)) as ReadResultByMethod[M];
    case "git.branchChanges":
      return (await gitBranchChanges(
        repository,
        params as ReadParamsByMethod["git.branchChanges"],
        signal,
      )) as ReadResultByMethod[M];
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
    case "git.diffSyntax":
    case "git.diffRows":
    case "git.diffRead":
    case "git.imageInfo":
    case "git.imageRead":
    case "git.diffSearch":
      return handleDiffRead(repository, method, params, signal);
    default:
      throw new ReadingFailure("invalid_request", "Not a Git request");
  }
}
