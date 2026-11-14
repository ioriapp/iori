export function registerCleanup<Args extends unknown[], Result>(
  cleanup: (...args: Args) => Result,
): (...args: Args) => Promise<Awaited<Result>>;
export function ownVerificationDirectory(directory: string): Promise<void>;
export function registerVerificationDaemon(root: string): Promise<void>;
export function recoverStaleVerificationRuns(): Promise<void>;
export function recoverVerificationDirectory(
  directory: string,
): Promise<boolean>;
export function verificationDirectoryFor(
  path: string,
): Promise<string | undefined>;
