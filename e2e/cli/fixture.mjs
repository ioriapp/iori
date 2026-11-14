import { capabilities } from "./capabilities.mjs";
import { randomUUID } from "node:crypto";
import assert from "node:assert/strict";
import { appendFileSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { prepareCliHome } from "../../verification/cli/home.mjs";
import { runHostTest } from "../../verification/host/process.mjs";
import { startFakeModel } from "../../verification/fake-model/server.mjs";

export const marker = (name) => `[fake-model:${name}]`;
export const model = (cli) =>
  cli === "claude"
    ? "claude-haiku-4-5"
    : cli === "opencode"
      ? "openai/gpt-6-luna"
      : cli === "omp"
        ? "openai-codex/gpt-6-luna"
        : "gpt-6-luna";
export const commandStep = (cli, command, extra = {}) => ({
  tool: cli === "claude" ? "Bash" : cli === "codex" ? "exec_command" : "bash",
  input: cli === "codex" ? { cmd: command, ...extra } : { command, ...extra },
  delayMs: 0,
});

// https://code.claude.com/docs/en/settings-reference#permissions-defaultmode
// https://code.claude.com/docs/en/settings-reference#permissions-denyinsteadofprompting
export async function unattendedClaude(home) {
  const file = join(home, ".claude/settings.json");
  const settings = JSON.parse(await readFile(file, "utf8"));
  settings.permissions = {
    allow: ["Bash(iori *)"],
    deny: ["mcp__*"],
    defaultMode: "dontAsk",
    denyInsteadOfPrompting: true,
  };
  await writeFile(file, JSON.stringify(settings));
}

/** Only the isolated Host's persisted session identity is read, never CLI credentials. */
export function savedSession(dataRoot, terminalId) {
  const db = new DatabaseSync(join(dataRoot, "iori-host/host.sqlite"), {
    readOnly: true,
  });
  try {
    const row = db
      .prepare("SELECT value FROM terminal_clis WHERE terminal_id = ?")
      .get(terminalId);
    const value = row && JSON.parse(row.value);
    assert.ok(value?.session?.id, "Hostが会話のIDを保存している");
    return value.session;
  } finally {
    db.close();
  }
}

export async function withCli(
  t,
  cli,
  scripts,
  body,
  { team = false, realModel = false } = {},
) {
  const evidence = process.env.IORI_CLI_COMPAT_EVIDENCE;
  assert.ok(evidence, "node scripts/cli-compat.mjs から起動してください");
  const directory = join(evidence, t.name);
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const scenarioScripts = {
    ready: [{ text: "COMPAT_READY", delayMs: 0 }],
    ...scripts,
  };
  if (realModel) {
    assert.equal(cli, "claude");
    assert.equal(process.env.IORI_CLI_COMPAT_REAL_MODEL, "1");
  }
  const fake = realModel
    ? undefined
    : await startFakeModel({ scripts: scenarioScripts });
  t.after(() => fake?.close());
  const terminals = [];
  t.after(async () => {
    if (fake)
      await writeFile(
        join(directory, "model-requests.json"),
        JSON.stringify(fake.requests, null, 2),
        { mode: 0o600 },
      );
    for (const [index, terminal] of terminals.entries())
      await writeFile(
        join(directory, `pty-${index}.ansi`),
        terminal.values.at(-1)?.output ?? "",
        { mode: 0o600 },
      );
  });
  await runHostTest(
    t,
    async (host) => {
      if (cli === "muse-code")
        await host.client.request("cli.arguments.set", {
          cliId: cli,
          arguments: "--trust-workspace",
        });
      const terminal = async (client, id) => {
        const file = join(directory, `pty-${terminals.length}.ansi`);
        const pty = await client.terminal(id, {
          cols: 160,
          rows: 40,
          onOutput: (frame) => {
            if (frame.kind === "terminal.snapshot")
              appendFileSync(
                file,
                frame.snapshot.scrollbackAnsi + frame.snapshot.snapshotAnsi,
                { mode: 0o600 },
              );
            if (frame.kind === "terminal.output")
              appendFileSync(file, frame.data, { mode: 0o600 });
          },
        });
        terminals.push(pty);
        return pty;
      };
      await body({
        ...host,
        fake,
        scripts: scenarioScripts,
        terminal,
        directory,
      });
    },
    {
      onStderr: (text) =>
        appendFileSync(join(directory, "host.log"), text, { mode: 0o600 }),
      prepareEnvironment: async (dataRoot) => {
        const cwd = join(dataRoot, "repository");
        await mkdir(cwd);
        const prepared = await prepareCliHome(dataRoot, {
          clis: capabilities[cli]?.fakeModel ? [cli] : [],
          fakeModel: fake,
          fakeModelClis:
            !realModel && capabilities[cli]?.fakeModel ? [cli] : [],
          isolatedAuth: true,
          claudeVerificationToken: realModel,
          repositories: [cwd],
          trustedFolders: [cwd],
          teamCommands: team,
          codexDefaults: team,
          claudeTheme: "dark",
          respondToBashCommands: false,
        });
        if (realModel) await unattendedClaude(prepared.home);
        else if (team && cli === "claude") {
          const settingsFile = join(prepared.home, ".claude/settings.json");
          const settings = JSON.parse(await readFile(settingsFile, "utf8"));
          settings.permissions.allow = ["Bash(node:*)"];
          await writeFile(settingsFile, JSON.stringify(settings));
        }
        if (cli === "opencode") {
          const v2 =
            Number(prepared.versions.opencode.match(/\bv?(\d+)\./u)?.[1]) >= 2;
          // https://opencode.ai/docs/permissions/: V2 uses shell and an ordered permissions array.
          const settingsFile = join(
            prepared.home,
            ".config/opencode/opencode.json",
          );
          const settings = JSON.parse(await readFile(settingsFile, "utf8"));
          if (!team)
            Object.assign(
              settings,
              v2
                ? {
                    permissions: [
                      { action: "shell", resource: "node *", effect: "ask" },
                    ],
                  }
                : { permission: { bash: "ask" } },
            );
          await writeFile(settingsFile, JSON.stringify(settings));
          if (v2)
            for (const steps of Object.values(scenarioScripts))
              for (const step of steps)
                if (step.tool === "bash") step.tool = "shell";
        }
        return {
          ...prepared.environment,
          HOME: prepared.home,
          PATH: process.env.PATH,
          CODEX_HOME: join(prepared.home, ".codex"),
          CLAUDE_CONFIG_DIR: join(prepared.home, ".claude"),
          PI_CODING_AGENT_DIR:
            cli === "pi" ? join(prepared.home, ".pi/agent") : undefined,
          PI_CODING_AGENT_SESSION_DIR:
            cli === "pi" ? join(prepared.home, ".pi/sessions") : undefined,
          XDG_CONFIG_HOME: join(prepared.home, ".config"),
          XDG_CACHE_HOME: join(prepared.home, ".cache"),
          XDG_STATE_HOME: join(prepared.home, ".local/state"),
          VOLTA_HOME: process.env.VOLTA_HOME,
          // A root verification process needs normal approvals, never bypass mode.
          IS_SANDBOX: "1",
          MUSE_NO_AUTO_UPDATE: "1",
          MUSE_LOGIN: "0",
        };
      },
    },
  );
}

export async function launch(context, cli) {
  context.stage("公開の要求でCLIを起動し最初の入力の応答を受信する");
  const { client, dataRoot } = context;
  const events = await client.events();
  const { terminal: created } = await client.request("cli.launch", {
    cliId: cli,
    cwd: join(dataRoot, "repository"),
    instruction: `COMPAT_MEMORY ${marker("ready")}`,
  });
  const pty = await context.terminal(client, created.id);
  await pty.output("COMPAT_READY");
  await status(events, created.id, "done");
  return { id: created.id, pty };
}

export async function submit(pty, text) {
  const id = randomUUID();
  await pty.submit(text, id);
  const { frame } = await pty.waitFor(
    ({ frame }) => frame.kind === "terminal.submitted" && frame.id === id,
  );
  assert.equal(frame.success, true, "CLIへの入力が受け付けられる");
}

export async function status(events, id, state) {
  const event = await events.waitFor(
    (event) =>
      event.type === "terminal.updated" &&
      event.terminal.id === id &&
      event.terminal.cliStatus?.state === state,
  );
  assert.notEqual(
    event.terminal.cliStatus.outcome,
    "failure",
    event.terminal.cliStatus.failure,
  );
  return event.terminal.cliStatus;
}
