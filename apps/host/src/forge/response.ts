import type { ForgeStatus } from "@iori/protocol";
import { ciStatus, commitStatusWords, markState } from "./ci.ts";
export type ForgeTarget = {
  remoteHost: string;
  origin: string;
  owner: string;
  repo: string;
  branch: string;
  sha: string;
};
type Json = Record<string, unknown>;
export const object = (value: unknown): Json => {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error("Invalid Forge response");
  return value as Json;
};
export const array = (value: unknown): unknown[] => {
  if (!Array.isArray(value)) throw new Error("Invalid Forge response");
  return value;
};
export const string = (value: unknown): string => {
  if (typeof value !== "string") throw new Error("Invalid Forge response");
  return value;
};

/** A sign-in-only Forgejo/Gitea answers every anonymous API read with this 403. */
export const SIGN_IN_ONLY_MESSAGE =
  "Only signed in user is allowed to call APIs.";

/** The site answered as Forgejo/Gitea: its version, or the sign-in-only 403. */
export function forgejoAnswered(status: number, body: unknown): boolean {
  const answer = body && typeof body === "object" ? (body as Json) : {};
  return status === 403
    ? answer.message === SIGN_IN_ONLY_MESSAGE
    : status >= 200 && status < 300 && typeof answer.version === "string";
}

/** Only a Forge's own HTTP links may cross to the Client/browser. */
export function forgeUrl(origin: string, value: unknown): string | undefined {
  if (typeof value !== "string" || !value) return undefined;
  try {
    const url = new URL(value, `${origin}/`);
    if (
      url.origin === origin &&
      ["https:", "http:"].includes(url.protocol) &&
      !url.username &&
      !url.password
    )
      return url.href;
  } catch {
    /* An unusable API link does not hide the remaining status. */
  }
  return undefined;
}

export type Check = {
  state: "passed" | "failed" | "running" | "other";
  url?: string;
  word?: string;
};
export function checksStatus(
  origin: string,
  checks: Check[] | undefined,
  fallback: string,
): ForgeStatus["checks"] {
  if (!checks?.length) return undefined;
  // A state iori does not know is not counted; only such states show neutral.
  const known = checks.filter((check) => check.state !== "other");
  const chosen =
    known.find((check) => check.state === "failed") ??
    known.find((check) => check.state === "running");
  const word = known.length
    ? undefined
    : checks.find((check) => check.word)?.word;
  return {
    state: chosen?.state ?? (known.length ? "passed" : "other"),
    ...(word ? { word } : {}),
    url:
      checks.find((check) => check.state === "failed" && check.url)?.url ??
      checks.find((check) => check.state === "running" && check.url)?.url ??
      `${origin}${fallback}`,
  };
}
export function commitChecks(origin: string, values: unknown[]): Check[] {
  // Multiple runs of one context replace older results; APIs return newest first.
  const seen = new Set<string>();
  const checks: Check[] = [];
  for (const value of values) {
    const check = object(value);
    const context = string(check.context);
    if (seen.has(context)) continue;
    seen.add(context);
    const { status, word } = ciStatus(
      commitStatusWords,
      check.state ?? check.status,
    );
    checks.push({
      state: markState(status),
      ...(word ? { word } : {}),
      url: forgeUrl(origin, check.target_url),
    });
  }
  return checks;
}

export function pullStatus(
  target: ForgeTarget,
  values: unknown[],
): ForgeStatus["pullRequest"] {
  const pulls = values
    .map(object)
    .filter((pull) => {
      const head = object(pull.head);
      if (head.ref !== target.branch) return false;
      if (pull.state !== "open" && head.sha !== target.sha) return false;
      // Exclude a fork's branch with the same name.
      if (!head.repo) return false;
      const repo = object(head.repo);
      return (
        typeof repo.full_name === "string" &&
        repo.full_name.toLowerCase() ===
          `${target.owner}/${target.repo}`.toLowerCase()
      );
    })
    .sort((a, b) => Number(b.number) - Number(a.number));
  const pull = pulls.find((value) => value.state === "open") ?? pulls[0];
  if (!pull) return undefined;
  const url = forgeUrl(target.origin, pull.html_url);
  if (
    !url ||
    !Number.isSafeInteger(pull.number) ||
    Number(pull.number) <= 0 ||
    !["open", "closed"].includes(string(pull.state))
  )
    return undefined;
  return {
    number: Number(pull.number),
    url,
    state:
      pull.merged === true || pull.merged_at
        ? "merged"
        : pull.state === "closed"
          ? "closed"
          : pull.draft === true
            ? "draft"
            : "open",
  };
}
