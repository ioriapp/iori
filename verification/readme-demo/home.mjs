import { mkdir, writeFile, readFile, open } from "node:fs/promises";
import { join } from "node:path";
import { homedir } from "node:os";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readClaudeToken } from "../cli/claude-token.mjs";

export async function ownerConfigHashes() {
  const result = {};
  for (const file of ["config.toml", "hooks.json", "AGENTS.md"]) {
    const value = await readFile(join(homedir(), ".codex", file)).catch(
      (error) => {
        if (error.code !== "ENOENT") throw error;
      },
    );
    result[file] = value
      ? createHash("sha256").update(value).digest("hex")
      : null;
  }
  return result;
}

export async function createHome(root) {
  const home = join(root, "home");
  const folder = join(home, "projects/acme-web");
  const bin = join(home, "bin");
  for (const name of [".claude", ".codex", "bin", ".tmp"])
    await mkdir(join(home, name), { recursive: true });
  // Resolve Volta's actual executable rather than a mise/Volta dispatch shim;
  // the recording wrapper deliberately changes HOME and PATH.
  const realCodex = execFileSync("volta", ["which", "codex"], {
    encoding: "utf8",
  }).trim();
  const sharedCodexHome = join(homedir(), ".codex");
  const auth = await open(join(sharedCodexHome, "auth.json"), "r+");
  await auth.close();
  const cliPath = `${bin}:${process.env.PATH}`;
  await writeFile(
    join(bin, "codex"),
    `#!/bin/sh\nexec '${process.execPath}' '${new URL("./codex.mjs", import.meta.url).pathname}' "$@"\n`,
    { mode: 0o755 },
  );
  await writeFile(
    join(home, ".profile"),
    `export PATH='${cliPath.replaceAll("'", "'\\''")}'\n`,
  );
  await writeFile(join(home, ".bash_profile"), '. "$HOME/.profile"\n');
  await writeFile(join(home, ".bashrc"), 'PS1="$ "\n');
  await writeFile(
    join(home, ".codex/config.toml"),
    "check_for_update_on_startup = false\n",
  );
  await writeFile(
    join(home, ".claude/.claude.json"),
    JSON.stringify({
      hasCompletedOnboarding: true,
      theme: "dark",
      projects: {},
    }),
  );
  await writeFile(
    join(home, ".claude/settings.json"),
    JSON.stringify({
      model: "claude-opus-5-5",
      theme: "dark",
      effortLevel: "medium",
      spinnerTipsEnabled: false,
      permissions: {
        defaultMode: "default",
        allow: ["Bash", "Read", "Write", "Edit"],
        deny: ["mcp__*"],
      },
    }),
  );
  return {
    home,
    folder,
    environment: {
      HOME: home,
      PATH: cliPath,
      CODEX_HOME: join(home, ".codex"),
      IORI_DEMO_SHARED_CODEX_HOME: sharedCodexHome,
      IORI_DEMO_CODEX_BIN: realCodex,
      CLAUDE_CONFIG_DIR: join(home, ".claude"),
      CLAUDE_CODE_OAUTH_TOKEN: await readClaudeToken(),
      CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: "1",
      XDG_CONFIG_HOME: join(home, ".config"),
      XDG_CACHE_HOME: join(home, ".cache"),
      XDG_STATE_HOME: join(home, ".local/state"),
      TMPDIR: join(home, ".tmp"),
      NODE_OPTIONS: `--import=${new URL("./hostname.mjs", import.meta.url).pathname}`,
      MISE_TRUSTED_CONFIG_PATHS: join(homedir(), ".config/mise"),
    },
    async trust(folders) {
      const file = join(home, ".claude/.claude.json");
      const settings = JSON.parse(await readFile(file, "utf8"));
      settings.projects = Object.fromEntries(
        folders.map((path) => [path, { hasTrustDialogAccepted: true }]),
      );
      await writeFile(file, JSON.stringify(settings));
    },
  };
}
