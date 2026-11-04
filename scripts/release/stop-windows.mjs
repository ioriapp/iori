import { join } from "node:path";
const quote = (value) =>
  "'" + value.replace(/['‘’‚‛]/gu, (character) => character + character) + "'";
export const stopHostScript = (
  bundle,
) => `Get-Process | Where-Object { $_.Path -eq ${quote(join(bundle, "iori-host-background.exe"))} } | ForEach-Object {
  $p=$_;$stop=$null
  try {
    if(-not $p.HasExited){
      $stop=[Threading.EventWaitHandle]::new($false,[Threading.EventResetMode]::ManualReset,('Local\\iori-host-stop-'+$p.Id))
      $null=$stop.Set();$p.WaitForExit()
    }
  } catch { if(-not $p.HasExited){throw} }
  finally { if($stop){$stop.Dispose()};$p.Dispose() }
}`;
