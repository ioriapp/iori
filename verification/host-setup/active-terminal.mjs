import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { openFolder } from "../../e2e/workspace/scenario.mjs";
import {
  create,
  observe,
  observed,
  typeTerminal,
} from "../../e2e/terminal/scenario.mjs";
import { writeWindows } from "../connection/build.mjs";
import { windows, ps } from "../native/remote.mjs";

export async function startActiveTerminal(
  client,
  state,
  record,
  retainedProgram = false,
) {
  await openFolder(client.screen, state.windowsRoot, false);
  await observe(client);
  await create(client);
  if (retainedProgram) await retainProgramProcess(client, state, record);
  const pidFile = state.windowsRoot + "\\active-terminal-pid.txt";
  await typeTerminal(
    client,
    `[IO.File]::WriteAllText(${ps(pidFile)},[string]$PID);Write-Output ('IORI_ACTIVE_'+'TERMINAL');while ($true) { Start-Sleep 1 }\r`,
  );
  await observed(client, "IORI_ACTIVE_TERMINAL");
  const pid = Number(windows(`[IO.File]::ReadAllText(${ps(pidFile)})`));
  const process = JSON.parse(
    windows(
      `Get-CimInstance Win32_Process -Filter 'ProcessId=${pid}' | Select-Object Name,ExecutablePath,ProcessId | ConvertTo-Json -Compress`,
    ),
  );
  assert.match(process.Name, /^(?:pwsh|powershell)\.exe$/iu);
  record("active-terminal", process);
  return pid;
}

export function activeRemovalEvidence(state) {
  const data = state.windowsRoot + "\\client-local";
  return JSON.parse(
    windows(
      `$paths=@(${[data + "\\Programs\\iori-host", data + "\\iori-host\\terminal-daemon", data + "\\iori-host\\team-command-bin"].map(ps).join(",")});@{paths=@($paths|ForEach-Object {@{path=$_;exists=Test-Path -LiteralPath $_}});processes=@(Get-CimInstance Win32_Process | Where-Object {$_.ExecutablePath -and $_.ExecutablePath.StartsWith(${ps(data + "\\")},[StringComparison]::OrdinalIgnoreCase)} | Select-Object Name,ExecutablePath,ProcessId)}|ConvertTo-Json -Depth 10 -Compress`,
    ),
  );
}

// E2E cannot reliably hold the gap between Terminal shutdown and OS image unload.
// Keep a real bundled Node process alive independently of Terminal shutdown.
async function prepareRetainedProgram(state) {
  const processes = activeRemovalEvidence(state).processes;
  const daemon = processes.find(
    (item) =>
      item.Name === "node.exe" &&
      item.ExecutablePath.includes("\\terminal-daemon\\"),
  );
  assert.ok(daemon);
  const script = state.windowsRoot + "\\retained-program.cjs";
  await writeWindows(script, "setInterval(() => {}, 1000);\n");
  return { daemon, script };
}

async function retainProgramProcess(client, state, record) {
  const { daemon, script } = await prepareRetainedProgram(state);
  const file = state.windowsRoot + "\\retained-program-pid.txt";
  await typeTerminal(
    client,
    `$child=Start-Process -FilePath ${ps(daemon.ExecutablePath)} -ArgumentList ${ps('"' + script + '"')} -WindowStyle Hidden -PassThru;[IO.File]::WriteAllText(${ps(file)},[string]$child.Id);Write-Output ('IORI_RETAINED_'+'PROGRAM')\r`,
  );
  await observed(client, "IORI_RETAINED_PROGRAM");
  const pid = Number(windows(`[IO.File]::ReadAllText(${ps(file)})`));
  const retained = activeRemovalEvidence(state).processes.find(
    (item) => item.ProcessId === pid,
  );
  assert.equal(retained?.ExecutablePath, daemon.ExecutablePath);
  const integrity = await readProcessIntegrity(state);
  const expected = integrity.find((item) => item.pid === daemon.ProcessId);
  const actual = integrity.find((item) => item.pid === pid);
  assert.ok(expected && actual);
  assert.equal(actual.integrity, expected.integrity);
  assert.equal(actual.sessionId, expected.sessionId);
  record("retained-program", retained);
  record("process-integrity", integrity);
}

export async function readProcessIntegrity(state, extraPids = []) {
  const file = state.windowsRoot + "\\process-integrity.ps1";
  await writeWindows(
    file,
    await readFile("verification/host-setup/process-integrity.ps1", "utf8"),
  );
  const ids = [
    ...activeRemovalEvidence(state).processes.map((item) => item.ProcessId),
    ...extraPids,
  ];
  return JSON.parse(
    windows(
      `& ([scriptblock]::Create([IO.File]::ReadAllText(${ps(file)}))) -ProcessIds @(${ids.join(",")})`,
    ),
  );
}
