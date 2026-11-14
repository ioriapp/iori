import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import {
  linux,
  windows,
  ps,
  sh,
  windowsNode,
  waitUntil,
  verificationPort,
} from "../native/remote.mjs";
import { writeWindows } from "./build.mjs";
export async function startHost(
  os,
  root,
  storageName = "data",
  {
    windowsPathEntries = [],
    windowsCliHome,
    windowsClaudeToken,
    windowsFakeModel,
    linuxCliHome,
    rustLog,
  } = {},
) {
  const dataHome =
    os === "linux" ? root + "/" + storageName : root + "\\" + storageName;
  const hostRoot =
    os === "linux" ? dataHome + "/iori-host" : dataHome + "\\iori-host";
  const id = "iori-connection-" + randomUUID();
  let pid;
  const runAs = (command) =>
    `sudo -u iori-dev -H env XDG_RUNTIME_DIR=/run/user/1001 DBUS_SESSION_BUS_ADDRESS=unix:path=/run/user/1001/bus bash -c ${sh(command)}`;
  if (os === "linux") {
    linux(
      runAs(
        `systemd-run --user --unit=${sh(id)} --collect -p MemoryMax=4G -p MemorySwapMax=0 --working-directory=${sh(root)} env ${rustLog ? `RUST_LOG=${sh(rustLog)} ` : ""}${linuxCliHome ? `HOME=${sh(linuxCliHome)} CODEX_HOME=${sh(linuxCliHome + "/.codex")} PI_CODING_AGENT_DIR=${sh(linuxCliHome + "/.pi/agent")} CLAUDE_CONFIG_DIR=${sh(linuxCliHome + "/.claude")} ` : ""}XDG_DATA_HOME=${sh(dataHome)} IORI_HOST_PORT=${verificationPort} node apps/host/src/main.ts`,
      ),
    );
  } else {
    const launcherName = "host-launcher-" + id + ".mjs";
    const stopRequestName = "host-stop-" + id + ".request";
    const launcherPath = root + "\\" + launcherName;
    const stopRequestPath = root + "\\" + stopRequestName;
    const scriptPath = root + "\\host-" + id + ".ps1";
    const pidPath = root + "\\host-launcher-" + id + ".pid";
    const tokenPipe = id + "-claude-token";
    await writeWindows(
      launcherPath,
      await readFile(new URL("./host-launcher.mjs", import.meta.url), "utf8"),
    );
    await writeWindows(
      scriptPath,
      `$ErrorActionPreference='Stop';${windowsPathEntries.length ? `$env:PATH=${ps(windowsPathEntries.join(";") + ";")}+$env:PATH;` : ""}${windowsCliHome ? `$env:USERPROFILE=${ps(windowsCliHome)};$env:HOME=${ps(windowsCliHome)};$env:CODEX_HOME=${ps(windowsCliHome + "\\.codex")};` : ""}${windowsFakeModel ? `$env:CLAUDE_CODE_OAUTH_TOKEN=$null;$env:ANTHROPIC_API_KEY=$null;$env:ANTHROPIC_BASE_URL=${ps(windowsFakeModel.baseURL)};$env:ANTHROPIC_AUTH_TOKEN='verification';$env:IORI_FAKE_MODEL_KEY='verification';$env:CLAUDE_CONFIG_DIR=${ps(windowsCliHome + "\\.claude")};` : ""}${windowsClaudeToken ? `$pipe=[IO.Pipes.NamedPipeServerStream]::new(${ps(tokenPipe)},[IO.Pipes.PipeDirection]::In);try{$pipe.WaitForConnection();$reader=[IO.StreamReader]::new($pipe);$env:CLAUDE_CODE_OAUTH_TOKEN=$reader.ReadLine()}finally{$pipe.Dispose()};$env:CLAUDE_CONFIG_DIR=${ps(windowsCliHome + "\\.claude")};` : ""}$env:LOCALAPPDATA=${ps(dataHome)};$env:IORI_HOST_PORT='${verificationPort}';$env:IORI_HOST_STOP_REQUEST=${ps(stopRequestPath)};Set-Location ${ps(root)};[IO.File]::WriteAllText(${ps(pidPath)},[string]$PID);& ${ps(windowsNode)} ${ps(launcherPath)} *> ${ps(root + "\\host.log")};exit $LASTEXITCODE;`,
    );
    const command = `pwsh -NoProfile -ExecutionPolicy Bypass -File "${scriptPath}"`;
    pid = Number(
      windows(
        `$r=Invoke-CimMethod -ClassName Win32_Process -MethodName Create -Arguments @{CommandLine=${ps(command)}};if($r.ReturnValue -ne 0){throw 'Host launcher failed'};$r.ProcessId`,
      ),
    );
    if (windowsClaudeToken) {
      // The value travels over SSH stdin and a one-use local pipe. Neither the
      // launcher script nor WMI's command line contains the credential.
      windows(
        `$token=[Console]::In.ReadLine();$pipe=[IO.Pipes.NamedPipeClientStream]::new('.',${ps(tokenPipe)},[IO.Pipes.PipeDirection]::Out);try{$pipe.Connect();$writer=[IO.StreamWriter]::new($pipe);$writer.WriteLine($token);$writer.Flush()}finally{$pipe.Dispose()}`,
        { input: windowsClaudeToken + "\n" },
      );
    }
  }
  const ready = () =>
    os === "linux"
      ? linux(
          `sudo -u iori-dev -H test -f ${sh(hostRoot + "/control.json")} && echo ready || true`,
        )
      : windows(`if(Test-Path ${ps(hostRoot + "\\control.json")}){'ready'}`);
  await waitUntil(ready, (v) => v === "ready");
  await waitUntil(
    () =>
      os === "linux"
        ? linux(`ss -H -lun 'sport = :${verificationPort}'`)
        : windows(
            `@(Get-NetUDPEndpoint | Where-Object LocalPort -eq ${verificationPort}).Count`,
          ),
    (value) => (os === "linux" ? Boolean(value) : Number(value) > 0),
  );
  const stop = async ({ stopTerminals = true } = {}) => {
    if (os === "linux") linux(runAs(`systemctl --user stop ${sh(id)}`));
    else {
      const launcherPath = root + "\\host-launcher-" + id + ".mjs";
      const stopRequestPath = root + "\\host-stop-" + id + ".request";
      const scriptPath = root + "\\host-" + id + ".ps1";
      const pidPath = root + "\\host-launcher-" + id + ".pid";
      const request = windows(
        `$p=Get-CimInstance Win32_Process -Filter ${ps("ProcessId = " + pid)};if(-not $p){'absent'}elseif($p.CommandLine -like ${ps("*" + scriptPath + "*")}){[IO.File]::WriteAllText(${ps(stopRequestPath)},'stop');'requested'}else{throw 'Host launcher ownership does not match'}`,
      );
      if (request === "requested") {
        await waitUntil(
          () =>
            windows(
              `$p=Get-CimInstance Win32_Process -Filter ${ps("ProcessId = " + pid)};if(-not $p){'exited'}elseif($p.CommandLine -like ${ps("*" + scriptPath + "*")}){'running'}else{'pid-reused'}`,
            ),
          (state) => state !== "running",
        );
      }
      await waitUntil(
        () =>
          windows(
            `@(Get-NetUDPEndpoint | Where-Object LocalPort -eq ${verificationPort}).Count`,
          ),
        (value) => Number(value) === 0,
      );
      windows(
        `Remove-Item -LiteralPath ${ps(stopRequestPath)},${ps(launcherPath)},${ps(scriptPath)},${ps(pidPath)} -Force -ErrorAction SilentlyContinue`,
      );
    }
    if (os === "linux") {
      await waitUntil(
        () => linux(`ss -H -lun 'sport = :${verificationPort}'`),
        (value) => value === "" || value === "0",
      );
    }
    if (stopTerminals) {
      const source =
        os === "linux"
          ? root + "/apps/host/src/terminal/daemon/launch.ts"
          : root + "\\apps\\host\\src\\terminal\\daemon\\launch.ts";
      const code = `const {pathToFileURL}=await import('node:url');const {stopTerminalDaemon}=await import(pathToFileURL(${JSON.stringify(source)}));await stopTerminalDaemon(${JSON.stringify(hostRoot)});`;
      if (os === "linux")
        linux(runAs(`node --input-type=module -e ${sh(code)}`));
      else
        windows(
          `& ${ps(windowsNode)} --input-type=module -e ${ps(code)};if($LASTEXITCODE -ne 0){throw 'Terminal daemon cleanup failed'}`,
        );
    }
  };
  return { os, root, dataHome, hostRoot, pid, unit: id, stop };
}
