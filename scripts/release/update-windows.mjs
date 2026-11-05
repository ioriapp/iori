import { stopHostScript } from "./stop-windows.mjs";
import { execFile, spawn } from "node:child_process";
import { promisify } from "node:util";
import { join } from "node:path";
const run = promisify(execFile);
const quote = (value) => "'" + value.replaceAll("'", "''") + "'";
const powershell = (script) =>
  run(
    "powershell.exe",
    [
      "-NoProfile",
      "-NonInteractive",
      "-EncodedCommand",
      Buffer.from(
        "$ErrorActionPreference='Stop';" + script,
        "utf16le",
      ).toString("base64"),
    ],
    {
      windowsHide: true,
      env: Object.fromEntries(
        Object.entries(process.env).filter(
          ([name]) => name.toUpperCase() !== "PSMODULEPATH",
        ),
      ),
    },
  ).catch((error) => {
    const id = String(error.stderr ?? "").match(
      /FullyQualifiedErrorId\s*:\s*([A-Za-z0-9_.-]+)/,
    )?.[1];
    if (id) error.code = id;
    throw error;
  });
export async function launchUpdate(request, work) {
  // The detached bootstrap remains until its worker exits, so a living Host
  // can observe completion even when the worker cannot write a result.
  const child = spawn(
    join(work, "node.exe"),
    [join(work, "update.mjs"), join(work, "request.json"), "--bootstrap"],
    // Windows locks the current directory; the bundle must remain movable.
    { detached: true, stdio: "ignore", windowsHide: true, cwd: work },
  );
  const exited = new Promise((resolve) => child.once("close", resolve));
  await new Promise((resolve, reject) => {
    child.once("spawn", resolve);
    child.once("error", reject);
  });
  child.unref();
  return { exited };
}
export async function stopHost(bundle) {
  await powershell(stopHostScript(bundle) + "\nexit 0");
}

export async function adapter(request) {
  return {
    async prepare() {},
    async stop() {
      await stopHost(request.bundle);
    },
    async start() {
      const exe = join(request.bundle, "iori-host-background.exe");
      await powershell(`$p=Get-Process | Where-Object { $_.Path -eq ${quote(exe)} } | Select-Object -First 1;
if(-not $p){$p=Start-Process -FilePath ${quote(exe)} -WorkingDirectory ${quote(request.bundle)} -PassThru};
$ready=[Threading.EventWaitHandle]::new($false,[Threading.EventResetMode]::ManualReset,('Local\\iori-host-ready-'+$p.Id));
$exited=[Threading.ManualResetEvent]::new($false);$exited.SafeWaitHandle=[Microsoft.Win32.SafeHandles.SafeWaitHandle]::new($p.Handle,$false);
try{$which=[Threading.WaitHandle]::WaitAny([Threading.WaitHandle[]]@($ready,$exited));if($which -eq 1){throw ('Host exited before ready: '+$p.ExitCode)}}finally{$exited.Dispose();$ready.Dispose();$p.Dispose()}`);
    },
    async cleanup() {},
    async extract(archive, destination) {
      await powershell(
        `Add-Type -AssemblyName System.IO.Compression.FileSystem;[IO.Compression.ZipFile]::ExtractToDirectory(${quote(archive)}, ${quote(destination)})`,
      );
    },
  };
}
