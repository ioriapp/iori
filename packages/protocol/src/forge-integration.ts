/** Why a Forge could not be read (forge.md「失敗の示し方」). */
export type ForgeFailureReason =
  | "token-missing"
  | "token-invalid"
  | "insufficient-scope"
  | "not-found"
  | "unreachable"
  | "rate-limited";

/** One shape for every view and command that reads a Forge. */
export interface ForgeReadFailure {
  reason: ForgeFailureReason;
  /** The Forge's web origin, such as https://github.com. */
  site: string;
  /** owner/repo when the read was for one repository. */
  repository?: string;
  /** The permission the Forge reported as missing, such as read:issue. */
  scope?: string;
  /** When the Forge accepts reads again after a rate limit (epoch ms). */
  resetAt?: number;
  /** GitHub: this Host has no gh at all. */
  ghMissing?: true;
}

/** A Forgejo/Gitea site on the Host's Integrations list. */
export interface ForgeSite {
  origin: string;
  /** Present when this Host has a token for the site, and where it is kept. */
  token?: { account?: string; storage: "os" | "file" };
  /** The last read could not use the site; cleared when a read succeeds. */
  failure?: {
    reason: "token-invalid" | "insufficient-scope" | "unreachable";
    scope?: string;
    at: number;
  };
}

export interface ForgeSites {
  /** Where this Host keeps a newly registered token. */
  storage: "os" | "file";
  sites: ForgeSite[];
}

export interface ForgeIntegrationParams {
  "forge.sites": Record<string, never>;
  "forge.token.set": { origin: string; token: string };
  "forge.token.remove": { origin: string };
  "forge.site.check": { origin: string };
}
export interface ForgeIntegrationResults {
  "forge.sites": ForgeSites;
  "forge.token.set":
    | { site: ForgeSite }
    | { rejected: "not-forge" | "token-invalid" | "unreachable" };
  "forge.token.remove": { origin: string };
  "forge.site.check": { site: ForgeSite };
}
export type ForgeIntegrationMethod = keyof ForgeIntegrationParams;
const methods: ForgeIntegrationMethod[] = [
  "forge.sites",
  "forge.token.set",
  "forge.token.remove",
  "forge.site.check",
];
export function isForgeIntegrationMethod(
  value: unknown,
): value is ForgeIntegrationMethod {
  return methods.includes(value as ForgeIntegrationMethod);
}

function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error("Expected an object");
  return value as Record<string, unknown>;
}

/**
 * Only the origin of an http(s) URL; credentials and paths are dropped. A
 * host name without a scheme means https, as in a browser's address bar.
 */
export function forgeSiteOrigin(value: unknown): string {
  if (typeof value === "string") {
    const text = value.trim();
    try {
      const url = new URL(text.includes("://") ? text : `https://${text}`);
      if (url.protocol === "http:" || url.protocol === "https:")
        return url.origin;
    } catch {
      /* Reported below as an invalid site URL. */
    }
  }
  throw new Error("Expected an http or https URL");
}

/** A token is sent in an HTTP header, so only visible ASCII can be one. */
export function forgeToken(value: unknown): string {
  if (typeof value !== "string") throw new Error("Expected a token");
  const token = value.trim();
  if (!/^[\x21-\x7e]+$/u.test(token)) throw new Error("Expected a token");
  return token;
}

export function parseForgeIntegrationParams<M extends ForgeIntegrationMethod>(
  method: M,
  value: unknown,
): ForgeIntegrationParams[M] {
  const input = object(value);
  if (method === "forge.sites") return {} as ForgeIntegrationParams[M];
  const origin = forgeSiteOrigin(input.origin);
  if (method === "forge.token.set")
    return {
      origin,
      token: forgeToken(input.token),
    } as ForgeIntegrationParams[M];
  return { origin } as ForgeIntegrationParams[M];
}

// Responses are iori's own values; only requests cross a trust boundary.
export const forgeIntegrationResultSchemas = Object.fromEntries(
  methods.map((method) => [method, { parse: (value: unknown) => value }]),
) as {
  [M in ForgeIntegrationMethod]: {
    parse: (value: unknown) => ForgeIntegrationResults[M];
  };
};
