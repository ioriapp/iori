export type ReadingFailureCode =
  | "invalid_request"
  | "path_outside_root"
  | "path_not_found"
  | "not_a_file"
  | "not_a_directory"
  | "permission_denied"
  | "read_failed"
  | "git_failed"
  | "not_git_repository";

export class ReadingFailure extends Error {
  readonly code: ReadingFailureCode;

  constructor(code: ReadingFailureCode, message: string) {
    super(message);
    this.name = "ReadingFailure";
    this.code = code;
  }
}

export function errorCode(error: unknown): string {
  return typeof error === "object" && error !== null && "code" in error
    ? String(error.code)
    : "";
}

/** Maps an OS error to what the reader can act on. Unknown errors stay a read failure. */
export function toFailure(error: unknown): ReadingFailure {
  if (error instanceof ReadingFailure) return error;
  const code = errorCode(error);
  if (code === "ENOENT" || code === "ENOTDIR")
    return new ReadingFailure("path_not_found", "Path does not exist");
  if (code === "EACCES" || code === "EPERM")
    return new ReadingFailure("permission_denied", "Permission denied");
  return new ReadingFailure("read_failed", "Path cannot be read");
}

export function throwIfAborted(signal: AbortSignal | undefined): void {
  if (signal?.aborted) throw signal.reason ?? new Error("read cancelled");
}
