import type { ForgeFailureReason, ForgeReadFailure } from "@iori/protocol";

/** A Forge read that failed for a reason the user can act on. */
export class ForgeReadError extends Error {
  readonly failure: ForgeReadFailure;
  /** A sign-in-only Forgejo/Gitea refused an anonymous read. */
  readonly signInOnly: boolean;
  /** The HTTP status the site answered with; absent when it did not answer. */
  readonly status?: number;
  constructor(failure: ForgeReadFailure, signInOnly = false, status?: number) {
    super("Forge unavailable");
    this.failure = failure;
    this.signInOnly = signInOnly;
    this.status = status;
  }
}

/** Views and commands show every thrown read error in the common shape. */
export function forgeReadFailure(
  error: unknown,
  site: string,
  repository?: string,
): ForgeReadFailure {
  const failure =
    error instanceof ForgeReadError
      ? error.failure
      : {
          reason:
            (error as { reason?: ForgeFailureReason } | null)?.reason ??
            "unreachable",
          site,
          // gh could not start at all (GhUnavailable).
          ...((error as { missing?: boolean } | null)?.missing
            ? { ghMissing: true as const }
            : {}),
        };
  return {
    ...failure,
    ...(repository && !failure.repository ? { repository } : {}),
  };
}

/** Forgejo/Gitea API status codes; the body is read only for 403 scopes. */
export function forgejoFailure(
  site: string,
  status: number,
  message: string,
  headers: { get(name: string): string | null },
  withToken: boolean,
  now = Date.now(),
): ForgeReadFailure {
  if (status === 429) {
    const after = headers.get("retry-after");
    const reset = headers.get("x-ratelimit-reset");
    const resetAt =
      after && /^\d+$/u.test(after)
        ? now + Number(after) * 1000
        : after && Number.isFinite(Date.parse(after))
          ? Date.parse(after)
          : reset && /^\d+$/u.test(reset)
            ? Number(reset) * 1000
            : undefined;
    return {
      reason: "rate-limited",
      site,
      ...(resetAt === undefined ? {} : { resetAt }),
    };
  }
  // Without a token, a private repository is indistinguishable from a
  // missing one, and sign-in-only sites refuse every read.
  if (!withToken && [401, 403, 404].includes(status))
    return { reason: "token-missing", site };
  if (status === 401) return { reason: "token-invalid", site };
  if (status === 403) {
    const scope = /required scope\(s\): \[([^\]\s]+)/u.exec(message)?.[1];
    return { reason: "insufficient-scope", site, ...(scope ? { scope } : {}) };
  }
  if (status === 404) return { reason: "not-found", site };
  return { reason: "unreachable", site };
}

/** gh api reports the HTTP status on stderr; exit code 4 means no login. */
export function githubFailureReason(
  code: number | null,
  stderr: string,
  launchFailed = false,
): ForgeFailureReason {
  if (launchFailed || code === 4) return "token-missing";
  const status = /^gh: (?:.*\(HTTP (\d{3})\)|HTTP (\d{3}))\r?$/mu.exec(stderr);
  switch (status?.[1] ?? status?.[2]) {
    case "401":
      return "token-invalid";
    case "403":
      return /rate limit/iu.test(stderr)
        ? "rate-limited"
        : "insufficient-scope";
    case "404":
      return "not-found";
    case "429":
      return "rate-limited";
    default:
      return "unreachable";
  }
}
