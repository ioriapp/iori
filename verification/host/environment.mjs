import { constants } from "node:fs";
import { access, mkdir, symlink, writeFile } from "node:fs/promises";
import { delimiter, join } from "node:path";

async function executable(name) {
  for (const directory of (process.env.PATH ?? "").split(delimiter)) {
    const path = join(directory, name);
    try {
      await access(path, constants.X_OK);
      return path;
    } catch (error) {
      if (!["ENOENT", "EACCES"].includes(error.code)) throw error;
    }
  }
}

/** Only real shells and Node are discoverable, regardless of installed agents. */
export async function prepareHostEnvironment(dataRoot) {
  const home = join(dataRoot, "home");
  const bin = join(dataRoot, "bin");
  await mkdir(home);
  await mkdir(bin);
  await symlink(process.execPath, join(bin, "node"));
  for (const name of ["bash", "zsh", "fish", "sh", "dash"]) {
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
  const config = join(home, ".config");
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
