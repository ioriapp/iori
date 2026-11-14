import { local as verificationLocal } from "../native/local.mjs";
import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

// Read public Issues without a token; do not write to the repository.
const ORIGIN = verificationLocal.forge.origin;
const REPOSITORY = verificationLocal.forge.repository;

/**
 * On a Windows Host, a Codex conversation outside a team and a team's parent
 * Codex run the real `iori issue list` from their own tool shells, with
 * Codex's default approval and sandbox. The request arrives as a file, as
 * from the worktree screen and an Automation of a team. A CLI started after
 * the Host's Path changed gets that Path behind the iori command's location.
 */
async function probe() {
  const { HostStore } = await import("../../bundle/src/store.js");
  const { TerminalManager } =
    await import("../../bundle/src/terminal/manager.js");
  const { ForgeDetection } = await import("../../bundle/src/forge/adapters.js");
  const { runForgeCommand } =
    await import("../../bundle/src/forge-commands.js");
  const { stopTerminalDaemon } =
    await import("../../bundle/src/terminal/daemon/launch.js");
  const { randomUUID } = await import("node:crypto");
  const { execFileSync } = await import("node:child_process");
  const { waitFor } = await import("../ui.mjs");
  const root = process.cwd();
  const repository = path.join(root, "repository");
  await mkdir(repository);
  const git = (...args) =>
    execFileSync(
      "git",
      [
        "-c",
        "user.name=iori verification",
        "-c",
        "user.email=e2e@example.invalid",
        ...args,
      ],
      { cwd: repository, encoding: "utf8" },
    );
  git("init");
  git("commit", "--allow-empty", "-m", "fixture");
  git("remote", "add", "origin", `${ORIGIN}/${REPOSITORY}.git`);
  const instructionFile = path.join(root, "instruction.md");
  await writeFile(
    instructionFile,
    "Run the shell command `iori issue list --limit 3` exactly once, then reply with only the number of the first Issue it lists. Do not change files.",
  );
  const context = () => ({
    clientPublicKey: "verification",
    operationId: randomUUID(),
  });
  const hostRoot = path.join(root, "host-data");
  await mkdir(hostRoot, { recursive: true });
  const { default: terminalNative } =
    await import("../../bundle/node_modules/@iori/terminal-native/index.js");
  // Match openHostStorage: all Host data is private, including inherited ACLs.
  terminalNative.restrictToCurrentUser(hostRoot);
  const store = new HostStore(path.join(hostRoot, "host.sqlite"));
  const detection = new ForgeDetection(() => {});
  const terminals = await TerminalManager.create(
    store,
    () => {},
    hostRoot,
    (where, command) => runForgeCommand(command, where, store, detection),
  );
  // As TeamManager does at Host startup: the daemon hands commands over.
  await terminals.activateTeamEvents();
  const { TeamManager } = await import("../../bundle/src/teams/manager.js");
  const teams = await TeamManager.create(store, terminals, hostRoot);
  const newest = (
    await (
      await fetch(
        `${ORIGIN}/api/v1/repos/${REPOSITORY}/issues?state=open&type=issues&limit=1`,
      )
    ).json()
  )[0].number;
  const screen = (id) =>
    [
      store.terminal(id)?.snapshot?.scrollbackAnsi,
      store.terminal(id)?.snapshot?.snapshotAnsi,
    ]
      .filter(Boolean)
      .join("\n")
      .replace(/[a-f0-9]{64}/g, "[redacted]");
  // Codex's own record: the output its tool shell got from `iori`, which is in
  // no other line of the record.
  const answered = async (id) => {
    const line = await waitFor(
      async () => {
        const file = store.terminalCli(id)?.session?.file;
        if (!file) return undefined;
        return (await readFile(file, "utf8").catch(() => ""))
          .split("\n")
          .find((value) =>
            value.includes(`Open Issues of ${REPOSITORY} (Forgejo)`),
          );
      },
      Boolean,
      300000,
      "Codexのツールが受け取ったiori issue listの答え",
    );
    return line.includes(`#${newest} `);
  };
  const check = async (start) => {
    let id;
    try {
      id = await start();
      return {
        passed: await answered(id),
        cliStatus: terminals.summary(id)?.cliStatus?.state,
      };
    } catch (error) {
      return {
        passed: false,
        error: error.message,
        cliStatus: id ? terminals.summary(id)?.cliStatus?.state : undefined,
        screen: id ? screen(id) : undefined,
      };
    }
  };
  let outcome = { passed: false };
  try {
    // A conversation outside a team: the PTY's environment gives the PATH.
    const alone = await check(async () => {
      const created = await terminals.createTerminal(
        context(),
        repository,
        undefined,
        "codex",
        undefined,
        undefined,
        {
          candidate: {
            id: "codex",
            cli: "codex",
            model: "",
            tools: [],
            minimum: "",
          },
          instructionFile,
        },
      );
      assert.ok(created.ok, "チームでないCodexを始める");
      const saved = store.terminalCli(created.result.terminal.id);
      assert.match(saved.command, /allow_login_shell=false/u);
      assert.doesNotMatch(
        saved.command,
        /--add-dir/u,
        "保存する起動にセッションの場所を含めない",
      );
      return created.result.terminal.id;
    });
    // A team's parent: its start command puts the PATH back, as before.
    const team = await check(async () => {
      const saved = store.teamOperation(context(), "teams.create", {
        definition: {
          name: "Forge command verification",
          description: "",
          parent: {
            id: "parent",
            cli: "codex",
            model: "gpt-6-luna",
            effort: "low",
            tools: [],
            minimum: "",
          },
          instruction: "Follow the user's request. Do not delegate.",
          roles: [],
        },
      });
      assert.ok(saved.ok, "チームを保存する");
      assert.ok(
        store.teamOperation(context(), "teams.settings", {
          enabled: true,
          defaultTeam: saved.result.saved.id,
          limits: {},
        }).ok,
      );
      const launched = await teams.launch(
        context(),
        saved.result.saved.id,
        repository,
        undefined,
        instructionFile,
      );
      assert.ok(launched.ok, "チームの親のCodexを始める");
      return launched.result.terminal.id;
    });
    // The Terminal daemon lives across Host restarts, so the Host's Path can
    // change after it started; a CLI started then gets the Host's current Path
    // after the iori command's location.
    const hostPath = await (async () => {
      const marker = path.join(root, "host-path-marker");
      await mkdir(marker);
      process.env.PATH = `${marker};${process.env.PATH}`;
      const written = path.join(root, "cli-path.json");
      const actor = path.join(root, "cli-path.mjs");
      await writeFile(
        actor,
        `import {writeFileSync} from 'node:fs';writeFileSync(${JSON.stringify(written)},JSON.stringify({bin:process.env.IORI_COMMAND_BIN,path:process.env.PATH}));`,
      );
      const quote = (value) => `'${value.replaceAll("'", "''")}'`;
      // A CLI added by name and launch command.
      const cli = await terminals.saveSimpleCliDefinition(context(), {
        name: "Path probe",
        command: `& ${quote(process.execPath)} ${quote(actor)}`,
        modelArgument: "",
      });
      assert.ok(cli.ok && "cliId" in cli.result, "Pathを書くCLIを足す");
      const created = await terminals.createTerminal(
        context(),
        repository,
        undefined,
        cli.result.cliId,
      );
      assert.ok(created.ok, "Pathを書くCLIを始める");
      const seen = JSON.parse(
        await waitFor(
          () => readFile(written, "utf8").catch(() => undefined),
          Boolean,
          60000,
          "CLIが受け取ったPath",
        ),
      );
      // pwsh puts its own folder first when it starts.
      const entries = seen.path.split(";");
      const at = seen.bin ? entries.indexOf(seen.bin) : -1;
      return {
        passed: at >= 0 && entries[at + 1] === marker,
        start: entries.slice(0, at + 2),
      };
    })().catch((error) => ({ passed: false, error: error.message }));
    outcome = {
      passed: alone.passed && team.passed && hostPath.passed,
      newest,
      alone,
      team,
      hostPath,
    };
    return outcome;
  } finally {
    for (const close of [
      () => teams.close(),
      () => terminals.close(),
      () => stopTerminalDaemon(hostRoot),
    ])
      await close().catch((error) => {
        outcome.passed = false;
        outcome.cleanupError = error.message;
      });
    store.close();
  }
}

if (process.platform === "win32") {
  const result = process.argv[process.argv.indexOf("--result") + 1];
  try {
    await writeFile(result, JSON.stringify(await probe(), null, 2) + "\n");
  } catch (error) {
    await writeFile(
      result,
      JSON.stringify({ passed: false, error: error.message }) + "\n",
    );
    process.exitCode = 1;
  }
  // ConPTY retains handles after close; the isolated launcher owns and reaps
  // any remaining descendants after it reads this completed result.
  process.exit(process.exitCode ?? 0);
} else {
  const { lockEntry } = await import("../native/locks.mjs");
  await lockEntry(import.meta.url);
  const { gate, windows, ps, windowsBuildNode, windowsPnpm } =
    await import("../native/remote.mjs");
  const { writeWindows, windowsEnvironment, runWindowsBuild } =
    await import("../connection/build.mjs");
  const { createSourceArchive, windowsSourceMtimes } =
    await import("../native/source.mjs");
  const { windowsCache } = await import("../native/cache.mjs");
  const {
    stopOwnedWindowsProcesses,
    startWindowsInteractiveTask,
    stopWindowsInteractiveTask,
  } = await import("../native/processes.mjs");
  const { findWindowsInteractiveSession } =
    await import("../connection/client.mjs");
  const { waitFor } = await import("../ui.mjs");
  gate({ requireFreePorts: false });
  const sessionId = findWindowsInteractiveSession();
  const evidence = path.resolve(
    process.env.IORI_VERIFICATION_EVIDENCE_ROOT ??
      ".local/evidence/forge-command",
    `run-${Date.now()}-${process.pid}`,
  );
  await mkdir(evidence, { recursive: true });
  const normalCodexHome = windows(
    "if($env:CODEX_HOME){$env:CODEX_HOME}else{Join-Path $env:USERPROFILE '.codex'}",
  );
  const temporary = await mkdtemp(path.join(tmpdir(), "iori-forge-command-"));
  const root = `${verificationLocal.windows.home}\\iori-development\\forge-command-${Date.now()}-${process.pid}`;
  const task = {
    task: `iori-forge-command-${Date.now()}-${process.pid}`,
    script: root + "\\probe.ps1",
    user:
      verificationLocal.windows.host + "\\" + verificationLocal.windows.user,
    sessionId,
  };
  let restoreSandbox = false;
  try {
    const archive = path.join(temporary, "source.tar");
    await createSourceArchive(
      fileURLToPath(new URL("../../", import.meta.url)),
      archive,
    );
    windows(`[IO.Directory]::CreateDirectory(${ps(root)}) | Out-Null`);
    await writeWindows(root + "\\source.tar", await readFile(archive));
    await runWindowsBuild(
      root,
      `${windowsEnvironment}tar -mxf ${ps(root + "\\source.tar")} -C ${ps(root)};if($LASTEXITCODE -ne 0){throw 'extract failed'};Set-Location ${ps(root)};${windowsSourceMtimes}$env:CARGO_TARGET_DIR=${ps(windowsCache + "\\cargo-target")};$env:CARGO_BUILD_JOBS='2';& ${ps(windowsBuildNode)} ${ps(windowsPnpm)} install --frozen-lockfile --store-dir ${ps(windowsCache + "\\pnpm-store")};if($LASTEXITCODE -ne 0){throw 'install failed'};node verification/native/node-pty.mjs;if($LASTEXITCODE -ne 0){throw 'node-pty build failed'};& ${ps(windowsBuildNode)} ${ps(windowsPnpm)} --filter @iori/host build:native;if($LASTEXITCODE -ne 0){throw 'native build failed'};& ${ps(windowsBuildNode)} scripts/release/host.mjs bundle;if($LASTEXITCODE -ne 0){throw 'bundle failed'}`,
      path.join(evidence, "build.log"),
    );
    // A separate Codex home: the model is cheap; approval and sandbox stay
    // Codex's defaults, with the verification Host's default Windows sandbox.
    const home = root + "\\cli-home",
      resultFile = root + "\\result.json";
    windows(
      `[IO.Directory]::CreateDirectory(${ps(home + "\\.codex")}) | Out-Null;New-Item -ItemType HardLink -Path ${ps(home + "\\.codex\\auth.json")} -Target (Join-Path $env:USERPROFILE '.codex\\auth.json') | Out-Null`,
    );
    await writeWindows(
      home + "\\.codex\\config.toml",
      'check_for_update_on_startup = false\ncli_auth_credentials_store = "file"\nmodel = "gpt-6-luna"\nmodel_reasoning_effort = "low"\n[windows]\nsandbox = "elevated"\n[projects.' +
        JSON.stringify(path.win32.join(root, "repository")) +
        ']\ntrust_level = "trusted"\n',
    );
    restoreSandbox = true;
    const setup = windows(
      `& codex sandbox setup --elevated --current-user --codex-home ${ps(home + "\\.codex")};if($LASTEXITCODE -ne 0){throw 'elevated fixture setup failed'}`,
    );
    await writeFile(path.join(evidence, "sandbox-setup.txt"), setup + "\n");
    let launchError;
    try {
      await writeWindows(
        task.script,
        `$env:IORI_VERIFICATION_LOCAL='.local/verification.json';$ErrorActionPreference='Stop';$env:USERPROFILE=${ps(home)};$env:HOME=${ps(home)};$env:CODEX_HOME=${ps(home + "\\.codex")};$env:PATH=${ps(path.win32.dirname(windowsBuildNode) + ";")}+$env:PATH;Set-Location ${ps(root)};& ${ps(root + "\\bundle\\runtime\\node.exe")} verification/cli/forge-command.mjs --result ${ps(resultFile)} *> ${ps(root + "\\probe.log")};if(-not(Test-Path -LiteralPath ${ps(resultFile)})){throw 'probe result missing'};exit 0`,
      );
      startWindowsInteractiveTask(task);
      await waitFor(
        () => windows(`Test-Path -LiteralPath ${ps(resultFile)}`),
        (value) => value === "True",
        600000,
        "WindowsのForgeのコマンドの検証の結果",
      );
    } catch (error) {
      launchError = error.message;
    }
    const result = JSON.parse(
      windows(
        `if(Test-Path -LiteralPath ${ps(resultFile)}){Get-Content -LiteralPath ${ps(resultFile)} -Raw}else{@{passed=$false;error=${ps(launchError ?? "probe result missing")}} | ConvertTo-Json}`,
      ),
    );
    await writeFile(
      path.join(evidence, "windows.json"),
      JSON.stringify(result, null, 2) + "\n",
    );
    console.log(
      JSON.stringify({
        passed: result.passed,
        error: result.error,
        newest: result.newest,
        alone: result.alone && { ...result.alone, screen: undefined },
        team: result.team && { ...result.team, screen: undefined },
        hostPath: result.hostPath,
      }),
    );
    assert.equal(result.passed, true);
  } finally {
    try {
      stopOwnedWindowsProcesses(root);
      stopWindowsInteractiveTask(task);
    } finally {
      if (restoreSandbox) {
        // The fixture setup regenerated the shared sandbox account; set the
        // normal home up again and run a command in its read-only sandbox.
        const setup = windows(
          `& codex sandbox setup --elevated --current-user --codex-home ${ps(normalCodexHome)};if($LASTEXITCODE -ne 0){throw 'normal elevated sandbox restoration failed'}`,
        );
        await writeFile(
          path.join(evidence, "sandbox-restore-setup.txt"),
          setup + "\n",
        );
        const restore = {
          ...task,
          task: task.task + "-restore",
          script: root + "\\restore.ps1",
        };
        const output = root + "\\restore.json";
        await writeWindows(
          restore.script,
          `$ErrorActionPreference='Stop';$env:CODEX_HOME=${ps(normalCodexHome)};$text=(& codex sandbox --include-managed-config --permission-profile :read-only -- cmd.exe /d /c echo IORI_SANDBOX_RESTORED 2>&1 | Out-String);$code=$LASTEXITCODE;[IO.File]::WriteAllText(${ps(output)},(ConvertTo-Json -InputObject @{exitCode=$code;output=$text} -Compress));`,
        );
        try {
          startWindowsInteractiveTask(restore);
          const value = await waitFor(
            () =>
              windows(
                `if(Test-Path -LiteralPath ${ps(output)}){Get-Content -LiteralPath ${ps(output)} -Raw}`,
              ),
            Boolean,
            300000,
            "通常のCodex sandboxの復旧確認",
          );
          const restored = JSON.parse(value);
          await writeFile(
            path.join(evidence, "sandbox-restored.json"),
            JSON.stringify(restored, null, 2) + "\n",
          );
          assert.equal(restored.exitCode, 0);
          assert.ok(restored.output.includes("IORI_SANDBOX_RESTORED"));
        } finally {
          stopWindowsInteractiveTask(restore);
        }
      }
    }
    windows(
      `if(Test-Path -LiteralPath ${ps(root)}){Remove-Item -LiteralPath ${ps(root)} -Recurse -Force}`,
    );
    await rm(temporary, { recursive: true, force: true });
  }
}
