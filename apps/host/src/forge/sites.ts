import type {
  ForgeIntegrationResults,
  ForgeReadFailure,
  ForgeSite,
  ForgeSites as ForgeSiteList,
} from "@iori/protocol";
import type { HostStore } from "../store.ts";
import type { ForgeDetection } from "./adapters.ts";
import type { TokenVault } from "./token-vault.ts";
import { parseRemoteUrl, readRemoteUrls } from "../forge-remote.ts";
import { forgejoAnswered } from "./response.ts";

type SiteFailure = NonNullable<ForgeSite["failure"]> & { family: string };
const siteProblems = new Set([
  "token-invalid",
  "insufficient-scope",
  "unreachable",
]);

/** The kind of read, so a missing scope clears only when that read works. */
function requestFamily(path: string): string {
  const parts = path.replace(/^\/api\/v1\/+/u, "").split("/");
  return (parts[0] === "repos" ? parts[3] : parts[0]) ?? "";
}

let active: ForgeSites | undefined;
/** The Host's sites; Forgejo reads use them for tokens and row states. */
export function activateForgeSites(sites: ForgeSites | undefined): void {
  active = sites;
}
export function forgeSites(): ForgeSites | undefined {
  return active;
}

/** Forgejo/Gitea sites: registered tokens and the last read of each site. */
export class ForgeSites {
  readonly #store: HostStore;
  readonly #vault: TokenVault;
  readonly #onChange: () => void;
  readonly #tokens = new Map<string, string>();
  readonly #changes = new Map<string, number>();
  readonly #failures = new Map<string, SiteFailure>();
  constructor(store: HostStore, vault: TokenVault, onChange: () => void) {
    this.#store = store;
    this.#vault = vault;
    this.#onChange = onChange;
  }

  async token(origin: string): Promise<string | undefined> {
    const saved = this.#store.forgeToken(origin);
    if (!saved) return undefined;
    const cached = this.#tokens.get(origin);
    if (cached) return cached;
    const change = this.#changes.get(origin);
    // A locked or removed store entry reads as no token; the next read tries again.
    const token = await this.#vault
      .read(origin, saved.storage)
      .catch(() => undefined);
    // A token replaced or removed during this read must not be remembered.
    if (token && this.#changes.get(origin) === change)
      this.#tokens.set(origin, token);
    return token;
  }

  /**
   * The last read of a site decides its row (forge.md「連携の設定」), with the
   * time of that read. Any answer means the site is reachable; only a read
   * that carried the token can show the token works. Views are told only when
   * the row's reason changes; the time of each later try is kept quietly and
   * shows when the row is read (opening Integrations, 再試行).
   */
  recordRead(
    origin: string,
    path: string,
    failure?: ForgeReadFailure,
    withToken = true,
  ): void {
    const previous = this.#failures.get(origin);
    const family = requestFamily(path);
    if (failure && siteProblems.has(failure.reason)) {
      this.#failures.set(origin, {
        reason: failure.reason as SiteFailure["reason"],
        ...(failure.scope ? { scope: failure.scope } : {}),
        at: Date.now(),
        family,
      });
      if (
        previous?.reason === failure.reason &&
        previous.scope === failure.scope
      )
        return;
    } else if (
      previous?.reason === "unreachable" ||
      (withToken &&
        (previous?.reason === "token-invalid" ||
          (previous?.reason === "insufficient-scope" &&
            previous.family === family)))
    )
      this.#failures.delete(origin);
    else return;
    this.#onChange();
  }

  site(origin: string): ForgeSite {
    const saved = this.#store.forgeToken(origin);
    const failure = this.#failures.get(origin);
    return {
      origin,
      ...(saved
        ? {
            token: {
              storage: saved.storage,
              ...(saved.account ? { account: saved.account } : {}),
            },
          }
        : {}),
      ...(failure
        ? {
            failure: {
              reason: failure.reason,
              ...(failure.scope ? { scope: failure.scope } : {}),
              at: failure.at,
            },
          }
        : {}),
    };
  }

  async list(discovered: string[]): Promise<ForgeSiteList> {
    const origins = new Set([
      ...this.#store.forgeTokens().map((saved) => saved.origin),
      ...discovered,
    ]);
    return {
      storage: await this.#vault.storage(),
      sites: [...origins]
        .sort(
          (a, b) =>
            new URL(a).hostname.localeCompare(new URL(b).hostname) ||
            a.localeCompare(b),
        )
        .map((origin) => this.site(origin)),
    };
  }

  /** Saved only after the site answers as Forgejo/Gitea and accepts the token. */
  async register(
    origin: string,
    token: string,
    signal?: AbortSignal,
  ): Promise<ForgeIntegrationResults["forge.token.set"]> {
    const checked = await checkSite(origin, token, signal);
    if ("rejected" in checked) return checked;
    // A registration cancelled while the site answered is not saved later.
    signal?.throwIfAborted();
    const previous = this.#store.forgeToken(origin);
    const storage = await this.#vault.write(origin, token);
    if (previous && previous.storage !== storage)
      await this.#vault.delete(origin, previous.storage).catch(() => undefined);
    this.#store.setForgeToken(origin, storage, checked.account ?? "");
    this.#changes.set(origin, (this.#changes.get(origin) ?? 0) + 1);
    this.#tokens.set(origin, token);
    this.#failures.delete(origin);
    this.#onChange();
    return { site: this.site(origin) };
  }

  async remove(origin: string): Promise<void> {
    const saved = this.#store.forgeToken(origin);
    if (saved) await this.#vault.delete(origin, saved.storage);
    this.#store.removeForgeToken(origin);
    this.#changes.set(origin, (this.#changes.get(origin) ?? 0) + 1);
    this.#tokens.delete(origin);
    this.#failures.delete(origin);
    this.#onChange();
  }

  /** 「再試行」: ask the site again with the saved token. */
  async check(origin: string): Promise<ForgeSite> {
    const token = await this.token(origin);
    const checked = await checkSite(origin, token);
    if ("rejected" in checked && checked.rejected !== "token-invalid") {
      this.recordRead(
        origin,
        "/api/v1/version",
        { reason: "unreachable", site: origin },
        false,
      );
      return this.site(origin);
    }
    this.recordRead(origin, "/api/v1/version", undefined, false);
    if ("rejected" in checked)
      this.recordRead(origin, "/api/v1/user", {
        reason: "token-invalid",
        site: origin,
      });
    else if (token) {
      const saved = this.#store.forgeToken(origin);
      if (saved && checked.account && checked.account !== saved.account) {
        this.#store.setForgeToken(origin, saved.storage, checked.account);
        this.#onChange();
      }
      this.recordRead(origin, "/api/v1/user");
    }
    return this.site(origin);
  }

  /** Host uninstall: OS credential store entries are outside the data folder. */
  async removeStoredTokens(): Promise<{
    removed: number;
    remaining: string[];
  }> {
    let removed = 0;
    const remaining: string[] = [];
    for (const { origin, storage } of this.#store.forgeTokens()) {
      if (storage !== "os") continue;
      try {
        await this.#vault.delete(origin, "os");
        removed += 1;
      } catch {
        remaining.push(origin);
      }
    }
    return { removed, remaining };
  }
}

async function checkSite(
  origin: string,
  token?: string,
  signal?: AbortSignal,
): Promise<
  | { account?: string }
  | { rejected: "not-forge" | "token-invalid" | "unreachable" }
> {
  const read = (path: string, withToken: boolean) =>
    fetch(`${origin}${path}`, {
      signal,
      redirect: "error",
      credentials: "omit",
      ...(withToken && token
        ? { headers: { authorization: `token ${token}` } }
        : {}),
    });
  let version: Response;
  try {
    // The token goes only to a site that answered as Forgejo/Gitea, never to
    // a mistyped URL.
    version = await read("/api/v1/version", false);
  } catch {
    signal?.throwIfAborted();
    return { rejected: "unreachable" };
  }
  if (version.status >= 500) {
    await version.body?.cancel().catch(() => undefined);
    return { rejected: "unreachable" };
  }
  const answer: unknown = await version.json().catch(() => undefined);
  if (!forgejoAnswered(version.status, answer))
    return { rejected: "not-forge" };
  if (!token) return {};
  let user: Response;
  try {
    user = await read("/api/v1/user", true);
  } catch {
    signal?.throwIfAborted();
    return { rejected: "unreachable" };
  }
  if (!user.ok) {
    await user.body?.cancel().catch(() => undefined);
    // Without read:user the token still reads repositories; only the name is unknown.
    return user.status === 401 ? { rejected: "token-invalid" } : {};
  }
  const login = (
    (await user.json().catch(() => undefined)) as
      { login?: unknown } | undefined
  )?.login;
  return typeof login === "string" && login ? { account: login } : {};
}

/** Forgejo/Gitea sites found from the remotes of the workspaces in the sidebar. */
export async function discoveredForgeOrigins(
  store: HostStore,
  detection: ForgeDetection,
): Promise<string[]> {
  const workspaces = [
    ...new Set(
      store
        .folderHistory()
        .filter((folder) => folder.kind === "git" && folder.inSidebar)
        .map((folder) => folder.workspacePath),
    ),
  ];
  const remotes = (
    await Promise.all(
      workspaces.map((path) => readRemoteUrls(path).catch(() => [])),
    )
  ).flat();
  const origins = new Set<string>();
  for (const remote of remotes) {
    const location = parseRemoteUrl(remote.url);
    if (!location) continue;
    const origin =
      store.forgeMapping(location.remoteHost)?.webUrl ?? location.origin;
    if (detection.forSettings(origin).adapter?.id === "forgejo")
      origins.add(origin);
  }
  return [...origins];
}
