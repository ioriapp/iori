import { rename } from "node:fs/promises";
import { randomUUID } from "node:crypto";

/** Refuse before Git starts removing files if Windows cannot move the directory. */
export async function checkWindowsWorktreeRemoval(path: string): Promise<void> {
  const temporary = `${path}.iori-removal-${randomUUID()}`;
  try {
    await rename(path, temporary);
  } catch {
    throw new Error(
      "A program has files open in this worktree. Close it and retry deleting the worktree.",
    );
  }
  await rename(temporary, path);
}
