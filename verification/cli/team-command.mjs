import { local as verificationLocal } from "../native/local.mjs";
import assert from "node:assert/strict";
import {
  copyFile,
  mkdir,
  mkdtemp,
  readFile,
  rename,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

async function ifPresent(read, missing) {
  try {
    return await read();
  } catch (error) {
    if (error.code === "ENOENT") return missing;
    throw error;
  }
}

async function argumentProbe() {
  const { randomUUID } = await import("node:crypto");
  const { execFileSync } = await import("node:child_process");
  const { attachTerminalDaemon, stopTerminalDaemon } =
    await import("../../bundle/src/terminal/daemon/launch.js");
  const { RemotePtys } =
    await import("../../bundle/src/terminal/remote-pty.js");
  const {
    quoteShell,
    shellCommand,
    invocation,
    resolveShellCommands,
    cliResumeCommand,
  } = await import("../../bundle/src/cli/shell-command.js");
  const { managedCommandArguments, TERMINAL_PARSER_SUBSCRIPTIONS } =
    await import("../../bundle/src/terminal/runtime.js");
  const { ptyEnvironment, getWindowsPtySpawnOptions } =
    await import("../../bundle/src/terminal/platform.js");
  const { waitForOperation } = await import("../ui.mjs");
  const root = process.cwd();
  const directory = path.join(root, ".local/evidence/argument-probe");
  await mkdir(directory, { recursive: true });
  const script = path.join(directory, "argv.mjs");
  await writeFile(
    script,
    `#!/usr/bin/env node\nimport {writeFileSync} from 'node:fs';writeFileSync(process.env.IORI_ARGV_OUTPUT,JSON.stringify({argv:process.argv.slice(2)}));process.exitCode=Number(process.env.IORI_ARGV_EXIT_CODE??'0');`,
  );
  const { default: cmdShim } = await import("cmd-shim");
  const shim = path.join(directory, "npm-argv");
  await cmdShim(script, shim);
  const batch = path.join(directory, "argv.cmd");
  await writeFile(
    batch,
    `@echo off\r\n"${process.execPath}" "${script}" %*\r\n`,
  );
  const psScript = path.join(directory, "argv.ps1");
  const savePowerShell = `[IO.File]::WriteAllText($env:IORI_ARGV_OUTPUT,(ConvertTo-Json -InputObject @{argv=@($args)} -Compress),[Text.UTF8Encoding]::new($false))`;
  await writeFile(psScript, savePowerShell);
  const where = (name) =>
    execFileSync("where.exe", [name], { encoding: "utf8" })
      .trim()
      .split(/\r?\n/)[0];
  const shells = [
    {
      id: "powershell",
      label: "pwsh",
      executable: where("pwsh.exe"),
      args: ["-NoLogo"],
    },
    {
      id: "powershell",
      label: "powershell51",
      executable: where("powershell.exe"),
      args: ["-NoLogo"],
    },
    { id: "cmd", label: "cmd", executable: where("cmd.exe"), args: [] },
  ];
  const instructions =
    "ARG_PROBE_BEGIN\nspace \"double quote\" 'single quote' ‘left’ ‚low‛ & ^ ( ) ! 100% %IORI_VALUE% 日本語 C:\\a b\\\nARG_PROBE_END";
  const edges = ["", "^()!", "C:\\a b" + "\\".repeat(3)];
  const payloads = [
    {
      name: "developer-json",
      argv: [
        "-c",
        "developer_instructions=" + JSON.stringify(instructions),
        ...edges,
      ],
    },
    {
      name: "literal-newline",
      argv: ["-c", "developer_instructions=" + instructions, ...edges],
    },
  ];
  const fakeNodeDirectory = path.join(directory, "batch-node");
  await mkdir(fakeNodeDirectory);
  await writeFile(
    path.join(fakeNodeDirectory, "node.cmd"),
    `@echo off\r\n"${process.execPath}" %* --node-wrapper\r\n`,
  );
  const rawValue = "from environment";
  const hostRoot = path.join(directory, "probe-host");
  await mkdir(hostRoot);
  const { channel } = await attachTerminalDaemon(hostRoot);
  const remote = new RemotePtys(channel);
  channel.handle = async (method, args) => {
    if (method === "data") return remote.data(...args);
    if (method === "event") return remote.event(args[0]);
    throw new Error("Unexpected probe request");
  };
  await channel.call("attach", TERMINAL_PARSER_SUBSCRIPTIONS);
  await channel.call("activate");
  await channel.call("commandsReady");
  const cases = [];
  const compare = (expected, received) =>
    received !== undefined &&
    Buffer.from(JSON.stringify(expected)).equals(
      Buffer.from(JSON.stringify(received)),
    );
  async function run(
    shell,
    target,
    payload,
    route = "managed",
    passing,
    form = "arguments",
  ) {
    const startedAt = new Date().toISOString();
    console.log(
      JSON.stringify({
        stage: "argument-case",
        startedAt,
        shell: shell.label,
        target,
        payload: payload.name,
        route,
        passing,
        form,
      }),
    );
    const id = randomUUID();
    const stage = (stage, details = {}) =>
      console.log(
        JSON.stringify({ stage, at: new Date().toISOString(), id, ...details }),
      );
    const output = path.join(directory, id + ".json");
    const resumeStateFile = path.join(directory, id + ".resume.json");
    const readyMarker = "IORI_RESUME_READY_" + id;
    const q = (value) => quoteShell(value, shell);
    const executable =
      target === "exe"
        ? process.execPath
        : target === "shim"
          ? shim + ".cmd"
          : target === "batch"
            ? batch
            : psScript;
    const raw =
      shell.id === "powershell" && (form === "raw" || form === "command-line");
    const expected = [
      ...(form === "command-line" ? ["command-line-prefix"] : []),
      ...(raw ? ["a b", rawValue] : []),
      ...payload.argv,
      ...(form === "node-fallback" ? ["--node-wrapper"] : []),
    ];
    const options = {
      ...(target === "exe" ? { prefixArguments: [script] } : {}),
      ...(raw ? { rawArguments: "'a b' $env:IORI_RAW_VALUE" } : {}),
      ...(form === "command-line" ? { commandLine: true } : {}),
    };
    const source =
      form === "command-line"
        ? invocation(path.basename(executable), shell) +
          " " +
          q("command-line-prefix")
        : executable;
    const generatedCommand = await shellCommand(
      source,
      payload.argv,
      shell,
      options,
    );
    const command =
      (passing ? `$PSNativeCommandArgumentPassing='${passing}'; ` : "") +
      generatedCommand;
    const input =
      route === "resume"
        ? cliResumeCommand(
            command +
              `; $ioriResumeExit=$LASTEXITCODE; [IO.File]::WriteAllText(${q(resumeStateFile)},(ConvertTo-Json -InputObject @{exitCode=$ioriResumeExit;nativeArguments=$env:IORI_NATIVE_ARGUMENTS;passing=[string]$PSNativeCommandArgumentPassing} -Compress),[Text.UTF8Encoding]::new($false))`,
            shell,
            id,
          )
        : undefined;
    const args =
      route === "resume"
        ? [
            ...shell.args,
            "-NoExit",
            "-Command",
            `Import-Module PSReadLine; Set-PSReadLineOption -HistorySaveStyle SaveNothing; function prompt { [Console]::Write('${readyMarker}'); 'PS> ' }`,
          ]
        : managedCommandArguments(command, shell);
    await channel.call("screen", id, 160, 32, "", []);
    stage("argument-pty-spawning");
    const child = await remote.spawn({
      id,
      executable: shell.executable,
      args,
      seed: "",
      options: {
        name: "xterm-256color",
        cols: 160,
        rows: 32,
        cwd: root,
        env: ptyEnvironment({
          ...process.env,
          IORI_ARGV_OUTPUT: output,
          IORI_VALUE: "EXPANDED_SENTINEL",
          IORI_RAW_VALUE: rawValue,
          IORI_ESCAPE: "\u001b",
          IORI_BELL: "\u0007",
          ...(route === "resume"
            ? {
                IORI_ARGV_EXIT_CODE: "1",
                IORI_NATIVE_ARGUMENTS: "RESTORED_SENTINEL",
              }
            : {}),
        }),
        encoding: "utf8",
        ...getWindowsPtySpawnOptions(),
      },
    });
    stage("argument-pty-spawned", { pid: child.pid });
    let text = "",
      exit;
    child.onData((batch) => {
      if (!text)
        stage("argument-output-received", { dataType: typeof batch.data });
      text += batch.data;
    });
    child.onExit((value) => {
      exit = value;
      stage("argument-pty-exited", value);
    });
    try {
      if (input !== undefined) {
        stage("argument-prompt-waiting");
        await waitForOperation(
          "argument resume prompt " + shell.label,
          () => ({
            ready: text.includes(readyMarker),
            exited: exit !== undefined,
          }),
          (state) => state.ready || state.exited,
          () => false,
        );
        if (exit === undefined) {
          stage("argument-prompt-ready");
          child.write(input + "\r");
          stage("argument-resume-sent");
        }
      }
      await waitForOperation(
        "argument probe " + shell.label + "/" + target + "/" + route,
        () => ({
          exited: exit !== undefined,
          complete:
            route === "resume"
              ? text.indexOf(readyMarker) !== text.lastIndexOf(readyMarker)
              : text.includes("]133;D;" + id),
        }),
        (state) => state.exited || state.complete,
        () => false,
      );
      const received = await ifPresent(() =>
        readFile(output, "utf8").then(JSON.parse),
      );
      stage("argument-argv-recorded", { recorded: received !== undefined });
      const resumeState =
        route === "resume"
          ? await ifPresent(() =>
              readFile(resumeStateFile, "utf8").then(JSON.parse),
            )
          : undefined;
      cases.push({
        startedAt,
        finishedAt: new Date().toISOString(),
        shell: shell.label,
        target,
        payload: payload.name,
        route,
        requestedPassing: passing,
        form,
        command,
        generatedCommandSingleLine: !/[\r\n]/u.test(generatedCommand),
        ...(input !== undefined
          ? {
              input,
              inputSingleLine: !/[\r\n]/u.test(input),
              resumeState,
              resumePreserved:
                !/[\r\n]/u.test(input) &&
                resumeState?.exitCode === 1 &&
                resumeState?.nativeArguments === "RESTORED_SENTINEL" &&
                resumeState?.passing === "Legacy",
            }
          : {}),
        shellArgs: args,
        expected,
        received: received?.argv,
        expectedUtf8: expected.map((value) =>
          Buffer.from(value).toString("base64"),
        ),
        receivedUtf8: received?.argv?.map((value) =>
          Buffer.from(value).toString("base64"),
        ),
        equal: compare(expected, received?.argv),
        exit,
        output: text,
        // cmd literal newlines and caret arguments to non-npm batches are
        // reported limitations; generated/native argv remains mandatory.
        required:
          shell.id !== "cmd" ||
          (payload.name !== "literal-newline" && target !== "batch"),
      });
      await writeFile(
        path.join(directory, "progress.json"),
        JSON.stringify(cases, null, 2),
      );
      console.log(
        JSON.stringify({
          stage: "argument-result",
          finishedAt: cases.at(-1).finishedAt,
          equal: cases.at(-1).equal,
        }),
      );
    } finally {
      await channel.call("remove", id);
    }
  }
  try {
    for (const shell of shells) {
      const originalPath = process.env.PATH;
      // Populate the same profile-aware resolution used by the registry's list.
      process.env.PATH = directory + ";" + originalPath;
      await resolveShellCommands(shell, [path.basename(shim) + ".cmd"]);
      process.env.PATH = originalPath;
      for (const target of shell.id === "cmd"
        ? ["exe", "shim"]
        : ["ps1", "exe", "shim"])
        for (const payload of payloads)
          await run(
            shell,
            target,
            payload,
            "managed",
            shell.id === "powershell" ? "Legacy" : undefined,
          );
      await run(
        shell,
        "batch",
        payloads[0],
        "managed",
        shell.id === "powershell" ? "Legacy" : undefined,
      );
      if (shell.id === "powershell") {
        await run(shell, "shim", payloads[0], "resume", "Legacy");
        for (const target of ["exe", "shim", "ps1", "batch"])
          await run(shell, target, payloads[0], "managed", "Legacy", "raw");
      }
      await run(
        shell,
        "shim",
        payloads[0],
        "managed",
        shell.id === "powershell" ? "Legacy" : undefined,
        "command-line",
      );
      try {
        process.env.PATH = fakeNodeDirectory + ";" + originalPath;
        const [node] = await resolveShellCommands(shell, ["node"]);
        assert.ok(node.toLowerCase().endsWith(".cmd"));
        await run(
          shell,
          "shim",
          { name: "node-fallback", argv: ["fallback-body"] },
          "managed",
          shell.id === "powershell" ? "Legacy" : undefined,
          "node-fallback",
        );
      } finally {
        process.env.PATH = directory + ";" + originalPath;
        await resolveShellCommands(shell, [path.basename(shim) + ".cmd"]);
        process.env.PATH = originalPath;
      }
    }
    return {
      passed: cases
        .filter((entry) => entry.required)
        .every(
          (entry) =>
            entry.equal &&
            (entry.shell === "cmd" || entry.generatedCommandSingleLine) &&
            (entry.route !== "resume" || entry.resumePreserved),
        ),
      purpose:
        "generated CLI argv byte comparison; batch and cmd newlines reported separately",
      instructions,
      cases,
    };
  } finally {
    await stopTerminalDaemon(hostRoot);
    channel.close();
  }
}

async function argumentTeamProbe() {
  const { randomUUID } = await import("node:crypto");
  const { readdir } = await import("node:fs/promises");
  const { execFileSync } = await import("node:child_process");
  const { HostStore } = await import("../../bundle/src/store.js");
  const { TerminalManager } =
    await import("../../bundle/src/terminal/manager.js");
  const { TeamManager } = await import("../../bundle/src/teams/manager.js");
  const { stopTerminalDaemon } =
    await import("../../bundle/src/terminal/daemon/launch.js");
  const { waitForOperation } = await import("../ui.mjs");
  const root = process.cwd(),
    repository = path.join(root, "repository");
  await mkdir(repository);
  const git = (...args) =>
    execFileSync(
      "git",
      [
        "-c",
        "user.name=verification",
        "-c",
        "user.email=e2e@example.invalid",
        ...args,
      ],
      { cwd: repository, encoding: "utf8" },
    );
  git("init");
  await writeFile(path.join(repository, "README.md"), "Argument probe\n");
  git("add", ".");
  git("commit", "-m", "fixture");
  const parentScript = path.join(root, "parent.mjs");
  await writeFile(parentScript, "process.stdin.resume();\n");
  const context = () => ({
    clientPublicKey: "verification",
    operationId: randomUUID(),
  });
  const store = new HostStore(path.join(root, "host.sqlite"));
  const hostRoot = path.join(root, "host-data");
  await mkdir(hostRoot);
  const { default: native } =
    await import("../../bundle/node_modules/@iori/terminal-native/index.js");
  native.restrictToCurrentUser(hostRoot);
  // Excluding pwsh from this process's PATH exercises the product's normal
  // Windows PowerShell 5.1 fallback without changing machine settings.
  if (process.argv.includes("--powershell51")) {
    const entries = await Promise.all(
      (process.env.PATH ?? "").split(path.delimiter).map(async (directory) => ({
        directory,
        pwsh: await stat(
          path.join(directory.replace(/^"|"$/gu, ""), "pwsh.exe"),
        )
          .then(() => true)
          .catch(() => false),
      })),
    );
    process.env.PATH = entries
      .filter((entry) => !entry.pwsh)
      .map((entry) => entry.directory)
      .join(path.delimiter);
  }
  const { discoverShells } =
    await import("../../bundle/src/terminal/platform.js");
  const discovered = await discoverShells();
  const shell = discovered.shells.find(
    (entry) => entry.id === discovered.preferred,
  );
  const terminals = await TerminalManager.create(store, () => {}, hostRoot);
  const teams = await TeamManager.create(store, terminals, hostRoot);
  let result;
  try {
    const parent = await terminals.saveSimpleCliDefinition(context(), {
      name: "Argument probe parent",
      command: `& '${process.execPath.replaceAll("'", "''")}' '${parentScript.replaceAll("'", "''")}'`,
      modelArgument: "",
    });
    assert.ok(parent.ok);
    const candidate = {
      id: "child",
      cli: "codex",
      model: "gpt-6-luna",
      effort: "low",
      tools: [],
      minimum: "",
    };
    const role = {
      id: "worker",
      name: "Worker",
      when: "Argument verification",
      limit: "1",
      reuse: true,
      split: true,
      instruction: `ARG_PROBE_BEGIN\nPreserve "double quote" and 'single quote' and ’, & 100% %IORI_VALUE% 日本語 C:\\a b\\\nARG_PROBE_END\nDo only the delegated request.`,
      request: "Follow the request.",
      report: "Result",
      candidates: { high: [], medium: [], low: [candidate] },
    };
    const saved = store.teamOperation(context(), "teams.create", {
      definition: {
        name: "Argument probe",
        description: "",
        parent: { ...candidate, id: "parent", cli: parent.result.cliId },
        instruction: "",
        roles: [role],
      },
    });
    assert.ok(saved.ok);
    store.teamOperation(context(), "teams.settings", {
      enabled: true,
      defaultTeam: saved.result.saved.id,
      limits: {},
    });
    const launched = await teams.launch(
      context(),
      saved.result.saved.id,
      repository,
    );
    assert.ok(launched.ok);
    const conversation = store
      .teamConversations()
      .find((entry) => entry.terminalId === launched.result.terminal.id);
    const delegated = await terminals.onTeamCommand(
      { conversation: conversation.id },
      {
        kind: "delegate",
        role: "Worker",
        difficulty: "low",
        title: "Argument probe",
        body: "Reply ARGUMENT_PROBE_DONE only. Do not change files or execute commands.",
        worktree: "parent",
      },
    );
    assert.equal(delegated.ok, true, delegated.text);
    const child = await waitForOperation(
      "Argument probe child launch",
      () =>
        store.teamChildren().find((entry) => entry.id === delegated.data.child),
      (entry) => Boolean(entry?.terminalId) || entry?.state === "failed",
      () => false,
    );
    const expected = await readFile(child.instructionFile, "utf8");
    const sessions = path.join(process.env.CODEX_HOME, "sessions");
    async function readInstructions() {
      const files = await ifPresent(
        () => readdir(sessions, { recursive: true }),
        [],
      );
      const records = [];
      for (const file of files.filter((name) => name.endsWith(".jsonl"))) {
        const entries = (await readFile(path.join(sessions, file), "utf8"))
          .split("\n")
          .filter(Boolean)
          .flatMap((line) => {
            try {
              return [JSON.parse(line)];
            } catch {
              return [];
            }
          });
        const texts = [];
        for (const entry of entries) {
          if (entry.payload?.developer_instructions)
            texts.push(
              typeof entry.payload.developer_instructions === "string"
                ? entry.payload.developer_instructions
                : entry.payload.developer_instructions.text,
            );
          if (
            entry.type === "response_item" &&
            entry.payload?.role === "developer"
          )
            for (const part of entry.payload.content ?? [])
              if (part.text) texts.push(part.text);
        }
        records.push({ file, texts });
      }
      return records;
    }
    let hookReviewSkipped = false;
    let hookReviewScreen;
    const observed = await waitForOperation(
      "Codex developer instructions record",
      async () => {
        const screen =
          store.terminal(child.terminalId)?.snapshot?.snapshotAnsi ?? "";
        if (!hookReviewSkipped && screen.includes("Hooks need review")) {
          hookReviewScreen = screen;
          // This probe needs argv, not hooks. Esc selects the CLI's skip option;
          // it does not grant trust to a hook or acknowledge folder trust.
          const frames = [
            { kind: "terminal.input", data: "\u001b" },
            undefined,
          ];
          await terminals.openStream(
            {},
            {
              async write() {},
              async finish() {},
              async reset() {},
              async stop() {},
            },
            {
              kind: "terminal",
              operationId: randomUUID(),
              action: "open",
              terminalId: child.terminalId,
              viewId: randomUUID(),
              deviceClass: "desktop",
              cols: 80,
              rows: 24,
              snapshotMaxLines: 5000,
              snapshotMaxBytes: 4 * 1024 * 1024,
              viewAttributes: {
                foreground: [255, 255, 255],
                background: [0, 0, 0],
                cursor: [255, 255, 255],
                ansi: Array.from({ length: 256 }, () => [0, 0, 0]),
                colorSchemeMode: "dark",
                cursorStyle: "block",
                cursorBlink: true,
              },
            },
            async () => frames.shift(),
          );
          hookReviewSkipped = true;
          console.log("Skipped hook trust review without granting trust");
        }
        return {
          records: await readInstructions(),
          child: store.teamChildren().find((entry) => entry.id === child.id),
          cli: terminals.summary(child.terminalId)?.cliStatus,
        };
      },
      (state) =>
        state.records.some((record) =>
          record.texts.some(
            (text) =>
              typeof text === "string" && text.includes("ARG_PROBE_BEGIN"),
          ),
        ) ||
        state.child?.state === "failed" ||
        state.child?.parentResponse === "unreported",
      () => false,
    );
    const command = store.terminalCli(child.terminalId)?.command;
    result = {
      passed: observed.records
        .flatMap((record) => record.texts)
        .some(
          (text) =>
            typeof text === "string" &&
            Buffer.from(expected).equals(Buffer.from(text)),
        ),
      expected,
      shell,
      expectedUtf8: Buffer.from(expected).toString("base64"),
      command,
      model: candidate.model,
      observed,
      hookReviewSkipped,
      hookReviewScreen,
      exactMatches: observed.records
        .flatMap((record) => record.texts)
        .filter((text) => typeof text === "string")
        .map((text) => ({
          equal: Buffer.from(expected).equals(Buffer.from(text)),
          includesExpected: text.includes(expected),
          received: text,
          receivedUtf8: Buffer.from(text).toString("base64"),
        })),
      screen: store.terminal(child.terminalId)?.snapshot,
    };
    await writeFile(
      path.join(root, "argument-team-observed.json"),
      JSON.stringify(result, null, 2),
    );
    return result;
  } finally {
    await teams.close();
    await terminals.close();
    await stopTerminalDaemon(hostRoot);
    store.close();
  }
}

async function probe() {
  const sandboxCase = process.argv
    .find((arg) => arg.startsWith("--sandbox-case="))
    ?.split("=")[1];
  if (process.argv.includes("--argument-probe")) return argumentProbe();
  if (process.argv.includes("--argument-team")) return argumentTeamProbe();
  const { HostStore } = await import("../../bundle/src/store.js");
  const { TerminalManager } =
    await import("../../bundle/src/terminal/manager.js");
  const { TeamManager } = await import("../../bundle/src/teams/manager.js");
  const { WorktreeCreator, worktreeSetup } =
    await import("../../bundle/src/worktree-creation.js");
  const { randomUUID } = await import("node:crypto");
  const { execFileSync } = await import("node:child_process");
  const { waitFor, waitForOperation } = await import("../ui.mjs");
  const { cliRecordSummary } = await import("./records.mjs");
  const cliFailure = process.argv.includes("--cli-failure");
  const readOnly =
    process.argv.includes("--read-only") ||
    sandboxCase === "profile" ||
    sandboxCase === "basic-profile";
  const readRequestOnly =
    sandboxCase === "personal-child" ||
    sandboxCase === "unconfigured-child" ||
    (sandboxCase === "profile" && process.argv.includes("--unelevated"));
  const { codexSandboxRecords } = await import("./codex-sandbox.mjs");
  const invalidModel = "iori-verification-unavailable-model";
  const backend = process.argv.includes("--unelevated")
    ? "unelevated"
    : "elevated";
  const root = process.cwd(),
    repository = path.join(root, "repository");
  if (sandboxCase === "basic-profile") {
    const temporary = path.join(root, "team's temp");
    await mkdir(temporary);
    process.env.TEMP = temporary;
    process.env.TMP = temporary;
  }
  const partialCases = [];
  const progressDirectory = path.join(root, ".local/evidence/codex-sandbox");
  const writeCases = async () => {
    await mkdir(progressDirectory, { recursive: true });
    await writeFile(
      path.join(progressDirectory, "progress.json"),
      JSON.stringify(partialCases, null, 2),
    );
  };
  const saveCase = async (value) => {
    partialCases.push({ ...value });
    await writeCases();
    return partialCases.length - 1;
  };
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
  await writeFile(
    path.join(repository, "README.md"),
    "Team command verification\n",
  );
  git("add", "README.md");
  git("commit", "-m", "fixture");
  const expectedBody =
    'Windows report\n"quoted" & %IORI_VALUE%\n日本語の報告\n';
  await writeFile(
    path.join(repository, "verification-report.txt"),
    expectedBody,
    "utf8",
  );
  git("add", "verification-report.txt");
  git("commit", "-m", "multiline report fixture");
  const requestFile = path.join(repository, "request.md");
  await writeFile(
    requestFile,
    "Run iori report --file verification-report.txt exactly once, then wait for the parent. The file is committed in your worktree. Set the tool workdir explicitly to your current worktree. If reporting fails, describe the error and end your response. Do not change files. Do not print or inspect iori credentials.",
  );
  const actor = path.join(root, "parent.mjs"),
    resultFile = path.join(root, "delegation.json");
  const metadataFile = path.join(root, "metadata.json");
  const expectedArgument = 'A & B 100% "quoted" %IORI_VALUE% 日本語';
  const expectedStdin =
    'Windows stdin\n"quoted" & %IORI_VALUE%\n日本語の標準入力\n';
  const quotePowerShell = (value) => "'" + value.replaceAll("'", "''") + "'";
  const psCommands = path.join(root, "metadata.ps1");
  const cmdCommands = path.join(root, "metadata.cmd");
  const bashCommands = path.join(root, "metadata.sh");
  await writeFile(
    psCommands,
    [
      `iori plan add --title ${quotePowerShell(expectedArgument)} --json`,
      `iori plan cancel 1 --reason ${quotePowerShell(expectedArgument)} --json`,
      "if($LASTEXITCODE -ne 0){exit $LASTEXITCODE}",
    ].join("\n"),
  );
  // Batch files escape percent expansion with %%; backslashes preserve quotes
  // for the native executable's argv parser after cmd has interpreted the line.
  const cmdValue =
    '"' + expectedArgument.replaceAll("%", "%%").replaceAll('"', '\\"') + '"';
  await writeFile(
    cmdCommands,
    [
      "@echo off",
      "chcp 65001 >nul",
      `iori plan add --title ${cmdValue} --json`,
      "if errorlevel 1 exit /b %errorlevel%",
      `iori plan cancel 2 --reason ${cmdValue} --json`,
      "exit /b %errorlevel%",
    ].join("\r\n"),
  );
  await writeFile(
    bashCommands,
    [
      "set -e",
      `iori plan add --title '${expectedArgument}' --json`,
      `iori plan cancel 3 --reason '${expectedArgument}' --json`,
    ].join("\n"),
  );
  const bash = path.resolve(
    path.dirname(
      execFileSync("where.exe", ["git"], { encoding: "utf8" })
        .trim()
        .split(/\r?\n/)[0],
    ),
    "../bin/bash.exe",
  );
  const legacyPowerShell = [
    `iori plan add --title ${quotePowerShell(expectedArgument.replaceAll('"', '\\"'))} --json`,
    `iori plan cancel 4 --reason ${quotePowerShell(expectedArgument.replaceAll('"', '\\"'))} --json`,
    "if($LASTEXITCODE -ne 0){exit $LASTEXITCODE}",
  ].join("\n");
  const delegationCommand = `iori delegate --role Worker --difficulty low --title Windows-worker --worktree new --file request.md --json`;
  const expectedNode = execFileSync("where.exe", ["node"], { encoding: "utf8" })
    .trim()
    .split(/\r?\n/)[0];
  const script = `import {execFile} from 'node:child_process';import {promisify} from 'node:util';import {writeFile,rename,readFile,rm} from 'node:fs/promises';import {watch,appendFileSync} from 'node:fs';
const exec=promisify(execFile);
${cliFailure ? `process.stdin.on('data',chunk=>appendFileSync(${JSON.stringify(path.join(root, "parent-input.txt"))},chunk));` : ""}
process.env.IORI_VALUE='EXPANDED_SENTINEL';
try {
  const nodeWhere=(await exec('where.exe',['node'])).stdout.trim().split(/\\r?\\n/)[0];
  if(nodeWhere.toLowerCase()!==${JSON.stringify(expectedNode)}.toLowerCase())throw new Error('Team CLI changed the user Node path: '+nodeWhere);
  const nodeVersion=(await exec('node',['--version'])).stdout.trim();
  const shellResults=[];
  for(const [shell,file,args] of ${JSON.stringify([
    ["PowerShell", "pwsh", ["-NoProfile", "-File", psCommands]],
    ["cmd", "cmd.exe", ["/d", "/c", cmdCommands]],
    [
      "Git Bash",
      bash,
      ["--noprofile", "--norc", bashCommands.replaceAll("\\", "/")],
    ],
    [
      "Windows PowerShell",
      "powershell.exe",
      [
        "-NoProfile",
        "-EncodedCommand",
        Buffer.from(legacyPowerShell, "utf16le").toString("base64"),
      ],
    ],
  ])}) {
    const result=await exec(file,args);shellResults.push({shell,output:result.stdout});
  }
  const input=exec(process.env.IORI_COMMAND_BIN+'\\\\iori.exe',['plan','goal','--body','-','--json']);
  input.child.stdin.end(${JSON.stringify(expectedStdin)});await input;
  const exitCode=await exec(process.env.IORI_COMMAND_BIN+'\\\\iori.exe',['unknown-command']).then(()=>0,error=>error.code);
  if(exitCode!==1)throw new Error('iori must preserve the command exit code: '+exitCode);
  await writeFile(${JSON.stringify(metadataFile)},JSON.stringify({passed:true,shellResults,nodeWhere,nodeVersion}));
} catch(error) {
  await writeFile(${JSON.stringify(metadataFile)},JSON.stringify({passed:false,error:error.message,stdout:error.stdout,stderr:error.stderr}));
}

const setupRoot=await import('node:fs/promises').then(fs=>fs.readFile('.iori-setup-root','utf8'));if(setupRoot!==${JSON.stringify(repository)})throw new Error('Setup must complete before parent CLI starts');
const result=await exec('pwsh',['-NoProfile','-Command',${JSON.stringify(delegationCommand)}]).then(r=>r.stdout,e=>JSON.stringify({ok:false,text:e.stderr||e.message}));
await writeFile(${JSON.stringify(resultFile + ".tmp")},result);await rename(${JSON.stringify(resultFile + ".tmp")},${JSON.stringify(resultFile)});
let resuming=false;
watch(${JSON.stringify(root)},async(_event,name)=>{
  if(name!=='resume-command.json'||resuming)return;
  resuming=true;
  try {
    const request=JSON.parse(await readFile(${JSON.stringify(path.join(root, "resume-command.json"))},'utf8'));
    await rm(${JSON.stringify(path.join(root, "resume-command.json"))});
    const sending=exec(process.env.IORI_COMMAND_BIN+'\\\\iori.exe',['send',request.child,'--kind','request','--body','-','--json']);
    sending.child.stdin.end(request.body);
    const result=await sending;
    await writeFile(${JSON.stringify(path.join(root, "resume-result.json"))},result.stdout);
  }catch(error){await writeFile(${JSON.stringify(path.join(root, "resume-result.json"))},JSON.stringify({ok:false,text:error.message}));}
  finally{resuming=false;}
});
${
  readOnly || !sandboxCase
    ? `let reading=false;
watch(${JSON.stringify(root)},async(_event,name)=>{
  if(name!=='read-command.json'||reading)return;
  reading=true;
  try {
    const request=JSON.parse(await readFile(${JSON.stringify(path.join(root, "read-command.json"))},'utf8'));
    await rm(${JSON.stringify(path.join(root, "read-command.json"))});
    const result=await exec(process.env.IORI_COMMAND_BIN+'\\\\iori.exe',['read',request.child,'--json']);
    await writeFile(${JSON.stringify(path.join(root, "read-result.json.tmp"))},result.stdout);
  }catch(error){await writeFile(${JSON.stringify(path.join(root, "read-result.json.tmp"))},JSON.stringify({ok:false,text:error.message}));}
  await rename(${JSON.stringify(path.join(root, "read-result.json.tmp"))},${JSON.stringify(path.join(root, "read-result.json"))});
});`
    : ""
}
process.stdout.write('parent ready\\n');process.stdin.resume();setInterval(()=>{},1000);`;
  await writeFile(actor, script);
  const readReport = async (childId) => {
    await writeFile(
      path.join(root, "read-command.json.tmp"),
      JSON.stringify({ child: childId }),
    );
    await rename(
      path.join(root, "read-command.json.tmp"),
      path.join(root, "read-command.json"),
    );
    const read = await waitForOperation(
      "親のiori readによる報告の取得",
      () =>
        readFile(path.join(root, "read-result.json"), "utf8")
          .then(JSON.parse)
          .catch((error) => {
            if (error.code === "ENOENT") return undefined;
            throw error;
          }),
      Boolean,
      () => false,
    );
    assert.equal(read.ok, true, read.text);
    return read;
  };
  const context = () => ({
    clientPublicKey: "verification",
    operationId: randomUUID(),
  });
  const store = new HostStore(path.join(root, "host.sqlite"));
  const hostRoot = path.join(root, "host-data");
  await mkdir(hostRoot, { recursive: true });
  const { default: terminalNative } =
    await import("../../bundle/node_modules/@iori/terminal-native/index.js");
  // Match openHostStorage: all Host data is private, including inherited ACLs.
  terminalNative.restrictToCurrentUser(hostRoot);
  const staleCopy = path.join(root, "stale-command-copy");
  await mkdir(staleCopy);
  terminalNative.restrictToCurrentUser(staleCopy);
  await copyFile(
    path.join(root, "bundle/node_modules/@iori/terminal-native/iori.exe"),
    path.join(staleCopy, "iori.exe"),
  );
  // Reproduce copies left by a previous daemon without bypassing startup cleanup.
  await writeFile(
    path.join(hostRoot, "team-command-sessions.json"),
    JSON.stringify([staleCopy]),
  );
  const commandDirectories = new Set([staleCopy]);
  const terminals = await TerminalManager.create(store, () => {}, hostRoot);
  await assert.rejects(stat(staleCopy), { code: "ENOENT" });
  const teams = await TeamManager.create(
    store,
    terminals,
    path.join(root, "host-data"),
  );
  let outcome;
  try {
    const clis = await terminals.listClis();
    assert.ok(clis.ok);
    assert.ok(clis.result.clis.some((cli) => cli.id === "codex"));
    const startupExtra = `-c "model_reasoning_summary = 'auto'"`;
    store.saveCliStartupArguments(
      "codex",
      `-m unused-model --config=model_reasoning_effort=high ${startupExtra}`,
    );
    // A CLI added by name and launch command.
    const parent = await terminals.saveSimpleCliDefinition(context(), {
      name: "Verification parent shell",
      command: `& '${process.execPath.replaceAll("'", "''")}' '${actor.replaceAll("'", "''")}'`,
      modelArgument: "",
    });
    assert.ok(parent.ok && "cliId" in parent.result);
    const candidate = {
      id: "child",
      cli: "codex",
      model: cliFailure ? invalidModel : "gpt-6-luna",
      effort: "low",
      tools: [],
      minimum: "",
      ...(readOnly ? { sandbox: "read-only", permission: "never" } : {}),
    };
    const saved = store.teamOperation(context(), "teams.create", {
      definition: {
        name: "Windows command verification",
        description: "",
        parent: { ...candidate, id: "parent", cli: parent.result.cliId },
        instruction: "",
        roles: [
          {
            id: "worker",
            name: "Worker",
            when: "Verification",
            limit: "1",
            reuse: true,
            split: true,
            instruction:
              "Run only the requested iori report; do not change files.",
            request: "Follow the request.",
            report: "Result",
            candidates: { high: [], medium: [], low: [candidate] },
          },
        ],
      },
    });
    assert.ok(saved.ok);
    assert.ok(
      store.teamOperation(context(), "teams.settings", {
        enabled: true,
        defaultTeam: saved.result.saved.id,
        limits: {},
      }).ok,
    );
    assert.equal(terminals.list().result.defaultShell, "powershell");
    const setupCommand =
      "[Console]::WriteLine('WINDOWS_SETUP_OK'); [IO.File]::WriteAllText((Join-Path (Get-Location) '.iori-setup-root'), $env:IORI_ROOT_PATH)";
    const creator = new WorktreeCreator(store);
    const created = await creator.create(
      context(),
      repository,
      "setup-parent",
      "HEAD",
      setupCommand,
    );
    assert.equal(created.state, "created");
    await writeFile(
      path.join(created.path, "request.md"),
      await readFile(requestFile),
    );
    const launched = await teams.launch(
      context(),
      saved.result.saved.id,
      created.path,
      await worktreeSetup(created.path, store),
    );
    assert.ok(launched.ok);
    const delegated = await waitFor(
      () =>
        readFile(resultFile, "utf8")
          .then(JSON.parse)
          .catch((error) => {
            if (error.code === "ENOENT") return undefined;
            throw error;
          }),
      Boolean,
      120000,
      "Windowsのiori.exe委譲",
    );
    const metadata = JSON.parse(await readFile(metadataFile, "utf8"));
    assert.equal(metadata.passed, true, JSON.stringify(metadata));
    const conversation = store
      .teamConversations()
      .find((entry) => entry.terminalId === launched.result.terminal.id);
    assert.ok(conversation);
    const parentRoute = await terminals.registerCommand({
      conversation: conversation.id,
    });
    commandDirectories.add(parentRoute.env.IORI_COMMAND_DIRECTORY);
    const plan = conversation.plan;
    assert.ok(plan, "Hostに保存された計画");
    assert.equal(plan.tasks.length, 4);
    for (const task of plan.tasks) {
      assert.equal(task.title, expectedArgument);
      assert.equal(task.reason, expectedArgument);
      assert.equal(task.state, "cancelled");
    }
    assert.equal(plan.goal, expectedStdin);
    assert.equal(delegated.ok, true, delegated.text);
    const child = await waitFor(
      () =>
        store
          .teamChildren()
          .find(
            (entry) => entry.id === delegated.data.child && entry.terminalId,
          ),
      Boolean,
      undefined,
      "Windowsの子の割り当て",
    );
    await waitFor(
      () =>
        readFile(path.join(child.cwd, ".iori-setup-root"), "utf8").catch(
          (error) => {
            if (error.code === "ENOENT") return undefined;
            throw error;
          },
        ),
      (value) => value === repository,
    );
    assert.equal(
      await readFile(path.join(created.path, ".iori-setup-root"), "utf8"),
      repository,
    );
    const childCommand = store.terminalCli(child.terminalId).command;
    assert.ok(childCommand.includes(startupExtra));
    assert.equal(childCommand.includes("unused-model"), false);
    assert.equal(childCommand.includes("model_reasoning_effort=high"), false);
    if (sandboxCase) {
      const capturedCase = await saveCase({
        scenario: sandboxCase,
        childStarted: true,
        storedCommand: childCommand,
      });
      if (readRequestOnly) {
        const { TerminalScreenObservation } =
          await import("../terminal/screen-observation.ts");
        const folderTrustConfirmation = async (snapshot) => {
          if (sandboxCase !== "unconfigured-child" || !snapshot) return false;
          const screen = new TerminalScreenObservation();
          try {
            await screen.apply(child.terminalId, {
              kind: "terminal.snapshot",
              terminalId: child.terminalId,
              snapshot,
            });
            return screen
              .currentText(child.terminalId)
              .includes("Trust this folder?");
          } finally {
            screen.dispose();
          }
        };
        const awaitingApproval = (state) =>
          state.cli?.state === "waiting" &&
          state.cli?.attention?.kind === "approval";
        const observed = await waitForOperation(
          "Windows read-onlyの子の依頼書の読取",
          async () => {
            const snapshot = store.terminal(child.terminalId)?.snapshot;
            const observed = {
              child: store
                .teamChildren()
                .find((entry) => entry.id === child.id),
              cli: terminals.summary(child.terminalId)?.cliStatus,
              records: await codexSandboxRecords(),
              screen: snapshot,
              folderTrustConfirmation: await folderTrustConfirmation(snapshot),
            };
            if (
              sandboxCase === "personal-child" ||
              sandboxCase === "unconfigured-child"
            ) {
              partialCases[capturedCase] = {
                ...partialCases[capturedCase],
                ...observed,
                conversationExists: observed.records.length > 0,
              };
              await writeCases();
            }
            return observed;
          },
          (state) =>
            Boolean(state.child?.reportFiles.length) ||
            state.child?.state === "failed" ||
            state.child?.parentResponse === "unreported" ||
            awaitingApproval(state) ||
            state.folderTrustConfirmation,
          () => false,
        );
        const requestRead = observed.records.some((record) =>
          record.entries.some(
            (entry) =>
              entry.type === "response_item" &&
              ["function_call_output", "custom_tool_call_output"].includes(
                entry.payload?.type,
              ) &&
              JSON.stringify(entry.payload.output).includes(
                "Set the tool workdir explicitly to your current worktree.",
              ),
          ),
        );
        const conversationExists = observed.records.some((record) =>
          record.entries.some((entry) => entry.type === "turn_context"),
        );
        const requestApproval =
          (sandboxCase === "personal-child" ||
            sandboxCase === "unconfigured-child") &&
          conversationExists &&
          awaitingApproval(observed) &&
          /delegation-[\w-]+\.md/u.test(observed.cli.attention.summary ?? "");
        outcome = {
          passed:
            (requestRead ||
              requestApproval ||
              observed.folderTrustConfirmation) &&
            observed.child?.state !== "failed",
          scenario: sandboxCase,
          childStarted: true,
          conversationExists,
          requestRead,
          requestApproval,
          storedCommand: childCommand,
          windowsSandbox: backend,
          reportReceived: Boolean(observed.child?.reportFiles.length),
          ...observed,
        };
        await saveCase(outcome);
        return outcome;
      }
    }
    if (cliFailure) {
      const failed = await waitForOperation(
        "Windows Codexの子のCLIエラー",
        () =>
          teams.listChildren().children.find((entry) => entry.id === child.id),
        (entry) => entry?.state === "failed",
        () => {
          const entry = teams
            .listChildren()
            .children.find((item) => item.id === child.id);
          return entry && entry.state !== "running" && entry.state !== "failed"
            ? `子が ${entry.state} で終了しました`
            : false;
        },
      );
      assert.match(failed.failure, /iori-verification-unavailable-model/u);
      const notice = await waitForOperation(
        "親へのCLIエラーの知らせ",
        () =>
          readFile(path.join(root, "parent-input.txt"), "utf8").catch(
            (error) => {
              if (error.code === "ENOENT") return "";
              throw error;
            },
          ),
        (input) => input.includes(failed.failure),
        () => false,
      );
      outcome = {
        passed: true,
        childStarted: true,
        model: child.candidate.model,
        childState: failed.state,
        failure: failed.failure,
        parentNotice: notice,
        backend: terminals.list().result.windowsPty,
      };
      return outcome;
    }
    if (process.argv.includes("--stop-only")) {
      await waitFor(
        () => store.terminal(child.terminalId)?.snapshot?.snapshotAnsi,
        (screen) =>
          screen?.includes("Codex") || screen?.includes("Would you like"),
        120000,
        "Windowsの本物の子CLIの画面",
      );
      const stopped = await teams.stopChild(context(), child.id);
      assert.ok(stopped.ok);
      assert.equal(terminals.isCliRunning(child.terminalId), false);
      const ended = teams
        .listChildren()
        .children.find((entry) => entry.id === child.id);
      assert.equal(ended.state, "stopped");
      assert.equal(ended.stoppedBy, "user");
      assert.ok(store.terminal(child.terminalId)?.snapshot?.snapshotAnsi);
      outcome = {
        passed: true,
        userStopVerified: true,
        screenRetained: true,
        childStarted: true,
        model: child.candidate.model,
        backend: terminals.list().result.windowsPty,
      };
      return outcome;
    }
    if (readOnly) {
      await waitForOperation(
        "Windows read-only Codexの子の報告",
        () => store.teamChildren().find((entry) => entry.id === child.id),
        (entry) => Boolean(entry?.reportFiles.length),
        () => {
          const entry = store
            .teamChildren()
            .find((item) => item.id === child.id);
          return entry?.state === "failed" ||
            entry?.parentResponse === "unreported"
            ? `子が報告できませんでした: ${entry.failure ?? entry.parentResponse}`
            : false;
        },
      );
      const read = await readReport(child.id);
      const sourceBody = await readFile(
        path.join(child.cwd, "verification-report.txt"),
        "utf8",
      );
      assert.equal(sourceBody.replaceAll("\r\n", "\n"), expectedBody);
      assert.deepEqual(read.data.reports, [sourceBody]);
      const records = sandboxCase ? await codexSandboxRecords() : undefined;
      if (sandboxCase) {
        const profileContext = records
          .flatMap((record) => record.entries)
          .find(
            (entry) =>
              entry.type === "turn_context" &&
              entry.payload?.active_permission_profile?.id === "iori-read-only",
          )?.payload;
        assert.ok(profileContext, "Codex自身の記録でread-only profileを確認");
        assert.equal(profileContext.approval_policy, "never");
        if (sandboxCase === "basic-profile") {
          assert.ok(
            profileContext.permission_profile.file_system.entries.some(
              (entry) =>
                entry.access === "write" &&
                entry.path?.type === "path" &&
                entry.path.path.includes("team's temp"),
            ),
          );
        }
      }
      outcome = {
        passed: true,
        childStarted: true,
        reportReceived: true,
        model: child.candidate.model,
        permission: child.candidate.permission,
        sandbox: child.candidate.sandbox,
        windowsSandbox: backend,
        storedCommand: childCommand,
        ...(sandboxCase ? { scenario: sandboxCase, records } : {}),
      };
      if (sandboxCase) await saveCase(outcome);
      return outcome;
    }
    await waitFor(
      () =>
        store
          .teamChildren()
          .find((entry) => entry.id === child.id && entry.reportFiles.length),
      Boolean,
      120000,
      "既定の許可のCodexの複数行report",
    );
    const reported = store
      .teamChildren()
      .find((entry) => entry.id === child.id);
    const firstCli = store.terminalCli(child.terminalId);
    const checkRoleRecords = async () => {
      const { codex } = await cliRecordSummary(process.env.CODEX_HOME);
      assert.deepEqual(codex.models, [candidate.model]);
      assert.deepEqual(codex.efforts, [candidate.effort]);
      return codex;
    };
    const initialRoleRecords = await checkRoleRecords();
    const sourceBody = await readFile(
      path.join(child.cwd, "verification-report.txt"),
      "utf8",
    );
    // Git may check this fixture out with CRLF. Verify the actual input bytes,
    // plus the fixture's text, rather than mistaking checkout conversion for
    // command-line corruption.
    assert.equal(sourceBody.replaceAll("\r\n", "\n"), expectedBody);
    assert.equal(await readFile(reported.reportFiles[0], "utf8"), sourceBody);
    const parentRead = await readReport(child.id);
    assert.deepEqual(parentRead.data.reports, [sourceBody]);
    assert.notEqual(child.cwd, repository);
    const childRoute = await terminals.registerCommand({
      conversation: child.conversation,
      child: child.id,
    });
    const childCommandDirectory = childRoute.env.IORI_COMMAND_DIRECTORY;
    commandDirectories.add(childCommandDirectory);
    const initialContext = (await codexSandboxRecords())
      .flatMap((record) => record.entries)
      .find((entry) => entry.type === "turn_context")?.payload;
    assert.equal(initialContext?.sandbox_policy?.type, "workspace-write");
    assert.ok(
      initialContext.sandbox_policy.writable_roots.some(
        (directory) =>
          path.win32.normalize(directory).toLowerCase() ===
          path.win32.normalize(childCommandDirectory).toLowerCase(),
      ),
    );
    assert.equal(childRoute.env.IORI_COMMAND_BIN, childCommandDirectory);
    assert.ok(
      (await stat(path.join(childCommandDirectory, "iori.exe"))).isFile(),
    );
    await assert.rejects(stat(path.join(childCommandDirectory, "node.exe")), {
      code: "ENOENT",
    });
    const other = await terminals.registerCommand({
      conversation: "isolation-probe",
    });
    const otherDirectory = other.env.IORI_COMMAND_DIRECTORY;
    commandDirectories.add(otherDirectory);
    const otherWork = path.join(root, "other-session-work");
    await mkdir(otherWork);
    const isolationResult = path.join(otherWork, "isolation.json");
    const isolationScript = path.join(otherWork, "isolation.ps1");
    await writeFile(
      isolationScript,
      [
        "$ErrorActionPreference='Stop'",
        `[IO.File]::WriteAllText(${quotePowerShell(path.join(otherDirectory, "own-write.txt"))},'own session')`,
        "$directoryWritable=$false;$executableWritable=$false",
        `try{[IO.File]::WriteAllText(${quotePowerShell(path.join(childCommandDirectory, "foreign-write.txt"))},'foreign session');$directoryWritable=$true}catch [UnauthorizedAccessException]{}`,
        `try{$handle=[IO.File]::Open(${quotePowerShell(path.join(childCommandDirectory, "iori.exe"))},[IO.FileMode]::Open,[IO.FileAccess]::Write,[IO.FileShare]::ReadWrite);$handle.Dispose();$executableWritable=$true}catch [UnauthorizedAccessException]{}`,
        `[IO.File]::WriteAllText(${quotePowerShell(isolationResult)},(ConvertTo-Json -InputObject @{directoryWritable=$directoryWritable;executableWritable=$executableWritable} -Compress))`,
      ].join("\n"),
    );
    const sandboxArgs = [
      "sandbox",
      "-c",
      'sandbox_mode="workspace-write"',
      "-c",
      "sandbox_workspace_write.writable_roots=" +
        JSON.stringify([otherDirectory]),
      "--",
      "pwsh",
      "-NoProfile",
      "-File",
      isolationScript,
    ];
    const isolationOutput = execFileSync(
      "pwsh",
      [
        "-NoProfile",
        "-Command",
        "& codex " +
          sandboxArgs.map(quotePowerShell).join(" ") +
          ";exit $LASTEXITCODE",
      ],
      {
        cwd: otherWork,
        encoding: "utf8",
      },
    );
    const isolation = JSON.parse(await readFile(isolationResult, "utf8"));
    const acl = {};
    for (const [name, target] of Object.entries({
      mailbox: childCommandDirectory,
      executable: path.join(childCommandDirectory, "iori.exe"),
      otherMailbox: otherDirectory,
    })) {
      const saved = path.join(otherWork, name + ".acl");
      const output = execFileSync("icacls.exe", [target], { encoding: "utf8" });
      execFileSync("icacls.exe", [target, "/save", saved], {
        encoding: "utf8",
      });
      acl[name] = { output, ace: await readFile(saved, "utf16le") };
    }
    await writeFile(
      path.join(root, "session-isolation.json"),
      JSON.stringify(
        { backend, isolation, acl, sandboxOutput: isolationOutput },
        null,
        2,
      ),
    );
    assert.equal(
      isolation.directoryWritable,
      false,
      "Another sandbox session can write this session's mailbox; parent decision required.",
    );
    assert.equal(
      isolation.executableWritable,
      false,
      "Another sandbox session can write iori.exe; parent decision required.",
    );
    other.dispose();
    const stopped = await teams.stopChild(context(), child.id);
    assert.ok(stopped.ok);
    assert.equal(terminals.isCliRunning(child.terminalId), false);
    const stoppedChild = teams
      .listChildren()
      .children.find((entry) => entry.id === child.id);
    assert.equal(stoppedChild.state, "stopped");
    assert.equal(stoppedChild.stoppedBy, "user");
    assert.ok(store.terminal(child.terminalId)?.snapshot);
    await waitFor(
      () =>
        stat(childCommandDirectory)
          .then(() => true)
          .catch((error) => {
            if (error.code === "ENOENT") return false;
            throw error;
          }),
      (exists) => !exists,
      undefined,
      "終了した子のコマンド用コピーの削除",
    );
    await writeFile(
      path.join(root, "resume-command.json.tmp"),
      JSON.stringify({
        child: child.id,
        body: "Run iori report --file verification-report.txt exactly once again, then finish your response. Do not inspect routing credentials.",
      }),
    );
    await rename(
      path.join(root, "resume-command.json.tmp"),
      path.join(root, "resume-command.json"),
    );
    const resumed = await waitFor(
      () =>
        readFile(path.join(root, "resume-result.json"), "utf8")
          .then(JSON.parse)
          .catch((error) => {
            if (error.code === "ENOENT") return undefined;
            throw error;
          }),
      Boolean,
      120000,
      "親のiori sendによる子の再開",
    );
    assert.equal(resumed.ok, true, resumed.text);
    const rereported = await waitFor(
      () => store.teamChildren().find((entry) => entry.id === child.id),
      (entry) => entry.reportFiles.length === 2,
      120000,
      "再開したWindows Codexの再報告",
    );
    assert.equal(await readFile(rereported.reportFiles[1], "utf8"), sourceBody);
    const resumedRoleRecords = await checkRoleRecords();
    const resumedRoute = await terminals.registerCommand({
      conversation: child.conversation,
      child: child.id,
    });
    const resumedDirectory = resumedRoute.env.IORI_COMMAND_DIRECTORY;
    commandDirectories.add(resumedDirectory);
    const restopped = await teams.stopChild(context(), child.id);
    assert.ok(restopped.ok);
    await waitFor(
      () =>
        stat(resumedDirectory).then(
          () => true,
          (error) => {
            if (error.code === "ENOENT") return false;
            throw error;
          },
        ),
      (exists) => !exists,
      undefined,
      "再開後に終了した子の通信フォルダーの削除",
    );
    outcome = {
      childResumeVerified: true,
      parentReadVerified: true,
      initialSandboxPolicy: initialContext.sandbox_policy,
      initialPermissionProfile: initialContext.permission_profile,
      initialCliObserved: firstCli.observed,
      initialCliSessionKnown: Boolean(firstCli.session),
      cliRecords: { initial: initialRoleRecords, resumed: resumedRoleRecords },
      userStopVerified: true,
      screenRetained: true,
      passed: true,
      shell: terminals.list().result.defaultShell,
      backend: terminals.list().result.windowsPty,
      cli: clis.result.clis.find((cli) => cli.id === "codex"),
      configuredModel: child.candidate.model,
      command: "iori.exe via PowerShell (--file)",
      localRoute: "per-session file mailbox",
      childStarted: true,
      worktreeCreated: true,
      parentSetupBeforeCliVerified: true,
      childSetupVerified: true,
      reportVerified: true,
      multilineBodyVerified: true,
      shellArgumentsVerified: metadata.shellResults.map((entry) => entry.shell),
      stdinVerified: true,
      exitCodeVerified: true,
      reportReceived: true,
      model: child.candidate.model,
      permission: "CLI default (unspecified)",
      windowsSandbox: backend,
      staleCopyRemovedAtStartup: true,
      childCopyRemovedAtExit: true,
      nodePathVerified: true,
      sessionIsolationVerified: true,
    };
    return outcome;
  } catch (error) {
    outcome = {
      passed: false,
      error: error.message,
      staleCopyRemovedAtStartup: true,
      metadata: await readFile(metadataFile, "utf8")
        .then(JSON.parse)
        .catch(() => undefined),
      children: store.teamChildren(),
      screens: store.listTerminals().map((record) => ({
        id: record.id,
        cli: store.terminalCli(record.id)?.cli.id,
        observed: store.terminalCli(record.id)?.observed ?? false,
        hasSession: Boolean(store.terminalCli(record.id)?.session),
        screen: [
          store.terminal(record.id)?.snapshot?.scrollbackAnsi,
          store.terminal(record.id)?.snapshot?.snapshotAnsi,
        ]
          .filter(Boolean)
          .join("\n")
          .replace(/[a-f0-9]{64}/g, "[redacted]"),
      })),
    };
    return outcome;
  } finally {
    if (outcome) {
      outcome.partialCases = [...partialCases];
    }
    const { stopTerminalDaemon } =
      await import("../../bundle/src/terminal/daemon/launch.js");
    const cleanup = [];
    for (const close of [
      () => teams.close(),
      () => terminals.close(),
      () => stopTerminalDaemon(path.join(root, "host-data")),
    ]) {
      try {
        await close();
      } catch (error) {
        cleanup.push(error.message);
      }
    }
    if (cleanup.length) {
      outcome.passed = false;
      outcome.cleanupErrors = cleanup;
    }
    const remainingCopies = [];
    for (const directory of commandDirectories) {
      const exists = await stat(directory).then(
        () => true,
        (error) => {
          if (error.code === "ENOENT") return false;
          throw error;
        },
      );
      if (exists) remainingCopies.push(directory);
    }
    if (remainingCopies.length) {
      outcome.passed = false;
      outcome.remainingCommandCopies = remainingCopies;
    } else {
      outcome.commandCopiesRemovedAtShutdown = true;
    }
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
      ".local/evidence/team-command",
    `run-${Date.now()}-${process.pid}`,
  );
  await mkdir(evidence, { recursive: true });
  const backend = process.argv.includes("--unelevated")
    ? "unelevated"
    : "elevated";
  let restoreSandbox = false;
  const normalCodexHome = windows(
    "if($env:CODEX_HOME){$env:CODEX_HOME}else{Join-Path $env:USERPROFILE '.codex'}",
  );
  const temporary = await mkdtemp(path.join(tmpdir(), "iori-team-command-"));
  const root = `${verificationLocal.windows.home}\\iori-development\\team-command-${Date.now()}-${process.pid}`;
  const task = {
    task: `iori-team-command-${Date.now()}-${process.pid}`,
    script: root + "\\probe.ps1",
    user:
      verificationLocal.windows.host + "\\" + verificationLocal.windows.user,
    sessionId,
  };
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
    const packaged = JSON.parse(
      windows(
        `Compress-Archive -Path ${ps(root + "\\bundle\\*")} -DestinationPath ${ps(root + "\\host.zip")};$zip=[IO.Compression.ZipFile]::OpenRead(${ps(root + "\\host.zip")});try{@{entries=@($zip.Entries | Where-Object {$_.FullName -like '*terminal-native*iori.exe'} | Select-Object FullName,Length)}|ConvertTo-Json -Depth 4}finally{$zip.Dispose()}`,
      ),
    );
    await writeFile(
      path.join(evidence, "bundle-contents.json"),
      JSON.stringify(packaged, null, 2) + "\n",
    );
    assert.equal(packaged.entries.length, 1);
    assert.ok(packaged.entries[0].Length > 0);
    const home = root + "\\cli-home",
      resultFile = root + "\\result.json";
    windows(
      `[IO.Directory]::CreateDirectory(${ps(home + "\\.codex")}) | Out-Null;New-Item -ItemType HardLink -Path ${ps(home + "\\.codex\\auth.json")} -Target (Join-Path $env:USERPROFILE '.codex\\auth.json') | Out-Null`,
    );
    const sandboxCase = process.argv
      .find((arg) => arg.startsWith("--sandbox-case="))
      ?.split("=")[1];
    await writeWindows(
      home + "\\.codex\\config.toml",
      (sandboxCase === "personal-child" ? 'sandbox_mode = "read-only"\n' : "") +
        'check_for_update_on_startup = false\ncli_auth_credentials_store = "file"\nmodel = "gpt-6-luna"\nmodel_reasoning_effort = "low"\n[windows]\nsandbox = "' +
        backend +
        '"\n' +
        (sandboxCase === "unconfigured-child"
          ? ""
          : "[projects.'" +
            path.win32.join(root, "repository").toLowerCase() +
            '\']\ntrust_level = "trusted"\n'),
    );
    if (backend === "elevated" && !process.argv.includes("--argument-probe")) {
      restoreSandbox = true;
      const setup = windows(
        `& codex sandbox setup --elevated --current-user --codex-home ${ps(home + "\\.codex")};if($LASTEXITCODE -ne 0){throw 'elevated fixture setup failed'}`,
      );
      await writeFile(path.join(evidence, "sandbox-setup.txt"), setup + "\n");
    }
    let launchError;
    try {
      // Match the installed Host's logon session. In SSH's Session 0,
      // native Codex sandbox commands can fail before PowerShell initializes.
      await writeWindows(
        task.script,
        `$ErrorActionPreference='Stop';[IO.File]::WriteAllText(${ps(root + "\\session.json")},(ConvertTo-Json -InputObject @{sessionId=(Get-Process -Id $PID).SessionId} -Compress));$env:USERPROFILE=${ps(home)};$env:HOME=${ps(home)};$env:CODEX_HOME=${ps(home + "\\.codex")};$env:PATH=${ps(path.win32.dirname(windowsBuildNode) + ";")}+$env:PATH;Set-Location ${ps(root)};& ${ps(root + "\\bundle\\runtime\\node.exe")} verification/cli/team-command.mjs ${process.argv.includes("--argument-probe") ? "--argument-probe " : ""}${process.argv.includes("--argument-team") ? "--argument-team " : ""}${process.argv.includes("--powershell51") ? "--powershell51 " : ""}${process.argv.includes("--stop-only") ? "--stop-only " : ""}${process.argv.includes("--cli-failure") ? "--cli-failure " : ""}${process.argv.includes("--read-only") ? "--read-only " : ""}${sandboxCase ? "--sandbox-case=" + sandboxCase + " " : ""}${backend === "unelevated" ? "--unelevated " : ""}--result ${ps(resultFile)} *> ${ps(root + "\\probe.log")};if(-not(Test-Path -LiteralPath ${ps(resultFile)})){throw 'probe result missing'};exit 0`,
      );
      startWindowsInteractiveTask(task);
      await waitFor(
        () => windows(`Test-Path -LiteralPath ${ps(resultFile)}`),
        (value) => value === "True",
        300000,
        "Windowsのチーム検証の結果",
      );
    } catch (error) {
      launchError = error.message;
    }
    // Retrieve a completed diagnostic even if SSH or the native runner failed.
    if (
      process.argv.some((arg) => arg.startsWith("--sandbox-case=")) ||
      process.argv.includes("--read-only") ||
      process.argv.includes("--argument-probe") ||
      process.argv.includes("--argument-team") ||
      windows(`Test-Path -LiteralPath ${ps(resultFile)}`) !== "True"
    ) {
      const log = windows(
        `if(Test-Path -LiteralPath ${ps(root + "\\probe.log")}){Get-Content -LiteralPath ${ps(root + "\\probe.log")} -Raw}`,
      );
      await writeFile(path.join(evidence, "probe.log"), log + "\n");
    }
    const result = JSON.parse(
      windows(
        `if(Test-Path -LiteralPath ${ps(resultFile)}){Get-Content -LiteralPath ${ps(resultFile)} -Raw}else{@{passed=$false;error=${ps(launchError ?? "probe result missing")}} | ConvertTo-Json}`,
      ),
    );
    const isolationEvidence = windows(
      `if(Test-Path -LiteralPath ${ps(root + "\\session-isolation.json")}){Get-Content -LiteralPath ${ps(root + "\\session-isolation.json")} -Raw}`,
    );
    if (isolationEvidence)
      await writeFile(
        path.join(evidence, "session-isolation.json"),
        isolationEvidence + "\n",
      );
    if (process.argv.includes("--argument-team") && !result.observed) {
      result.capturedInstructions = JSON.parse(
        windows(
          `if(Test-Path -LiteralPath ${ps(root + "\\argument-team-observed.json")}){Get-Content -LiteralPath ${ps(root + "\\argument-team-observed.json")} -Raw}else{'null'}`,
        ),
      );
    }
    if (process.argv.includes("--argument-probe") && !result.cases) {
      result.partialCases = JSON.parse(
        windows(
          `if(Test-Path -LiteralPath ${ps(root + "\\.local\\evidence\\argument-probe\\progress.json")}){Get-Content -LiteralPath ${ps(root + "\\.local\\evidence\\argument-probe\\progress.json")} -Raw}else{'null'}`,
        ),
      );
    }
    if (
      process.argv.some((arg) => arg.startsWith("--sandbox-case=")) &&
      !result.partialCases
    ) {
      result.partialCases = JSON.parse(
        windows(
          `if(Test-Path -LiteralPath ${ps(root + "\\.local\\evidence\\codex-sandbox\\progress.json")}){Get-Content -LiteralPath ${ps(root + "\\.local\\evidence\\codex-sandbox\\progress.json")} -Raw}else{'null'}`,
        ),
      );
    }
    result.executionSession = JSON.parse(
      windows(
        `if(Test-Path -LiteralPath ${ps(root + "\\session.json")}){Get-Content -LiteralPath ${ps(root + "\\session.json")} -Raw}else{'null'}`,
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
        childStarted: result.childStarted,
        reportReceived: result.reportReceived,
        worktreeCreated: result.worktreeCreated,
        model: result.model,
      }),
    );
    assert.equal(result.passed, true);
  } finally {
    try {
      stopOwnedWindowsProcesses(root);
      stopWindowsInteractiveTask(task);
    } finally {
      if (restoreSandbox) {
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
          const result = JSON.parse(value);
          await writeFile(
            path.join(evidence, "sandbox-restored.json"),
            JSON.stringify(result, null, 2) + "\n",
          );
          assert.equal(result.exitCode, 0);
          assert.ok(result.output.includes("IORI_SANDBOX_RESTORED"));
        } finally {
          stopWindowsInteractiveTask(restore);
        }
      }
    }
    try {
      windows(
        `if(Test-Path -LiteralPath ${ps(root)}){cmd.exe /c ${ps('rd /s /q "\\\\?\\' + root + '"')};if(Test-Path -LiteralPath ${ps(root)}){throw 'Windows verification folder remains'}}`,
      );
    } catch (error) {
      console.error("Windows verification cleanup failed:", error);
      process.exitCode = 1;
    }
    await rm(temporary, { recursive: true, force: true });
  }
}
