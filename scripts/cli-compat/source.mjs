export async function fetchMain(command, output, repo) {
  await command("git", ["fetch", "origin", "main"], repo);
  return output("git", ["rev-parse", "FETCH_HEAD"], repo);
}

export async function checkoutSource(command, repo, sha) {
  await command("git", ["checkout", "--detach", sha], repo);
}

export async function prepareDependencies(
  command,
  repo,
  { beforeNative } = {},
) {
  await command("pnpm", ["install", "--frozen-lockfile"], repo);
  await beforeNative?.();
  await command("pnpm", ["--filter", "@iori/host", "build:native"], repo);
}
