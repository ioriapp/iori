import assert from "node:assert/strict";
import { existsSync, watch } from "node:fs";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";
import { writeFakeCli } from "../../verification/host/environment.mjs";
import { runHostTest } from "../../verification/host/process.mjs";
import { stopTerminalDaemon } from "../../verification/terminal/daemon-process.mjs";

function fakeCodexSource(dataRoot, options = {}) {
  return `import { existsSync, unlinkSync, watch, writeFileSync } from "node:fs";
import { appendFile, readFile, writeFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { join } from "node:path";
import { createInterface } from "node:readline";

const root = ${JSON.stringify(dataRoot)};
const delayVersionUntilFlags = ${JSON.stringify(Boolean(options.delayVersionUntilFlags))};
const exclusiveAppServerInit = ${JSON.stringify(Boolean(options.exclusiveAppServerInit))};
const startedFlag = join(root, "version-probe-started");
const armFlag = join(root, "arm-version-delay");
const trustFlag = join(root, "trust-completed");
const initLockFile = join(root, "app-server-init.lock");
const initStartedFlag = join(root, "app-server-init-started");
const launchSentFlag = join(root, "launch-sent");
const launchLog = join(root, "codex-launches.jsonl");

function findHookCommand(node) {
  if (!node || typeof node !== "object") return undefined;
  if (typeof node.command === "string") return node.command;
  if (Array.isArray(node)) {
    for (const item of node) {
      const found = findHookCommand(item);
      if (found) return found;
    }
    return undefined;
  }
  for (const value of Object.values(node)) {
    const found = findHookCommand(value);
    if (found) return found;
  }
  return undefined;
}

function waitForConditions(check, delayMs) {
  return new Promise((resolve) => {
    let settled = false;
    let watcher;
    const ready = () => {
      if (settled || !check()) return;
      settled = true;
      watcher?.close();
      setTimeout(resolve, delayMs);
    };
    watcher = watch(root, ready);
    ready();
  });
}

if (process.argv.includes("--version")) {
  if (delayVersionUntilFlags) {
    await writeFile(startedFlag, "");
    await waitForConditions(
      () => existsSync(armFlag) && existsSync(trustFlag),
      400,
    );
  }
  console.log("codex-cli 0.162.1");
} else if (process.argv[2] === "app-server") {
  let ownsInitLock = false;
  const releaseInitLock = () => {
    if (!ownsInitLock) return;
    ownsInitLock = false;
    try {
      unlinkSync(initLockFile);
    } catch {
      /* Ignore already removed lock during teardown. */
    }
  };
  if (exclusiveAppServerInit) {
    try {
      writeFileSync(initLockFile, String(process.pid), { flag: "wx" });
      ownsInitLock = true;
    } catch (error) {
      if (error?.code === "EEXIST") {
        process.stderr.write("failed to initialize sqlite state runtime\\n");
        process.exit(1);
      }
      throw error;
    }
    process.once("exit", releaseInitLock);
    process.once("SIGTERM", () => {
      releaseInitLock();
      process.exit(0);
    });
  }
  for await (const line of createInterface({
    input: process.stdin,
    terminal: false,
  })) {
    if (!line.trim()) continue;
    const message = JSON.parse(line);
    if (message.method === "initialize" && exclusiveAppServerInit) {
      await writeFile(initStartedFlag, "");
      await waitForConditions(() => existsSync(launchSentFlag), 250);
      releaseInitLock();
    }
    if (message.method === "hooks/list") writeFileSync(trustFlag, "");
    if (message.id === undefined) continue;
    const result =
      message.method === "hooks/list"
        ? { hooks: [] }
        : message.method === "account/rateLimits/read"
          ? { rateLimits: {} }
          : {};
    process.stdout.write(JSON.stringify({ id: message.id, result }) + "\\n");
  }
  releaseInitLock();
} else {
  const args = process.argv.slice(2);
  await appendFile(
    launchLog,
    JSON.stringify({
      argv: args,
      hookUrl: process.env.IORI_CLI_HOOK_URL ?? "",
    }) + "\\n",
  );
  const previous = await readFile(launchLog, "utf8");
  const count = previous.trim().split("\\n").filter(Boolean).length;
  if (!args.includes("resume")) {
    const home = process.env.HOME || process.env.USERPROFILE || "";
    const hooksFile = join(home, ".codex", "hooks.json");
    if (existsSync(hooksFile)) {
      const parsed = JSON.parse(await readFile(hooksFile, "utf8"));
      const command = findHookCommand(parsed.hooks?.SessionStart);
      if (command) {
        spawnSync(command, {
          shell: true,
          input: JSON.stringify({
            session_id: "fake-codex-session-1",
            hook_event_name: "SessionStart",
            cwd: process.cwd(),
            source: "startup",
          }),
          stdio: ["pipe", "ignore", "ignore"],
        });
      }
    }
  }
  console.log(\`CODEX_LAUNCHED:\${count}\`);
  process.stdin.resume();
}
`;
}

function waitForFile(t, directory, path) {
  return new Promise((resolve, reject) => {
    if (existsSync(path)) {
      resolve();
      return;
    }
    const watcher = watch(directory, () => {
      if (!existsSync(path)) return;
      watcher.close();
      resolve();
    });
    watcher.once("error", reject);
    t.after(() => watcher.close());
    if (existsSync(path)) {
      watcher.close();
      resolve();
    }
  });
}

async function readLaunchLog(dataRoot) {
  return (await readFile(join(dataRoot, "codex-launches.jsonl"), "utf8"))
    .trim()
    .split("\n")
    .map((line) => JSON.parse(line));
}

async function launchAndVerifyCodexResume(
  t,
  { client, dataRoot, restart, stage },
  { setupStage, cliOptions, waitFlag, releaseFlag, launchStage, checkNoDaemon },
) {
  stage(setupStage);
  await writeFakeCli(
    join(dataRoot, "bin"),
    "codex",
    fakeCodexSource(dataRoot, cliOptions),
  );
  const events = await client.events();
  await events.waitFor((event) => event.type === "snapshot");

  stage(launchStage);
  await client.request("cli.list");
  await waitForFile(t, dataRoot, join(dataRoot, waitFlag));
  await writeFile(join(dataRoot, releaseFlag), "");
  const { terminal: created } = await client.request("cli.launch", {
    cliId: "codex",
    cwd: dataRoot,
  });
  const terminal = await client.terminal(created.id);
  await terminal.output("CODEX_LAUNCHED:1");

  const launchLines = await readLaunchLog(dataRoot);
  if (checkNoDaemon) {
    assert.ok(
      launchLines[0].argv.includes("--no-daemon"),
      `初回起動引数に--no-daemonが必要: ${JSON.stringify(launchLines[0])}`,
    );
  }
  assert.ok(
    launchLines[0].hookUrl.length > 0,
    `初回起動にIORI_CLI_HOOK_URLが必要: ${JSON.stringify(launchLines[0])}`,
  );

  await events.waitFor(
    (event) =>
      event.type === "terminal.updated" &&
      event.terminal.id === created.id &&
      event.terminal.cliStatus !== undefined,
  );

  stage("デーモン停止とHost再起動後にCodexを再開する");
  await stopTerminalDaemon(join(dataRoot, "iori-host"));
  await events.waitFor(
    (event) =>
      event.type === "terminal.updated" &&
      event.terminal.id === created.id &&
      event.terminal.cliResumePending === true,
  );
  const reconnected = await restart();
  const resumed = await reconnected.terminal(created.id);
  await reconnected.request("cli.resume", { terminalId: created.id });
  await resumed.output("CODEX_LAUNCHED:2");

  const allLaunches = await readLaunchLog(dataRoot);
  assert.equal(allLaunches.length, 2);
  assert.ok(
    allLaunches[1].argv.includes("resume") &&
      allLaunches[1].argv.includes("fake-codex-session-1"),
    `再開引数に会話IDが必要: ${JSON.stringify(allLaunches[1])}`,
  );
}

test("バージョン確認の完了前に起動したCodexでもhookと会話IDを引き継いで再開する", (t) =>
  runHostTest(t, (context) =>
    launchAndVerifyCodexResume(t, context, {
      setupStage: "バージョン確認が遅れる偽Codexを用意する",
      cliOptions: { delayVersionUntilFlags: true },
      waitFlag: "version-probe-started",
      releaseFlag: "arm-version-delay",
      launchStage:
        "一覧取得でバージョン確認を開始させ、完了前にCodexを起動する",
      checkNoDaemon: true,
    }),
  ));

test("Codexの利用枠取得と同時でもhookを取り付けて会話IDを引き継いで再開する", (t) =>
  runHostTest(t, (context) =>
    launchAndVerifyCodexResume(t, context, {
      setupStage: "同時app-server初期化を拒否する偽Codexを用意する",
      cliOptions: { exclusiveAppServerInit: true },
      waitFlag: "app-server-init-started",
      releaseFlag: "launch-sent",
      launchStage: "利用枠取得の初期化中にCodexを起動する",
      checkNoDaemon: false,
    }),
  ));
