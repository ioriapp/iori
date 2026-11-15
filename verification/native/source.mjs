import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  lstat,
  mkdir,
  rm,
  readdir,
  readFile,
  readlink,
  utimes,
  mkdtemp,
  copyFile,
} from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { file as verificationConfig } from "./local.mjs";

export async function listSourceFiles(repo) {
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
  return present;
}

async function hashEntry(fullPath) {
  const stat = await lstat(fullPath);
  const hash = createHash("sha256");
  if (stat.isSymbolicLink()) {
    hash.update("symlink:");
    hash.update(await readlink(fullPath));
  } else {
    hash.update("file:");
    hash.update(await readFile(fullPath));
  }
  return hash.digest("hex");
}

export async function hashSourceFiles(repo, files = undefined) {
  const list = files ?? (await listSourceFiles(repo));
  const hashes = {};
  for (const file of list) {
    hashes[file] = await hashEntry(path.join(repo, file));
  }
  hashes[".local/verification.json"] = await hashEntry(verificationConfig);
  return hashes;
}

export async function createSourceArchive(repo, archive, files = undefined) {
  const requested = files ?? (await listSourceFiles(repo));
  const includeConfig =
    files === undefined || requested.includes(".local/verification.json");
  const repoFiles = requested.filter(
    (file) => file !== ".local/verification.json",
  );
  if (repoFiles.length > 0) {
    execFileSync(
      "tar",
      ["--no-recursion", "--null", "-cf", archive, "-T", "-"],
      {
        cwd: repo,
        input: Buffer.from(repoFiles.join("\0") + "\0"),
        timeout: 120_000,
      },
    );
  }
  if (!includeConfig) return;
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
      repoFiles.length > 0 ? "-rf" : "-cf",
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
