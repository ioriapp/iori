import assert from "node:assert/strict";
import test from "node:test";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { join, resolve } from "node:path";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { watch } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { daemonProxy } from "../../verification/host/daemon-proxy.mjs";
const run = promisify(execFile);
import { pathToFileURL } from "node:url";
import { quoteShellWord } from "../../verification/host/environment.mjs";
import { runHostTest } from "../../verification/host/process.mjs";

async function daemonThreadCount(pid) {
  if (process.platform === "linux") {
    const status = await readFile(`/proc/${pid}/status`, "utf8");
    const match = status.match(/^Threads:\s*(\d+)/mu);
    assert.ok(match, "expected Threads line in /proc/<pid>/status");
    return Number(match[1]);
  }
  if (process.platform === "win32") {
    const { stdout } = await run(
      "powershell.exe",
      [
        "-NoProfile",
        "-NonInteractive",
        "-Command",
        "(Get-Process -Id ([int]$env:IORI_DAEMON_PID)).Threads.Count",
      ],
      {
        windowsHide: true,
        env: { ...process.env, IORI_DAEMON_PID: String(pid) },
      },
    );
    const count = Number(stdout.trim());
    assert.ok(
      Number.isInteger(count) && count > 0,
      `unexpected thread count: ${stdout}`,
    );
    return count;
  }
  throw new Error(`Unsupported platform: ${process.platform}`);
}

test("4096文字を超え分割されたOSC 7でも作業ディレクトリを更新する", (t) =>
  runHostTest(t, async ({ client, dataRoot, stage }) => {
    const events = await client.events();
    await events.waitFor((event) => event.type === "snapshot");
    const { terminal: created } = await client.request("terminal.create", {
      cwd: dataRoot,
      ...(process.platform === "win32" ? {} : { shell: "bash" }),
    });
    const terminal = await client.terminal(created.id);
    const cwd =
      process.platform === "win32"
        ? join(dataRoot, ...Array(180).fill("日本語"))
        : dataRoot + "/" + "日本語/".repeat(180);
    const uri = pathToFileURL(cwd).href;
    assert.ok(uri.length > 4096);
    const script = `process.stdin.setRawMode(true); process.stdout.write(${JSON.stringify("\x1b]7;" + uri.slice(0, 5000))}); process.stdin.on('data', () => process.stdout.write(${JSON.stringify(uri.slice(5000) + "\x07")}));`;
    stage("未完了のOSC 7の前半がHostへ届く");
    const executable = join(dataRoot, "long-osc.mjs");
    await writeFile(executable, script);
    await terminal.input(`node ${quoteShellWord(executable)}\r`);
    await terminal.waitFor(({ output }) =>
      output.includes("\x1b]7;" + uri.slice(0, 200)),
    );
    stage("別のPTY出力でOSC 7を完了し、作業ディレクトリの通知を受ける");
    await terminal.input("x");
    const updated = await events.waitFor(
      (event) =>
        event.type === "terminal.updated" &&
        event.terminal.id === created.id &&
        (process.platform === "win32"
          ? resolve(event.terminal.cwd)
          : event.terminal.cwd) === cwd,
    );
    assert.equal(updated.terminal.cwdFromShell, true);
  }));

async function launchActor(client, dataRoot) {
  const actor = join(dataRoot, "daemon-actor.mjs");
  const route = join(dataRoot, "actor-route.json");
  const hookModule = new URL(
    "../../verification/host/send-hook.mjs",
    import.meta.url,
  ).href;
  await writeFile(
    actor,
    `
    import {watch, writeFileSync} from 'node:fs';
    import {execFile} from 'node:child_process';
    import {join} from 'node:path';
    import {hook} from ${JSON.stringify(hookModule)};
    if (process.argv.includes('--help') || process.argv.includes('--version')) { console.log('daemon-actor 1.0.0'); process.exit(0); }
    const env = Object.fromEntries(['IORI_COMMAND_DIRECTORY','IORI_COMMAND_AUTH','IORI_COMMAND_SESSION','IORI_COMMAND_BIN'].map(key=>[key,process.env[key]]));
    writeFileSync(${JSON.stringify(route)},JSON.stringify(env),{mode:0o600});
    await hook('SessionStart',{session_id:'daemon-actor',cwd:process.cwd()});
    process.stdin.setRawMode(true);
    let received = Buffer.alloc(0);
    process.stdin.on('data',data=>{ received=Buffer.concat([received,data]);console.log('INPUT_HEX:'+received.toString('hex')); });
    const handled = new Set();
    watch(process.cwd(),(_,file)=>{
      if (handled.has(file)) return; handled.add(file);
      if(file==='fire-hook') void hook('UserPromptSubmit',{session_id:'daemon-actor'});
      if(file==='fire-exit') { process.kill(process.ppid,'SIGKILL'); process.exit(7); }
      if(file==='fire-mode') process.stdout.write('\\x1b[?2004h\\x1b[?25h\\x1b[=2;1uOFFLINE_MODES\\n');
      if(file==='reset-mode') process.stdout.write('\\x1b[?2004l\\x1b[=0;1uRESET_MODES\\n');
      if(file==='fire-done') void hook('Stop',{session_id:'daemon-actor'});
      if(file==='fire-command') execFile(join(env.IORI_COMMAND_BIN, ${JSON.stringify(process.platform === "win32" ? "iori.exe" : "iori")}), ['help'], (error) => console.log('COMMAND_EXIT:'+(error?.code??0)));
    });
    process.stdout.write('\\x1b[?2004l\\x1b[=0;1uDAEMON_ACTOR_READY\\n');
  `,
  );
  const { cliId } = await client.request("cli.definition.save", {
    definition: JSON.stringify({
      schema: 1,
      id: "daemon-actor",
      name: "Daemon actor",
      command: { shell: `node ${quoteShellWord(actor)}` },
      hooks: {
        format: "claude-settings",
        file: join(dataRoot, "actor-settings.json"),
        sessionId: "session_id",
        rules: [
          { event: "SessionStart", state: "idle" },
          { event: "UserPromptSubmit", state: "active" },
          { event: "Stop", state: "done" },
        ],
      },
    }),
  });
  const { terminal: created } = await client.request("cli.launch", {
    cliId,
    cwd: dataRoot,
  });
  const terminal = await client.terminal(created.id);
  await terminal.output("DAEMON_ACTOR_READY");
  return { id: created.id, route: JSON.parse(await readFile(route, "utf8")) };
}

for (const kind of ["hook", "exit"]) {
  test(`Hostの終了と${kind}が重なっても未処理の出来事を次のHostへ配送する`, (t) =>
    runHostTest(t, async ({ client, dataRoot, restart, stage }) => {
      const actor = await launchActor(client, dataRoot);
      let proxy;
      client = await restart({
        whileStopped: async () => {
          proxy = await daemonProxy(dataRoot);
        },
      });
      t.after(() => proxy.close());
      t.signal.addEventListener("abort", () => proxy.release(), { once: true });
      stage("Hostの処理を実際のsnapshot応答の境界で保留する");
      const blocked = proxy.hold("snapshot");
      const opening = client.terminal(actor.id).catch(() => undefined);
      await blocked;
      stage("保留中のTerminalへhookまたは終了を届ける");
      await writeFile(
        join(dataRoot, kind === "hook" ? "fire-hook" : "fire-exit"),
        "",
      );
      const event = await proxy.event(kind);
      // A later command crosses the same socket after the event. Its reply
      // establishes that the Host dispatched the event without timing guesses.
      await run(
        join(
          actor.route.IORI_COMMAND_BIN,
          process.platform === "win32" ? "iori.exe" : "iori",
        ),
        ["help"],
        {
          env: { ...process.env, ...actor.route },
        },
      ).catch(() => {});
      if (event.acknowledged()) {
        proxy.release();
        await opening;
      }
      assert.equal(
        event.acknowledged(),
        false,
        "Hostの処理完了前に配送完了を返さない",
      );
      stage("Hostを中断し、再接続で未処理の出来事を受け取る");
      client = await restart({
        interrupt: true,
        whileStopped: async () => {
          proxy.release();
        },
      });
      await opening;
      const events = await client.events();
      await events.waitFor((event) => event.type === "snapshot");
      if (kind === "hook") {
        const updated = (await client.request("terminal.list")).terminals.find(
          (terminal) => terminal.id === actor.id,
        );
        if (updated?.cliStatus?.state !== "active")
          await events.waitFor(
            (event) =>
              event.type === "terminal.updated" &&
              event.terminal.id === actor.id &&
              event.terminal.cliStatus?.state === "active",
          );
      } else {
        const terminal = await client.terminal(actor.id);
        await terminal.waitFor(
          ({ frame }) =>
            frame.kind === "terminal.exit" &&
            (process.platform === "win32"
              ? frame.code !== 0
              : frame.code === 137),
        );
      }
    }));
}

test("応答ファイルを作れなくてもioriコマンドの呼び出しが終了する", (t) =>
  runHostTest(t, async ({ client, dataRoot, restart, stage }) => {
    const actor = await launchActor(client, dataRoot);
    let proxy;
    client = await restart({
      whileStopped: async () => {
        proxy = await daemonProxy(dataRoot);
      },
    });
    t.after(() => proxy.close());
    t.signal.addEventListener("abort", () => proxy.release(), { once: true });
    const terminal = await client.terminal(actor.id);
    const responseHeld = proxy.hold("command");
    let watcher;
    const requestReady = new Promise((resolve) => {
      watcher = watch(actor.route.IORI_COMMAND_DIRECTORY, (_, file) => {
        if (file?.endsWith(".request.json")) resolve(file);
      });
    });
    t.after(() => watcher.close());
    stage("本物のioriコマンドの応答を公開前で保留する");
    await writeFile(join(dataRoot, "fire-command"), "");
    const request = await requestReady;
    await responseHeld;
    stage("応答の一時ファイルを作成できない状態にする");
    await mkdir(
      join(
        actor.route.IORI_COMMAND_DIRECTORY,
        request.replace(".request.json", ".response.json.tmp"),
      ),
    );
    proxy.release();
    stage("呼び出しが失敗として終了する");
    await terminal.output("COMMAND_EXIT:1");
  }));

test("Host停止中のモード変更を再接続で復元し貼り付けとkittyキー入力へ反映する", (t) =>
  runHostTest(t, async ({ client, dataRoot, restart, stage }) => {
    const actor = await launchActor(client, dataRoot);
    const descriptorFile = join(
      dataRoot,
      "iori-host/terminal-daemon/connection.json",
    );
    const before = JSON.parse(await readFile(descriptorFile, "utf8"));
    stage("Hostの停止中にCLIがモードを変更する");
    client = await restart({
      whileStopped: () => writeFile(join(dataRoot, "fire-mode"), ""),
    });
    assert.equal(
      JSON.parse(await readFile(descriptorFile, "utf8")).pid,
      before.pid,
    );
    const terminal = await client.terminal(actor.id);
    await terminal.output("OFFLINE_MODES");
    stage("再接続したHostが貼り付けを囲みキー解放を転送する");
    await terminal.submit("paste", "paste-after-restart");
    await terminal.output(
      "INPUT_HEX:" + Buffer.from("\x1b[200~paste\x1b[201~").toString("hex"),
    );
    await terminal.input("\x1b[97;1:3u");
    await terminal.output(Buffer.from("\x1b[97;1:3u").toString("hex"));
  }));

test("Device Attributesの問い合わせへの応答がPTYへ1回だけ届く", (t) =>
  runHostTest(t, async ({ client, dataRoot, stage }) => {
    const { terminal: created } = await client.request("terminal.create", {
      cwd: dataRoot,
      ...(process.platform === "win32" ? {} : { shell: "bash" }),
    });
    const terminal = await client.terminal(created.id);
    // After DA1, DSR is an ordered delimiter on the same parser/reply stream.
    const script = `process.stdin.setRawMode(true); let received=''; process.stdin.on('data',bytes=>{received+=bytes.toString();if(received.endsWith('R')){console.log('QUERY_'+'REPLIES:'+JSON.stringify(received));process.stdin.setRawMode(false);process.exit(0);}}); process.stdout.write('\\x1b[c\\x1b[6n');`;
    stage("実際のPTYから問い合わせを送り応答の列を読む");
    await terminal.input(`node -e ${quoteShellWord(script)}\r`);
    const output = await terminal.output(/QUERY_REPLIES:([^\r\n]+)\r?\n/u);
    const replies = JSON.parse(output.match(/QUERY_REPLIES:([^\r\n]+)/u)[1]);
    assert.equal([...replies.matchAll(/\x1b\[\?[0-9;]*c/gu)].length, 1);
    assert.equal([...replies.matchAll(/\x1b\[[0-9]+;[0-9]+R/gu)].length, 1);
  }));

test("再接続後に停止前のモードへ戻っても貼り付けを囲まない", (t) =>
  runHostTest(t, async ({ client, dataRoot, restart, stage }) => {
    const actor = await launchActor(client, dataRoot);
    client = await restart({
      whileStopped: () => writeFile(join(dataRoot, "fire-mode"), ""),
    });
    const terminal = await client.terminal(actor.id);
    await terminal.output("OFFLINE_MODES");
    stage("停止前と同じモードへ戻してから貼り付ける");
    await writeFile(join(dataRoot, "reset-mode"), "");
    await terminal.output("RESET_MODES");
    await terminal.submit("paste", "paste-after-mode-reset");
    const output = await terminal.output(/INPUT_HEX:([0-9a-f]+)\r?\n/u);
    assert.equal(
      output.match(/INPUT_HEX:([0-9a-f]+)/u)[1],
      Buffer.from("paste").toString("hex"),
    );
  }));

test("hookの保存が失敗しても同じTerminalの後のhookを配送する", (t) =>
  runHostTest(t, async ({ client, dataRoot, restart, stage }) => {
    const actor = await launchActor(client, dataRoot);
    let proxy;
    client = await restart({
      whileStopped: async () => {
        proxy = await daemonProxy(dataRoot);
      },
    });
    t.after(() => proxy.close());
    const events = await client.events();
    await events.waitFor((event) => event.type === "snapshot");
    const database = new DatabaseSync(join(dataRoot, "iori-host/host.sqlite"));
    // Fail the actual storage write for active state, including any redelivery.
    database.exec(`CREATE TRIGGER reject_active_hook BEFORE INSERT ON terminal_clis
      WHEN json_extract(NEW.value, '$.runtime.status.state') = 'active'
      BEGIN SELECT RAISE(ABORT, 'hook storage failure'); END`);
    try {
      stage("実際のSQLiteへのhookの保存を失敗させる");
      await writeFile(join(dataRoot, "fire-hook"), "");
      const delivered = await (await proxy.event("hook")).completed();
      assert.equal(
        delivered.error,
        undefined,
        "処理の失敗は配送の失敗にしない",
      );
      stage("保存できる次のhookが完了の状態へ更新する");
      await writeFile(join(dataRoot, "fire-done"), "");
      await events.waitFor(
        (event) =>
          event.type === "terminal.updated" &&
          event.terminal.id === actor.id &&
          event.terminal.cliStatus?.state === "done",
      );
    } finally {
      database.exec("DROP TRIGGER reject_active_hook");
      database.close();
    }
  }));

test("別のTerminalの終了処理中もhookを配送する", (t) =>
  runHostTest(t, async ({ client, dataRoot, restart, stage }) => {
    const slowDirectory = join(dataRoot, "slow-terminal");
    await mkdir(slowDirectory);
    const slow = await launchActor(client, slowDirectory);
    const other = await launchActor(client, dataRoot);
    let proxy;
    client = await restart({
      whileStopped: async () => {
        proxy = await daemonProxy(dataRoot);
      },
    });
    t.after(() => proxy.close());
    t.signal.addEventListener("abort", () => proxy.release(), { once: true });
    const events = await client.events();
    await events.waitFor((event) => event.type === "snapshot");
    stage("一方のTerminalの終了処理を実際のsnapshot応答で保留する");
    const blocked = proxy.hold("snapshot");
    const opening = client.terminal(slow.id).catch(() => undefined);
    await blocked;
    try {
      await writeFile(join(slowDirectory, "fire-exit"), "");
      const exit = await proxy.event("exit");
      stage("終了処理の完了前に別のTerminalのhookを受け取る");
      await writeFile(join(dataRoot, "fire-hook"), "");
      await events.waitFor(
        (event) =>
          event.type === "terminal.updated" &&
          event.terminal.id === other.id &&
          event.terminal.cliStatus?.state === "active",
      );
      assert.equal(exit.acknowledged(), false);
    } finally {
      proxy.release();
      await opening;
    }
  }));

test("終了したTerminalを閉じてもデーモンのスレッドが増え続けない", (t) =>
  runHostTest(t, async ({ client, dataRoot, stage }) => {
    const events = await client.events();
    await events.waitFor((event) => event.type === "snapshot");
    const { pid } = JSON.parse(
      await readFile(
        join(dataRoot, "iori-host/terminal-daemon/connection.json"),
        "utf8",
      ),
    );
    const shell = process.platform === "win32" ? {} : { shell: "bash" };
    // Measured on Windows (6 iterations): unpatched daemon leaks +1 worker
    // thread per closed PTY after the first-PTY pool init (13 -> 16..21, +8);
    // patched daemon reclaims each worker after ~1000ms drain (13 -> 15, +0/PTY).
    // Linux stays flat (11 -> 11, +0).
    const iterations = 6;
    const before = await daemonThreadCount(pid);
    stage("終了したTerminalを閉じる操作を繰り返す");
    for (let index = 0; index < iterations; index++) {
      const { terminal: created } = await client.request("terminal.create", {
        cwd: dataRoot,
        ...shell,
      });
      const terminal = await client.terminal(created.id);
      await terminal.input("exit 7\r");
      await events.waitFor(
        (event) =>
          event.type === "terminal.updated" &&
          event.terminal.id === created.id &&
          event.terminal.state === "error",
      );
      await client.request("terminal.close", { terminalId: created.id });
      await events.waitFor(
        (event) =>
          event.type === "terminal.closed" && event.terminalId === created.id,
      );
    }
    stage("終了処理後のデーモンのスレッド数が増えていないことを確認する");
    let after = await daemonThreadCount(pid);
    const deadline = Date.now() + 4000;
    while (after - before >= iterations && Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 100));
      after = await daemonThreadCount(pid);
    }
    assert.ok(
      after - before < iterations,
      `expected daemon threads not to grow with closed PTYs (before=${before}, after=${after}, iterations=${iterations})`,
    );
  }));
