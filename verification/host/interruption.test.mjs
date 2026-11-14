import assert from "node:assert/strict";
import test from "node:test";
import { spawn, execFile } from "node:child_process";
import { once } from "node:events";
import { randomUUID } from "node:crypto";
import { mkdir, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { promisify } from "node:util";
import { registerScriptedCli } from "./scripted-definition.mjs";
import { startHostTest } from "./process.mjs";
import {
  stopTerminalDaemon,
  stopVerificationUnitsUnder,
} from "../terminal/daemon-process.mjs";
import { ownVerificationDirectory } from "../lifecycle.mjs";

const run = promisify(execFile);
const fixture = process.env.IORI_INTERRUPTION_FIXTURE === "1";

test(
  "時間切れで停止したHost APIの試験が検証のデーモンとCLIを残さない",
  {
    skip:
      process.platform !== "linux" ||
      (!fixture && !process.env.DBUS_SESSION_BUS_ADDRESS),
  },
  async (t) => {
    if (fixture) {
      const { client, dataRoot } = await startHostTest(t);
      const { terminal: created } = await client.request("terminal.create", {
        cwd: dataRoot,
        shell: "bash",
      });
      const terminal = await client.terminal(created.id);
      await terminal.input("printf 'PROCESS=%s\\n' $$\r");
      const { output } = await terminal.waitFor(({ output }) =>
        /PROCESS=\d+/u.test(output),
      );
      const shellPid = Number(output.match(/PROCESS=(\d+)/u)?.[1]);
      assert.ok(shellPid);
      const cliId = await registerScriptedCli(client, dataRoot);
      const { terminal: cliTerminal } = await client.request("cli.launch", {
        cliId,
        cwd: dataRoot,
      });
      await (await client.terminal(cliTerminal.id)).output("ACTOR_READY");
      const { pid } = JSON.parse(
        await readFile(
          join(dataRoot, "iori-host/terminal-daemon/connection.json"),
          "utf8",
        ),
      );
      const cgroup = await readFile(`/proc/${pid}/cgroup`, "utf8");
      const unit = cgroup
        .split(/[\/\n]/u)
        .find(
          (part) =>
            part.startsWith("iori-terminal-") && part.endsWith(".service"),
        );
      const processIds = (
        await readFile(`/proc/${pid}/task/${pid}/children`, "utf8")
      )
        .trim()
        .split(/\s+/u)
        .filter(Boolean)
        .map(Number);
      const timeoutPid = Number(
        (await readFile(`/proc/${process.ppid}/stat`, "utf8"))
          .split(") ")[1]
          .split(" ")[1],
      );
      console.log(
        `INTERRUPTION_READY ${JSON.stringify({ dataRoot, pid, shellPid, unit, workerPid: process.pid, timeoutPid, processIds })}`,
      );
      await new Promise(() => {});
      return;
    }
    // GNU timeout sends SIGTERM to the node --test process group, as in the bounded runner.
    const environment = { ...process.env, IORI_INTERRUPTION_FIXTURE: "1" };
    delete environment.NODE_TEST_CONTEXT;
    const child = spawn(
      process.execPath,
      [
        "scripts/run-bounded-check.mjs",
        process.execPath,
        "--test",
        import.meta.filename,
      ],
      {
        detached: true,
        stdio: ["ignore", "pipe", "pipe"],
        env: environment,
      },
    );
    const exited = once(child, "close");
    let log = "";
    child.stderr.on("data", (chunk) => {
      log += chunk;
    });
    const ready = new Promise((resolve, reject) => {
      child.stdout.on("data", (chunk) => {
        log += chunk;
        const match = log.match(/INTERRUPTION_READY (\{[^\n]+\})/u);
        if (match) resolve(JSON.parse(match[1]));
      });
      child.once("exit", () => reject(new Error(log)));
    });
    let owned;
    let parallelRoot;
    const parallelUnit = `iori-host-update-verification-${randomUUID()}.service`;
    try {
      owned = await ready;
      parallelRoot = `${owned.dataRoot}d`;
      await mkdir(parallelRoot);
      await ownVerificationDirectory(parallelRoot);
      // An adjacent run and a non-path argument containing our root must survive.
      await run("systemd-run", [
        "--user",
        `--unit=${parallelUnit}`,
        "--collect",
        `--property=WorkingDirectory=${parallelRoot}`,
        process.execPath,
        "--eval",
        "setInterval(() => {}, 1000)",
        `${parallelRoot}/fixture`,
        `unrelated${owned.dataRoot}/fixture`,
      ]);
      // Recovery must still find the daemon through WorkingDirectory.
      await rm(
        join(owned.dataRoot, "iori-host/terminal-daemon/connection.json"),
      );
      process.kill(owned.timeoutPid, "SIGTERM");
      await exited;
      if (owned.unit) {
        const { stdout } = await run("systemctl", [
          "--user",
          "show",
          owned.unit,
          "--property=ActiveState",
          "--value",
        ]);
        assert.ok(
          !["active", "activating", "deactivating"].includes(stdout.trim()),
          `検証デーモンが残っています: ${owned.unit}\n${log}`,
        );
      }
      for (const pid of [
        owned.pid,
        owned.shellPid,
        owned.workerPid,
        ...owned.processIds,
      ]) {
        const stat = await readFile(`/proc/${pid}/stat`, "utf8").catch(
          (error) => {
            if (error.code !== "ENOENT") throw error;
          },
        );
        assert.ok(
          !stat || stat.slice(stat.lastIndexOf(")") + 2).startsWith("Z "),
          `検証プロセスが残っています: ${pid}`,
        );
      }
      await stopVerificationUnitsUnder(owned.dataRoot);
      const { stdout: parallelState } = await run("systemctl", [
        "--user",
        "show",
        parallelUnit,
        "--property=ActiveState",
        "--value",
      ]);
      assert.equal(
        parallelState.trim(),
        "active",
        "並行する検証unitを保持する",
      );
    } finally {
      if (child.exitCode === null && child.signalCode === null) {
        child.kill("SIGTERM");
        await exited;
      }
      if (owned) await stopTerminalDaemon(join(owned.dataRoot, "iori-host"));
      if (parallelRoot) {
        await run("systemctl", ["--user", "stop", parallelUnit]);
        await rm(parallelRoot, { recursive: true, force: true });
      }
    }
  },
);
