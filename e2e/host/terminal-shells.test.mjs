import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { realpath } from "node:fs/promises";
import { userInfo } from "node:os";
import { promisify } from "node:util";
import test from "node:test";
import { runHostTest } from "../../verification/host/process.mjs";

const run = promisify(execFile);

test("shell一覧と既定のshellを返し、そのshellのPTYで命令を実行できる", (t) =>
  runHostTest(t, async ({ client, dataRoot, stage }) => {
    stage("shellの一覧と既定のshellを取得する");
    const listed = await client.request("terminal.list");
    assert.ok(listed.shells.length > 0);
    assert.ok(listed.shells.some(({ id }) => id === listed.defaultShell));
    if (process.platform === "linux") {
      const paths = await Promise.all(
        listed.shells.map(async ({ id }) => {
          const executable =
            id === "login-shell"
              ? userInfo().shell
              : (
                  await run("/bin/sh", ["-c", 'command -v "$1"', "sh", id])
                ).stdout.trim();
          return realpath(executable);
        }),
      );
      assert.equal(
        new Set(paths).size,
        listed.shells.length,
        "同じ実体のshellを重複して表示しない",
      );
    }
    stage("既定のshellでTerminalを作る");
    const events = await client.events();
    await events.waitFor((event) => event.type === "snapshot");
    const { terminal: created } = await client.request("terminal.create", {
      cwd: dataRoot,
    });
    assert.equal(created.shell, listed.defaultShell);
    await events.waitFor(
      (event) =>
        event.type === "terminal.created" && event.terminal.id === created.id,
    );
    stage("TerminalのPTYで入力した命令の出力が届く");
    const terminal = await client.terminal(created.id);
    // The complete marker only exists in command output, never the input echo.
    await terminal.input(
      process.platform === "win32"
        ? "[Console]::WriteLine('HOST_SHELL_' + 'EXECUTED')\r"
        : "printf '%s%s\\n' 'HOST_SHELL_' 'EXECUTED'\r",
    );
    await terminal.output("HOST_SHELL_EXECUTED");
  }));

test("実行中のコマンドがあるTerminalは確認無しで閉じずにconfirmationRequiredを返す", (t) =>
  runHostTest(t, async ({ client, dataRoot, stage }) => {
    stage("Terminalを作成して子プロセスを起動する");
    const { terminal: created } = await client.request("terminal.create", {
      cwd: dataRoot,
    });
    const terminal = await client.terminal(created.id);
    const quote = (value) =>
      process.platform === "win32"
        ? `'${value.replaceAll("'", "''")}'`
        : `'${value.replaceAll("'", "'\\''")}'`;
    const command =
      process.platform === "win32"
        ? `& ${quote(process.execPath)} -e "console.log('CHILD_BUSY_' + 'STARTED'); setTimeout(() => {}, 30000)"\r`
        : `${quote(process.execPath)} -e "console.log('CHILD_BUSY_' + 'STARTED'); setTimeout(() => {}, 30000)"\r`;
    await terminal.input(command);
    await terminal.output("CHILD_BUSY_STARTED");

    stage("confirm=falseの終了要求で稼働中コマンドを検知する");
    const check = await client.request("terminal.close", {
      terminalId: created.id,
      confirm: false,
    });
    assert.equal(check.confirmationRequired, true);
    assert.ok(check.command, "稼働中コマンド名が返ること");

    stage("confirm=trueで終了する");
    const closed = await client.request("terminal.close", {
      terminalId: created.id,
      confirm: true,
    });
    assert.equal(closed.confirmationRequired, undefined);
  }));
