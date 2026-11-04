import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { hookInstallContext } from "../../apps/host/src/cli/hook-install.ts";
import { hooks as claude } from "../../apps/host/src/cli/claude/hooks.ts";
import { hooks as antigravity } from "../../apps/host/src/cli/antigravity/hooks.ts";
import {
  hookReceiver,
  hookReply,
  hookShells,
  runHookCommand,
} from "./hook-shells.mjs";

// Model-free check of real installed commands. The JSON deliberately contains
// cmd syntax; only this run's disposable TEMP may receive the proof file.
async function checkWindows() {
  const root = join(process.cwd(), `hook-shells-${Date.now()}`);
  const results = [];
  const payload = {
    hook_event_name: "PreToolUse",
    tool_input: {
      command: 'echo " & echo IORI_PROBE> %TEMP%\\iori-injected.txt & rem ',
    },
  };
  const receiver = await hookReceiver();
  const url = receiver.url;
  try {
    for (const name of ["ascii", "日本語"]) {
      const home = join(root, name);
      await mkdir(home, { recursive: true });
      const env = {
        ...process.env,
        USERPROFILE: home,
        HOME: home,
        CLAUDE_CONFIG_DIR: join(home, ".claude"),
        TEMP: home,
        TMP: home,
        IORI_CLI_HOOK_URL: url,
        IORI_CLI_HOOK_ADAPTER: "",
      };
      // os.homedir uses USERPROFILE on Windows; never touch the real HOME.
      const names = ["USERPROFILE", "CLAUDE_CONFIG_DIR"];
      const original = names.map((name) => process.env[name]);
      for (const name of names) process.env[name] = env[name];
      try {
        const shell = {
          id: "cmd",
          label: "Command Prompt",
          executable: process.env.ComSpec,
          args: [],
        };
        await claude.install(await hookInstallContext(shell, "claude"));
        await antigravity.install(
          await hookInstallContext(shell, "antigravity"),
        );
      } finally {
        names.forEach((name, index) => {
          if (original[index] === undefined) delete process.env[name];
          else process.env[name] = original[index];
        });
      }
      const configs = [
        [
          "claude",
          JSON.parse(
            await readFile(join(home, ".claude/settings.json"), "utf8"),
          ).hooks.PreToolUse[0].hooks[0].command,
          undefined,
        ],
        [
          "antigravity",
          JSON.parse(
            await readFile(join(home, ".gemini/config/hooks.json"), "utf8"),
          )["iori-status"].PreToolUse[0].hooks[0].command,
          { decision: "ask" },
        ],
      ];
      for (const [cli, command, expected] of configs) {
        for (const shell of hookShells) {
          const row = await runHookCommand({
            shell,
            command,
            env,
            payload,
            receiver,
            proof: join(home, "iori-injected.txt"),
          });
          const { reply } =
            expected === undefined
              ? { reply: true }
              : hookReply(row.stdout, expected);
          // The CLI's own notification, plus the `id` of the CLI whose
          // settings hold this hook (docs/design/cli-definitions.md「hooks」).
          const [received] = row.received;
          results.push({
            home: name,
            cli,
            shell: shell.id,
            code: row.code,
            timedOut: row.timedOut,
            injected: row.injected,
            delivered:
              row.received.length === 1 &&
              !!received &&
              Object.entries(payload).every(
                ([key, value]) =>
                  JSON.stringify(received[key]) === JSON.stringify(value),
              ) &&
              received.iori_cli === cli,
            reply,
            interactiveCmd: row.stdout
              .replaceAll("\u0000", "")
              .includes("Microsoft Windows"),
            stderr: row.stderr,
          });
        }
      }
    }
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
      results,
      passed: results.every(
        (row) =>
          row.code === 0 &&
          !row.timedOut &&
          !row.injected &&
          row.delivered &&
          row.reply,
      ),
    };
    await writeFile(
      process.argv[process.argv.indexOf("--result") + 1],
      JSON.stringify(result, null, 2),
    );
    if (!process.argv.includes("--baseline")) assert.equal(result.passed, true);
  } finally {
    await receiver.close();
    await rm(root, { recursive: true, force: true });
  }
}

if (process.platform === "win32") await checkWindows();
else {
  const { lockEntry } = await import("../native/locks.mjs");
  await lockEntry(import.meta.url);
  const { evidence, writeWindows } = await import("../connection/build.mjs");
  const { gate, ps, windows, windowsBuildNode } =
    await import("../native/remote.mjs");
  gate({ requireFreePorts: false });
  const state = JSON.parse(
    await readFile(join(evidence, "build-state.json"), "utf8"),
  );
  const file = state.windowsRoot + "\\verification\\cli\\windows-hooks.mjs";
  await writeWindows(file, await readFile(import.meta.filename));
  await writeWindows(
    state.windowsRoot + "\\verification\\cli\\hook-shells.mjs",
    await readFile(new URL("./hook-shells.mjs", import.meta.url)),
  );
  const filename = `windows-hooks-${Date.now()}.json`;
  const remoteResult = state.windowsRoot + "\\" + filename;
  const output = windows(
    `Set-Location ${ps(state.windowsRoot)};& ${ps(windowsBuildNode)} ${ps(file)} --result ${ps(remoteResult)} ${process.argv.includes("--baseline") ? "--baseline" : ""};Get-Content -LiteralPath ${ps(remoteResult)} -Raw`,
  );
  await writeFile(join(evidence, filename), output);
  console.log(output);
  if (!process.argv.includes("--baseline"))
    assert.equal(JSON.parse(output).passed, true);
}
