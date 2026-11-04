import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import {
  ReadingFailure,
  errorCode,
  throwIfAborted,
} from "./reading-failure.ts";

type Signal = AbortSignal | undefined;
type CloseResult = { code: number | null };

// stderr is read only to tell "not a repository" from other Git failures.
const MAX_STDERR_BYTES = 8192;

export interface GitProcess {
  child: ChildProcessWithoutNullStreams;
  closed: Promise<CloseResult>;
  stderr(): string;
  spawnError?: Error;
  dispose(): void;
}

/**
 * Runs the user's Git without a shell, pager, external diff or textconv.
 * Pathspecs are literal so a file name is never read as a pattern.
 */
export function startGit(
  cwd: string,
  args: string[],
  signal?: Signal,
  stdin?: Buffer,
  // check-ignore takes paths, not pathspecs, and refuses the literal option.
  literalPathspecs = true,
): GitProcess {
  throwIfAborted(signal);
  const child = spawn(
    "git",
    [
      "--no-pager",
      "--no-optional-locks",
      ...(literalPathspecs ? ["--literal-pathspecs"] : []),
      ...args,
    ],
    {
      cwd,
      env: {
        ...process.env,
        GIT_PAGER: "cat",
        PAGER: "cat",
        GIT_OPTIONAL_LOCKS: "0",
        GIT_TERMINAL_PROMPT: "0",
        LC_ALL: "C",
      },
      shell: false,
      windowsHide: true,
      stdio: ["pipe", "pipe", "pipe"],
    },
  );
  const stderr: Buffer[] = [];
  let stderrBytes = 0;
  const onAbort = () => child.kill();
  signal?.addEventListener("abort", onAbort, { once: true });
  const state: GitProcess = {
    child,
    closed: new Promise<CloseResult>((resolve) => {
      child.once("close", (code) => resolve({ code }));
    }),
    stderr: () => Buffer.concat(stderr).toString("utf8"),
    dispose: () => signal?.removeEventListener("abort", onAbort),
  };
  child.once("error", (error) => {
    state.spawnError = error;
  });
  child.stderr.on("data", (chunk: Buffer) => {
    const remaining = MAX_STDERR_BYTES - stderrBytes;
    if (remaining <= 0) return;
    stderr.push(chunk.subarray(0, remaining));
    stderrBytes += Math.min(remaining, chunk.length);
  });
  // A closed stdin pipe is not a read failure; Git may exit before reading it.
  child.stdin.on("error", () => undefined);
  child.stdin.end(stdin);
  return state;
}

export function gitFailure(error: unknown): ReadingFailure {
  if (error instanceof ReadingFailure) return error;
  const code = errorCode(error);
  if (code === "EACCES" || code === "EPERM")
    return new ReadingFailure("permission_denied", "Git access was denied");
  return new ReadingFailure("git_failed", "Git could not read this repository");
}

export async function finishGit(
  process: GitProcess,
  signal?: Signal,
  accepted: readonly number[] = [0],
): Promise<number> {
  const result = await process.closed;
  process.dispose();
  throwIfAborted(signal);
  if (process.spawnError) throw gitFailure(process.spawnError);
  const code = result.code ?? -1;
  if (!accepted.includes(code)) {
    if (code === 128 && /not a git repository/iu.test(process.stderr()))
      throw new ReadingFailure(
        "not_git_repository",
        "The folder is not inside a Git repository",
      );
    throw new ReadingFailure(
      "git_failed",
      "Git could not read this repository",
    );
  }
  return code;
}

/** Stops a process whose remaining output is no longer needed. */
export async function stopGit(process: GitProcess): Promise<void> {
  if (process.child.exitCode === null && process.child.signalCode === null)
    process.child.kill();
  process.child.stdout.destroy();
  await process.closed;
  process.dispose();
}

export async function collectGit(
  cwd: string,
  args: string[],
  signal?: Signal,
  accepted: readonly number[] = [0],
  stdin?: Buffer,
  literalPathspecs = true,
): Promise<{ stdout: Buffer; code: number }> {
  const process = startGit(cwd, args, signal, stdin, literalPathspecs);
  const chunks: Buffer[] = [];
  try {
    for await (const chunk of process.child.stdout) {
      throwIfAborted(signal);
      chunks.push(chunk as Buffer);
    }
    const code = await finishGit(process, signal, accepted);
    return { stdout: Buffer.concat(chunks), code };
  } catch (error) {
    await stopGit(process);
    throw gitFailure(error);
  }
}

/** Reads NUL-terminated fields from a Git stream without holding the whole output. */
export class NulReader {
  readonly #iterator: AsyncIterator<Buffer>;
  #buffer: Buffer = Buffer.alloc(0);
  #done = false;

  constructor(stream: AsyncIterable<Buffer>) {
    this.#iterator = stream[Symbol.asyncIterator]();
  }

  async next(): Promise<Buffer | undefined> {
    const parts: Buffer[] = [];
    for (;;) {
      const end = this.#buffer.indexOf(0);
      if (end >= 0) {
        parts.push(this.#buffer.subarray(0, end));
        this.#buffer = this.#buffer.subarray(end + 1);
        return Buffer.concat(parts);
      }
      if (this.#buffer.length > 0) parts.push(this.#buffer);
      this.#buffer = Buffer.alloc(0);
      if (this.#done) return parts.length ? Buffer.concat(parts) : undefined;
      const next = await this.#iterator.next();
      if (next.done) this.#done = true;
      else this.#buffer = next.value as Buffer;
    }
  }
}

const strictUtf8 = new TextDecoder("utf-8", { fatal: true });
const lossyUtf8 = new TextDecoder("utf-8");

/** Decodes a Git field; an undecodable name is still shown, marked as unreadable. */
export function decodeField(bytes: Buffer): { text: string; valid: boolean } {
  try {
    return { text: strictUtf8.decode(bytes), valid: true };
  } catch {
    return { text: lossyUtf8.decode(bytes), valid: false };
  }
}
