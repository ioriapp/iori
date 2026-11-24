import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { lstat, realpath, unlink } from "node:fs/promises";
import { basename, dirname, join } from "node:path";
import type {
  GitWriteMethod,
  GitWriteParams,
  GitWriteResult,
  RequestByMethod,
} from "@iori/protocol";
import { gitPatchOptions } from "./git-diff.ts";
import { collectGit, startGit, stopGit, finishGit } from "./git-process.ts";
import {
  discoverRepository,
  hasHead,
  invalidateGitStatus,
} from "./git-reading.ts";
import { isWithin } from "./path-boundary.ts";
import {
  ReadingFailure,
  throwIfAborted,
  toFailure,
} from "./reading-failure.ts";

type WriteRequest = Extract<RequestByMethod, { method: GitWriteMethod }>;
const pending = new Map<string, Promise<GitWriteResult>>();

function failure(message: string): GitWriteResult {
  return { ok: false, message };
}

async function writeGit(
  root: string,
  args: string[],
  signal: AbortSignal,
  input?: string | Buffer,
): Promise<GitWriteResult> {
  throwIfAborted(signal);
  const child = spawn(
    "git",
    [
      "--no-pager",
      "-c",
      "core.fsmonitor=false",
      "--literal-pathspecs",
      ...args,
    ],
    {
      cwd: root,
      shell: false,
      windowsHide: true,
      signal,
      env: { ...process.env, GIT_TERMINAL_PROMPT: "0", LC_ALL: "C" },
      stdio: ["pipe", "ignore", "pipe"],
    },
  );
  let stderr = Buffer.alloc(0);
  let truncated = false;
  child.stderr.on("data", (chunk: Buffer) => {
    const available = 8192 - stderr.length;
    if (chunk.length > available) truncated = true;
    if (available)
      stderr = Buffer.concat([stderr, chunk.subarray(0, available)]);
  });
  let error: Error | undefined;
  child.once("error", (cause) => {
    error = cause;
  });
  const closed = new Promise<number | null>((resolve) =>
    child.once("close", resolve),
  );
  // Git may reject the operation before consuming its input.
  child.stdin.on("error", () => {});
  child.stdin.end(input);
  const code = await closed;
  throwIfAborted(signal);
  if (!error && code === 0) return { ok: true };
  let text = stderr.toString("utf8");
  if (truncated) text = text.replace(/\S+$/u, "…");
  const message = (text.trim() || error?.message || "Git operation failed.")
    .replace(/([a-z][a-z0-9+.-]*:\/\/)[^\s/]+@/giu, "$1***@")
    .slice(0, 2000);
  return failure(message);
}

async function discardUntracked(
  root: string,
  paths: string[],
  signal: AbortSignal,
): Promise<GitWriteResult> {
  const targets = [];
  for (const path of new Set(paths)) {
    const parent = await realpath(join(root, dirname(path)));
    if (!isWithin(root, parent))
      throw new ReadingFailure(
        "path_outside_root",
        "Path is outside the repository",
      );
    const target = join(parent, basename(path));
    const info = await lstat(target);
    if (!info.isFile() && !info.isSymbolicLink())
      return failure("Expected an untracked file.");
    const { stdout } = await collectGit(
      root,
      ["ls-files", "--others", "--exclude-standard", "-z", "--", path],
      signal,
    );
    if (!stdout.equals(Buffer.from(path + "\0")))
      return failure("File is no longer untracked.");
    targets.push(target);
  }
  for (const target of targets) {
    throwIfAborted(signal);
    await unlink(target);
  }
  return { ok: true };
}

// Keep Git's raw bytes, including CRLF and a missing final newline in the file.
// Only the current line, file header and selected hunk are retained.
async function* patchLines(stream: AsyncIterable<Buffer>) {
  let parts: Buffer[] = [];
  for await (const chunk of stream) {
    let start = 0;
    while (start < chunk.length) {
      const end = chunk.indexOf(10, start);
      if (end === -1) {
        parts.push(chunk.subarray(start));
        break;
      }
      const line = chunk.subarray(start, end + 1);
      yield parts.length ? Buffer.concat([...parts, line]) : line;
      parts = [];
      start = end + 1;
    }
  }
  if (parts.length) yield Buffer.concat(parts);
}

async function applyHunk(
  root: string,
  params: GitWriteParams["git.applyHunk"],
  signal: AbortSignal,
): Promise<GitWriteResult> {
  const { action, path, hunkIndex, expectedFingerprint } = params;
  const git = startGit(
    root,
    [
      "diff",
      ...(action === "unstage" ? ["--cached"] : []),
      ...gitPatchOptions,
      "--",
      path,
    ],
    signal,
  );
  let header: Buffer[] = [];
  let index = -1;
  let inHunk = false;
  let selectedHeader: Buffer[] | undefined;
  const selected: Buffer[] = [];
  try {
    for await (const line of patchLines(git.child.stdout)) {
      if (line[0] === 0x64 && line.toString("ascii", 0, 11) === "diff --git ") {
        header = [line];
        inHunk = false;
      } else if (line[0] === 0x40 && line.toString("ascii", 0, 3) === "@@ ") {
        index++;
        inHunk = true;
        if (index === hunkIndex) selectedHeader = header;
      } else if (
        !inHunk &&
        /^(--- |\+\+\+ |new file mode |deleted file mode )/u.test(
          line.toString("latin1", 0, 18),
        )
      ) {
        header.push(line);
      }
      if (inHunk && index === hunkIndex) selected.push(line);
    }
    await finishGit(git, signal);
  } catch (error) {
    await stopGit(git);
    throw error;
  }
  if (!selectedHeader) return failure("Hunk is no longer available.");
  const body = Buffer.concat(selected);
  if (
    expectedFingerprint &&
    createHash("sha256").update(body).digest("hex") !== expectedFingerprint
  )
    return failure("Diff has changed. Reload and try again.");
  return writeGit(
    root,
    [
      "apply",
      ...(action !== "discard" ? ["--cached"] : []),
      ...(action !== "stage" ? ["--reverse"] : []),
      "-",
    ],
    signal,
    Buffer.concat([...selectedHeader, body]),
  );
}

async function push(
  root: string,
  signal: AbortSignal,
): Promise<GitWriteResult> {
  const read = async (args: string[], accepted = [0]) =>
    (await collectGit(root, args, signal, accepted)).stdout
      .toString("utf8")
      .trim();
  const branch = await read(["symbolic-ref", "--quiet", "HEAD"], [0, 1]);
  if (!branch.startsWith("refs/heads/"))
    return failure("Switch to a branch before pushing.");
  const name = branch.slice("refs/heads/".length);
  const mapping = (
    await read([
      "for-each-ref",
      "--format=%(refname)%00%(push:remoteref)",
      branch,
    ])
  )
    .split("\n")
    .map((line) => line.split("\0"))
    .find(([ref]) => ref === branch);
  const destination = mapping?.[1] || branch;
  if (!destination.startsWith("refs/heads/"))
    return failure("The Git push destination must be a branch.");
  const config = (key: string) => read(["config", "--get", key], [0, 1]);
  let remote =
    (await config(`branch.${name}.pushRemote`)) ||
    (await config("remote.pushDefault")) ||
    (await config(`branch.${name}.remote`));
  if (!remote) {
    const remotes = (await read(["remote"])).split("\n").filter(Boolean);
    remote = remotes.includes("origin")
      ? "origin"
      : remotes.length === 1
        ? remotes[0]
        : "";
  }
  if (!remote) return failure("Configure a push remote for this branch.");
  const upstream = await read(
    ["rev-parse", "--abbrev-ref", "--symbolic-full-name", "@{upstream}"],
    [0, 128],
  );
  return writeGit(
    root,
    [
      "-c",
      `remote.${remote}.mirror=false`,
      "push",
      "--no-force",
      "--no-follow-tags",
      ...(!upstream ? ["--set-upstream"] : []),
      "--",
      remote,
      `${branch}:${destination}`,
    ],
    signal,
  );
}

async function execute(
  root: string,
  request: WriteRequest,
  signal: AbortSignal,
): Promise<GitWriteResult> {
  switch (request.method) {
    case "git.stage":
      return writeGit(
        root,
        request.params.all
          ? ["add", "-A"]
          : ["add", "--", ...request.params.paths!],
        signal,
      );
    case "git.unstage": {
      const { all, paths } = request.params;
      if (await hasHead(root, signal))
        return writeGit(
          root,
          ["reset", "-q", "HEAD", ...(all ? [] : ["--", ...paths!])],
          signal,
        );
      return writeGit(
        root,
        ["rm", "--cached", "-f", "-r", "-q", "--", ...(all ? ["."] : paths!)],
        signal,
      );
    }
    case "git.discard":
      if (request.params.untracked) {
        try {
          return await discardUntracked(root, request.params.paths, signal);
        } catch (error) {
          throwIfAborted(signal);
          throw toFailure(error);
        }
      }
      return writeGit(
        root,
        ["checkout", "--", ...request.params.paths],
        signal,
      );
    case "git.applyHunk":
      return applyHunk(root, request.params, signal);
    case "git.createCommit": {
      const { amend, message } = request.params;
      if (!amend) {
        const staged = await collectGit(
          root,
          ["diff", "--cached", "--quiet"],
          signal,
          [0, 1],
        );
        if (staged.code === 0) return failure("No staged changes to commit.");
      }
      const result = await writeGit(
        root,
        ["commit", "--file=-", ...(amend ? ["--amend"] : [])],
        signal,
        message,
      );
      if (!result.ok) return result;
      const { stdout } = await collectGit(root, ["rev-parse", "HEAD"], signal);
      return { ok: true, hash: stdout.toString("ascii").trim() };
    }
    case "git.fetch":
      return writeGit(root, ["fetch"], signal);
    case "git.pull":
      return writeGit(root, ["pull", "--ff-only"], signal);
    case "git.push":
      return push(root, signal);
  }
}

export async function handleGitWrite(
  request: WriteRequest,
  signal: AbortSignal,
): Promise<GitWriteResult> {
  const { root, commonDir } = await discoverRepository(
    request.params.root,
    signal,
  );
  const previous = pending.get(commonDir) ?? Promise.resolve();
  const operation = previous
    .catch(() => {})
    .then(async () => {
      throwIfAborted(signal);
      try {
        return await execute(root, request, signal);
      } finally {
        invalidateGitStatus(root);
      }
    });
  pending.set(commonDir, operation);
  try {
    return await operation;
  } finally {
    if (pending.get(commonDir) === operation) pending.delete(commonDir);
  }
}
