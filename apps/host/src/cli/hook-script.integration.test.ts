import { test } from "node:test";
import assert from "node:assert/strict";
import {
  mkdtemp,
  readFile,
  rm,
  mkdir,
  symlink,
  lstat,
  stat,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawn } from "node:child_process";
import { hookInstallContext, removeCliHooks } from "./hook-install.ts";
import { hooks as antigravity } from "./antigravity/hooks.ts";
import { hooks as cursor } from "./cursor/hooks.ts";
import { hooks as claude } from "./claude/hooks.ts";

// These CLIs are absent from the E2E environment. Exercise their real installed
// commands outside iori, with stdin deliberately left open: replies are required
// before any environment check or payload read. POSIX then drains a large
// payload to EOF, while Windows is allowed to exit without consuming stdin.
test("ioriの外のhookで応答欠落・大きい入力のEPIPE・撤去後の設定残存がない", async () => {
  const home = await mkdtemp(join(tmpdir(), "iori-hook-contract-"));
  const original = process.env.HOME;
  process.env.HOME = home;
  try {
    const shell = {
      id: "bash",
      label: "Bash",
      executable: "/bin/bash",
      args: [],
    };
    const agyContext = await hookInstallContext(shell, "antigravity");
    const cursorContext = await hookInstallContext(shell, "cursor");
    await antigravity.install(agyContext);
    await cursor.install(cursorContext);
    const agy = JSON.parse(
      await readFile(join(home, ".gemini/config/hooks.json"), "utf8"),
    )["iori-status"];
    const cur = JSON.parse(
      await readFile(join(home, ".cursor/hooks.json"), "utf8"),
    ).hooks;
    for (const [command, expected] of [
      [agy.PreToolUse[0].hooks[0].command, { decision: "ask" }],
      [agy.Stop[0].command, { decision: "" }],
      [agy.PostInvocation[0].command, {}],
      [cur.beforeSubmitPrompt[0].command, { continue: true }],
      [cur.stop[0].command, {}],
    ]) {
      const child = spawn("/bin/sh", ["-c", command], {
        env: { ...process.env, IORI_CLI_HOOK_URL: "" },
        stdio: ["pipe", "pipe", "ignore"],
      });
      let output = "";
      const closed = new Promise((resolve, reject) => {
        child.once("error", reject);
        child.once("close", resolve);
      });
      const reply = new Promise<void>((resolve) => {
        child.stdout.on("data", (chunk) => {
          output += chunk;
          if (output.includes("\n")) resolve();
        });
      });
      const drained = new Promise<void>((resolve, reject) => {
        child.stdin.once("error", reject);
        void reply.then(() => {
          if (process.platform === "win32") resolve();
          else
            child.stdin.end(
              JSON.stringify({ tool_response: "x".repeat(900_000) }),
              resolve,
            );
        });
      });
      await drained;
      const code = await closed;
      assert.equal(code, 0);
      assert.deepEqual(JSON.parse(output), expected);
      child.stdin.destroy();
    }
    await antigravity.remove(agyContext);
    await cursor.remove(cursorContext);
    for (const path of [".gemini/config/hooks.json", ".cursor/hooks.json"])
      await assert.rejects(readFile(join(home, path)), { code: "ENOENT" });
  } finally {
    if (original === undefined) delete process.env.HOME;
    else process.env.HOME = original;
    await rm(home, { recursive: true, force: true });
  }
});

// A browser scenario cannot exercise a user's dotfile symlink or deletion of
// config.toml during uninstall. Use the real installers and removal tool.
test("symlinkの設定と利用者のコメントを保ち、Codexの設定が無くても撤去を続ける", async () => {
  const home = await mkdtemp(join(tmpdir(), "iori-hook-files-"));
  const names = [
    "HOME",
    "CODEX_HOME",
    "CLAUDE_CONFIG_DIR",
    "PI_CODING_AGENT_DIR",
  ];
  const original = names.map((name) => process.env[name]);
  for (const name of names) delete process.env[name];
  process.env.HOME = home;
  try {
    const shell = {
      id: "bash",
      label: "Bash",
      executable: "/bin/bash",
      args: [],
    };
    const ctx = await hookInstallContext(shell, "claude");
    const cursorContext = await hookInstallContext(shell, "cursor");
    const path = join(home, ".claude/settings.json");
    const target = join(home, "dotfiles/claude-settings.json");
    await mkdir(join(home, ".claude"));
    await mkdir(join(home, "dotfiles"));
    await writeFile(target, JSON.stringify({ theme: "dark" }));
    await symlink(target, path);
    await claude.install(ctx);
    assert.equal((await lstat(path)).isSymbolicLink(), true);
    const installed = await stat(target);
    await claude.install(ctx);
    assert.equal((await stat(target)).mtimeMs, installed.mtimeMs);
    await cursor.install(cursorContext);
    const codex = join(home, ".codex");
    await mkdir(codex);
    const key = join(codex, "hooks.json") + ":Stop:0";
    await writeFile(
      join(codex, "iori-hook-trust.json"),
      JSON.stringify([{ key, hash: "iori-hash" }]),
    );
    const user =
      '# user comment\n[hooks.state."user-hook"]\ntrusted_hash = "user-hash"\n';
    await writeFile(
      join(codex, "config.toml"),
      user +
        `[hooks.state.${JSON.stringify(key)}]\n# retain this comment\ntrusted_hash = "iori-hash" # and this comment\n`,
    );
    await removeCliHooks(shell, home);
    assert.equal((await lstat(path)).isSymbolicLink(), true);
    assert.deepEqual(JSON.parse(await readFile(target, "utf8")), {
      theme: "dark",
    });
    assert.equal(
      await readFile(join(codex, "config.toml"), "utf8"),
      user + "# retain this comment\n# and this comment\n",
    );
    await assert.rejects(readFile(join(home, ".cursor/hooks.json")), {
      code: "ENOENT",
    });
    await cursor.install(cursorContext);
    await writeFile(
      join(codex, "iori-hook-trust.json"),
      JSON.stringify([{ key, hash: "iori-hash" }]),
    );
    await rm(join(codex, "config.toml"));
    await removeCliHooks(shell, home);
    await assert.rejects(readFile(join(codex, "iori-hook-trust.json")), {
      code: "ENOENT",
    });
    await assert.rejects(readFile(join(home, ".cursor/hooks.json")), {
      code: "ENOENT",
    });
  } finally {
    names.forEach((name, index) => {
      if (original[index] === undefined) delete process.env[name];
      else process.env[name] = original[index];
    });
    await rm(home, { recursive: true, force: true });
  }
});
