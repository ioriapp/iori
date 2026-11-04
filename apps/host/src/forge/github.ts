import { spawn } from "node:child_process";
import type { ForgeStatus, GitHubAccounts } from "@iori/protocol";
import type { HostStore } from "../store.ts";
import type { ForgeAdapter, ForgeRepository } from "./types.ts";
import { githubReadFailure } from "./github-error.ts";
import { githubFailureReason } from "./failure.ts";
import type { ForgeFailureReason } from "@iori/protocol";
import { githubStatus, readGitHubCi, readGitHubCiLog } from "./github-ci.ts";
import { markState } from "./ci.ts";
import {
  array,
  object,
  commitChecks,
  checksStatus,
  pullStatus,
  forgeUrl,
  type Check,
  type ForgeTarget,
} from "./response.ts";

function checkRuns(origin: string, values: unknown[]): Check[] {
  return values.map(object).map((run) => {
    const { status, word } = githubStatus(run);
    return {
      state: markState(status),
      ...(word ? { word } : {}),
      url: forgeUrl(origin, run.html_url),
    };
  });
}

export class GhUnavailable extends Error {
  readonly missing: boolean;
  /** Why gh could not read, for views that show it (forgeReadFailure). */
  readonly reason?: ForgeFailureReason;
  constructor(missing = false, reason?: ForgeFailureReason) {
    super("GitHub unavailable");
    this.missing = missing;
    this.reason = reason;
  }
}

export class GhWriteFailure extends Error {}
export class GhRepositoryUnreadable extends GhUnavailable {}
export class GhTokenUnavailable extends GhUnavailable {}
class GhUnknownFlag extends GhUnavailable {}

// Serialize actual process lifetimes across every worktree observed by this Host.
let ghQueue: Promise<unknown> = Promise.resolve();
export function command(
  args: string[],
  signal?: AbortSignal,
  env = process.env,
  writeFailure = false,
): Promise<string> {
  const request = ghQueue.then(() => {
    signal?.throwIfAborted();
    return new Promise<string>((resolve, reject) => {
      const child = spawn("gh", args, {
        env,
        signal,
        stdio: ["ignore", "pipe", "pipe"],
        windowsHide: true,
      });
      let failed = false;
      let missing = false;
      let output = "";
      let errorOutput = "";
      child.stdout.setEncoding("utf8");
      child.stdout.on("data", (chunk: string) => {
        output += chunk;
      });
      child.stderr.setEncoding("utf8");
      child.stderr.on("data", (chunk: string) => {
        errorOutput += chunk;
      });
      child.once("error", (error: NodeJS.ErrnoException) => {
        failed = true;
        missing = error.code === "ENOENT";
      });
      child.once("close", (code) => {
        // gh api reports HTTP failures on stderr; exit code 1 alone also
        // covers network failures. Never expose or attach either output.
        const reason =
          args[0] === "api"
            ? githubFailureReason(code, errorOutput, failed)
            : undefined;
        if (writeFailure && /\(HTTP (409|422)\)/u.test(errorOutput)) {
          try {
            const body = JSON.parse(output) as {
              message?: unknown;
              errors?: unknown;
            };
            const messages = [
              body.message,
              ...(Array.isArray(body.errors)
                ? body.errors.map(
                    (entry: { message?: unknown }) => entry?.message,
                  )
                : []),
            ].filter(
              (value): value is string =>
                typeof value === "string" && !!value.trim(),
            );
            let message = messages.join("\n").slice(0, 1000);
            if (env.GH_TOKEN)
              message = message.replaceAll(env.GH_TOKEN, "[redacted]");
            if (message) {
              reject(new GhWriteFailure(message));
              return;
            }
          } catch {
            /* Preserve the usual failure classification. */
          }
        }
        if (
          args[0] === "api" &&
          githubReadFailure(code, errorOutput, failed) === "unreadable"
        )
          reject(new GhRepositoryUnreadable(missing, reason));
        else if (code !== 0 && /^unknown flag: /mu.test(errorOutput))
          reject(new GhUnknownFlag(missing, reason));
        else if (failed || code !== 0)
          reject(new GhUnavailable(missing, reason));
        else resolve(output);
      });
    });
  });
  ghQueue = request.catch(() => undefined);
  return request;
}

// Keep each Host's facts for its own lifetime, including an unsupported list
// command. Explicit settings reads and exhaustion refresh this cache.
const accountLists = new WeakMap<HostStore, Promise<GitHubAccounts>>();
export function githubAccounts(
  store: HostStore,
  refresh = false,
): Promise<GitHubAccounts> {
  let accounts = accountLists.get(store);
  if (!accounts || refresh) {
    accounts = readAccounts();
    accountLists.set(store, accounts);
  }
  return accounts;
}

async function readAccounts(): Promise<GitHubAccounts> {
  try {
    // Select only account facts in gh itself; never ask it to show a token.
    const output = await command([
      "auth",
      "status",
      "--hostname",
      "github.com",
      "--json",
      "hosts",
      "--jq",
      '(.hosts["github.com"] // []) | map({login,active,state})',
    ]);
    const accounts = array(JSON.parse(output)).map((value) => {
      const account = object(value);
      if (
        typeof account.login !== "string" ||
        typeof account.active !== "boolean"
      )
        throw new GhUnavailable();
      return {
        login: account.login,
        active: account.active,
        verified: account.state === "success",
      };
    });
    return {
      available: true,
      accounts: accounts.sort((a, b) => a.login.localeCompare(b.login)),
    };
  } catch (error) {
    if (error instanceof GhUnavailable && error.missing)
      return { available: false, accounts: [] };
    throw new GhUnavailable();
  }
}

export async function accountEnvironment(
  account?: string,
  signal?: AbortSignal,
): Promise<NodeJS.ProcessEnv> {
  if (!account) return process.env;
  try {
    const token = (
      await command(
        ["auth", "token", "--hostname", "github.com", "--user", account],
        signal,
      )
    ).trim();
    if (!token) throw new GhTokenUnavailable();
    // The token exists only in memory and this gh child's environment.
    return { ...process.env, GH_TOKEN: token };
  } catch {
    signal?.throwIfAborted();
    throw new GhTokenUnavailable();
  }
}

export async function githubPages(
  endpoint: string,
  env = process.env,
  signal?: AbortSignal,
): Promise<unknown[]> {
  try {
    return array(
      JSON.parse(
        await command(
          [
            "api",
            "--hostname",
            "github.com",
            "--paginate",
            "--slurp",
            endpoint,
          ],
          signal,
          env,
        ),
      ),
    );
  } catch (error) {
    if (error instanceof GhRepositoryUnreadable) throw error;
    throw new GhUnavailable(
      false,
      error instanceof GhUnavailable ? error.reason : undefined,
    );
  }
}

/**
 * One response as text, as a job's log. gh 2.97 and later refuse its colors
 * without --allow-escape-sequences; older gh pass them and do not know the
 * flag, so its refusal, not a version string, decides to read without it.
 */
export async function githubText(
  endpoint: string,
  env = process.env,
  signal?: AbortSignal,
): Promise<string> {
  const read = (flags: string[]) =>
    command(
      ["api", "--hostname", "github.com", ...flags, endpoint],
      signal,
      env,
    );
  try {
    try {
      return await read(["--allow-escape-sequences"]);
    } catch (error) {
      if (!(error instanceof GhUnknownFlag)) throw error;
      return await read([]);
    }
  } catch (error) {
    if (error instanceof GhRepositoryUnreadable) throw error;
    throw new GhUnavailable(
      false,
      error instanceof GhUnavailable ? error.reason : undefined,
    );
  }
}

export const github: ForgeAdapter = {
  id: "github",
  label: "GitHub",
  async detect(origin) {
    return origin === "https://github.com";
  },
  checkUrl: ({ origin, owner, repo, sha }) =>
    `${origin}/${owner}/${repo}/commit/${sha}/checks`,
  readChecks,
  readPullRequest,
  readCi: readGitHubCi,
  readCiLog: readGitHubCiLog,
  forRepository(store, mainPath, onSettingsChange) {
    return {
      ...github,
      readStatus: (target, signal) =>
        readRepositoryStatus(target, store, mainPath, onSettingsChange, signal),
    };
  },
};

/**
 * Reads a repository with its GitHub account (settings.md「GitHubのアカウント」):
 * the one chosen in its Git settings, or else this Host's gh accounts in turn —
 * the owner's, the one that read it last, the active one, then the rest —
 * until one can read it. The marks, Issues and CI all choose it this way.
 */
export async function withGitHubAccount<T>(
  { store, mainPath }: ForgeRepository,
  owner: string,
  read: (env: NodeJS.ProcessEnv) => Promise<T>,
  signal?: AbortSignal,
  /** Keeps the account found without a choice; "" when none can read. */
  remember?: (account: string) => void,
): Promise<T> {
  const selected = store.repositoryGitAccount(mainPath);
  const remembered = store.repositoryGitAutoAccount(mainPath);
  const listing = await githubAccounts(store).catch(() => undefined);
  const active = listing?.accounts.find((account) => account.active)?.login;
  const find = (name: string) =>
    listing?.accounts.find(
      (account) => account.login.toLowerCase() === name.toLowerCase(),
    )?.login;
  const candidates: (string | undefined)[] = selected
    ? [selected]
    : !listing
      ? [undefined]
      : [
          ...new Set(
            [
              find(owner),
              find(remembered),
              active,
              ...listing.accounts.map((account) => account.login),
            ].filter((login): login is string => login !== undefined),
          ),
        ];
  let tokenUnavailable = false;
  const refusals: (ForgeFailureReason | undefined)[] = [];
  for (const account of candidates) {
    try {
      const env = await accountEnvironment(
        account === active ? undefined : account,
        signal,
      );
      const value = await read(env);
      signal?.throwIfAborted();
      if (!selected) remember?.(account ?? "");
      return value;
    } catch (error) {
      signal?.throwIfAborted();
      if (error instanceof GhTokenUnavailable) {
        tokenUnavailable = true;
        continue;
      }
      if (!(error instanceof GhRepositoryUnreadable)) throw error;
      refusals.push(error.reason);
    }
  }
  if (candidates.length)
    await githubAccounts(store, true).catch(() => undefined);
  // A missing token leaves access unknown; do not erase the remembered account
  // or the Watcher's last marks merely because it could not be tried.
  if (tokenUnavailable)
    throw new GhUnavailable(listing?.available === false, "token-missing");
  if (!selected) remember?.("");
  // No account is no gh login. GitHub answers 404 for a private repository an
  // account cannot see, so a refusal means no account can read it, unless
  // every account's sign-in was refused.
  throw new GhRepositoryUnreadable(
    listing?.available === false,
    !refusals.length
      ? "token-missing"
      : refusals.every((reason) => reason === "token-invalid")
        ? "token-invalid"
        : "insufficient-scope",
  );
}

async function readRepositoryStatus(
  target: ForgeTarget,
  store: HostStore,
  mainPath: string,
  onSettingsChange: () => void,
  signal?: AbortSignal,
): Promise<ForgeStatus> {
  const remember = (account: string) => {
    signal?.throwIfAborted();
    if (store.repositoryGitAutoAccount(mainPath) === account) return;
    store.saveRepositoryGitAutoAccount(mainPath, account);
    onSettingsChange();
  };
  try {
    return await withGitHubAccount(
      { store, mainPath },
      target.owner,
      // Read all marks with one account before remembering it or trying another.
      async (env) => {
        const pullRequest = await readPullRequest(target, signal, env);
        // The repository read: a 404 of the commit's results means it has none.
        const checks = await readChecks(target, signal, env).catch(
          (error: unknown) => {
            if (error instanceof GhRepositoryUnreadable) return undefined;
            throw error;
          },
        );
        return { checks, pullRequest };
      },
      signal,
      remember,
    );
  } catch (error) {
    // No account can read the repository: it has no marks.
    if (error instanceof GhRepositoryUnreadable) return {};
    throw error;
  }
}

async function readChecks(
  target: ForgeTarget,
  signal?: AbortSignal,
  env = process.env,
) {
  const { origin, owner, repo, sha } = target;
  const commit = `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/commits/${encodeURIComponent(sha)}`;
  const runs = await githubPages(
    `${commit}/check-runs?per_page=100`,
    env,
    signal,
  );
  const statuses = await githubPages(
    `${commit}/status?per_page=100`,
    env,
    signal,
  );
  const runChecks = checkRuns(
    origin,
    runs.flatMap((page) => array(object(page).check_runs)),
  );
  const statusChecks = commitChecks(
    origin,
    statuses.flatMap((page) => array(object(page).statuses)),
  );
  return checksStatus(
    origin,
    [...runChecks, ...statusChecks],
    github.checkUrl(target).slice(origin.length),
  );
}
async function readPullRequest(
  target: ForgeTarget,
  signal?: AbortSignal,
  env = process.env,
) {
  const { owner, repo, branch } = target;
  const pulls = await githubPages(
    `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/pulls?state=all&head=${encodeURIComponent(`${owner}:${branch}`)}&per_page=100`,
    env,
    signal,
  );
  return pullStatus(target, pulls.flatMap(array));
}
