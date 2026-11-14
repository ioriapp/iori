import assert from "node:assert/strict";
import {
  access,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  writeFile,
} from "node:fs/promises";
import { join, resolve } from "node:path";
import { homedir } from "node:os";
import { createSocket } from "node:dgram";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { performance } from "node:perf_hooks";
import {
  prepareHostDistribution,
  startUpdateHost,
} from "./host-distribution.mjs";
import { runReleaseScenario } from "./host-release-scenario.mjs";
import { terminalClient } from "../terminal/daemon-client.mjs";
import { prepareCliHome, stopCliProcesses } from "../cli/home.mjs";
import { waitFor } from "../ui.mjs";

const argument = (name) =>
  process.argv
    .find((value) => value.startsWith(`--${name}=`))
    ?.slice(name.length + 3);
const previousArchive = argument("previous-archive");
const targetArchive = argument("target-archive");
if (!previousArchive || !targetArchive)
  throw new Error("--previous-archive and --target-archive are required");
const runningClis = process.argv.includes("--running-clis");
const uninstall = process.argv.includes("--uninstall");
const evidence = resolve(
  process.env.IORI_VERIFICATION_EVIDENCE_ROOT ?? ".local/evidence/host-update",
  `linux-${Date.now()}-${process.pid}`,
);
await mkdir(evidence, { recursive: true });
await mkdir(resolve(".local"), { recursive: true });
const root = await mkdtemp(join(homedir(), ".cache/iori-host-update-linux-"));
const hostRoot = join(root, "data/iori-host");
const result = {
  passed: false,
  attempts: [],
  node: process.version,
  stages: {},
  cleanupFailures: [],
};
let fixture, host, client, cliHome;
let currentCheck = "host-update";
let checkStarted = performance.now();
function finishCheck() {
  result.seconds ??= {};
  result.seconds[currentCheck] = Number(
    ((performance.now() - checkStarted) / 1000).toFixed(3),
  );
  console.log(
    `[release] acceptance/${currentCheck} seconds=${result.seconds[currentCheck]}`,
  );
}
const run = promisify(execFile);
async function processes() {
  const { stdout } = await run("ps", ["-eo", "pid=,ppid=,lstart="], {
    env: { ...process.env, LC_ALL: "C" },
  });
  return stdout
    .trim()
    .split("\n")
    .map((line) => {
      const [, pid, parent, started] = /^\s*(\d+)\s+(\d+)\s+(.+)$/u.exec(line);
      return {
        ProcessId: Number(pid),
        ParentProcessId: Number(parent),
        CreationDate: Date.parse(started),
      };
    });
}
async function checkpoint(stage) {
  result.waitingFor = stage;
  result.stages[stage] = new Date().toISOString();
  await writeFile(
    join(evidence, "result.json"),
    JSON.stringify(result, null, 2),
  );
  console.log(JSON.stringify({ waitingFor: stage }));
}
async function cleanup(name, action) {
  try {
    await action();
  } catch (error) {
    result.cleanupFailures.push({ name, error: error.message });
    process.exitCode = 1;
  }
}
try {
  await checkpoint("prepare-distributions");
  fixture = await prepareHostDistribution(root, {
    previousArchive: resolve(previousArchive),
    targetArchive: resolve(targetArchive),
  });
  if (runningClis) {
    cliHome = await prepareCliHome(root, {
      clis: ["claude", "codex"],
      repositories: [root],
    });
    process.env.VOLTA_HOME ??= join(process.env.HOME, ".volta");
    process.env.HOME = cliHome.home;
    process.env.CODEX_HOME = join(cliHome.home, ".codex");
    process.env.CLAUDE_CONFIG_DIR = join(cliHome.home, ".claude");
    process.env.XDG_CONFIG_HOME = join(cliHome.home, ".config");
  }
  const socket = createSocket("udp4");
  await new Promise((resolve, reject) => {
    socket.once("error", reject);
    socket.bind(0, "127.0.0.1", resolve);
  });
  const port = socket.address().port;
  socket.close();
  await checkpoint("old-host-ready");
  // Removal also deletes a launcher under HOME. Keep it and all CLI settings
  // inside this run, even when no real CLI is requested.
  const home = join(root, "home");
  if (!runningClis) await mkdir(home);
  host = await startUpdateHost(fixture, join(root, "data"), {
    port,
    cliEnvironment: runningClis
      ? {}
      : {
          HOME: home,
          XDG_CONFIG_HOME: join(home, ".config"),
          XDG_CACHE_HOME: join(home, ".cache"),
          XDG_STATE_HOME: join(home, ".local/state"),
          CODEX_HOME: join(home, ".codex"),
          CLAUDE_CONFIG_DIR: join(home, ".claude"),
        },
  });
  await checkpoint("connect-old-host");
  client = await terminalClient(hostRoot, port);
  await runReleaseScenario({
    root,
    hostRoot,
    client,
    fixture,
    result,
    runningClis,
    checkpoint,
    processes,
    checkpointCliWait: true,
    shell: "bash",
    shellCommand: "/bin/bash",
    async setupTerminal(root) {
      await writeFile(
        join(root, "pulse.mjs"),
        "import{writeFileSync}from'node:fs';setInterval(()=>{writeFileSync('pulse.json',JSON.stringify({pid:process.pid}));console.log('LINUX_UPDATE_ACTIVE');},250);\n",
      );
    },
    activeCommand: "while :; do date; sleep 0.05; done\r",
    activePattern: /\d{4}/u,
    pulseCommand: `'${process.execPath.replaceAll("'", "'\\''")}' pulse.mjs\r`,
  });
  if (uninstall) {
    finishCheck();
    currentCheck = "host-uninstall";
    checkStarted = performance.now();
    await checkpoint("prepare-uninstall");
    const plan = await client.request("host.uninstall.prepare");
    assert.equal(plan.error, undefined);
    const status = await client.request("host.uninstall", {
      canContinue: plan.canContinue,
      hasOpenTerminals: plan.hasOpenTerminals,
      targets: plan.targets.map((target) => target.id),
      generations: Object.fromEntries(
        plan.targets.map((target) => [target.id, target.generation]),
      ),
      deleteData: false,
    });
    assert.equal(status.phase, "removing", JSON.stringify(status));
    await checkpoint("uninstall-receipt");
    const receipt = await waitFor(
      () =>
        readFile(status.receiptPath, "utf8")
          .then(JSON.parse)
          .catch((error) => {
            if (error.code !== "ENOENT") throw error;
          }),
      Boolean,
    );
    assert.equal(receipt.status.phase, "succeeded", JSON.stringify(receipt));
    for (const file of [fixture.bundle, host.unitFile]) {
      await assert.rejects(access(file), { code: "ENOENT" });
    }
    await access(join(hostRoot, "host.sqlite"));
    await access(join(root, "pulse.mjs"));
    result.uninstall = { phase: receipt.status.phase, deleteData: false };
  }
  delete result.waitingFor;
  result.passed = true;
} catch (error) {
  result.error = error.message;
  process.exitCode = 1;
} finally {
  finishCheck();
  await cleanup("client", async () => client?.close());
  await cleanup("host", async () => host?.close());
  if (cliHome)
    await cleanup("cli-processes", async () => stopCliProcesses(cliHome.home));
  await cleanup("distribution", async () => fixture?.close());
  if (!result.cleanupFailures.length)
    await cleanup("temporary-directory", async () =>
      rm(root, { recursive: true, force: true }),
    );
  if (result.cleanupFailures.length) result.retainedRoot = root;
  if (result.cleanupFailures.length) result.passed = false;
  await writeFile(
    join(evidence, "result.json"),
    JSON.stringify(result, null, 2),
  );
  console.log(
    JSON.stringify({
      result: join(evidence, "result.json"),
      passed: result.passed,
    }),
  );
}
