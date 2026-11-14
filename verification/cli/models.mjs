import { local as verificationLocal } from "../native/local.mjs";
import { windowsClaudeInstall } from "./windows-claude-install.mjs";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

// Model-free verification of the production registry, including real stdin RPC
// and simultaneous callers. User configuration is never edited.
async function probe() {
  const { HostStore } = await import("../../apps/host/src/store.ts");
  const { CliRegistry } = await import("../../apps/host/src/cli/registry.ts");
  const { discoverShells, getHomeDirectory } =
    await import("../../apps/host/src/terminal/platform.ts");
  const { hookInstallContext } =
    await import("../../apps/host/src/cli/hook-install.ts");
  const { hooks } = await import("../../apps/host/src/cli/claude/hooks.ts");
  const { runInShell } =
    await import("../../apps/host/src/cli/shell-command.ts");
  const home = getHomeDirectory();
  assert.equal(
    home,
    path.join(process.cwd(), "cli-home"),
    "専用CLI保存先だけを使う",
  );
  const discovery = await discoverShells();
  const shell = discovery.shells.find(
    (entry) => entry.id === discovery.preferred,
  );
  assert.ok(shell);
  const received = [];
  const receiver = createServer((request, response) => {
    request.resume();
    request.on("end", () => {
      received.push(true);
      response.writeHead(204).end();
    });
  });
  await new Promise((resolve) => receiver.listen(0, "127.0.0.1", resolve));
  process.env.IORI_CLI_HOOK_URL = `http://127.0.0.1:${receiver.address().port}/probe`;
  process.env.IORI_CLI_HOOK_ADAPTER = "";
  const store = new HostStore(path.join(process.cwd(), "models.sqlite"));
  const registry = new CliRegistry(store, () => {});
  try {
    const ctx = await hookInstallContext(shell, "claude");
    await hooks.install(ctx);
    const hookConfig = JSON.parse(
      await readFile(path.join(home, ".claude", "settings.json"), "utf8"),
    );
    assert.ok(
      hookConfig.hooks.SessionStart.some((entry) =>
        entry.hooks.some((hook) => hook.command.includes("iori-cli-hook")),
      ),
    );
    await runInShell(shell, ctx.command, undefined, {
      start(send, end) {
        send(JSON.stringify({ hook_event_name: "SessionStart" }));
        end();
      },
      data() {},
    });
    assert.equal(received.length, 1, "ioriの実hookと受信先の接続を先に確認");
    received.length = 0;
    const sentinel = path.join(home, "mcp-started");
    const mcp = path.join(home, "mcp-probe.mjs");
    await writeFile(
      mcp,
      `import {writeFileSync} from 'node:fs'; writeFileSync(${JSON.stringify(sentinel)}, 'started');`,
    );
    await writeFile(
      path.join(home, ".mcp.json"),
      JSON.stringify({
        mcpServers: { probe: { command: process.execPath, args: [mcp] } },
      }),
    );
    const results = [];
    for (const id of ["codex", "claude", "pi", "opencode"]) {
      const first = registry.models(id, shell);
      const second = registry.models(id, shell);
      assert.equal(first, second, "同じCLIの進行中の取得を共有");
      const response = await first;
      assert.equal(response.ok, true);
      if (
        ["pi", "opencode"].includes(id) &&
        response.result.error === "not_found"
      ) {
        results.push({ cli: id, absent: true });
        continue;
      }
      assert.equal(response.result.error, undefined, `${id}のモデル一覧取得`);
      assert.ok(response.result.models.length > 0);
      results.push({ cli: id, sharedRequest: true, ...response.result });
    }
    assert.equal(received.length, 0, "モデル取得ではioriのhookを呼ばない");
    await assert.rejects(readFile(sentinel), { code: "ENOENT" });
    return {
      passed: true,
      shell: shell.id,
      hookRequests: received.length,
      mcpStarted: false,
      results,
    };
  } finally {
    registry.close();
    store.close();
    await new Promise((resolve) => receiver.close(resolve));
    delete process.env.IORI_CLI_HOOK_URL;
    delete process.env.IORI_CLI_HOOK_ADAPTER;
  }
}

if (process.platform === "win32" || process.argv.includes("--probe")) {
  const output = process.argv[process.argv.indexOf("--result") + 1];
  try {
    await writeFile(output, JSON.stringify(await probe(), null, 2) + "\n");
  } catch (error) {
    await writeFile(
      output,
      JSON.stringify({ passed: false, error: error.message }) + "\n",
    );
    process.exitCode = 1;
  }
} else {
  const { lockEntry } = await import("../native/locks.mjs");
  await lockEntry(import.meta.url);
  const { gate, windows, ps, windowsBuildNode, windowsPnpm } =
    await import("../native/remote.mjs");
  const { windowsCache } = await import("../native/cache.mjs");
  const { writeWindows, runWindowsBuild } =
    await import("../connection/build.mjs");
  const { createSourceArchive } = await import("../native/source.mjs");
  const { stopOwnedWindowsProcesses } = await import("../native/processes.mjs");
  const { readClaudeToken } = await import("./claude-token.mjs");
  gate({ requireFreePorts: false });
  // Read the verification token before any Host or machine work starts.
  const claudeToken = await readClaudeToken();
  const evidenceRoot = path.resolve(
    process.env.IORI_VERIFICATION_EVIDENCE_ROOT ?? ".local/evidence/cli-models",
  );
  const evidence = path.join(evidenceRoot, `run-${Date.now()}-${process.pid}`);
  await mkdir(evidence, { recursive: true });
  const local = await mkdtemp(path.join(tmpdir(), "iori-cli-models-"));
  const root = `${verificationLocal.windows.home}\\iori-development\\cli-models-${Date.now()}-${process.pid}`;
  const resultFile = root + "\\result.json";
  try {
    const repo = fileURLToPath(new URL("../../", import.meta.url));
    const archive = path.join(local, "source.tar");
    await createSourceArchive(repo, archive);
    windows(`[IO.Directory]::CreateDirectory(${ps(root)}) | Out-Null`);
    await writeWindows(root + "\\source.tar", await readFile(archive));
    await runWindowsBuild(
      root,
      `tar -xf ${ps(root + "\\source.tar")} -C ${ps(root)};if($LASTEXITCODE -ne 0){throw 'source extraction failed'};Set-Location ${ps(root)};$env:PATH=${ps(path.win32.dirname(windowsBuildNode) + ";")}+$env:PATH;` +
        // The Host modules this probe imports need their dependencies. Install
        // from the lockfile into the shared store like the other Windows verification machine
        // runners; the probe opens no terminal, so node-pty's build script is
        // not needed.
        `& ${ps(windowsBuildNode)} ${ps(windowsPnpm)} install --frozen-lockfile --ignore-scripts --store-dir ${ps(path.win32.join(windowsCache, "pnpm-store"))};if($LASTEXITCODE -ne 0){throw 'pnpm install failed'};` +
        `$workspace=${ps(root + "\\apps\\host\\node_modules\\@iori")};if(-not(Test-Path -LiteralPath (Join-Path $workspace 'protocol'))){[IO.Directory]::CreateDirectory($workspace) | Out-Null;New-Item -ItemType Junction -Path (Join-Path $workspace 'protocol') -Target ${ps(root + "\\packages\\protocol")} | Out-Null}`,
      path.join(evidence, "build.log"),
    );
    const home = root + "\\cli-home";
    const installClaude = process.argv.includes("--install-claude")
      ? windowsClaudeInstall(root)
      : "";
    // The verification token arrives on stdin, so it never appears in an ssh or
    // PowerShell command line; only this process and the CLI children see it.
    windows(
      `$token=[Console]::In.ReadLine();if(-not $token){throw 'Claude Codeの試験用トークンがありません'};$env:CLAUDE_CODE_OAUTH_TOKEN=$token;$original=$env:USERPROFILE;$testHome=${ps(home)};foreach($sub in @('.codex','.claude','.pi\\agent')){[IO.Directory]::CreateDirectory((Join-Path $testHome $sub)) | Out-Null};foreach($auth in @('.codex\\auth.json','.pi\\agent\\auth.json')){$source=Join-Path $original $auth;if(Test-Path -LiteralPath $source){New-Item -ItemType HardLink -Path (Join-Path $testHome $auth) -Target $source | Out-Null}};$env:USERPROFILE=$testHome;$env:HOME=$testHome;$env:CODEX_HOME=Join-Path $testHome '.codex';$env:CLAUDE_CONFIG_DIR=Join-Path $testHome '.claude';$env:XDG_DATA_HOME=Join-Path $testHome 'data';$env:XDG_CONFIG_HOME=Join-Path $testHome 'config';$env:XDG_CACHE_HOME=Join-Path $testHome 'cache';$env:NPM_CONFIG_CACHE=Join-Path $testHome 'npm-cache';$env:PATH=${ps(path.win32.dirname(windowsBuildNode) + ";")}+$env:PATH;Set-Location ${ps(root)};${installClaude}& ${ps(windowsBuildNode)} verification/cli/models.mjs --result ${ps(resultFile)};if(-not(Test-Path -LiteralPath ${ps(resultFile)})){throw 'result missing'}`,
      { input: claudeToken },
    );
    const result = JSON.parse(
      windows(`Get-Content -LiteralPath ${ps(resultFile)} -Raw`),
    );
    await writeFile(
      path.join(evidence, "windows-models.json"),
      JSON.stringify(result, null, 2) + "\n",
    );
    console.log(
      JSON.stringify({
        passed: result.passed,
        shell: result.shell,
        results: result.results?.map(({ cli, models, absent }) => ({
          cli,
          count: models?.length,
          absent,
        })),
        error: result.error,
      }),
    );
    assert.equal(result.passed, true);
  } finally {
    stopOwnedWindowsProcesses(root);
    windows(
      `if(Test-Path -LiteralPath ${ps(root)}){Remove-Item -LiteralPath ${ps(root)} -Recurse -Force}`,
    );
    await rm(local, { recursive: true, force: true });
  }
}
