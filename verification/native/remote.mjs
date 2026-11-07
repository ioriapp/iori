import { local as verificationLocal } from "./local.mjs";
import { execFileSync } from "node:child_process";
import { heldDevices } from "./locks.mjs";

export const windowsNode =
  verificationLocal.windows.home +
  "\\iori-development\\worktree-recovery-windows-host-01\\bundle\\runtime\\node.exe";
export const windowsBuildNode =
  verificationLocal.windows.home + "\\dev-tools\\node-24.22.1\\node.exe";
export const windowsPnpm =
  verificationLocal.windows.home +
  "\\iori-e0\\tools\\pnpm\\node_modules\\pnpm\\bin\\pnpm.cjs";
export const verificationPort = Number(
  process.env.IORI_VERIFICATION_PORT ?? 49172,
);
export const androidId = "io.github.ioriapp.iori.connectiontest";
export const androidDevice = verificationLocal.android.device;
export const adbPath =
  "/root/projects/iori/.local/android-sdk/platform-tools/adb";

export function run(file, args, options = {}) {
  try {
    const result = execFileSync(file, args, {
      encoding: "utf8",
      timeout: 120_000,
      maxBuffer: 16 * 1024 * 1024,
      ...options,
    });
    return Buffer.isBuffer(result) ? result : result.trim();
  } catch (error) {
    const status =
      error.status !== undefined
        ? `exit ${error.status}`
        : error.signal
          ? `signal ${error.signal}`
          : `code ${error.code ?? "unknown"}`;
    const captured = options.diagnosticStdout
      ? String(error.stdout ?? "") + String(error.stderr ?? "")
      : (error.stderr ?? error.output?.[2] ?? "");
    const stderr = (
      Buffer.isBuffer(captured) ? captured.toString("utf8") : String(captured)
    )
      .replace(/\u001b\[[0-?]*[ -/]*[@-~]/g, "")
      .replace(
        /iori:\/\/pair(?:\?code=|\/)[A-Za-z0-9_-]+/g,
        "[invitation redacted]",
      )
      .replace(/[A-Za-z0-9+/_-]{40,}={0,2}/g, "[redacted]")
      .trim();
    throw new Error(`${file} failed (${status})${stderr ? `: ${stderr}` : ""}`);
  }
}
export function sh(value) {
  return `'${String(value).replaceAll("'", "'\\''")}'`;
}
export function ps(value) {
  return `'${String(value).replaceAll("'", "''")}'`;
}
export function linux(script) {
  return run("ssh", [
    "-o",
    "BatchMode=yes",
    "-o",
    "ConnectTimeout=10",
    verificationLocal.linux.host,
    script,
  ]);
}
export function windows(script, options = {}) {
  const prelude =
    "$ErrorActionPreference='Stop';$ProgressPreference='SilentlyContinue';[Console]::OutputEncoding=[Text.UTF8Encoding]::new($false);";
  return run(
    "ssh",
    [
      "-o",
      "BatchMode=yes",
      "-o",
      "ConnectTimeout=10",
      verificationLocal.windows.host,
      "pwsh",
      "-NoProfile",
      "-EncodedCommand",
      Buffer.from(prelude + script, "utf16le").toString("base64"),
    ],
    options,
  );
}
export function adb(args, options = {}) {
  return run(adbPath, ["-s", androidDevice, ...args], {
    diagnosticStdout: args[0] === "install",
    ...options,
  });
}

export function jsonLines(text) {
  return text.split(/\r?\n/).flatMap((line) => {
    try {
      return [JSON.parse(line)];
    } catch {
      return [];
    }
  });
}
export async function waitUntil(read, predicate, seconds = 45) {
  const deadline = Date.now() + seconds * 1000;
  let last;
  while (Date.now() < deadline) {
    last = await read();
    if (predicate(last)) return last;
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error(`観測の待機が${seconds}秒を超過しました`);
}

// Reuse an already-permitted verification runtime path without changing firewall rules.
// Record only directories created by this invocation and remove them only when empty.
export function prepareWindowsRuntime() {
  const script =
    "$target=" +
    ps(windowsNode) +
    ";$source=" +
    ps(windowsBuildNode) +
    ";" +
    "if(Test-Path -LiteralPath $target -PathType Leaf){" +
    '[Console]::WriteLine(\'{"created":false,"directories":[]}\');return};' +
    "if(-not(Test-Path -LiteralPath $source -PathType Leaf)){throw 'Node 24 runtime is missing'};" +
    "$dirs=[Collections.Generic.List[string]]::new();" +
    "$dir=[IO.Path]::GetDirectoryName($target);" +
    "while(-not(Test-Path -LiteralPath $dir)){" +
    "$dirs.Add($dir);$dir=[IO.Path]::GetDirectoryName($dir)};" +
    "[IO.Directory]::CreateDirectory([IO.Path]::GetDirectoryName($target)) | Out-Null;" +
    "[IO.File]::Copy($source,$target,$false);" +
    "$result=@{created=$true;directories=@($dirs.ToArray())};" +
    "[Console]::WriteLine((ConvertTo-Json -InputObject $result -Compress))";
  return JSON.parse(windows(script));
}

export function cleanupWindowsRuntime(runtime) {
  if (!runtime?.created) return;
  windows("Remove-Item -LiteralPath " + ps(windowsNode) + " -Force");
  for (const directory of runtime.directories) {
    windows(
      "if((Test-Path -LiteralPath " +
        ps(directory) +
        ") -and " +
        "@(Get-ChildItem -LiteralPath " +
        ps(directory) +
        " -Force).Count -eq 0){" +
        "[IO.Directory]::Delete(" +
        ps(directory) +
        ")}",
    );
  }
}

// Confirm the configured verification identities before creating files or apps.
export function gate({
  requireFreePorts = true,
  port = verificationPort,
  devices = heldDevices(),
} = {}) {
  const held = heldDevices();
  if (!held.length || devices.some((device) => !held.includes(device)))
    throw new Error("実機のgateは対象機器の鍵を保持してから呼んでください");
  if (
    devices.includes(verificationLocal.linux.host) &&
    linux("hostname").toLowerCase() !== verificationLocal.linux.host
  )
    throw new Error("Linux検証Host不一致");
  if (
    devices.includes(verificationLocal.windows.host) &&
    windows("hostname").toLowerCase() !== verificationLocal.windows.host
  )
    throw new Error("Windows検証Host不一致");
  if (devices.includes("android")) {
    let connected = false;
    try {
      connected = adb(["get-state"]) === "device";
    } catch {
      /* The shared server may have just started. */
    }
    if (!connected) adb(["connect", androidDevice]);
    if (adb(["shell", "getprop", "ro.product.model"]) !== "SM-S9180")
      throw new Error("Android検証Client不一致");
  }
  if (!requireFreePorts) return;
  const linuxPorts = devices.includes(verificationLocal.linux.host)
    ? linux(`ss -H -lun 'sport = :${port}'`)
    : "";
  const windowsPorts = devices.includes(verificationLocal.windows.host)
    ? windows(
        `@(Get-NetUDPEndpoint | Where-Object LocalPort -eq ${port}).Count`,
      )
    : "0";
  if (linuxPorts || windowsPorts !== "0")
    throw new Error(`検証の専用port ${port}が使用中です`);
}
