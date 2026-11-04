import { execFileSync } from "node:child_process";
import {
  lstat,
  mkdir,
  rm,
  readdir,
  utimes,
  mkdtemp,
  copyFile,
} from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { file as verificationConfig } from "./local.mjs";

export async function createSourceArchive(repo, archive) {
  const listed = execFileSync(
    "git",
    ["ls-files", "--cached", "--others", "--exclude-standard", "-z"],
    { cwd: repo, maxBuffer: 64 * 1024 * 1024 },
  );
  const present = [];
  for (const file of listed.toString().split("\0").filter(Boolean)) {
    try {
      await lstat(path.join(repo, file));
      present.push(file);
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
    }
  }
  execFileSync("tar", ["--no-recursion", "--null", "-cf", archive, "-T", "-"], {
    cwd: repo,
    input: Buffer.from(present.join("\0") + "\0"),
    timeout: 120_000,
  });
  const staging = await mkdtemp(
    path.join(os.tmpdir(), "iori-verification-config-"),
  );
  try {
    await mkdir(path.join(staging, ".local"));
    await copyFile(
      verificationConfig,
      path.join(staging, ".local/verification.json"),
    );
    execFileSync("tar", [
      "-rf",
      archive,
      "-C",
      staging,
      ".local/verification.json",
    ]);
  } finally {
    await rm(staging, { recursive: true, force: true });
  }
}

// Refresh under the build's cache lock, not only at extraction: another
// worktree may have built into the shared target between those two entries.
// Include assets/configs watched by build.rs, but never dependencies or links.
export async function refreshSourceMtimes(source) {
  const now = new Date();
  const visit = async (directory) => {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const file = path.join(directory, entry.name);
      if (entry.isDirectory()) {
        if (!["node_modules", "target", ".git", ".local"].includes(entry.name))
          await visit(file);
      } else if (entry.isFile()) await utimes(file, now, now);
    }
  };
  await visit(source);
}

// Same source-only traversal for build.ps1; called after Set-Location while the
// Windows build entry holds Windows verification machine. Reparse points must not lead into caches.
export const windowsSourceMtimes =
  "$sourceTime=[DateTime]::UtcNow;function Update-SourceMtimes($directory){Get-ChildItem -LiteralPath $directory -Force | ForEach-Object {if(($_.Attributes -band [IO.FileAttributes]::ReparsePoint) -eq 0){if($_.PSIsContainer){if($_.Name -notin @('node_modules','target','.git','.local')){Update-SourceMtimes $_.FullName}}else{$_.LastWriteTimeUtc=$sourceTime}}}};Update-SourceMtimes (Get-Location).Path;";

// Extraction itself also avoids importing the original worktree's old mtime.
export async function createSourceCopy(repo, destination) {
  await mkdir(destination, { recursive: true });
  const archive = path.join(destination, "source.tar");
  try {
    await createSourceArchive(repo, archive);
    execFileSync("tar", ["-mxf", archive, "-C", destination], {
      timeout: 120_000,
    });
  } finally {
    await rm(archive, { force: true });
  }
}
