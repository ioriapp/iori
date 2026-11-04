import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { spawnSync } from "node:child_process";
import { mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, isAbsolute, join, relative, resolve, win32 } from "node:path";
import {
  hookInstallContext,
  removeCliHooks,
} from "../../apps/host/src/cli/hook-install.ts";
import {
  cliDefinitions,
  definitionInfo,
  removeUserDefinition,
  saveUserDefinition,
  writesDefinitionHooks,
} from "../../apps/host/src/cli/definitions.ts";
import {
  hooksTarget,
  writtenPath,
} from "../../apps/host/src/cli/definition-hooks.ts";
import {
  scriptSessionTokens,
  scriptUsage,
} from "../../apps/host/src/cli/definition-script.ts";
import { hookOwner } from "../../apps/host/src/cli/hook-documents.ts";
import {
  hookReceiver,
  hookReply,
  hookShells,
  runHookCommand,
} from "./hook-shells.mjs";

// The parsers of the formats that a CLI's hooks file can have, taken from the
// packages that the Host itself reads them with.
const hostRequire = createRequire(
  new URL("../../apps/host/src/cli/hook-documents.ts", import.meta.url),
);
const TOML = hostRequire("@decimalturn/toml-patch");
const { parse: parseYaml } = hostRequire("yaml");

// Model-free check of the hooks that CLI definitions write on Windows
// (docs/design/cli-definitions.md). The bundled definitions' hooks and a
// user's definition are written through the Host's own readers and writers,
// the written commands are run from PowerShell, cmd and Git Bash, and the
// hooks are removed through the Host's own cleanup. The JSON sent to a hook
// deliberately contains cmd syntax; only this run's disposable folders may
// receive the proof file. Every HOME is a disposable folder of this run.

const bait = 'echo " & echo IORI_PROBE> %TEMP%\\iori-injected.txt & rem ';
const userId = "probe-cli";
const userDefinition =
  JSON.stringify(
    {
      schema: 1,
      id: userId,
      name: "Probe CLI",
      command: "probe",
      hooks: {
        format: "claude-settings",
        // The environment overrides `default`, as in cli-definitions.md.
        file: {
          env: "PROBE_CONFIG_DIR",
          default: "~/.probe-cli",
          path: "settings.json",
        },
        sessionId: "session_id",
        transcript: "transcript_path",
        rules: [
          { event: "SessionStart", state: "idle" },
          { event: "UserPromptSubmit", state: "active" },
          { event: "PreToolUse", state: "active", tool: "tool_name" },
          {
            event: "PermissionRequest",
            state: "waiting",
            attention: "approval",
            tool: "tool_name",
          },
          { event: "Stop", state: "done" },
        ],
      },
    },
    null,
    2,
  ) + "\n";
/** The user's part of a settings file that is already there, by syntax.
 * Comment lines are part of it wherever the syntax has comments. */
const userFile = {
  json: '{\r\n  "userSetting": "keep",\r\n  "userList": [1, 2]\r\n}\r\n',
  toml: '# 利用者のコメント\r\n[user]\r\nkeep = "yes"\r\n',
  yaml: "# 利用者のコメント\r\nuser:\r\n  keep: yes\r\n",
};

/** The bundled definitions that write their own hooks, as the Host reads
 * them: an official CLI's code writes its hooks instead. */
const bundled = cliDefinitions.flatMap((definition) => {
  const file = definitionInfo(definition)?.file;
  return file?.hooks &&
    file.hooks.format !== "plugin-file" &&
    writesDefinitionHooks(file)
    ? [{ definition, hooks: file.hooks }]
    : [];
});
/** The places that this PC's own CLIs would name: cleared for the length of
 * a HOME so that no file outside the disposable folders is read or written. */
const places = {
  USERPROFILE: undefined,
  HOME: undefined,
  CLAUDE_CONFIG_DIR: undefined,
  CODEX_HOME: undefined,
  PI_CODING_AGENT_DIR: undefined,
  XDG_CONFIG_HOME: undefined,
  PROBE_CONFIG_DIR: undefined,
};

const shellOf = (id) => ({
  id,
  label: id === "powershell" ? "PowerShell" : "Command Prompt",
  executable: id === "powershell" ? "powershell.exe" : process.env.ComSpec,
  args: [],
});
const exists = (path) =>
  stat(path).then(
    () => true,
    () => false,
  );
/** The path that a definition's `file` gives under `home`, read here so that
 * it is an expectation of its own and not the Host's own answer. */
function expectedPath(file, home, env) {
  if (typeof file === "string")
    return file === "~"
      ? home
      : /^~[\\/]/u.test(file)
        ? join(home, file.slice(2))
        : file;
  const directory = env[file.env] || expectedPath(file.default, home, env);
  return file.path ? join(directory, file.path) : directory;
}
function insideHome(home, path) {
  const local = relative(home, path);
  return !!local && !local.startsWith("..") && !isAbsolute(local);
}
/** Every line with something in it, in order: the user's part of a file whose
 * line endings the writer may keep. */
function keepsLines(before, after) {
  const wanted = before
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .filter(Boolean);
  let at = 0;
  for (const line of after
    .split(/\r?\n/u)
    .map((found) => found.trim())
    .filter(Boolean))
    if (at < wanted.length && line === wanted[at]) at++;
  return at === wanted.length;
}
/** JSON is written with 2 spaces (cli-definitions.md「書き換え方」), so the
 * user's items of a JSON file are compared as values, not as bytes. */
function sameJson(before, after) {
  try {
    return (
      JSON.stringify(JSON.parse(before)) === JSON.stringify(JSON.parse(after))
    );
  } catch {
    return false;
  }
}
function keepsItems(before, after) {
  try {
    const wanted = JSON.parse(before);
    const found = JSON.parse(after);
    return Object.entries(wanted).every(
      ([key, value]) => JSON.stringify(found[key]) === JSON.stringify(value),
    );
  } catch {
    return false;
  }
}
/** A file that mixes CRLF and LF lines breaks the CLI's own readers. */
const mixedNewlines = (text) =>
  text.includes("\r\n") &&
  text
    .split("\n")
    .slice(0, -1)
    .some((line) => !line.endsWith("\r"));
const parseFile = (text, syntax) =>
  syntax === "json"
    ? JSON.parse(text)
    : syntax === "toml"
      ? TOML.parse(text)
      : parseYaml(text);
/** The strings of a hooks file that call iori's hook. */
function ioriCommands(value, found = []) {
  if (typeof value === "string") {
    if (hookOwner(value) !== undefined) found.push(value);
  } else if (Array.isArray(value))
    for (const item of value) ioriCommands(item, found);
  else if (value && typeof value === "object")
    for (const item of Object.values(value)) ioriCommands(item, found);
  return found;
}
/** The form of the written command that the Host's own rule gives: the batch
 * file when both paths are ASCII-safe, PowerShell's encoded command if not. */
function commandForm(home) {
  const safe = /^[A-Za-z0-9_.:\\~-]+$/u;
  return safe.test(join(home, ".iori", "hooks", "iori-cli-hook.cmd")) &&
    safe.test(process.execPath)
    ? "batch"
    : "encoded";
}
const sameBody = (got, want) =>
  !!got &&
  typeof got === "object" &&
  Object.keys(got).length === Object.keys(want).length &&
  Object.entries(want).every(
    ([key, value]) => JSON.stringify(got[key]) === JSON.stringify(value),
  );
/** Whether a settings file that was there before the write is back as it was:
 * TOML and YAML byte for byte, JSON by its items (it is rewritten). */
async function fileRestored(target, before, syntax) {
  const after = await readFile(target, "utf8").catch(() => undefined);
  if (after === undefined || before === undefined) return false;
  return syntax === "json" ? sameJson(before, after) : before === after;
}
/** `values` for the length of `task`: the Host reads `USERPROFILE` and a
 * definition's environment from this process, as it does for a real launch. */
async function withProcessEnv(values, task) {
  const names = Object.keys(values);
  const original = names.map((name) => process.env[name]);
  for (const name of names) {
    if (values[name] === undefined) delete process.env[name];
    else process.env[name] = values[name];
  }
  try {
    return await task();
  } finally {
    names.forEach((name, index) => {
      if (original[index] === undefined) delete process.env[name];
      else process.env[name] = original[index];
    });
  }
}

/** One HOME of this run: the writes, the runs of what was written, and the
 * removal of both. */
async function probeHome(homeName, home, receiver) {
  const host = join(home, "host");
  const rows = [];
  const writes = [];
  const removals = [];
  const written = [];
  const childEnv = () => ({
    ...process.env,
    TEMP: home,
    TMP: home,
    IORI_CLI_HOOK_URL: receiver.url,
    IORI_CLI_HOOK_ADAPTER: "",
  });

  /** Write one definition's hooks through the Host's own writer, see what it
   * wrote, then run the written command from every shell. */
  async function writeAndRun({ definition, hooks, label = definition.id }) {
    const target = expectedPath(hooks.file, home, process.env);
    const own = !!hooks.own;
    const before = own ? undefined : userFile[hooks.syntax];
    if (before !== undefined) {
      await mkdir(dirname(target), { recursive: true });
      await writeFile(target, before);
    }
    // The Host prepares a CLI's hooks in the shell its Terminal runs.
    const contexts = [];
    for (const id of ["cmd", "powershell"])
      contexts.push(
        await hookInstallContext(
          shellOf(id),
          definition.id,
          "",
          true,
          undefined,
          host,
        ),
      );
    for (const context of contexts) await definition.hooks.install(context);
    const context = contexts[0];
    const events = [...new Set(hooks.rules.map((rule) => rule.event))];
    const commands = new Map(
      events.map((event) => [
        event,
        hooks.format === "claude-settings"
          ? context.command
          : context.commandForEvent(event),
      ]),
    );
    const text = await readFile(target, "utf8");
    const found = ioriCommands(parseFile(text, hooks.syntax));
    const wanted = [...commands.values()];
    const record = JSON.parse(
      await readFile(writtenPath(host), "utf8").catch(() => "{}"),
    );
    const form = context.command.includes("-EncodedCommand")
      ? "encoded"
      : "batch";
    writes.push({
      home: homeName,
      definition: label,
      id: definition.id,
      syntax: hooks.syntax,
      own,
      path: target,
      insideHome: insideHome(home, target),
      recorded: record[definition.id]?.file === target,
      userKept: own
        ? null
        : hooks.syntax === "json"
          ? keepsItems(before, text)
          : keepsLines(before, text),
      newlines: !mixedNewlines(text),
      owners: [...new Set(found.map((command) => hookOwner(command)))],
      commands: found.length,
      missing: events.filter((event) => !found.includes(commands.get(event))),
      unexpected: found.filter((command) => !wanted.includes(command)).length,
      form,
      formExpected: form === commandForm(home),
    });

    // The notification that this CLI sends for one of its events, in its own
    // field names (the item of the first rule that names a state and a tool).
    const rule =
      hooks.rules.find((rule) => rule.state && rule.tool) ??
      hooks.rules.find((rule) => rule.state) ??
      hooks.rules[0];
    const event = rule.event;
    const payload = {
      hook_event_name: event,
      ...(hooks.sessionId ? { [hooks.sessionId]: "verify-session" } : {}),
      ...(hooks.transcript
        ? { [hooks.transcript]: "C:\\verify\\session.jsonl" }
        : {}),
      ...(hooks.toolId ? { [hooks.toolId]: "tool-verify" } : {}),
      ...(rule.tool ? { [rule.tool]: "Bash" } : {}),
      tool_input: { command: bait },
    };
    const expected = { ...payload, iori_cli: definition.id };
    const command = commands.get(event);
    for (const shell of hookShells) {
      const run = await runHookCommand({
        shell,
        command,
        env: childEnv(),
        payload,
        receiver,
        proof: join(home, "iori-injected.txt"),
      });
      const row = {
        home: homeName,
        definition: label,
        shell: shell.id,
        event,
        command,
        code: run.code,
        timedOut: run.timedOut,
        injected: run.injected,
        delivered:
          run.received.length === 1 && sameBody(run.received[0], expected),
        received: run.received,
        owner: run.received[0]?.iori_cli ?? null,
        stderr: run.stderr,
      };
      // A definition writes no reply, so what the command wrote to stdout is
      // kept as evidence (the reply is required only where a CLI needs one).
      const { quiet } = hookReply(run.stdout, undefined);
      rows.push({
        ...row,
        quiet,
        passed:
          row.code === 0 &&
          !row.timedOut &&
          !row.injected &&
          row.delivered &&
          row.owner === definition.id,
      });
    }
    written.push({
      label,
      target,
      before,
      syntax: hooks.syntax,
      own,
    });
    return { target, before };
  }

  const cleared = Object.fromEntries(
    bundled.flatMap(({ hooks }) => {
      const file = hooks.file;
      // The default place of a bundled definition, not a value of this PC.
      return typeof file === "string" ? [] : [[file.env, undefined]];
    }),
  );
  await withProcessEnv(
    { ...places, USERPROFILE: home, HOME: home, ...cleared },
    async () => {
      for (const { definition, hooks } of bundled)
        await writeAndRun({ definition, hooks });

      await saveUserDefinition(host, userId, userDefinition);
      const user = cliDefinitions.find(
        (definition) => definition.id === userId,
      );
      // The environment overrides the default place of a user's definition.
      const override = join(home, "probe-env");
      await mkdir(override, { recursive: true });
      const byEnvironment = await withProcessEnv(
        { PROBE_CONFIG_DIR: override },
        () =>
          writeAndRun({
            definition: user,
            hooks: definitionInfo(user).file.hooks,
            label: `${userId} (環境変数)`,
          }),
      );
      const byDefault = await writeAndRun({
        definition: user,
        hooks: definitionInfo(user).file.hooks,
        label: `${userId} (既定)`,
      });
      // The place of the hooks changed, so the Host removed the earlier one.
      removals.push({
        home: homeName,
        definition: `${userId} (環境変数)`,
        own: false,
        restored: await fileRestored(
          byEnvironment.target,
          byEnvironment.before,
          "json",
        ),
      });

      // The reply that a CLI requires from a hook, from the same writer.
      const context = await hookInstallContext(
        shellOf("cmd"),
        userId,
        "",
        true,
        undefined,
        host,
      );
      const command = context.commandForEvent("PermissionRequest", {
        decision: "ask",
      });
      const payload = {
        hook_event_name: "PermissionRequest",
        tool_input: { command: bait },
      };
      const expected = { ...payload, iori_cli: userId };
      for (const shell of hookShells) {
        const run = await runHookCommand({
          shell,
          command,
          env: childEnv(),
          payload,
          receiver,
          proof: join(home, "iori-injected.txt"),
        });
        const row = {
          home: homeName,
          definition: "返答が要る出来事",
          shell: shell.id,
          event: "PermissionRequest",
          command,
          code: run.code,
          timedOut: run.timedOut,
          injected: run.injected,
          delivered:
            run.received.length === 1 && sameBody(run.received[0], expected),
          received: run.received,
          owner: run.received[0]?.iori_cli ?? null,
          stderr: run.stderr,
        };
        const { reply } = hookReply(run.stdout, { decision: "ask" });
        rows.push({
          ...row,
          reply,
          passed:
            row.code === 0 &&
            !row.timedOut &&
            !row.injected &&
            row.delivered &&
            row.owner === userId &&
            reply,
        });
      }

      // The Host's own removal when a definition goes, then the Host's own
      // cleanup of every hook it wrote in this HOME.
      await removeUserDefinition(host, userId);
      removals.push({
        home: homeName,
        definition: `${userId} (既定)`,
        own: false,
        restored: await fileRestored(
          byDefault.target,
          byDefault.before,
          "json",
        ),
      });
      await removeCliHooks(shellOf("cmd"), host);
      for (const entry of written) {
        removals.push({
          home: homeName,
          definition: entry.label,
          own: entry.own,
          ...(entry.own
            ? { removed: !(await exists(entry.target)) }
            : {
                restored: await fileRestored(
                  entry.target,
                  entry.before,
                  entry.syntax,
                ),
              }),
          createdMarker: !(await exists(entry.target + ".iori-created")),
        });
      }
      removals.push({
        home: homeName,
        definition: "cli-definition-hooks.json",
        own: false,
        record: !(await exists(writtenPath(host))),
      });
      removals.push({
        home: homeName,
        definition: "ioriのhookの部品",
        own: true,
        removed: !(await exists(join(home, ".iori", "hooks"))),
      });
    },
  );
  return { rows, writes, removals };
}

/** The Host runs a definition's scripts as separate Node processes with the
 * login environment, and places a plugin-file bridge without changing a file
 * of the same name that iori did not place
 * (docs/design/cli-definitions.md「トークン量と利用枠のスクリプト」「上書きしない」). */
async function probeScriptsAndParts(homeName, home, receiver) {
  const host = join(home, "host");
  const scripts = [];
  const plugins = [];
  const shell = shellOf("powershell");
  const secrets = ["IORI_COMMAND_AUTH", "FORGEJO_TOKEN", "IORI_CLI_HOOK_URL"];
  const guard = `const secrets = ${JSON.stringify(secrets)};\nif (secrets.some((name) => process.env[name] !== undefined)) process.exit(3);`;
  const folder = join(home, "definition scripts");
  const conversation = join(home, "conversation");
  const pidFile = join(conversation, "script-pid.txt");
  await mkdir(folder, { recursive: true });
  await mkdir(conversation, { recursive: true });
  await writeFile(
    join(folder, "tokens.mjs"),
    `import { readFileSync, writeFileSync } from 'node:fs';\n${guard}\nconst input = JSON.parse(readFileSync(0, 'utf8'));\nif (input.sessionId !== 'verify-session' || !input.transcript || !input.cwd) process.exit(4);\nwriteFileSync(input.cwd + '/script-pid.txt', String(process.pid));\nprocess.stdout.write(JSON.stringify({ input: 12, output: 3, cacheRead: 4 }));\n`,
  );
  await writeFile(
    join(folder, "usage.mjs"),
    `${guard}\nprocess.stdout.write(JSON.stringify({ windows: [{ remaining: 42, minutes: 60, name: 'Verify' }] }));\n`,
  );
  await withProcessEnv(
    {
      USERPROFILE: home,
      HOME: home,
      IORI_COMMAND_AUTH: "probe-secret",
      FORGEJO_TOKEN: "probe-token",
      IORI_CLI_HOOK_URL: receiver.url,
    },
    async () => {
      const tokens = await scriptSessionTokens("probe-scripts", folder, {
        script: "tokens.mjs",
      }).read(
        { id: "verify-session", file: "C:\\verify\\session.jsonl" },
        shell,
        conversation,
      );
      const pid = Number(await readFile(pidFile, "utf8").catch(() => "0"));
      scripts.push({
        home: homeName,
        kind: "tokens",
        tokens,
        separateProcess: pid > 0 && pid !== process.pid,
        envKeptOut: tokens !== undefined,
      });

      const controller = new globalThis.AbortController();
      let usage;
      const monitor = scriptUsage("probe-usage", folder, {
        script: "usage.mjs",
      });
      await monitor(
        shell,
        "probe",
        controller.signal,
        (value) => {
          // The monitor keeps waiting for its next refresh; this probe reads
          // one report and then stops it, whether or not a window came back.
          if (usage === undefined) usage = value;
          controller.abort();
        },
        () => {},
      );
      scripts.push({
        home: homeName,
        kind: "usage",
        usage,
        windows: usage?.windows.length ?? 0,
      });
    },
  );

  // A plugin-file bridge that iori places, and the file that goes with it.
  const source = "// iori bridge\nexport default function () {}\n";
  const dependency = join(home, "部品 フォルダー");
  const target = join(dependency, "iori-bridge.js");
  const place = async (id, value) => {
    const folderPath = join(host, "cli-definitions", id);
    await mkdir(folderPath, { recursive: true });
    await writeFile(join(folderPath, "iori-bridge.js"), value);
    await saveUserDefinition(
      host,
      id,
      JSON.stringify({
        schema: 1,
        id,
        name: `Probe plugin ${id}`,
        command: "probe",
        hooks: {
          format: "plugin-file",
          install: { copy: "iori-bridge.js", to: dependency },
        },
      }),
    );
    const definition = cliDefinitions.find((entry) => entry.id === id);
    await definition.hooks.install(
      await hookInstallContext(shell, id, "", true, undefined, host),
    );
    const record = JSON.parse(
      await readFile(writtenPath(host), "utf8").catch(() => "{}"),
    );
    return { definition, record };
  };
  const readTarget = () => readFile(target, "utf8").catch(() => undefined);

  const own = await place("probe-plugin-own", source);
  plugins.push({
    home: homeName,
    case: "置く",
    placed: (await readTarget()) === source,
    recorded: own.record["probe-plugin-own"]?.file === target,
    target: own.record["probe-plugin-own"]?.file === target,
    destination:
      hooksTarget(definitionInfo(own.definition).file.hooks, home) === target,
  });
  await removeUserDefinition(host, "probe-plugin-own");
  plugins.push({
    home: homeName,
    case: "定義を削除",
    removed: (await readTarget()) === undefined,
  });

  await writeFile(target, "// the user's file\n");
  await place("probe-plugin-foreign", source);
  plugins.push({
    home: homeName,
    case: "利用者のファイル",
    kept: (await readTarget()) === "// the user's file\n",
  });
  await removeUserDefinition(host, "probe-plugin-foreign");
  plugins.push({
    home: homeName,
    case: "利用者のファイルは残す",
    kept: (await readTarget()) === "// the user's file\n",
  });
  await rm(target, { force: true });

  await place("probe-plugin-edited", source);
  await writeFile(target, "// the user changed iori's copy\n");
  await place("probe-plugin-edited", source);
  plugins.push({
    home: homeName,
    case: "利用者が変えた部品",
    kept: (await readTarget()) === "// the user changed iori's copy\n",
  });
  await removeUserDefinition(host, "probe-plugin-edited");
  plugins.push({
    home: homeName,
    case: "変えた部品は消さない",
    kept: (await readTarget()) === "// the user changed iori's copy\n",
  });
  return { scripts, plugins };
}

/** Exercise the real script path with a registry-only value and a Host-only secret. */
async function probeRegistryEnvironment(root) {
  const suffix = randomUUID().replaceAll("-", "");
  const names = ["VALUE", "EXPAND", "EMPTY"].map(
    (part) => `IORI_VERIFY_${part}_${suffix}`,
  );
  const secret = `IORI_VERIFY_SECRET_${suffix}`;
  const expected = `${randomUUID()} 日本語 with spaces`;
  const key = "HKCU\\Environment";
  const reg = (...args) =>
    spawnSync("reg.exe", args, { encoding: "utf8", windowsHide: true });
  const added = [];
  try {
    for (const [index, value] of [expected, `%${names[0]}%`, ""].entries()) {
      assert.notEqual(reg("query", key, "/v", names[index]).status, 0);
      const result = reg(
        "add",
        key,
        "/v",
        names[index],
        "/t",
        index === 1 ? "REG_EXPAND_SZ" : "REG_SZ",
        "/d",
        value,
        "/f",
      );
      assert.equal(result.status, 0, result.stderr);
      added.push(names[index]);
    }
    const folder = join(root, "registry scripts");
    await mkdir(folder, { recursive: true });
    const source = `if (process.env[${JSON.stringify(names[0])}] !== ${JSON.stringify(expected)} || process.env[${JSON.stringify(secret)}] !== undefined || process.env.USERNAME !== ${JSON.stringify(process.env.USERNAME)}) process.exit(3); process.stdout.write(JSON.stringify({input:12,output:3}));`;
    await writeFile(join(folder, "tokens.mjs"), source);
    const rows = await withProcessEnv(
      { [names[0]]: undefined, [secret]: "host-only" },
      async () => {
        const results = [];
        for (const id of ["powershell", "cmd"]) {
          const run = (path) =>
            scriptSessionTokens(`registry-${id}`, path, {
              script: "tokens.mjs",
            }).read({ id: "verify-session" }, shellOf(id), root);
          const tokens = await run(folder);
          results.push({
            shell: id,
            passed: tokens?.input === 12 && tokens?.output === 3,
          });
        }
        return results;
      },
    );
    return { rows };
  } finally {
    const failures = [];
    for (const name of added) {
      const result = reg("delete", key, "/v", name, "/f");
      if (result.status !== 0) failures.push(`${name}: ${result.stderr}`);
    }
    assert.deepEqual(failures, []);
  }
}

async function checkWindows() {
  const root = join(process.cwd(), `cli-definitions-${Date.now()}`);
  const receiver = await hookReceiver();
  const rows = [];
  const writes = [];
  const removals = [];
  try {
    const scripts = [];
    const plugins = [];
    for (const name of ["ascii", "日本語"]) {
      const home = join(root, name);
      await mkdir(home, { recursive: true });
      const probed = await probeHome(name, home, receiver);
      rows.push(...probed.rows);
      writes.push(...probed.writes);
      removals.push(...probed.removals);
      const parts = await probeScriptsAndParts(name, home, receiver);
      scripts.push(...parts.scripts);
      plugins.push(...parts.plugins);
    }
    const registry = await probeRegistryEnvironment(root);
    // The verification HOMEs go before the result is kept.
    await receiver.close();
    await rm(root, { recursive: true, force: true });
    const result = {
      codePage: spawnSync(process.env.ComSpec, ["/d", "/c", "chcp"], {
        encoding: "utf8",
      }).stdout.trim(),
      msysSwitches: spawnSync(
        "C:\\Program Files\\Git\\bin\\bash.exe",
        [
          "-c",
          `${process.execPath.replaceAll("\\", "/")} -e 'console.log(JSON.stringify(process.argv.slice(1)))' -- /d /c`,
        ],
        { encoding: "utf8" },
      ).stdout.trim(),
      homeRemoved: !(await exists(root)),
      rows,
      writes,
      removals,
      scripts,
      plugins,
      registry,
      passed:
        registry.rows.every((row) => row.passed) &&
        rows.every((row) => row.passed) &&
        writes.every(
          (write) =>
            write.insideHome &&
            write.recorded &&
            write.userKept !== false &&
            write.newlines &&
            write.owners.length === 1 &&
            write.owners[0] === write.id &&
            !write.missing.length &&
            !write.unexpected &&
            write.formExpected,
        ) &&
        removals.every(
          (removal) =>
            removal.restored !== false &&
            removal.removed !== false &&
            removal.createdMarker !== false &&
            removal.record !== false,
        ) &&
        scripts.every((script) =>
          script.kind === "tokens"
            ? script.tokens?.input === 12 &&
              script.tokens?.output === 3 &&
              script.tokens?.cacheRead === 4 &&
              script.separateProcess &&
              script.envKeptOut
            : script.windows === 1 &&
              script.usage?.windows[0]?.remaining === 42,
        ) &&
        plugins.every(
          (plugin) =>
            plugin.placed !== false &&
            plugin.recorded !== false &&
            plugin.destination !== false &&
            plugin.removed !== false &&
            plugin.kept !== false,
        ) &&
        !(await exists(root)),
    };
    await writeFile(
      process.argv[process.argv.indexOf("--result") + 1],
      JSON.stringify(result, null, 2),
    );
    assert.equal(result.passed, true);
  } finally {
    await receiver.close();
    await rm(root, { recursive: true, force: true });
  }
}

if (process.platform === "win32") await checkWindows();
else {
  const { mkdtemp } = await import("node:fs/promises");
  const { tmpdir } = await import("node:os");
  const { fileURLToPath } = await import("node:url");
  const { lockEntry } = await import("../native/locks.mjs");
  await lockEntry(import.meta.url);
  const { gate, ps, windows, windowsBuildNode, windowsPnpm } =
    await import("../native/remote.mjs");
  const { windowsCache } = await import("../native/cache.mjs");
  const { writeWindows } = await import("../connection/build.mjs");
  const { createSourceArchive } = await import("../native/source.mjs");
  const { stopOwnedWindowsProcesses } = await import("../native/processes.mjs");
  gate({ requireFreePorts: false });
  // This probe opens no window and builds no native module, so it uses its own
  // source copy and the shared dependency store.
  const evidenceRoot = resolve(
    process.env.IORI_VERIFICATION_EVIDENCE_ROOT ??
      ".local/evidence/cli-definitions",
  );
  const evidence = join(evidenceRoot, `run-${Date.now()}-${process.pid}`);
  await mkdir(evidence, { recursive: true });
  const local = await mkdtemp(join(tmpdir(), "iori-cli-definitions-"));
  // The verification user's own home, as the other Windows verification machine runners find it.
  const home = windows("$env:USERPROFILE");
  const root = win32.join(
    home,
    "iori-development",
    `cli-definitions-${Date.now()}-${process.pid}`,
  );
  const resultFile = root + "\\result.json";
  try {
    const repo = fileURLToPath(new URL("../../", import.meta.url));
    const archive = join(local, "source.tar");
    await createSourceArchive(repo, archive);
    windows(`[IO.Directory]::CreateDirectory(${ps(root)}) | Out-Null`);
    await writeWindows(root + "\\source.tar", await readFile(archive));
    windows(
      `tar -xf ${ps(root + "\\source.tar")} -C ${ps(root)};if($LASTEXITCODE -ne 0){throw 'source extraction failed'};Set-Location ${ps(root)};$env:PATH=${ps(win32.dirname(windowsBuildNode) + ";")}+$env:PATH;` +
        `& ${ps(windowsBuildNode)} ${ps(windowsPnpm)} install --frozen-lockfile --ignore-scripts --store-dir ${ps(win32.join(windowsCache, "pnpm-store"))};if($LASTEXITCODE -ne 0){throw 'pnpm install failed'};` +
        `& ${ps(windowsBuildNode)} verification/cli/windows-definitions.mjs --result ${ps(resultFile)};if(-not(Test-Path -LiteralPath ${ps(resultFile)})){throw 'result missing'}`,
      { timeout: 900_000 },
    );
    const output = windows(`Get-Content -LiteralPath ${ps(resultFile)} -Raw`);
    await writeFile(join(evidence, "windows-definitions.json"), output + "\n");
    const result = JSON.parse(output);
    console.log(
      JSON.stringify({
        passed: result.passed,
        rows: result.rows?.length,
        writes: result.writes?.length,
        removals: result.removals?.length,
        scripts: result.scripts,
        registry: result.registry,
        plugins: result.plugins,
        error: result.error,
      }),
    );
    assert.equal(result.passed, true);
  } finally {
    stopOwnedWindowsProcesses(root);
    windows(
      `Remove-Item -LiteralPath ${ps(root)} -Recurse -Force -ErrorAction SilentlyContinue`,
    );
    await rm(local, { recursive: true, force: true });
  }
}
