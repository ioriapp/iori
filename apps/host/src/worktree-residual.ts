import { lstat, rm } from "node:fs/promises";

async function exists(path: string): Promise<boolean> {
  try {
    await lstat(path);
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;
    throw error;
  }
}

/**
 * Deletes whatever remains at a worktree path after Git removed the
 * worktree. The caller must already have verified that the path is the
 * intended worktree (for example with checkChildWorktreeRemoval); this
 * only deletes at that exact path. Node's rm deletes a symlink itself rather
 * than following it out of the worktree.
 * Throws with the path when anything remains.
 */
export async function removeRemainingWorktreeFolder(
  path: string,
): Promise<void> {
  const stat = await lstat(path).catch((error: unknown) => {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw error;
  });
  if (!stat) return;
  try {
    await rm(path, { recursive: true, force: true });
  } catch {
    // Report the remaining path below instead of the low-level cause.
  }
  if (await exists(path))
    throw new Error(`Could not delete the remaining worktree folder: ${path}`);
}
