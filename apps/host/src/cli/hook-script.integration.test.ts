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
import { execFile, execFileSync, spawn } from "node:child_process";
import { promisify } from "node:util";
import { createServer } from "node:http";
import { fileURLToPath } from "node:url";
import { hookInstallContext, removeCliHooks } from "./hook-install.ts";
import { hooks as antigravity } from "./antigravity/hooks.ts";
import { hooks as cursor } from "./cursor/hooks.ts";
import { hooks as claude } from "./claude/hooks.ts";
import { cliDefinitions } from "./definitions.ts";

test("Muse の背景の subagent の hook は iori へ届かず、主の hook は届く", async () => {
  const received: string[] = [];
  const server = createServer((req, res) => {
    let body = "";
    req.on("data", (chunk) => (body += chunk));
    req.on("end", () => {
      received.push(JSON.parse(body).hook_event_name);
      res.end();
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  try {
    const address = server.address();
    assert.ok(address && typeof address !== "string");
    const environment = cliDefinitions
      .find((definition) => definition.id === "muse-code")
      ?.launchEnvironment?.();
    assert.ok(environment?.IORI_CLI_HOOK_ADAPTER);
    for (const [event, session, thread] of [
      ["Stop", "main", "main"],
      ["PreToolUse", "main", "background"],
      ["PostToolUse", "main", "background"],
      ["UserPromptSubmit", "main", "main"],
      ["StopFailure", undefined, "main"],
      ["SessionEnd", "main", undefined],
    ]) {
      const child = spawn(
        process.execPath,
        [fileURLToPath(new URL("./hook-script.mjs", import.meta.url))],
        {
          env: {
            ...process.env,
            ...environment,
            IORI_CLI_HOOK_URL: `http://127.0.0.1:${address.port}/`,
            MUSE_SESSION_ID: session,
            MUSE_THREAD_ID: thread,
          },
          stdio: ["pipe", "ignore", "ignore"],
        },
      );
      const closed = new Promise((resolve, reject) => {
        child.once("error", reject);
        child.once("close", resolve);
      });
      child.stdin.end(JSON.stringify({ hook_event_name: event }));
      assert.equal(await closed, 0);
    }
    assert.deepEqual(received, [
      "Stop",
      "UserPromptSubmit",
      "StopFailure",
      "SessionEnd",
    ]);
  } finally {
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
  }
});

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

test("チームの hook が対応するイベントで指示を返し、すべてのイベントを Host に届ける", async (t) => {
  const dir = await mkdtemp(join(tmpdir(), "iori-instructions-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const file = join(dir, "instructions.md");
  const content = "チームの指示\nsecond line";
  await writeFile(file, content);
  const events: string[] = [];
  const server = createServer(async (req, res) => {
    let body = "";
    for await (const chunk of req) body += chunk;
    events.push(JSON.parse(body).hook_event_name);
    res.end();
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(() => new Promise<void>((resolve) => server.close(() => resolve())));
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  const url = `http://127.0.0.1:${address.port}/`;
  const expectedEvents: string[] = [];
  for (const [id, event, expected, once] of [
    [
      "antigravity",
      "SessionStart",
      { injectSteps: [{ systemMessage: { systemMessage: content } }] },
    ],
    ["kiro", "SessionStart", content],
    [
      "vtcode",
      "session_start",
      {
        hookSpecificOutput: {
          hookEventName: "SessionStart",
          additionalContext: content,
        },
      },
    ],
    ["kimi-code", "UserPromptSubmit", { message: content }, true],
    ["hermes", "pre_llm_call", { context: content }, true],
    [
      "vibe",
      "session_start",
      { hook_specific_output: { additional_context: content } },
    ],
  ] as const) {
    const launch = {
      candidate: { cli: id, id: "parent", model: "", tools: [], minimum: "" },
      trustWorkspace: false,
      instructions: content,
      instructionFile: file,
      commandDirectory: dir,
      teamFilesDirectory: dir,
    };
    const definition = cliDefinitions.find((cli) => cli.id === id)!;
    const environment = definition.launchEnvironment?.(launch);
    assert.equal(
      {
        ...definition.launchEnvironment?.({ ...launch, resume: true }),
        ...definition.teamEnvironment?.(launch),
      }.IORI_CLI_HOOK_INSTRUCTION_FILE,
      undefined,
    );
    const call = async (
      name: string,
      registeredId = id as string,
      hookUrl = url,
      instructionFile = environment?.IORI_CLI_HOOK_INSTRUCTION_FILE,
    ) => {
      const reply =
        id === "antigravity"
          ? Buffer.from(
              name === "PreToolUse" ? '{"decision":"ask"}' : "{}",
            ).toString("base64url")
          : "-";
      if (hookUrl) expectedEvents.push(name);
      const result = promisify(execFile)(
        process.execPath,
        [
          fileURLToPath(new URL("./hook-script.mjs", import.meta.url)),
          id === "kiro" ? "-" : name,
          reply,
          registeredId,
        ],
        {
          env: {
            ...process.env,
            ...environment,
            IORI_CLI_HOOK_URL: hookUrl,
            IORI_CLI_HOOK_INSTRUCTION_FILE: instructionFile,
          },
        },
      );
      result.child.stdin!.end(JSON.stringify({ hook_event_name: name }));
      return (await result).stdout;
    };
    assert.equal(
      await call(event),
      (typeof expected === "string" ? expected : JSON.stringify(expected)) +
        "\n",
      id,
    );
    if (once) {
      assert.equal(await call(event), "");
      await rm(environment!.IORI_CLI_HOOK_INSTRUCTION_ONCE!);
    }
    if (id === "antigravity") {
      assert.equal(await call(event, "another"), "{}\n");
      assert.equal(await call(event, id, ""), "{}\n");
      assert.equal(await call(event, id, url, join(dir, "missing")), "{}\n");
      assert.equal(await call("PreToolUse"), '{"decision":"ask"}\n');
    }
  }
  assert.deepEqual(events, expectedEvents);
});

test("Amp は最初の agent.start だけに非表示のチームの指示を返す", async (t) => {
  const dir = await mkdtemp(join(tmpdir(), "iori-amp-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const file = join(dir, "instructions.md");
  await writeFile(file, "Team context");
  const definition = cliDefinitions.find((cli) => cli.id === "amp")!;
  const environment = definition.launchEnvironment?.({
    candidate: { cli: "amp", id: "parent", model: "", tools: [], minimum: "" },
    trustWorkspace: false,
    instructions: "Team context",
    instructionFile: file,
    commandDirectory: dir,
    teamFilesDirectory: dir,
  });
  const output = execFileSync(
    process.execPath,
    [
      "--input-type=module",
      "-e",
      `
    import bridge from ${JSON.stringify(new URL("./amp/iori-bridge.js", import.meta.url).href)};
    const callbacks = new Map();
    bridge({on: (name, callback) => callbacks.set(name,callback)});
    const start = callbacks.get("agent.start");
    console.log(JSON.stringify([await start({}),await start({})]));
  `,
    ],
    {
      encoding: "utf8",
      env: {
        ...process.env,
        ...environment,
        IORI_CLI_HOOK_URL: "http://127.0.0.1:1/",
      },
    },
  );
  assert.deepEqual(JSON.parse(output), [
    { message: { content: "Team context", display: false } },
    null,
  ]);
});
