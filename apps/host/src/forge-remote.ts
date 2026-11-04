import type { ForgeTarget } from "./forge/response.ts";
import { collectGit } from "./git-process.ts";
export function parseRemoteUrl(remoteUrl: string) {
  let url: URL;
  try {
    // Support both URL and Git's scp-style SSH form, without invoking a shell.
    const scp = /^(?:[^/@:]+@)?([^/:]+):(.+)$/u.exec(remoteUrl);
    url = new URL(
      remoteUrl.includes("://")
        ? remoteUrl
        : scp
          ? `ssh://${scp[1]}/${scp[2]}`
          : remoteUrl,
    );
  } catch {
    return undefined;
  }
  if (!["https:", "http:", "ssh:", "git:"].includes(url.protocol))
    return undefined;
  url.hostname = url.hostname.toLowerCase();
  return {
    remoteHost: url.hostname,
    origin:
      url.protocol === "http:" || url.protocol === "https:"
        ? url.origin
        : `https://${url.hostname}`,
    parts: url.pathname
      .replace(/^\/+|\/+$/gu, "")
      .replace(/\.git$/u, "")
      .split("/"),
  };
}
async function git(path: string, args: string[], signal?: AbortSignal) {
  return (await collectGit(path, args, signal)).stdout.toString("utf8").trim();
}

export async function readPushTarget(
  path: string,
  signal?: AbortSignal,
): Promise<ForgeTarget | undefined> {
  // Git, rather than upstream/origin conventions, resolves triangular pushes.
  const branch = await git(
    path,
    ["symbolic-ref", "--quiet", "HEAD"],
    signal,
  ).catch(() => "");
  if (!branch) return undefined;
  const tracking = await git(
    path,
    ["rev-parse", "--symbolic-full-name", "@{push}"],
    signal,
  ).catch(() => "");
  if (!tracking) return undefined;
  const configuredRemote = (
    await git(
      path,
      ["for-each-ref", "--format=%(refname)%00%(push:remotename)", branch],
      signal,
    )
  )
    .split("\n")
    .map((line) => line.split("\0"))
    .find(([name]) => name === branch)?.[1];
  const remotes = configuredRemote
    ? [configuredRemote]
    : (await git(path, ["remote"], signal)).split("\n").filter(Boolean);
  const candidates: { remote: string; ref: string }[] = [];
  for (const remote of remotes) {
    const result = await collectGit(
      path,
      ["config", "--get-all", `remote.${remote}.fetch`],
      signal,
      [0, 1],
    );
    for (const spec of result.stdout.toString("utf8").trim().split("\n")) {
      // Invert Git's fetch mapping; the tracking ref's spelling is not a branch name.
      const mapping = spec.replace(/^\+/u, "").split(":");
      const [source, destination] = mapping;
      if (!source || !destination || source.startsWith("^")) continue;
      let ref: string | undefined;
      const wildcard = destination.indexOf("*");
      if (wildcard < 0) {
        if (destination === tracking) ref = source;
      } else {
        const prefix = destination.slice(0, wildcard);
        const suffix = destination.slice(wildcard + 1);
        if (
          tracking.startsWith(prefix) &&
          tracking.endsWith(suffix) &&
          tracking.length >= prefix.length + suffix.length
        )
          ref = source.replace(
            "*",
            tracking.slice(prefix.length, suffix ? -suffix.length : undefined),
          );
      }
      if (
        ref?.startsWith("refs/heads/") &&
        !candidates.some(
          (candidate) => candidate.remote === remote && candidate.ref === ref,
        )
      )
        candidates.push({ remote, ref });
    }
  }
  if (candidates.length !== 1) return undefined;
  const { remote, ref } = candidates[0]!;
  const sha = await git(
    path,
    ["rev-parse", "--verify", `${tracking}^{commit}`],
    signal,
  ).catch(() => "");
  if (!sha) return undefined;
  const remoteUrl = await git(
    path,
    ["remote", "get-url", "--push", remote],
    signal,
  );
  const location = parseRemoteUrl(remoteUrl);
  if (
    !location ||
    location.parts.length !== 2 ||
    location.parts.some((part) => !part)
  )
    return undefined;
  const { remoteHost, origin, parts } = location;
  return {
    remoteHost,
    origin,
    owner: parts[0]!,
    repo: parts[1]!,
    branch: ref.slice("refs/heads/".length),
    sha,
  };
}

export async function readRemoteUrls(path: string) {
  const names = (await git(path, ["remote"])).split("\n").filter(Boolean);
  const result: { name: string; url: string }[] = [];
  for (const name of names) {
    const urls = await Promise.all([
      git(path, ["remote", "get-url", "--all", name]),
      git(path, ["remote", "get-url", "--push", "--all", name]),
    ]);
    for (const url of new Set(
      urls.flatMap((value) => value.split("\n").filter(Boolean)),
    )) {
      result.push({ name, url });
    }
  }
  return result;
}
