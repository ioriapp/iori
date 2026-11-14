import {
  mkdir,
  readFile,
  writeFile,
  rm,
  readdir,
  symlink,
  rename,
  open,
  realpath,
} from "node:fs/promises";
import { join } from "node:path";
import { homedir } from "node:os";
import { spawnSync } from "node:child_process";
import { setTimeout } from "node:timers/promises";
import assert from "node:assert/strict";
import { trustHooks } from "../../apps/host/src/cli/codex/hook-trust.ts";
import { verificationHostEnvironment } from "./environment.mjs";
import { readClaudeToken, setClaudeToken } from "./claude-token.mjs";

/** Pi uses its default folder inside the runner's isolated CLI home. */
export const piAgentDirectory = (home = homedir()) =>
  join(home, ".pi", "agent");

/** CLI app-server children can survive their PTY; only this isolated HOME is
 * owned by the run. Stop them before removing the isolated CLI settings. */
export async function stopCliProcesses(home) {
  const pids = [];
  for (const entry of await readdir("/proc")) {
    if (!/^\d+$/.test(entry) || Number(entry) === process.pid) continue;
    try {
      const env = (await readFile(`/proc/${entry}/environ`, "utf8")).split(
        "\0",
      );
      if (!env.includes(`HOME=${home}`)) continue;
      process.kill(Number(entry), "SIGTERM");
      pids.push(entry);
    } catch (error) {
      if (!["ENOENT", "ESRCH", "EACCES"].includes(error.code)) throw error;
    }
  }
  for (const pid of pids) {
    for (;;) {
      try {
        const status = await readFile(`/proc/${pid}/status`, "utf8");
        if (/^State:\s+Z/m.test(status)) break;
      } catch (error) {
        if (!["ENOENT", "ESRCH"].includes(error.code)) throw error;
        break;
      }
      await setTimeout(200);
    }
  }
}

/** Separate CLI home, with explicit low-cost model choices only in verification.
 * Codex, Pi and OpenCode auth links refer to the CLI's own file: no copied refresh tokens
 * or write-back. Claude Code replaces its credential file with a rename, so it
 * runs on the verification token instead (see claude-token.mjs). */
export async function prepareCliHome(
  root,
  {
    clis = [],
    codexDefaults = false,
    fakeModel,
    fakeModelClis = [],
    fakeModelCodexAccount = false,
    isolatedAuth = false,
    claudeVerificationToken = false,
    teamCommands = false,
    respondToBashCommands,
    claudeTheme,
    repositories = [join(root, "repository")],
    // Written before any Claude Code runs; a worktree follows its repository.
    trustedFolders = teamCommands ? repositories : [],
  } = {},
) {
  // A verification Host must not forward the calling agent session into its CLI.
  for (const key of Object.keys(process.env))
    if (
      /^(?:CLAUDE_CODE_|CLAUDECODE$|CODEX_THREAD_ID$|CODEX_INTERNAL_ORIGINATOR_OVERRIDE$)/u.test(
        key,
      )
    )
      delete process.env[key];
  const environment = {
    ...(fakeModelClis.includes("claude")
      ? {
          ANTHROPIC_BASE_URL: fakeModel.baseURL,
          ANTHROPIC_AUTH_TOKEN: "verification",
        }
      : {}),
    ...(fakeModelClis.includes("codex")
      ? { IORI_FAKE_MODEL_KEY: "verification" }
      : {}),
  };
  const original = homedir();
  const home = join(root, "cli-home");
  await mkdir(home, { recursive: true });
  const versions = {};
  if (clis.includes("opencode")) {
    const result = spawnSync("opencode", ["--version"], {
      encoding: "utf8",
      env: {
        ...verificationHostEnvironment(),
        HOME: home,
        ...(isolatedAuth
          ? {
              CODEX_HOME: join(home, ".codex"),
              CLAUDE_CONFIG_DIR: join(home, ".claude"),
              XDG_DATA_HOME: join(home, ".local/share"),
              XDG_STATE_HOME: join(home, ".local/state"),
              XDG_CACHE_HOME: join(home, ".cache"),
              PI_CODING_AGENT_DIR: undefined,
              PI_CODING_AGENT_SESSION_DIR: undefined,
              XDG_CONFIG_HOME: join(home, ".config"),
            }
          : {}),
        XDG_CONFIG_HOME: join(home, ".config"),
        VOLTA_HOME: process.env.VOLTA_HOME ?? join(original, ".volta"),
      },
    });
    assert.equal(
      result.status,
      0,
      `opencode --version could not run (${result.error?.code ?? result.status})`,
    );
    versions.opencode = result.stdout.trim();
  }
  const opencodeV1 =
    clis.includes("opencode") &&
    Number(versions.opencode.match(/\bv?(\d+)\./u)?.[1]) < 2;
  // OAuth refresh belongs to the CLI's shared credentials. A restricted
  // runner can read them but fail minutes later when the CLI refreshes them.
  // Opening for read/write checks that permission without reading or changing
  // credential bytes, before any Host/browser/model work starts. Claude Code's
  // file is not opened: it runs on the verification token instead.
  for (const cli of isolatedAuth ? [] : clis) {
    if (
      fakeModelClis.includes(cli) &&
      !(cli === "codex" && fakeModelCodexAccount)
    )
      continue;
    if (cli === "opencode" && !opencodeV1) continue;
    const auth = {
      codex: ".codex/auth.json",
      pi: ".pi/agent/auth.json",
      opencode: ".local/share/opencode/auth.json",
      // omp keeps its OAuth logins in a SQLite database (openai-codex).
      omp: ".omp/agent/agent.db",
    }[cli];
    if (!auth) continue;
    try {
      const file = await open(join(original, auth), "r+");
      await file.close();
    } catch (error) {
      if (!["EROFS", "EACCES", "EPERM"].includes(error.code)) throw error;
      throw new Error(
        `${cli}の共有認証ファイルを更新できません。CLIのOAuth更新ができる権限で検証を実行してください（制限された実行環境ではrequire_escalated）。認証はコピーしないでください。`,
      );
    }
  }
  for (const path of isolatedAuth
    ? []
    : [
        ...(fakeModelClis.includes("codex") && !fakeModelCodexAccount
          ? []
          : [".codex/auth.json"]),
        ...(fakeModelClis.includes("pi") ? [] : [".pi/agent/auth.json"]),
        ...(clis.includes("omp") && !fakeModelClis.includes("omp")
          ? [".omp/agent/agent.db"]
          : []),
      ]) {
    const source = join(original, path);
    const target = join(home, path);
    await mkdir(join(target, ".."), { recursive: true });
    await symlink(source, target);
  }
  if (!isolatedAuth && opencodeV1 && !fakeModelClis.includes("opencode")) {
    const target = join(process.env.XDG_DATA_HOME, "opencode/auth.json");
    await mkdir(join(target, ".."), { recursive: true });
    await symlink(join(original, ".local/share/opencode/auth.json"), target);
  }
  await mkdir(join(home, ".codex"), { recursive: true });
  await mkdir(join(home, ".claude"));
  // The Owner's own file is never opened for Claude: the token keeps this
  // home's CLI from writing a refresh token the Owner's login cannot use.
  if (
    (!isolatedAuth || claudeVerificationToken) &&
    clis.includes("claude") &&
    !fakeModelClis.includes("claude")
  )
    setClaudeToken(
      await readClaudeToken(),
      isolatedAuth ? environment : process.env,
    );
  const claudeSettings = {
    ...(claudeTheme ? { theme: claudeTheme } : {}),
    model: "claude-haiku-4-5",
    ...(respondToBashCommands === undefined ? {} : { respondToBashCommands }),
    // Account connectors are MCP tools too; a model choosing one waits for approval.
    permissions: teamCommands
      ? { deny: ["mcp__*"], defaultMode: "default" }
      : { ask: ["Bash"], deny: ["mcp__*"], defaultMode: "default" },
  };
  await writeFile(
    join(home, ".claude/settings.json"),
    JSON.stringify(claudeSettings),
  );
  await writeFile(
    join(home, ".claude/.claude.json"),
    JSON.stringify({
      hasCompletedOnboarding: true,
      theme: claudeTheme ?? "dark",
      ...(trustedFolders.length
        ? {
            projects: Object.fromEntries(
              trustedFolders.map((path) => [
                path,
                { hasTrustDialogAccepted: true },
              ]),
            ),
          }
        : {}),
    }),
  );
  const userHook = { type: "command", command: "printf ''" };
  const config = { hooks: { Stop: [{ hooks: [userHook] }] } };
  await writeFile(join(home, ".codex/hooks.json"), JSON.stringify(config));
  await writeFile(
    join(home, ".codex/config.toml"),
    'check_for_update_on_startup = false\nmodel = "gpt-6-luna"\nmodel_reasoning_effort = "low"\n' +
      (codexDefaults
        ? ""
        : 'approval_policy = "on-request"\nsandbox_mode = "read-only"\n') +
      'approvals_reviewer = "user"\n' +
      (fakeModelClis.includes("codex")
        ? 'model_provider = "verification"\n[model_providers.verification]\nname = "Verification"\nwire_api = "responses"\nrequires_openai_auth = false\nenv_key = "IORI_FAKE_MODEL_KEY"\nbase_url = ' +
          JSON.stringify(`${fakeModel.baseURL}/v1`) +
          "\n"
        : "") +
      repositories
        .map(
          (path) =>
            "[projects." +
            JSON.stringify(path) +
            ']\ntrust_level = "trusted"\n',
        )
        .join(""),
  );
  await mkdir(join(home, ".codex/rules"));
  await writeFile(
    join(home, ".codex/rules/verification.rules"),
    'prefix_rule(pattern=["node"], decision="prompt")\n',
  );
  await mkdir(piAgentDirectory(home), { recursive: true });
  if (clis.includes("pi") && trustedFolders.length)
    // Pi 1.4 stores canonical project paths in its agent-directory trust.json.
    // https://github.com/earendil-works/pi/blob/main/packages/coding-agent/docs/security.md#how-pi-chooses-a-trust-decision
    await writeFile(
      join(piAgentDirectory(home), "trust.json"),
      JSON.stringify(
        Object.fromEntries(
          await Promise.all(
            trustedFolders.map(async (path) => [await realpath(path), true]),
          ),
        ),
      ),
    );
  if (fakeModelClis.includes("pi"))
    await writeFile(
      join(piAgentDirectory(home), "models.json"),
      JSON.stringify({
        providers: {
          openai: {
            baseUrl: `${fakeModel.baseURL}/v1`,
            api: "openai-responses",
            apiKey: "verification",
            models: [
              { id: "gpt-6-luna", input: ["text", "image"], reasoning: false },
            ],
          },
        },
      }),
    );
  if (fakeModelClis.includes("opencode")) {
    const config = join(home, ".config", "opencode");
    await mkdir(config, { recursive: true });
    await writeFile(
      join(config, "opencode.json"),
      JSON.stringify({
        model: "openai/gpt-6-luna",
        ...(!opencodeV1 ? { enabled_providers: ["openai"] } : {}),
        small_model: "openai/gpt-6-luna",
        provider: {
          openai: {
            options: {
              baseURL: `${fakeModel.baseURL}/v1`,
              apiKey: "verification",
            },
            ...(!opencodeV1
              ? {
                  models: {
                    "gpt-6-luna": {
                      name: "Fake model",
                      limit: { context: 32000, output: 1000 },
                    },
                  },
                }
              : {}),
          },
        },
      }),
    );
  }
  await writeFile(
    join(piAgentDirectory(home), "settings.json"),
    JSON.stringify({
      defaultProvider: "openai",
      defaultModel: "gpt-6-luna",
      defaultThinkingLevel: "off",
    }),
  );
  if (clis.includes("omp")) {
    // Every role asks for the same cheap model; the Owner's own config is not
    // copied. `write` asks before running commands, so the approval path can
    // be observed; a team role's permission argument switches that off.
    const role = "openai-codex/gpt-6-luna";
    const config =
      "modelRoles:\n" +
      [
        "default",
        "smol",
        "slow",
        "vision",
        "plan",
        "commit",
        "tiny",
        "memory",
        "task",
        "advisor",
        "judge",
      ]
        .map((name) => `  ${name}: ${role}\n`)
        .join("") +
      "tools:\n  approvalMode: write\nstartup:\n  setupWizard: false\n";
    const profile = join(home, ".omp/profiles/verification/agent");
    await mkdir(profile, { recursive: true });
    await mkdir(join(home, ".omp/agent"), { recursive: true });
    if (fakeModelClis.includes("omp")) {
      const models = `providers:\n  openai-codex:\n    baseUrl: ${fakeModel.baseURL}/v1\n    api: openai-responses\n    apiKey: verification\n    models:\n      - id: gpt-6-luna\n        api: openai-responses\n        reasoning: false\n        input: [text, image]\n`;
      await writeFile(join(home, ".omp/agent/models.yml"), models);
      await writeFile(join(profile, "models.yml"), models);
    } else if (!isolatedAuth) {
      await symlink(
        join(original, ".omp/agent/agent.db"),
        join(profile, "agent.db"),
      );
    }
    await writeFile(join(home, ".omp/agent/config.yml"), config);
    await writeFile(join(profile, "config.yml"), config);
  }
  // No user's shell settings or profile history is copied into this home.
  await writeFile(
    join(home, ".profile"),
    `export PATH='${process.env.PATH.replaceAll("'", "'\\''")}'\n`,
  );
  await writeFile(
    join(home, ".bash_profile"),
    '. "$HOME/.profile"; . "$HOME/.bashrc"\n',
  );
  await writeFile(join(home, ".bashrc"), 'PS1="iori-test# "\n');
  // The fixture represents a hook already trusted by its user. iori must
  // neither trust this hook on install nor revoke it on removal.
  await trustHooks(
    {
      home,
      command: userHook.command,
      cliCommand: "codex",
      shell: { id: "bash", executable: "/bin/bash", args: ["-l"] },
    },
    join(home, ".codex"),
  );
  const userTrust = JSON.parse(
    await readFile(join(home, ".codex/iori-hook-trust.json"), "utf8"),
  );
  assert.equal(userTrust.length, 1);
  await rm(join(home, ".codex/iori-hook-trust.json"));
  for (const command of clis) {
    if (command === "opencode") continue;
    const result = spawnSync(command, ["--version"], {
      encoding: "utf8",
      env: {
        ...verificationHostEnvironment(),
        HOME: home,
        ...(isolatedAuth
          ? {
              CODEX_HOME: join(home, ".codex"),
              CLAUDE_CONFIG_DIR: join(home, ".claude"),
              XDG_DATA_HOME: join(home, ".local/share"),
              XDG_STATE_HOME: join(home, ".local/state"),
              XDG_CACHE_HOME: join(home, ".cache"),
              PI_CODING_AGENT_DIR:
                command === "pi" ? piAgentDirectory(home) : undefined,
              PI_CODING_AGENT_SESSION_DIR:
                command === "pi" ? join(home, ".pi/sessions") : undefined,
              XDG_CONFIG_HOME: join(home, ".config"),
            }
          : {}),
        VOLTA_HOME: process.env.VOLTA_HOME ?? join(original, ".volta"),
      },
    });
    assert.equal(
      result.status,
      0,
      `${command} --version could not run (${result.error?.code ?? result.status})`,
    );
    versions[command] = result.stdout.trim();
  }
  return {
    home,
    versions,
    environment,
    async trustFolders(folders) {
      const file = join(home, ".claude/.claude.json");
      const current = JSON.parse(await readFile(file, "utf8"));
      current.projects = {
        ...current.projects,
        ...Object.fromEntries(
          folders.map((path) => [path, { hasTrustDialogAccepted: true }]),
        ),
      };
      await writeFile(file, JSON.stringify(current));
    },
    async checkUnusedHooks() {
      await assert.rejects(
        readFile(join(home, ".iori/hooks/iori-cli-hook.mjs")),
        { code: "ENOENT" },
      );
      assert.deepEqual(
        JSON.parse(await readFile(join(home, ".codex/hooks.json"), "utf8")),
        config,
      );
      assert.equal(
        JSON.parse(await readFile(join(home, ".claude/settings.json"), "utf8"))
          .hooks,
        undefined,
      );
    },
    async preventHookInstall() {
      // A browser cannot create a conflicting filesystem entry. Make the
      // real install fail without changing any CLI settings or credentials.
      const directory = join(home, ".iori/hooks");
      const backup = join(home, ".iori/hooks-verification-backup");
      await mkdir(directory, { recursive: true });
      await rename(directory, backup);
      await writeFile(directory, "verification filesystem conflict");
      return async () => {
        await rm(directory);
        await rename(backup, directory);
      };
    },
    async checkRemoval() {
      const codex = JSON.parse(
        await readFile(join(home, ".codex/hooks.json"), "utf8"),
      );
      assert.deepEqual(codex, config, "利用者のhookだけが残る");
      const settings = await readFile(join(home, ".codex/config.toml"), "utf8");
      assert.equal(
        (settings.match(/trusted_hash/g) ?? []).length,
        1,
        "利用者の信頼登録だけが残る",
      );
      assert.equal(
        settings.includes('model = "gpt-6-luna"'),
        true,
        "利用者の設定を保つ",
      );
      assert.deepEqual(
        JSON.parse(await readFile(join(home, ".claude/settings.json"), "utf8")),
        claudeSettings,
      );
      await assert.rejects(
        readFile(
          join(piAgentDirectory(home), "extensions", "iori-agent-status.ts"),
        ),
        { code: "ENOENT" },
      );
    },
  };
}
