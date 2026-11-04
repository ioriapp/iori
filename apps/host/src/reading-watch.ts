import { batchChanges } from "./change-batch.ts";
import { realpath } from "node:fs/promises";
import { isAbsolute, join, relative, sep } from "node:path";
import { ReadingFailure, errorCode, toFailure } from "./reading-failure.ts";
import { collectGit } from "./git-process.ts";
import { discoverRepository } from "./git-reading.ts";
import { watchDirectory } from "./directory-watch.ts";

type Failure = (error: unknown) => void;

// Above this many distinct paths a notification says "anything may have changed".
const MAX_REPORTED_PATHS = 256;
// Changes gathered while the previous notification is sent or filtered.
const MAX_GATHERED_PATHS = 4096;
// Metadata in a Git directory that changes what status, branches or history show.
const GIT_METADATA =
  /^(?:index|HEAD|packed-refs|[A-Z_]+_HEAD|refs(?:\/.*)?|rebase-(?:merge|apply)(?:\/.*)?)$/u;

function inside(base: string, target: string): string | undefined {
  const rel = relative(base, target);
  if (
    rel === "" ||
    isAbsolute(rel) ||
    rel === ".." ||
    rel.startsWith(`..${sep}`)
  )
    return undefined;
  return rel.split(sep).join("/");
}

/**
 * Coalesces changes for one subscription. While a notification is being
 * sent, further changes are gathered into the next one. `filter` returns the
 * paths worth reporting, `undefined` for "anything", or `null` for nothing.
 */
function coalesce(
  send: (paths: string[] | undefined) => Promise<void>,
  filter?: (paths: string[]) => Promise<string[] | undefined | null>,
) {
  let paths = new Set<string>();
  let everything = false;
  const batch = batchChanges(async () => {
    const current = everything ? undefined : [...paths];
    paths = new Set();
    everything = false;
    const kept = current && filter ? await filter(current) : current;
    if (kept === null || (kept && kept.length === 0)) return;
    await send(kept && kept.length <= MAX_REPORTED_PATHS ? kept : undefined);
  });
  return Object.assign(
    (path: string | undefined) => {
      if (path === undefined || paths.size >= MAX_GATHERED_PATHS)
        everything = true;
      else paths.add(path);
      batch.changed();
    },
    { close: batch.close },
  );
}

/**
 * Watches what a Files or Git view shows and reports changed paths relative
 * to the selected folder (Files) or the repository root (Git).
 */
export async function watchReading(
  root: string,
  scope: "files" | "file" | "git",
  send: (paths: string[] | undefined) => Promise<void>,
  failed: Failure,
): Promise<() => void> {
  const stops: Array<() => void> = [];
  const stop = () => {
    for (const release of stops.splice(0)) release();
  };
  try {
    if (scope === "files" || scope === "file") {
      let base: string;
      try {
        base = await realpath(root);
      } catch (error) {
        throw toFailure(error);
      }
      const changed = coalesce(send);
      stops.push(changed.close);
      stops.push(
        await watchDirectory(base, scope === "files", changed, failed),
      );
      // Reads can finish during startup; refresh once all paths are watched.
      await send(undefined);
      return stop;
    }
    let repository;
    try {
      repository = await discoverRepository(root);
    } catch (error) {
      if (
        !(error instanceof ReadingFailure) ||
        error.code !== "not_git_repository"
      )
        throw error;
      // Without a repository, any change may be the one that creates it.
      const base = await realpath(root).catch((cause: unknown) => {
        throw toFailure(cause);
      });
      const changed = coalesce(() => send(undefined));
      stops.push(changed.close);
      stops.push(await watchDirectory(base, true, changed, failed));
      await send(undefined);
      return stop;
    }
    const base = repository.root;
    const gitDirInside = inside(base, repository.gitDir);
    // Changes Git ignores (build output, dependencies) do not change the list.
    const reported = async (paths: string[]) => {
      if (paths.some((path) => path.startsWith("\0"))) return undefined;
      try {
        const { stdout } = await collectGit(
          base,
          ["check-ignore", "-z", "--stdin"],
          undefined,
          [0, 1],
          Buffer.from(paths.join("\0") + "\0"),
          false,
        );
        const skip = new Set(stdout.toString("utf8").split("\0"));
        return paths.filter((path) => !skip.has(path));
      } catch {
        return paths;
      }
    };
    const changed = coalesce(send, reported);
    stops.push(changed.close);
    // Metadata changes are marked with a leading NUL so the filter can tell them apart.
    const metadataChanged = () => changed("\0metadata");
    stops.push(
      await watchDirectory(
        base,
        true,
        (path) => {
          if (path === undefined) return changed(undefined);
          if (
            gitDirInside !== undefined &&
            (path === gitDirInside || path.startsWith(`${gitDirInside}/`))
          ) {
            const inner = path.slice(gitDirInside.length + 1);
            if (GIT_METADATA.test(inner)) metadataChanged();
            return;
          }
          if (path === ".git" || path.startsWith(".git/")) return;
          changed(path);
        },
        failed,
      ),
    );
    if (gitDirInside === undefined) {
      // A linked worktree keeps its index and HEAD outside the worktree.
      const directories = new Set([repository.gitDir, repository.commonDir]);
      for (const directory of directories)
        stops.push(
          await watchDirectory(
            directory,
            false,
            (path) => {
              if (path === undefined || GIT_METADATA.test(path))
                metadataChanged();
            },
            failed,
          ),
        );
      stops.push(
        await watchDirectory(
          join(repository.commonDir, "refs"),
          true,
          metadataChanged,
          failed,
        ),
      );
    }
    await send(undefined);
    return stop;
  } catch (error) {
    stop();
    if (error instanceof ReadingFailure) throw error;
    const code = errorCode(error);
    throw new ReadingFailure(
      code === "EACCES" || code === "EPERM"
        ? "permission_denied"
        : code === "ENOENT"
          ? "path_not_found"
          : "read_failed",
      "Could not watch this folder",
    );
  }
}
