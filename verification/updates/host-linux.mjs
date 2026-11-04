import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { createSocket } from "node:dgram";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import {
  prepareHostDistribution,
  startUpdateHost,
} from "./host-distribution.mjs";
import { runReleaseScenario } from "./host-release-scenario.mjs";
import { terminalClient } from "../terminal/daemon-client.mjs";
import { prepareCliHome, stopCliProcesses } from "../cli/home.mjs";

const argument = (name) =>
  process.argv
    .find((value) => value.startsWith(`--${name}=`))
    ?.slice(name.length + 3);
const previousArchive = argument("previous-archive");
const targetArchive = argument("target-archive");
if (!previousArchive || !targetArchive)
  throw new Error("--previous-archive and --target-archive are required");
const runningClis = process.argv.includes("--running-clis");
const evidence = resolve(
  process.env.IORI_VERIFICATION_EVIDENCE_ROOT ?? ".local/evidence/host-update",
  `linux-${Date.now()}-${process.pid}`,
);
await mkdir(evidence, { recursive: true });
await mkdir(resolve(".local"), { recursive: true });
const root = await mkdtemp(resolve(".local/host-update-linux-"));
const hostRoot = join(root, "data/iori-host");
const result = {
  passed: false,
  attempts: [],
  node: process.version,
  stages: {},
  cleanupFailures: [],
};
let fixture, host, client, cliHome;
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
      trustedFolders: [root],
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
  host = await startUpdateHost(fixture, join(root, "data"), { port });
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
  delete result.waitingFor;
  result.passed = true;
} catch (error) {
  result.error = error.message;
  process.exitCode = 1;
} finally {
  await cleanup("client", async () => client?.close());
  await cleanup("host", async () => host?.close());
  if (cliHome)
    await cleanup("cli-processes", async () => stopCliProcesses(cliHome.home));
  await cleanup("distribution", async () => fixture?.close());
  await cleanup("temporary-directory", async () =>
    rm(root, { recursive: true, force: true }),
  );
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
