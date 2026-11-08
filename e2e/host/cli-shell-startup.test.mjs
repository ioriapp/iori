import assert from "node:assert/strict";
import {
  appendFile,
  chmod,
  readFile,
  realpath,
  writeFile,
} from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { stripVTControlCharacters } from "node:util";
import test from "node:test";
import { stopTerminalDaemon } from "../../verification/terminal/daemon-process.mjs";
import { runHostTest } from "../../verification/host/process.mjs";
import { registerScriptedCli } from "../../verification/host/scripted-definition.mjs";

async function registerExitCli(client, dataRoot) {
  const actor = join(dataRoot, "exit-cli.mjs");
  await writeFile(
    actor,
    'console.log("ACTOR_READY:" + crypto.randomUUID()); console.log("SCREEN_SAVED:" + crypto.randomUUID()); process.stdin.once("data", () => { console.log("ACTOR_INPUT"); process.exit(0); });\n',
  );
  const { cliId } = await client.request("cli.definition.save", {
    definition: JSON.stringify({
      schema: 1,
      id: "exit-cli",
      name: "Exit CLI",
      command: { shell: `'${process.execPath}' '${actor}'` },
    }),
  });
  return cliId;
}

test("Bashの利用者設定が別のshellへ移る前からioriを使える", (t) =>
  runHostTest(t, async ({ client, dataRoot, stage }) => {
    stage("利用者設定でioriの場所を確認し、別のBashへ移る");
    const marker = join(dataRoot, "profile-command");
    await writeFile(
      join(dataRoot, "home", ".bash_profile"),
      `command -v iori > '${marker}' || :\nexec /bin/bash --noprofile --norc -i\n`,
    );
    await client.request("terminal.defaultShell.set", { shell: "bash" });
    const cliId = await registerExitCli(client, dataRoot);
    const { terminal: created } = await client.request("cli.launch", {
      cliId,
      cwd: dataRoot,
    });
    const terminal = await client.terminal(created.id);
    await terminal.output("ACTOR_READY");
    assert.match(await readFile(marker, "utf8"), /\/iori\s*$/u);
  }));

test("シェル統合の資材を書けなくてもCLIを起動できる", (t) =>
  runHostTest(t, async ({ client, dataRoot, stage }) => {
    stage("シェル統合の保存先を作れない状態にする");
    await writeFile(
      join(dataRoot, "iori-host", "shell-integration"),
      "blocked",
    );
    await client.request("terminal.defaultShell.set", { shell: "bash" });
    const cliId = await registerExitCli(client, dataRoot);
    stage("CLIを開く");
    const { terminal: created } = await client.request("cli.launch", {
      cliId,
      cwd: dataRoot,
    });
    const terminal = await client.terminal(created.id);
    await terminal.output("ACTOR_READY");
  }));

test("準備の印のないBashで入力するとCLIの起動を取り消し、後の印でも起動しない", (t) =>
  runHostTest(t, async ({ client, dataRoot, stage }) => {
    stage("Bashの入力準備の印を無効にする");
    const inputrc = join(dataRoot, "home", ".inputrc");
    await writeFile(inputrc, "set enable-bracketed-paste off\n");
    for (const file of [".bash_profile", ".bashrc"])
      await appendFile(
        join(dataRoot, "home", file),
        `export INPUTRC='${inputrc}'\nPS1='IORI_TEST_PROMPT# '\n`,
      );
    await client.request("terminal.defaultShell.set", { shell: "bash" });
    const cliId = await registerExitCli(client, dataRoot);
    const events = await client.events();
    await events.waitFor((event) => event.type === "snapshot");
    stage("CLIを開き、Bashのプロンプトに通常の文字を入力する");
    const { terminal: created } = await client.request("cli.launch", {
      cliId,
      cwd: dataRoot,
    });
    const terminal = await client.terminal(created.id);
    await terminal.output("IORI_TEST_PROMPT# ");
    await terminal.input("b");
    await events.waitFor(
      (event) =>
        event.type === "terminal.updated" &&
        event.terminal.id === created.id &&
        !event.terminal.cli,
    );
    stage("後から準備の印が出たshellでも利用者のコマンドを実行できる");
    await writeFile(inputrc, "set enable-bracketed-paste on\n");
    await terminal.input("ash\r");
    await terminal.waitFor(({ output }) => output.includes("\u001b[?2004h"));
    await terminal.input("printf '%s%s\\n' 'SHELL_' 'CONTINUES'\r");
    const output = await terminal.output("SHELL_CONTINUES");
    assert.doesNotMatch(output, /ACTOR_READY/u);
    const list = await client.request("terminal.list");
    assert.ok(!list.terminals.find((item) => item.id === created.id)?.cli);
  }));

test("会話IDのないCLIは再開で元のコマンドを起動する", (t) =>
  runHostTest(t, async ({ client, dataRoot, stage }) => {
    stage("会話IDを送らないCLIを起動する");
    const cliId = await registerExitCli(client, dataRoot);
    const events = await client.events();
    await events.waitFor((event) => event.type === "snapshot");
    const { terminal: created } = await client.request("cli.launch", {
      cliId,
      cwd: dataRoot,
    });
    const first = await client.terminal(created.id);
    const { output } = await first.waitFor(({ output }) =>
      /ACTOR_READY:([a-f0-9-]+)\r?\n/u.test(output),
    );
    const firstStart = output.match(/ACTOR_READY:([a-f0-9-]+)\r?\n/u)[1];
    stage("専用のTerminalの係を停止し、再開を選ぶ");
    await stopTerminalDaemon(join(dataRoot, "iori-host"));
    await events.waitFor(
      (event) =>
        event.type === "terminal.updated" &&
        event.terminal.id === created.id &&
        event.terminal.cliResumePending,
    );
    const resumed = await client.terminal(created.id);
    await client.request("cli.resume", { terminalId: created.id });
    stage("元のCLIが再び入力を受け付ける");
    await resumed.waitFor(({ output }) =>
      [...output.matchAll(/ACTOR_READY:([a-f0-9-]+)\r?\n/gu)].some(
        (match) => match[1] !== firstStart,
      ),
    );
  }));

test("Hostの再起動と係の停止後も再開待ちの画面に最後の出力が残る", (t) =>
  runHostTest(t, async ({ client, dataRoot, restart, stage }) => {
    stage("CLIが表示した画面を確認する");
    const cliId = await registerExitCli(client, dataRoot);
    const events = await client.events();
    await events.waitFor((event) => event.type === "snapshot");
    const { terminal: created } = await client.request("cli.launch", {
      cliId,
      cwd: dataRoot,
    });
    const terminal = await client.terminal(created.id);
    const { output } = await terminal.waitFor(({ output }) =>
      /SCREEN_SAVED:([a-f0-9-]+)\r?\n/u.test(output),
    );
    const marker = output.match(/SCREEN_SAVED:([a-f0-9-]+)\r?\n/u)[0].trim();
    stage("Hostを再起動し、専用のTerminalの係を停止する");
    const restarted = await restart();
    const restartedEvents = await restarted.events();
    await restartedEvents.waitFor((event) => event.type === "snapshot");
    await stopTerminalDaemon(join(dataRoot, "iori-host"));
    await restartedEvents.waitFor(
      (event) =>
        event.type === "terminal.updated" &&
        event.terminal.id === created.id &&
        event.terminal.cliResumePending,
    );
    stage("再開待ちの画面に最後の出力が残る");
    const restored = await restarted.terminal(created.id);
    await restored.output(marker);
  }));

test("再開待ちのCLIを閉じるとTerminalの一覧から消える", (t) =>
  runHostTest(t, async ({ client, dataRoot, stage }) => {
    stage("CLIを開き、専用のTerminalの係を停止する");
    const cliId = await registerExitCli(client, dataRoot);
    const events = await client.events();
    await events.waitFor((event) => event.type === "snapshot");
    const { terminal: created } = await client.request("cli.launch", {
      cliId,
      cwd: dataRoot,
    });
    const terminal = await client.terminal(created.id);
    await terminal.output("ACTOR_READY");
    await stopTerminalDaemon(join(dataRoot, "iori-host"));
    await events.waitFor(
      (event) =>
        event.type === "terminal.updated" &&
        event.terminal.id === created.id &&
        event.terminal.cliResumePending,
    );
    stage("再開せず閉じる");
    await client.request("terminal.close", { terminalId: created.id });
    const listed = await client.request("terminal.list");
    assert.equal(
      listed.terminals.some((item) => item.id === created.id),
      false,
    );
  }));

test("会話IDを持つCLIは再開で同じ会話IDを受け取る", (t) =>
  runHostTest(t, async ({ client, dataRoot, stage }) => {
    stage("会話IDをhookで知らせるCLIを登録する");
    const actor = join(dataRoot, "session-cli.mjs");
    const hook = fileURLToPath(
      new URL("../../apps/host/src/cli/hook-script.mjs", import.meta.url),
    );
    await writeFile(
      actor,
      `import { spawn } from 'node:child_process';\nconst index = process.argv.indexOf('--resume');\nconst id = index < 0 ? 'session-one' : process.argv[index + 1];\nconst child = spawn(process.execPath, [${JSON.stringify(hook)}, 'SessionStart', '-'], { stdio: ['pipe', 'ignore', 'inherit'] });\nchild.stdin.end(JSON.stringify({ session_id: id, cwd: process.cwd(), source: index < 0 ? 'startup' : 'resume' }));\nawait new Promise((resolve, reject) => { child.once('error', reject); child.once('exit', code => code === 0 ? resolve() : reject(new Error('hook failed'))); });\nconsole.log((index < 0 ? 'START:' : 'RESUME:') + id);\nprocess.stdin.resume();\n`,
    );
    const { cliId } = await client.request("cli.definition.save", {
      definition: JSON.stringify({
        schema: 1,
        id: "session-cli",
        name: "Session CLI",
        command: { shell: `'${process.execPath}' '${actor}'` },
        resume: { args: ["--resume", "{sessionId}"] },
        hooks: {
          format: "claude-settings",
          file: join(dataRoot, "session-settings.json"),
          sessionId: "session_id",
          rules: [{ event: "SessionStart", state: "idle" }],
        },
      }),
    });
    const events = await client.events();
    await events.waitFor((event) => event.type === "snapshot");
    const { terminal: created } = await client.request("cli.launch", {
      cliId,
      cwd: dataRoot,
    });
    const first = await client.terminal(created.id);
    await first.output("START:session-one");
    stage("専用のTerminalの係の停止後にCLIを再開する");
    await stopTerminalDaemon(join(dataRoot, "iori-host"));
    await events.waitFor(
      (event) =>
        event.type === "terminal.updated" &&
        event.terminal.id === created.id &&
        event.terminal.cliResumePending,
    );
    const resumed = await client.terminal(created.id);
    await client.request("cli.resume", { terminalId: created.id });
    stage("再開したCLIに同じ会話IDが渡る");
    await resumed.output("RESUME:session-one");
  }));

test("保存した起動引数をCLIの新規起動と再開に渡す", (t) =>
  runHostTest(t, async ({ client, dataRoot, stage }) => {
    stage("引数を表示するCLIを登録し、引用符付きの起動引数を保存する");
    const actor = join(dataRoot, "bin", "args-cli");
    await writeFile(
      actor,
      '#!/usr/bin/env node\nconsole.log("ARGS:" + crypto.randomUUID() + ":" + JSON.stringify(process.argv.slice(2))); process.stdin.resume();\n',
    );
    await chmod(actor, 0o755);
    const { cliId } = await client.request("cli.definition.save", {
      definition: JSON.stringify({
        schema: 1,
        id: "args-cli",
        name: "Arguments CLI",
        command: "args-cli",
      }),
    });
    await client.request("cli.arguments.set", {
      cliId,
      arguments: '--model "two words"',
    });
    const events = await client.events();
    await events.waitFor((event) => event.type === "snapshot");
    stage("新規起動したCLIが引数を受け取る");
    const { terminal: created } = await client.request("cli.launch", {
      cliId,
      cwd: dataRoot,
    });
    const first = await client.terminal(created.id);
    const { output } = await first.waitFor(({ output }) =>
      /ARGS:([a-f0-9-]+):\["--model","two words"\]\r?\n/u.test(output),
    );
    const firstStart = output.match(
      /ARGS:([a-f0-9-]+):\["--model","two words"\]\r?\n/u,
    )[1];
    stage("専用のTerminalの係を停止し、再開する");
    await stopTerminalDaemon(join(dataRoot, "iori-host"));
    await events.waitFor(
      (event) =>
        event.type === "terminal.updated" &&
        event.terminal.id === created.id &&
        event.terminal.cliResumePending,
    );
    const resumed = await client.terminal(created.id);
    await client.request("cli.resume", { terminalId: created.id });
    stage("再開したCLIも同じ引数を受け取る");
    await resumed.waitFor(({ output }) =>
      [
        ...output.matchAll(
          /ARGS:([a-f0-9-]+):\["--model","two words"\]\r?\n/gu,
        ),
      ].some((match) => match[1] !== firstStart),
    );
  }));

test("CLIの定義を削除しても実行中のCLIを使い続けられる", (t) =>
  runHostTest(t, async ({ client, dataRoot, stage }) => {
    stage("CLIを開く");
    const cliId = await registerExitCli(client, dataRoot);
    const { terminal: created } = await client.request("cli.launch", {
      cliId,
      cwd: dataRoot,
    });
    const terminal = await client.terminal(created.id);
    await terminal.output("ACTOR_READY");
    stage("定義を削除し、開いたCLIに入力する");
    await client.request("cli.definition.remove", { cliId });
    await terminal.input("continue\r");
    await terminal.output("ACTOR_INPUT");
  }));

test("CLIの起動後もshellの履歴に素の起動コマンドが残る", (t) =>
  runHostTest(t, async ({ client, dataRoot, stage }) => {
    stage("BashでCLIを開く");
    await client.request("terminal.defaultShell.set", { shell: "bash" });
    const cliId = await registerExitCli(client, dataRoot);
    const events = await client.events();
    await events.waitFor((event) => event.type === "snapshot");
    const { terminal: created } = await client.request("cli.launch", {
      cliId,
      cwd: dataRoot,
    });
    const terminal = await client.terminal(created.id);
    await terminal.output("ACTOR_READY");
    stage("CLIを終了し、履歴の直前のコマンドを呼び戻す");
    await terminal.input("exit\r");
    await events.waitFor(
      (event) =>
        event.type === "terminal.updated" &&
        event.terminal.id === created.id &&
        !event.terminal.cli,
    );
    const prompt = await terminal.waitFor(({ output }) =>
      /ACTOR_INPUT\r?\n[^\n]*[#$] $/u.test(stripVTControlCharacters(output)),
    );
    const before = prompt.output.length;
    await terminal.input("\u001b[A");
    const command = `'${process.execPath}' '${join(dataRoot, "exit-cli.mjs")}'`;
    const { output } = await terminal.waitFor(({ output }) =>
      output.slice(before).includes(command),
    );
    assert.doesNotMatch(output, /printf/u);
    assert.equal(
      output
        .slice(before)
        .replace(/\u001b\[[0-?]*[ -/]*[@-~]/gu, "")
        .replace(/[\r\b]/gu, "")
        .trim(),
      command,
    );
  }));

test("CLIのhookに応じて応答中と完了を知らせる", (t) =>
  runHostTest(t, async ({ client, dataRoot, stage }) => {
    stage("hook付きの台本CLIを起動する");
    const cliId = await registerScriptedCli(client, dataRoot);
    const events = await client.events();
    await events.waitFor((event) => event.type === "snapshot");
    const { terminal: created } = await client.request("cli.launch", {
      cliId,
      cwd: dataRoot,
    });
    const terminal = await client.terminal(created.id);
    await terminal.output("ACTOR_READY");
    stage("CLIの依頼開始で応答中を知らせる");
    await terminal.input(
      JSON.stringify({ id: "start", hook: "UserPromptSubmit" }) + "\r",
    );
    await events.waitFor(
      (event) =>
        event.type === "terminal.updated" &&
        event.terminal.id === created.id &&
        event.terminal.cliStatus?.state === "active",
    );
    await terminal.output("ACTOR_HOOK:start");
    stage("CLIの応答終了で完了を知らせる");
    await terminal.input(JSON.stringify({ id: "stop", hook: "Stop" }) + "\r");
    await events.waitFor(
      (event) =>
        event.type === "terminal.updated" &&
        event.terminal.id === created.id &&
        event.terminal.cliStatus?.state === "done",
    );
  }));

test("dashと同じ実体の既定shellでCLIを開き、終了後に同じshellを使う", (t) =>
  runHostTest(t, async ({ client, dataRoot, stage }) => {
    stage("dashと同じ実体のshellを既定にする");
    const list = await client.request("terminal.list");
    const dash = await realpath(join(dataRoot, "bin", "dash"));
    const candidates = await Promise.all(
      list.shells.map(async (item) => ({
        ...item,
        executable: await realpath(join(dataRoot, "bin", item.id)).catch(
          () => undefined,
        ),
      })),
    );
    const shell = candidates.find((item) => item.executable === dash);
    assert.ok(shell, "dashの実体がshell一覧にある");
    await client.request("terminal.defaultShell.set", { shell: shell.id });
    const cliId = await registerExitCli(client, dataRoot);
    const events = await client.events();
    await events.waitFor((event) => event.type === "snapshot");
    stage("台本のCLIを既定shellで起動する");
    const { terminal: created } = await client.request("cli.launch", {
      cliId,
      cwd: dataRoot,
    });
    const terminal = await client.terminal(created.id);
    await terminal.output("ACTOR_READY");
    stage("CLI終了後に同じTerminalのshellでコマンドを実行する");
    await terminal.input("exit\r");
    await events.waitFor(
      (event) =>
        event.type === "terminal.updated" &&
        event.terminal.id === created.id &&
        !event.terminal.cli,
    );
    await terminal.input("printf '%s%s\\n' 'DASH_' 'CONTINUES'\r");
    await terminal.output("DASH_CONTINUES");
  }));
