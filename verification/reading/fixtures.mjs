// Dedicated native fixtures. No owner folder or existing repository is modified.
import { mkdir, rm, writeFile, symlink } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import path from "node:path";
import { pngBytes } from "./png.mjs";
const root = path.resolve(process.argv[2]);
await mkdir(root, { recursive: true });
const git = (...args) =>
  execFileSync("git", args, { cwd: root, stdio: "pipe", timeout: 30_000 });
await mkdir(path.join(root, "many"));
for (let i = 0; i < 1200; i++)
  await writeFile(
    path.join(root, "many", `entry-${String(i).padStart(4, "0")}.txt`),
    `entry ${i}\n`,
  );
await mkdir(path.join(root, "inside"));
await writeFile(path.join(root, "inside", "linked.txt"), "inside target\n");
await writeFile(
  path.join(root, "large.txt"),
  "\uFEFF" +
    Array.from(
      { length: 100000 },
      (_, i) =>
        `line ${i + 1} ${i === 99999 ? "LAST_FILE_MARKER" : "text"}\r\n`,
    ).join(""),
);
await writeFile(
  path.join(root, "one-line.txt"),
  "LONG_LINE_START" +
    "界".repeat(1_500_000) +
    "LONG_LINE_END\r\nnext logical line\n",
);
await writeFile(
  path.join(root, "readme.md"),
  "# Reading\n\n[End](#last-heading)\n\n![Local](image.png)\n\n![External](https://example.invalid/never-fetch.png)\n\n<script>document.body.dataset.scriptRan='yes'</script>\n\n" +
    Array.from({ length: 1400 }, (_, i) => `Paragraph ${i + 1}.\n\n`).join("") +
    "## Last heading\n\nMARKDOWN_END\n",
);
// A 240x160 gradient PNG, so zooming changes the drawn size visibly.
await writeFile(path.join(root, "image.png"), pngBytes(240, 160));
await writeFile(path.join(root, "empty.txt"), "");
// A log the scenario keeps appending to while it is read.
await writeFile(
  path.join(root, "app.log"),
  Array.from(
    { length: 200000 },
    (_, i) => `log line ${i + 1} ${"x".repeat(80)}\n`,
  ).join(""),
);
await mkdir(path.join(root, "tracked-dir"));
await writeFile(path.join(root, "tracked-dir", "a.txt"), "tracked\n");
await writeFile(
  path.join(root, "binary.bin"),
  Buffer.from([0, 1, 2, 3, 0, 255]),
);
await writeFile(
  path.join(root, "diff.txt"),
  Array.from({ length: 8000 }, (_, i) => `original ${i + 1}\n`).join(""),
);
await writeFile(path.join(root, "long-diff.txt"), "old long diff line\n");
await writeFile(path.join(root, "conflict.txt"), "common ancestor\n");
await writeFile(
  path.join(root, "context.txt"),
  Array.from({ length: 1000 }, (_, i) => `context line ${i + 1}\n`).join(""),
);
git("init", "--initial-branch=main");
git(
  "-c",
  "user.name=Reading verification",
  "-c",
  "user.email=reading@example.invalid",
  "add",
  ".",
);
git(
  "-c",
  "user.name=Reading verification",
  "-c",
  "user.email=reading@example.invalid",
  "commit",
  "-m",
  "Initial reading fixtures\n\nFull commit message detail",
);
// A linked worktree, as iori makes for each Agent.
const worktree = root + "-wt";
git("worktree", "add", "-b", "reading-wt", worktree);
git("branch", "reading-conflict-side");
git("checkout", "reading-conflict-side");
await writeFile(path.join(root, "conflict.txt"), "theirs version\n");
git("add", "conflict.txt");
git(
  "-c",
  "user.name=Reading verification",
  "-c",
  "user.email=reading@example.invalid",
  "commit",
  "-m",
  "Conflict side",
);
git("checkout", "main");
await writeFile(path.join(root, "conflict.txt"), "ours version\n");
git("add", "conflict.txt");
git(
  "-c",
  "user.name=Reading verification",
  "-c",
  "user.email=reading@example.invalid",
  "commit",
  "-m",
  "Conflict main",
);
try {
  git(
    "-c",
    "user.name=Reading verification",
    "-c",
    "user.email=reading@example.invalid",
    "merge",
    "--no-edit",
    "reading-conflict-side",
  );
  throw new Error("Expected a real three-stage merge conflict");
} catch (error) {
  if (error.status !== 1) throw error;
}
git("mv", "many/entry-0001.txt", "many/entry 0001.txt");
await writeFile(path.join(root, "staged.txt"), "staged addition\n");
git("add", "staged.txt");
await writeFile(
  path.join(root, "diff.txt"),
  Array.from(
    { length: 8000 },
    (_, i) => `changed ${i + 1} ${i === 7999 ? "LAST_DIFF_MARKER" : ""}\n`,
  ).join(""),
);
await writeFile(
  path.join(root, "long-diff.txt"),
  Array.from({ length: 5 }, () => "x".repeat(40_000) + "NEEDLE").join("x") +
    "\n",
);
await writeFile(path.join(root, "untracked.txt"), "untracked content\n");
await writeFile(
  path.join(root, "context.txt"),
  Array.from(
    { length: 1000 },
    (_, i) =>
      `${i === 79 || i === 899 ? "changed" : "context"} line ${i + 1}\n`,
  ).join(""),
);
const outside = root + "-outside";
await mkdir(outside);
await writeFile(path.join(outside, "secret.txt"), "MUST_NOT_READ_OUTSIDE\n");
await symlink(
  path.join(root, "inside"),
  path.join(root, "inside-link"),
  process.platform === "win32" ? "junction" : "dir",
);
await symlink(
  outside,
  path.join(root, "outside-link"),
  process.platform === "win32" ? "junction" : "dir",
);
// A tracked folder replaced by a link to the outside folder.
await rm(path.join(root, "tracked-dir"), { recursive: true });
await symlink(
  outside,
  path.join(root, "tracked-dir"),
  process.platform === "win32" ? "junction" : "dir",
);
// A repository with many folders and changes, for the Git list.
const bulk = root + "-bulk";
await mkdir(bulk);
const bulkGit = (...args) =>
  execFileSync("git", args, { cwd: bulk, stdio: "pipe", timeout: 60_000 });
bulkGit("init", "--initial-branch=main");
for (let d = 0; d < 400; d++) {
  await mkdir(path.join(bulk, `dir${d}`));
  for (let f = 0; f < 3; f++)
    await writeFile(
      path.join(bulk, `dir${d}`, `file${f}.txt`),
      `content ${d} ${f}\n`,
    );
}
bulkGit("add", ".");
bulkGit(
  "-c",
  "user.name=Reading verification",
  "-c",
  "user.email=reading@example.invalid",
  "commit",
  "-qm",
  "bulk",
);
for (let d = 0; d < 200; d++)
  await writeFile(path.join(bulk, `dir${d}`, "file0.txt"), `changed ${d}\n`);
console.log(
  JSON.stringify({
    root,
    worktree,
    bulk,
    entries: 1200,
    lines: 100000,
    diffLines: 8000,
    longLineBytes: 4500013,
  }),
);
