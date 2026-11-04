/** gh api's exit code alone also covers transport and process failures. */
export function githubReadFailure(
  code: number | null,
  stderr: string,
  launchFailed = false,
): "unreadable" | "rate-limit" | "unavailable" {
  if (launchFailed || code === null || code === 0) return "unavailable";
  const status =
    /^gh: (?:.*\(HTTP (401|403|404)\)|HTTP (401|403|404))\r?$/m.exec(stderr);
  if (!status) return "unavailable";
  if ((status[1] ?? status[2]) === "403" && /rate limit/i.test(stderr))
    return "rate-limit";
  return "unreadable";
}
