import { execFile } from "node:child_process";
import { join } from "node:path";
import { promisify } from "node:util";

const query = promisify(execFile);
type RegistryValue = { name: string; type: string; value: string };
type RegistryEnvironment = { system: RegistryValue[]; user: RegistryValue[] };

// Use the Windows registry API without expanding values, and emit UTF-8 even
// when the machine's console code page is not UTF-8.
const registryQuery = String.raw`
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = New-Object System.Text.UTF8Encoding $false
function Read-Environment($root, $path) {
  $key = $root.OpenSubKey($path)
  if ($null -eq $key) { return }
  try {
    foreach ($name in $key.GetValueNames()) {
      $kind = $key.GetValueKind($name).ToString()
      if ($kind -eq 'String' -or $kind -eq 'ExpandString') {
        [ordered]@{ name = $name; type = $kind; value = $key.GetValue($name, $null, [Microsoft.Win32.RegistryValueOptions]::DoNotExpandEnvironmentNames) }
      }
    }
  } finally { $key.Dispose() }
}
$result = [ordered]@{
  system = @(Read-Environment ([Microsoft.Win32.Registry]::LocalMachine) 'SYSTEM\CurrentControlSet\Control\Session Manager\Environment')
  user = @(Read-Environment ([Microsoft.Win32.Registry]::CurrentUser) 'Environment')
}
[Console]::Write(($result | ConvertTo-Json -Depth 4 -Compress))
`;

/** Merge Windows registry values without changing the supplied login base. */
export function windowsLoginEnvironment(
  base: Record<string, string>,
  output: string,
): Record<string, string> {
  const registry = JSON.parse(output) as RegistryEnvironment;
  const values = new Map<string, { name: string; value: string }>();
  const baseValues = new Map(
    Object.entries(base).map(([name, value]) => [name.toUpperCase(), value]),
  );
  const apply = (entries: RegistryValue[], user: boolean) => {
    for (const entry of entries) {
      const key = entry.name.toUpperCase();
      const value =
        entry.type === "ExpandString"
          ? entry.value.replace(
              /%([^%]+)%/gu,
              (match, name: string) =>
                values.get(name.toUpperCase())?.value ??
                baseValues.get(name.toUpperCase()) ??
                match,
            )
          : entry.value;
      const previous = values.get(key);
      values.set(key, {
        name: entry.name,
        value:
          key === "PATH" && user && previous?.value
            ? value
              ? `${previous.value};${value}`
              : previous.value
            : value,
      });
    }
  };
  apply(registry.system, false);
  for (const [name, value] of Object.entries(base)) {
    const key = name.toUpperCase();
    if (key !== "PATH" || !values.has(key)) values.set(key, { name, value });
  }
  apply(registry.user, true);
  return Object.fromEntries(
    [...values.values()].map(({ name, value }) => [name, value]),
  );
}

export async function readWindowsLoginEnvironment(
  base: Record<string, string>,
): Promise<Record<string, string>> {
  try {
    const root =
      Object.entries(base).find(
        ([name]) => name.toUpperCase() === "SYSTEMROOT",
      )?.[1] ?? "C:\\Windows";
    const powershell = join(
      root,
      "System32",
      "WindowsPowerShell",
      "v1.0",
      "powershell.exe",
    );
    const { stdout } = await query(
      powershell,
      ["-NoProfile", "-NonInteractive", "-Command", registryQuery],
      { env: base, windowsHide: true },
    );
    return windowsLoginEnvironment(base, stdout);
  } catch {
    console.error("iori-host windows-login-environment-unreadable");
    return base;
  }
}
