import type { ForgeStatus } from "@iori/protocol";
import type { ForgeAdapter } from "./forge/types.ts";
import type { ForgeTarget } from "./forge/response.ts";
export { readPushTarget } from "./forge-remote.ts";

export async function readForgeStatus(
  target: ForgeTarget,
  adapter: ForgeAdapter,
  signal?: AbortSignal,
): Promise<ForgeStatus> {
  if (adapter.readStatus) return adapter.readStatus(target, signal);
  const [checks, pullRequest] = await Promise.all([
    adapter.readChecks(target, signal),
    adapter.readPullRequest(target, signal),
  ]);
  return { checks, pullRequest };
}
