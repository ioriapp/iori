import { providerHome } from "./provider-home.mjs";
import { capabilities } from "./capabilities.mjs";
import { randomUUID } from "node:crypto";
import { execFileSync } from "node:child_process";
import assert from "node:assert/strict";
import { appendFileSync } from "node:fs";
import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
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
  tool:
    cli === "claude"
      ? "Bash"
      : cli === "codex"
        ? "exec_command"
        : cli === "hermes"
          ? "terminal"
          : "bash",
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
  { team = false, realModel = false, untrustedChild = false } = {},
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
      // A user adds the repository to iori before starting a team there; the
      // team then starts the CLI trusted in it.
      if (team)
        await host.client.request("folders.open", {
          path: join(host.dataRoot, "repository"),
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
        if (untrustedChild) execFileSync("git", ["init", "-q", cwd]);
        const prepared = await prepareCliHome(dataRoot, {
          clis:
            capabilities[cli]?.fakeModel && !["hermes", "vibe"].includes(cli)
              ? [cli]
              : [],
          fakeModel: fake,
          fakeModelClis:
            !realModel && capabilities[cli]?.fakeModel ? [cli] : [],
          isolatedAuth: true,
          claudeVerificationToken: realModel,
          repositories: untrustedChild ? [] : [cwd],
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
        const providerEnvironment = fake
          ? await providerHome(cli, prepared.home, fake.baseURL)
          : {};
        return {
          ...prepared.environment,
          ...providerEnvironment,
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

/** Return command-line argument arrays for processes running with the isolated CLI HOME. */
async function cliProcessArguments(home) {
  const entries = [];
  for (const entry of await readdir("/proc")) {
    if (!/^\d+$/u.test(entry) || Number(entry) === process.pid) continue;
    try {
      const env = (await readFile(`/proc/${entry}/environ`, "utf8")).split(
        "\0",
      );
      if (!env.includes(`HOME=${home}`)) continue;
      entries.push(
        (await readFile(`/proc/${entry}/cmdline`, "utf8")).split("\0"),
      );
    } catch (error) {
      if (!["ENOENT", "ESRCH", "EACCES"].includes(error.code)) throw error;
    }
  }
  return entries;
}

/** Check whether any running CLI process includes the expected contiguous arguments. */
export function hasArgumentSequence(commands, expected) {
  return commands.some((args) =>
    args.some(
      (_, index) =>
        index + expected.length <= args.length &&
        expected.every((value, offset) => args[index + offset] === value),
    ),
  );
}

/** Launch a team with the selected permission and assert that the spawned CLI receives its flags. */
export async function assertTeamPermissionArguments(
  context,
  cli,
  permission,
  expectedArguments,
  waitForReady,
) {
  const { client, dataRoot } = context;
  const candidate = {
    id: "worker-candidate",
    cli,
    model: capabilities[cli]?.fakeModel ? model(cli) : "",
    permission,
    tools: [],
    minimum: "",
  };
  const team = await client.request("teams.create", {
    definition: {
      name: "Permission Compatibility",
      description: "",
      instruction: "",
      parent: { ...candidate, id: "parent" },
      roles: [
        {
          id: "worker",
          name: "Worker",
          when: "",
          limit: "",
          reuse: true,
          split: false,
          instruction: "",
          request: "",
          report: "",
          candidates: { high: [], medium: [candidate], low: [] },
        },
      ],
    },
  });
  await client.request("teams.settings", {
    defaultTeam: team.saved.id,
    limits: {},
  });
  const events = await client.events();
  await events.waitFor((event) => event.type === "snapshot");
  const { terminal: created } = await client.request("team.launch", {
    teamId: team.saved.id,
    cwd: join(dataRoot, "repository"),
    ...(capabilities[cli]?.fakeModel ? { instruction: marker("ready") } : {}),
  });
  const pty = await context.terminal(client, created.id);
  await waitForReady(pty, created.id, events);
  const commands = await cliProcessArguments(join(dataRoot, "cli-home"));
  assert.ok(
    hasArgumentSequence(commands, expectedArguments),
    `Expected ${expectedArguments.join(" ")} in ${JSON.stringify(commands)}`,
  );
}
