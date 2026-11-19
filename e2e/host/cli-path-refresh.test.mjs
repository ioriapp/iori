import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import test from "node:test";
import { runHostTest } from "../../verification/host/process.mjs";

const run = promisify(execFile);
const powershell = join(
  process.env.SystemRoot ?? "C:\\Windows",
  "System32",
  "WindowsPowerShell",
  "v1.0",
  "powershell.exe",
);

async function registry(script, extra = {}) {
  const { stdout } = await run(
    powershell,
    ["-NoProfile", "-NonInteractive", "-Command", script],
    {
      env: { ...process.env, ...extra },
      windowsHide: true,
    },
  );
  return stdout.trim();
}

const readPath = String.raw`
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = New-Object System.Text.UTF8Encoding $false
$key = [Microsoft.Win32.Registry]::CurrentUser.OpenSubKey('Environment')
try {
  if ($key.GetValueNames() -contains 'Path') {
    $value = $key.GetValue('Path', $null, [Microsoft.Win32.RegistryValueOptions]::DoNotExpandEnvironmentNames)
    $kind = $key.GetValueKind('Path').ToString()
    @{ exists = $true; value = $value; kind = $kind } | ConvertTo-Json -Compress
  } else { '{"exists":false}' }
} finally { $key.Dispose() }
`;

const writePath = String.raw`
$ErrorActionPreference = 'Stop'
$path = $env:IORI_TEST_REGISTRY_PATH | ConvertFrom-Json
$key = [Microsoft.Win32.Registry]::CurrentUser.OpenSubKey('Environment', $true)
try {
  if ($path.exists) {
    $kind = [Microsoft.Win32.RegistryValueKind]::$($path.kind)
    $key.SetValue('Path', [string]$path.value, $kind)
  } else { $key.DeleteValue('Path', $false) }
} finally { $key.Dispose() }
`;

test(
  "Hostの起動後にユーザーのPATHへ足したCLIを一覧に出して起動できる",
  { skip: process.platform !== "win32" },
  async (t) => {
    const folder = await mkdtemp(join(tmpdir(), "iori-path-cli-"));
    t.after(() => rm(folder, { recursive: true, force: true }));
    await writeFile(
      join(folder, "iori-path-refresh-cli.cmd"),
      "@echo off\r\necho IORI_PATH_REFRESH_EXECUTED\r\n",
    );
    await runHostTest(t, async ({ client, dataRoot, stage }) => {
      const original = JSON.parse(await registry(readPath));
      const setPath = (value) =>
        registry(writePath, { IORI_TEST_REGISTRY_PATH: JSON.stringify(value) });
      try {
        stage("CLIの定義を保存し、一覧で未検出を確認する");
        await client.request("cli.definition.save", {
          definition: JSON.stringify({
            schema: 1,
            id: "path-refresh-cli",
            name: "Path refresh CLI",
            command: "iori-path-refresh-cli",
          }),
        });
        const before = await client.request("cli.list", {});
        assert.equal(
          before.clis.find((cli) => cli.id === "path-refresh-cli")?.missing,
          true,
        );
        stage("ユーザーのPATHにCLIのフォルダーを追加する");
        await setPath({
          exists: true,
          value: original.value ? `${original.value};${folder}` : folder,
          kind: original.kind ?? "ExpandString",
        });
        stage("一覧でCLIを検出し、Terminalで起動する");
        const after = await client.request("cli.list", {});
        const cli = after.clis.find((item) => item.id === "path-refresh-cli");
        assert.ok(cli);
        assert.notEqual(cli.missing, true);
        const { terminal } = await client.request("cli.launch", {
          cliId: cli.id,
          cwd: dataRoot,
        });
        await (
          await client.terminal(terminal.id)
        ).output("IORI_PATH_REFRESH_EXECUTED");
      } finally {
        await setPath(original);
        assert.deepEqual(JSON.parse(await registry(readPath)), original);
        t.diagnostic("ユーザーのPATHの値と型を復元しました");
      }
    });
  },
);
