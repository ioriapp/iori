import { parseGitWorktrees } from "./worktree-list.ts";
import { homedir } from "node:os";
import { batchChanges } from "./change-batch.ts";
import { worktreeStateReader } from "./worktree-state.ts";
import { spawn } from "node:child_process";
import { watch, type FSWatcher } from "node:fs";
import { realpath, readdir, readFile, stat } from "node:fs/promises";
import {
  basename,
  dirname,
  isAbsolute,
  join,
  normalize,
  resolve,
  relative,
  sep,
} from "node:path";
import type {
  Event,
  FolderEntry,
  FolderHistoryItem,
  ProtocolErrorCode,
  ResultByMethod,
  Worktree,
} from "@iori/protocol";
import { HostStore, type Mutation, type StoreContext } from "./store.ts";
import { folderRoots } from "./folders-native.ts";

interface GitWorktree extends Worktree {
  gitDirectory: string;
}

interface GitWorkspace {
  workspacePath: string;
  commonDirectory: string;
  worktrees: GitWorktree[];
}

interface GitCommandResult {
  exitCode: number;
  stdout: string;
}

export class WorkspaceError extends Error {
  readonly code: ProtocolErrorCode;

  constructor(code: ProtocolErrorCode) {
    super(code);
    this.name = "WorkspaceError";
    this.code = code;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function filesystemErrorCode(error: unknown): ProtocolErrorCode {
  if (!isRecord(error) || typeof error.code !== "string") {
    return "internal_error";
  }
  switch (error.code) {
    case "ENOENT":
      return "path_not_found";
    case "ENOTDIR":
      return "not_a_directory";
    case "EACCES":
    case "EPERM":
      return "permission_denied";
    default:
      return "internal_error";
  }
}

function requireHostPath(path: string): string {
  if (!path.includes("\0") && isAbsolute(path)) return path;
  throw new WorkspaceError("invalid_request");
}

function outputLine(value: string): string {
  return value.endsWith("\r\n")
    ? value.slice(0, -2)
    : value.endsWith("\n")
      ? value.slice(0, -1)
      : value;
}

function runGit(args: string[]): Promise<GitCommandResult> {
  return new Promise((resolveResult, reject) => {
    const process = spawn("git", args, {
      stdio: ["ignore", "pipe", "ignore"],
      windowsHide: true,
    });
    let stdout = "";
    process.stdout.setEncoding("utf8");
    process.stdout.on("data", (chunk: string) => {
      stdout += chunk;
    });
    process.once("error", reject);
    process.once("close", (code) => {
      resolveResult({ exitCode: code ?? 1, stdout });
    });
  });
}

function publicWorktrees(
  worktrees: GitWorktree[],
  removing: ReadonlyMap<string, number>,
): Worktree[] {
  return worktrees.map(({ gitDirectory: _gitDirectory, ...item }) => ({
    ...item,
    ...(removing.has(item.path) ? { removing: true } : {}),
  }));
}

async function worktreeGitDirectory(path: string): Promise<string | undefined> {
  const dotGitPath = join(path, ".git");
  try {
    const info = await stat(dotGitPath);
    if (info.isDirectory()) return await realpath(dotGitPath);
    if (!info.isFile()) return undefined;
    const content = await readFile(dotGitPath, "utf8");
    const match = /^gitdir: (.+)$/mu.exec(content);
    if (!match?.[1]) return undefined;
    return await realpath(resolve(path, match[1]));
  } catch {
    return undefined;
  }
}

async function pathIsDirectory(path: string): Promise<boolean> {
  try {
    return (await stat(path)).isDirectory();
  } catch (error) {
    if (filesystemErrorCode(error) === "path_not_found") return false;
    if (filesystemErrorCode(error) === "not_a_directory") return false;
    return true;
  }
}

async function listGitWorktrees(
  commonDirectory: string,
): Promise<GitWorktree[]> {
  const result = await runGit([
    "--git-dir",
    commonDirectory,
    "worktree",
    "list",
    "--porcelain",
    "-z",
  ]);
  if (result.exitCode !== 0) throw new WorkspaceError("internal_error");
  const records = parseGitWorktrees(result.stdout).filter(
    (worktree) => !worktree.bare,
  );
  const existing: typeof records = [];
  for (const worktree of records) {
    const path = await realpath(normalize(worktree.path)).catch(
      () => undefined,
    );
    if (path && (await pathIsDirectory(path))) {
      existing.push({ ...worktree, path });
    }
  }
  const primaryPath = existing[0]?.path;
  const resultWorktrees: GitWorktree[] = [];
  const state = primaryPath
    ? await worktreeStateReader(primaryPath, existing)
    : undefined;
  for (const worktree of existing) {
    const gitDirectory = await worktreeGitDirectory(worktree.path);
    resultWorktrees.push({
      path: worktree.path,
      ...(worktree.branch === undefined ? {} : { branch: worktree.branch }),
      detached: worktree.detached,
      primary: worktree.path === primaryPath,
      gitDirectory: gitDirectory ?? commonDirectory,
      merged:
        worktree.path === primaryPath
          ? false
          : ((await state?.(worktree.path, worktree.branch, gitDirectory))
              ?.merged ?? false),
    });
  }
  return resultWorktrees;
}

async function inspectGitWorkspace(
  path: string,
): Promise<GitWorkspace | undefined> {
  let topLevel: GitCommandResult;
  let common: GitCommandResult;
  try {
    [topLevel, common] = await Promise.all([
      runGit(["-C", path, "rev-parse", "--show-toplevel"]),
      runGit([
        "-C",
        path,
        "rev-parse",
        "--path-format=absolute",
        "--git-common-dir",
      ]),
    ]);
  } catch {
    return undefined;
  }
  if (topLevel.exitCode !== 0 || common.exitCode !== 0) return undefined;
  const commonDirectoryOutput = outputLine(common.stdout);
  if (!isAbsolute(commonDirectoryOutput)) return undefined;
  const commonDirectory = await realpath(commonDirectoryOutput).catch(() => {
    throw new WorkspaceError("internal_error");
  });
  const worktrees = await listGitWorktrees(commonDirectory);
  const primary = worktrees.find((worktree) => worktree.primary);
  return {
    workspacePath:
      primary?.path ?? (await realpath(normalize(outputLine(topLevel.stdout)))),
    commonDirectory,
    worktrees,
  };
}

async function browseRoots(): Promise<ResultByMethod["folders.browse"]> {
  return { homePath: homedir(), entries: await folderRoots() };
}

export async function browseFolders(
  requestedPath?: string,
): Promise<ResultByMethod["folders.browse"]> {
  if (requestedPath === undefined) return browseRoots();
  try {
    const path = requireHostPath(requestedPath);
    const canonicalPath = await realpath(path);
    const directory = await stat(canonicalPath);
    if (!directory.isDirectory()) throw new WorkspaceError("not_a_directory");
    const children = await readdir(canonicalPath, { withFileTypes: true });
    const entries: FolderEntry[] = [];
    for (const child of children) {
      const childPath = join(canonicalPath, child.name);
      if (child.isDirectory()) {
        entries.push({ name: child.name, path: childPath });
      } else if (child.isSymbolicLink() && (await pathIsDirectory(childPath))) {
        entries.push({ name: child.name, path: childPath });
      }
    }
    entries.sort((left, right) => left.name.localeCompare(right.name));
    const parentPath = dirname(canonicalPath);
    return {
      homePath: homedir(),
      path: canonicalPath,
      ...(parentPath === canonicalPath ? {} : { parentPath }),
      entries,
    };
  } catch (error) {
    if (error instanceof WorkspaceError) throw error;
    throw new WorkspaceError(filesystemErrorCode(error));
  }
}

async function inspectOpenedFolder(
  requestedPath: string,
): Promise<{ folder: FolderHistoryItem; workspace?: GitWorkspace }> {
  try {
    const path = requireHostPath(requestedPath);
    const canonicalPath = await realpath(path);
    const info = await stat(canonicalPath);
    if (!info.isDirectory()) throw new WorkspaceError("not_a_directory");
    const gitWorkspace = await inspectGitWorkspace(canonicalPath);
    return {
      folder: {
        path: canonicalPath,
        workspacePath: gitWorkspace?.workspacePath ?? canonicalPath,
        kind: gitWorkspace ? "git" : "folder",
        openedAt: Date.now(),
        inSidebar: true,
        ...(gitWorkspace
          ? { worktrees: publicWorktrees(gitWorkspace.worktrees, new Map()) }
          : {}),
      },
      ...(gitWorkspace ? { workspace: gitWorkspace } : {}),
    };
  } catch (error) {
    if (error instanceof WorkspaceError) throw error;
    throw new WorkspaceError(filesystemErrorCode(error));
  }
}

async function worktreeWatchDirectories(
  commonDirectory: string,
  worktrees: GitWorktree[],
): Promise<string[]> {
  const directories = new Set([commonDirectory]);
  for (const refDir of ["refs", "logs/refs"]) {
    const walk = async (path: string): Promise<void> => {
      for (const entry of await readdir(path, { withFileTypes: true }).catch(
        () => [],
      ))
        if (entry.isDirectory()) await walk(join(path, entry.name));
      if (await pathIsDirectory(path)) directories.add(path);
    };
    await walk(join(commonDirectory, refDir));
  }
  const metadataDirectory = join(commonDirectory, "worktrees");
  if (await pathIsDirectory(metadataDirectory))
    directories.add(metadataDirectory);
  const reftableDirectory = join(commonDirectory, "reftable");
  if (await pathIsDirectory(reftableDirectory))
    directories.add(reftableDirectory);
  for (const worktree of worktrees) {
    directories.add(dirname(worktree.path));
    directories.add(worktree.gitDirectory);
    const worktreeReftable = join(worktree.gitDirectory, "reftable");
    if (await pathIsDirectory(worktreeReftable))
      directories.add(worktreeReftable);
  }
  return [...directories];
}

class WorktreeWatcher {
  readonly workspacePath: string;
  readonly #commonDirectory: string;
  readonly #onChange: (event: Event) => void;
  readonly #onGitChange: (paths: string[]) => void;
  readonly #removing: ReadonlyMap<string, number>;
  readonly #watchers = new Map<string, FSWatcher>();
  #worktrees: Worktree[];
  #gitWorktrees: GitWorktree[];
  readonly #batch = batchChanges(() => this.#refresh());
  #closed = false;

  constructor(
    workspacePath: string,
    commonDirectory: string,
    worktrees: GitWorktree[],
    onChange: (event: Event) => void,
    onGitChange: (paths: string[]) => void,
    removing: ReadonlyMap<string, number>,
  ) {
    this.workspacePath = workspacePath;
    this.#commonDirectory = commonDirectory;
    this.#removing = removing;
    this.#worktrees = publicWorktrees(worktrees, removing);
    this.#gitWorktrees = worktrees;
    this.#onChange = onChange;
    this.#onGitChange = onGitChange;
  }

  async start(): Promise<void> {
    await this.#syncWatchers();
    this.#queueRefresh();
  }

  close(): void {
    this.#closed = true;
    this.#batch.close();
    for (const watcher of this.#watchers.values()) watcher.close();
    this.#watchers.clear();
  }

  publishRemovedWorktrees(paths: string[]): void {
    this.#gitWorktrees = this.#gitWorktrees.filter(
      (worktree) => !paths.some((path) => relative(path, worktree.path) === ""),
    );
    this.publishWorktrees();
  }

  publishWorktrees(): void {
    const worktrees = publicWorktrees(this.#gitWorktrees, this.#removing);
    if (JSON.stringify(worktrees) === JSON.stringify(this.#worktrees)) return;
    this.#worktrees = worktrees;
    this.#onChange({
      type: "worktrees.changed",
      repositoryPath: this.workspacePath,
      worktrees,
    });
  }

  async #syncWatchers(): Promise<void> {
    if (this.#closed) return;
    const directories = await worktreeWatchDirectories(
      this.#commonDirectory,
      this.#gitWorktrees,
    );
    if (this.#closed) return;
    const required = new Set(directories);
    for (const [path, watcher] of this.#watchers) {
      if (!required.has(path)) {
        watcher.close();
        this.#watchers.delete(path);
      }
    }
    for (const path of directories) {
      if (this.#watchers.has(path)) continue;
      try {
        const watcher = watch(path, { persistent: false }, (_event, name) => {
          if (name !== null && !this.#affectsWorktrees(path, name.toString()))
            return;
          this.#queueRefresh();
        });
        watcher.on("error", () => {
          watcher.close();
          this.#watchers.delete(path);
        });
        this.#watchers.set(path, watcher);
      } catch {
        // Other watched directories still cover repository and worktree changes.
      }
    }
  }

  #affectsWorktrees(directory: string, name: string): boolean {
    const metadata = new Set([
      this.#commonDirectory,
      ...this.#gitWorktrees.map((worktree) => worktree.gitDirectory),
    ]);
    if (metadata.has(directory))
      return /^(?:HEAD|[A-Z_]+_HEAD|packed-refs|config(?:\.worktree)?|refs|reftable|worktrees|gitdir|commondir|iori-base-commit|iori-accepted-commit)$/u.test(
        name,
      );
    if ([...metadata].some((path) => directory === join(path, "reftable")))
      return true;
    const rel = relative(this.#commonDirectory, directory);
    if (
      rel === "worktrees" ||
      rel.startsWith(`refs${sep}`) ||
      rel === "refs" ||
      rel.startsWith(`logs${sep}`)
    )
      return true;
    // Parent directories are watched only to notice worktree creation/removal.
    return this.#gitWorktrees.some(
      (worktree) =>
        dirname(worktree.path) === directory &&
        basename(worktree.path) === name,
    );
  }

  #queueRefresh(): void {
    this.#batch.changed();
  }

  async #refresh(): Promise<void> {
    if (this.#closed) return;
    const next = await listGitWorktrees(this.#commonDirectory);
    if (this.#closed) return;
    this.#gitWorktrees = next;
    this.#onGitChange(next.map((item) => item.path));
    await this.#syncWatchers();
    if (this.#closed) return;
    const visibleWorktrees = publicWorktrees(next, this.#removing);
    if (JSON.stringify(visibleWorktrees) !== JSON.stringify(this.#worktrees)) {
      this.#worktrees = visibleWorktrees;
      this.#onChange({
        type: "worktrees.changed",
        repositoryPath: this.workspacePath,
        worktrees: visibleWorktrees,
      });
    }
  }
}

export class WorkspaceService {
  readonly #store: HostStore;
  readonly #onEvent: (event: Event) => void;
  readonly #onGitChange: (paths: string[]) => void;
  readonly #watchers = new Map<string, WorktreeWatcher>();
  readonly #suspended = new Set<WorktreeWatcher>();
  readonly #removing = new Map<string, number>();

  constructor(
    store: HostStore,
    onEvent: (event: Event) => void,
    onGitChange: (paths: string[]) => void = () => {},
  ) {
    this.#store = store;
    this.#onEvent = onEvent;
    this.#onGitChange = onGitChange;
  }

  setRemoving(paths: string[], removing: boolean): void {
    for (const path of paths) {
      const count = this.#removing.get(path) ?? 0;
      if (removing) this.#removing.set(path, count + 1);
      else if (count > 1) this.#removing.set(path, count - 1);
      else this.#removing.delete(path);
    }
    for (const watcher of new Set([
      ...this.#watchers.values(),
      ...this.#suspended,
    ]))
      watcher.publishWorktrees();
  }

  stopRepositoryWatches(
    path: string,
  ): (removed: string[], done?: boolean) => void {
    const stopped: WorktreeWatcher[] = [];
    for (const [key, watcher] of this.#watchers) {
      if (relative(watcher.workspacePath, path) !== "") continue;
      watcher.close();
      this.#watchers.delete(key);
      stopped.push(watcher);
      this.#suspended.add(watcher);
    }
    // Publish completed deletions from the snapshot, without asking Git to
    // rebuild the whole list while a parent and its children are being removed.
    return (removed, done) => {
      for (const watcher of new Set([
        ...stopped,
        ...[...this.#watchers.values()].filter(
          (watcher) => relative(watcher.workspacePath, path) === "",
        ),
      ]))
        watcher.publishRemovedWorktrees(removed);
      if (done) for (const watcher of stopped) this.#suspended.delete(watcher);
    };
  }

  async history(): Promise<ResultByMethod["folders.history"]> {
    const folders = this.#store.folderHistory();
    const resolved = await Promise.all(
      folders.map(async (folder): Promise<FolderHistoryItem> => {
        if (folder.kind !== "git" || !folder.inSidebar) return folder;
        try {
          const workspace =
            (await inspectGitWorkspace(folder.path)) ??
            (await inspectGitWorkspace(folder.workspacePath));
          if (!workspace) return folder;
          const enriched: FolderHistoryItem = {
            ...folder,
            workspacePath: workspace.workspacePath,
            inSidebar:
              folder.inSidebar &&
              this.#store.isSidebarTarget(workspace.workspacePath),
            worktrees: publicWorktrees(workspace.worktrees, this.#removing),
          };
          if (enriched.inSidebar) this.#watch(workspace);
          return enriched;
        } catch {
          return folder;
        }
      }),
    );
    return { folders: resolved };
  }

  async open(
    context: StoreContext,
    requestedPath: string,
  ): Promise<Mutation<ResultByMethod["folders.open"]>> {
    const previous =
      this.#store.replayOperation<ResultByMethod["folders.open"]>(context);
    if (previous) return { response: previous };
    try {
      const inspected = await inspectOpenedFolder(requestedPath);
      const result = this.#store.openFolder(context, inspected.folder);
      if (inspected.workspace) this.#watch(inspected.workspace);
      if (result.response.ok && inspected.workspace)
        result.response.result.folder.worktrees = publicWorktrees(
          inspected.workspace.worktrees,
          this.#removing,
        );
      return result;
    } catch (error) {
      if (error instanceof WorkspaceError) {
        return { response: { ok: false, error: { code: error.code } } };
      }
      return {
        response: { ok: false, error: { code: filesystemErrorCode(error) } },
      };
    }
  }

  reorderSidebar(context: StoreContext, paths: string[]) {
    return this.#store.reorderSidebar(context, paths);
  }

  removeSidebarTarget(
    context: StoreContext,
    path: string,
  ): Mutation<ResultByMethod["folders.sidebar.remove"]> {
    const result = this.#store.removeSidebarTarget(context, path);
    if (result.changed) {
      for (const [commonDirectory, watcher] of this.#watchers) {
        if (
          watcher.workspacePath === path &&
          !this.#store.isSidebarTarget(watcher.workspacePath)
        ) {
          watcher.close();
          this.#watchers.delete(commonDirectory);
        }
      }
    }
    return result;
  }

  close(): void {
    for (const watcher of this.#watchers.values()) watcher.close();
    this.#watchers.clear();
  }

  #watch(workspace: GitWorkspace): void {
    const key = workspace.commonDirectory;
    if (this.#watchers.has(key)) return;
    const watcher = new WorktreeWatcher(
      workspace.workspacePath,
      workspace.commonDirectory,
      workspace.worktrees,
      this.#onEvent,
      this.#onGitChange,
      this.#removing,
    );
    this.#watchers.set(key, watcher);
    void watcher.start().catch(() => undefined);
  }
}
