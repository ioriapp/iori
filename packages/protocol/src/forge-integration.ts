import * as v from "valibot";
import {
  decoded,
  method,
  emptyParams,
  hostResult,
  type Params,
  type Results,
  hasMethod,
  paramsOf,
  type ResultSchemas,
} from "./primitives.ts";
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

const origin = decoded(forgeSiteOrigin);
export const forgeIntegrationMethods = {
  "forge.sites": method(emptyParams, hostResult<ForgeSites>()),
  "forge.token.set": method(
    v.object({ origin, token: decoded(forgeToken) }),
    hostResult<
      | { site: ForgeSite }
      | { rejected: "not-forge" | "token-invalid" | "unreachable" }
    >(),
  ),
  "forge.token.remove": method(
    v.object({ origin }),
    hostResult<{ origin: string }>(),
  ),
  "forge.site.check": method(
    v.object({ origin }),
    hostResult<{ site: ForgeSite }>(),
  ),
};

export type ForgeIntegrationMethod = keyof typeof forgeIntegrationMethods;
export type ForgeIntegrationParams = Params<typeof forgeIntegrationMethods>;
export type ForgeIntegrationResults = Results<typeof forgeIntegrationMethods>;
export function isForgeIntegrationMethod(
  value: unknown,
): value is ForgeIntegrationMethod {
  return hasMethod(forgeIntegrationMethods, value);
}
export function parseForgeIntegrationParams<M extends ForgeIntegrationMethod>(
  key: M,
  value: unknown,
): ForgeIntegrationParams[M] {
  return paramsOf<ForgeIntegrationParams, M>(
    forgeIntegrationMethods,
    key,
    value,
  );
}
export const forgeIntegrationResultSchemas: ResultSchemas<ForgeIntegrationResults> =
  forgeIntegrationMethods;
