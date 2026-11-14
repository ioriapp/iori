export function parseGitWorktrees(output: string): Array<{
  path: string;
  branch?: string;
  detached: boolean;
  bare: boolean;
}> {
  const worktrees: Array<{
    path: string;
    branch?: string;
    detached: boolean;
    bare: boolean;
  }> = [];
  let entry: {
    path?: string;
    branch?: string;
    detached: boolean;
    bare: boolean;
  } = { detached: false, bare: false };

  const finish = () => {
    if (entry.path) {
      worktrees.push({
        path: entry.path,
        ...(entry.branch === undefined ? {} : { branch: entry.branch }),
        detached: entry.detached,
        bare: entry.bare,
      });
    }
    entry = { detached: false, bare: false };
  };

  for (const field of output.split("\0")) {
    if (field === "") {
      finish();
    } else if (field.startsWith("worktree ")) {
      entry.path = field.slice("worktree ".length);
    } else if (field.startsWith("branch refs/heads/")) {
      entry.branch = field.slice("branch refs/heads/".length);
    } else if (field === "detached") {
      entry.detached = true;
    } else if (field === "bare") {
      entry.bare = true;
    }
  }
  finish();
  return worktrees;
}
