import type { RepositoryGitSettings } from "@iori/protocol";
import type { HostStore } from "./store.ts";
import type { ForgeDetection } from "./forge/adapters.ts";
import { discoverRepository } from "./git-reading.ts";
import { inventory } from "./worktree-creation.ts";
import { parseRemoteUrl, readRemoteUrls } from "./forge-remote.ts";
import { realpath } from "node:fs/promises";

/** Use the same absolute path / real Git discovery boundary as git.* reads. */
export async function repositoryMainPath(path: string): Promise<string> {
  const repository = await discoverRepository(path);
  const main = (await inventory(repository.root))[0];
  if (!main) throw new Error("Repository unavailable");
  return realpath(main.path);
}

export function displayRemoteUrl(value: string): string {
  try {
    const url = new URL(value);
    // An SSH address needs its user name (ssh://git@host/...) and that name
    // is not a secret. In every other scheme the user name may be a token.
    const ssh = ["ssh:", "git+ssh:", "ssh+git:"].includes(url.protocol);
    const web = url.protocol === "http:" || url.protocol === "https:";
    if (!web && !url.password && (ssh || !url.username)) return value;
    if (!ssh) url.username = "";
    url.password = "";
    return url.href;
  } catch {
    /* Git also accepts scp-style and local paths. */
  }
  return value;
}

export async function repositoryGitSettings(
  path: string,
  store: HostStore,
  detection: ForgeDetection,
): Promise<RepositoryGitSettings> {
  const mainPath = await repositoryMainPath(path);
  const rawRemotes = await readRemoteUrls(mainPath);
  const otherPaths = [
    ...new Set(
      store
        .folderHistory()
        .filter(
          (folder) =>
            folder.kind === "git" && folder.workspacePath !== mainPath,
        )
        .map((folder) => folder.workspacePath),
    ),
  ];
  const others = await Promise.all(
    otherPaths.map(async (path) => ({
      path,
      remotes: await readRemoteUrls(path).catch(() => []),
    })),
  );
  const remotes = await Promise.all(
    rawRemotes.map(async (remote) => {
      const location = parseRemoteUrl(remote.url);
      if (!location)
        return {
          ...remote,
          url: displayRemoteUrl(remote.url),
          sharedRepositories: [],
          detecting: false,
        };
      const mapping = store.forgeMapping(location.remoteHost)?.webUrl;
      const origin = mapping ?? location.origin;
      const { adapter, pending } = detection.forSettings(origin);
      return {
        ...remote,
        url: displayRemoteUrl(remote.url),
        remoteHost: location.remoteHost,
        webUrl: origin,
        forge: adapter ? { id: adapter.id, label: adapter.label } : undefined,
        detecting: pending,
        mapping,
        sharedRepositories: others
          .filter((other) =>
            other.remotes.some(
              (value) =>
                parseRemoteUrl(value.url)?.remoteHost === location.remoteHost,
            ),
          )
          .map((other) => other.path)
          .sort((a, b) => a.localeCompare(b)),
      };
    }),
  );
  return {
    mainPath,
    remotes: remotes.sort(
      (a, b) => a.name.localeCompare(b.name) || a.url.localeCompare(b.url),
    ),
    setupCommand: store.worktreeSetupCommand(mainPath),
    githubAccount: store.repositoryGitAccount(mainPath),
    githubAutoAccount: store.repositoryGitAutoAccount(mainPath),
  };
}
