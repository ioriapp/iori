import { execFileSync } from "node:child_process";
import { constants } from "node:fs";
import { access, chmod, mkdir, symlink, writeFile } from "node:fs/promises";
import { delimiter, dirname, join } from "node:path";

export const quoteShellWord = (word) =>
  process.platform === "win32"
    ? `"${word}"`
    : `'${word.replaceAll("'", "'\\''")}'`;

export const ioriCommand = (binDir) =>
  join(binDir, process.platform === "win32" ? "iori.exe" : "iori");

export async function writeFakeCli(binDir, name, scriptBody) {
  if (process.platform === "win32") {
    const script = join(binDir, `${name}.mjs`);
    await writeFile(script, scriptBody);
    await writeFile(
      join(binDir, `${name}.cmd`),
      `@echo off\r\n"${process.execPath}" "${script}" %*\r\n`,
    );
    return;
  }
  const executablePath = join(binDir, name);
  await writeFile(executablePath, `#!/usr/bin/env node\n${scriptBody}`);
  await chmod(executablePath, 0o755);
}

export async function linkGit(binDir) {
  if (process.platform === "win32") {
    const found = execFileSync("where.exe", ["git"], { encoding: "utf8" })
      .split(/\r?\n/u)
      .map((line) => line.trim())
      .find(Boolean);
    if (!found) throw new Error("git.exe が見つかりません");
    await symlink(found, join(binDir, "git.exe"));
    return;
  }
  const found = execFileSync("which", ["git"], { encoding: "utf8" }).trim();
  await symlink(found, join(binDir, "git"));
}

async function executable(name) {
  for (const directory of (process.env.PATH ?? "").split(delimiter)) {
    const path = join(directory.replace(/^"|"$/gu, ""), name);
    try {
      await access(
        path,
        process.platform === "win32" ? constants.F_OK : constants.X_OK,
      );
      return path;
    } catch (error) {
      if (!["ENOENT", "EACCES"].includes(error.code)) throw error;
    }
  }
}

/** Only real shells, Node and lifecycle tools are discoverable, regardless of installed agents. */
export async function prepareHostEnvironment(dataRoot) {
  const home = join(dataRoot, "home");
  const bin = join(dataRoot, "bin");
  await mkdir(home);
  await mkdir(bin);
  const isWindows = process.platform === "win32";
  await symlink(process.execPath, join(bin, isWindows ? "node.exe" : "node"));
  const config = join(home, ".config");
  if (isWindows) {
    const systemRoot = process.env.SystemRoot ?? "C:\\Windows";
    const system32 = join(systemRoot, "System32");
    const pwsh = await executable("pwsh.exe");
    const pathEntries = [
      bin,
      ...(pwsh ? [dirname(pwsh)] : []),
      join(system32, "WindowsPowerShell", "v1.0"),
      system32,
      systemRoot,
    ];
    return {
      HOME: home,
      USERPROFILE: home,
      APPDATA: join(home, "AppData", "Roaming"),
      LOCALAPPDATA: dataRoot,
      PATH: pathEntries.join(delimiter),
      XDG_DATA_HOME: dataRoot,
      XDG_CONFIG_HOME: config,
      XDG_CACHE_HOME: join(home, ".cache"),
      XDG_STATE_HOME: join(home, ".local", "state"),
    };
  }
  for (const name of [
    "bash",
    "zsh",
    "fish",
    "sh",
    "dash",
    "systemctl",
    "systemd-run",
  ]) {
    const path = await executable(name);
    if (path) await symlink(path, join(bin, name));
  }
  // Login shells read /etc/profile, which can replace PATH. Their normal user
  // profiles put the isolated path back before Host resolves CLI commands.
  const profile = `export PATH='${bin.replaceAll("'", "'\\''")}'\n`;
  for (const name of [
    ".profile",
    ".bash_profile",
    ".bashrc",
    ".zshenv",
    ".zprofile",
    ".zshrc",
  ])
    await writeFile(join(home, name), profile);
  await mkdir(join(config, "fish"), { recursive: true });
  await writeFile(
    join(config, "fish", "config.fish"),
    `set -gx PATH '${bin}'\n`,
  );
  return {
    HOME: home,
    PATH: bin,
    XDG_DATA_HOME: dataRoot,
    XDG_CONFIG_HOME: config,
    XDG_CACHE_HOME: join(home, ".cache"),
    XDG_STATE_HOME: join(home, ".local", "state"),
  };
}
