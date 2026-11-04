import { mkdir, writeFile, open } from "node:fs/promises";
import { join, resolve } from "node:path";
import { spawn, execFile } from "node:child_process";
import { promisify } from "node:util";
import { prepareHostDistribution } from "./host-distribution.mjs";
import { adapter } from "../../scripts/release/update-windows.mjs";
import { terminalClient } from "../terminal/daemon-client.mjs";
import { runReleaseScenario } from "./host-release-scenario.mjs";

const root = resolve(process.argv[2]);
const port = Number(process.argv[3]);
const runningClis = process.argv.includes("--running-clis");
const data = join(root, "data");
const hostRoot = join(data, "iori-host");
const result = {
  passed: false,
  attempts: [],
  node: process.version,
  stages: {},
};
let fixture, client;
const run = promisify(execFile);
async function processes() {
  const { stdout } = await run("powershell.exe", [
    "-NoProfile",
    "-NonInteractive",
    "-EncodedCommand",
    Buffer.from(
      "[Console]::OutputEncoding=[Text.UTF8Encoding]::new($false);ConvertTo-Json -InputObject @(Get-CimInstance Win32_Process | Select-Object Name,ProcessId,ParentProcessId,CreationDate) -Compress",
      "utf16le",
    ).toString("base64"),
  ]);
  return JSON.parse(stdout);
}
async function checkpoint(stage) {
  result.waitingFor = stage;
  result.stages[stage] = new Date().toISOString();
  await writeFile(
    join(root, "host-update-progress.json"),
    JSON.stringify(result, null, 2),
  );
}

try {
  await checkpoint("prepare-distributions");
  fixture = await prepareHostDistribution(root, {
    previousZip: join(root, "previous.zip"),
    targetZip: join(root, "target.zip"),
  });
  process.env.LOCALAPPDATA = data;
  process.env.IORI_HOST_PORT = String(port);
  process.env.NODE_EXTRA_CA_CERTS = fixture.ca;
  await mkdir(data, { recursive: true });
  await checkpoint("old-host-ready");
  const stdout = await open(join(root, "host-stdout.log"), "w");
  const stderr = await open(join(root, "host-stderr.log"), "w");
  try {
    const launcher = spawn(
      join(fixture.bundle, "iori-host-background.exe"),
      [],
      {
        cwd: fixture.bundle,
        detached: true,
        windowsHide: true,
        stdio: ["ignore", stdout.fd, stderr.fd],
      },
    );
    await new Promise((resolve, reject) => {
      launcher.once("spawn", resolve);
      launcher.once("error", reject);
    });
    launcher.unref();
  } finally {
    await stdout.close();
    await stderr.close();
  }
  await checkpoint("wait-old-host-ready");
  await (await adapter({ bundle: fixture.bundle })).start();
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
    shell: "powershell",
    shellCommand: "powershell.exe -NoLogo -NoProfile",
    async setupTerminal(root) {
      await writeFile(
        join(root, "pulse.mjs"),
        "import{writeFileSync}from'node:fs';setInterval(()=>{writeFileSync('pulse.json',JSON.stringify({pid:process.pid}));console.log('WINDOWS_UPDATE_ACTIVE');},250);\n",
      );
    },
    activeCommand: "while(1){ Get-Date; Start-Sleep -Milliseconds 50 }\r",
    activePattern: /\d{4}/u,
    pulseCommand: `& '${process.execPath.replaceAll("'", "''")}' pulse.mjs\r`,
  });
  delete result.waitingFor;
  result.passed = true;
} catch (error) {
  result.error = error.message;
  process.exitCode = 1;
} finally {
  await writeFile(
    join(root, "host-update-result.json"),
    JSON.stringify(result, null, 2),
  );
  await client?.close();
  // The outer runner owns process cleanup even when the product is stuck stopping.
  await fixture?.close();
}
