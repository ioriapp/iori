$ErrorActionPreference = 'Stop'
$program = Join-Path $env:LOCALAPPDATA 'Programs\iori-host\runtime\node.exe'
# Stable per-installation name; paths differ between users on the same PC.
$sha = [Security.Cryptography.SHA256]::Create()
$name = 'iori-host-' + [BitConverter]::ToString($sha.ComputeHash([Text.Encoding]::UTF8.GetBytes($program.ToLowerInvariant()))).Replace('-', '').Substring(0,16)
$sha.Dispose()
if ($env:IORI_FIREWALL_QUERY -eq '1') {
    $rule = Get-NetFirewallRule -Name $name -ErrorAction SilentlyContinue
    $application = if ($rule) { $rule | Get-NetFirewallApplicationFilter }
    $port = if ($rule) { $rule | Get-NetFirewallPortFilter }
    if ($rule -and $rule.Enabled -eq 'True' -and $rule.Action -eq 'Allow' -and $rule.Direction -eq 'Inbound' -and $rule.Profile -eq 'Any' -and $application.Program -ieq $program -and $port.Protocol -eq 'UDP') { 'true' } else { 'false' }
    exit
}
# The elevated process receives a literal path, never code from the WebView.
$literalProgram = "'" + [Management.Automation.Language.CodeGeneration]::EscapeSingleQuotedStringContent($program) + "'"
$script = "`$ErrorActionPreference='Stop';try { `$rule=Get-NetFirewallRule -Name '$name' -ErrorAction SilentlyContinue; if (`$rule) { Set-NetFirewallRule -Name '$name' -Direction Inbound -Action Allow -Enabled True -Profile Any -Protocol UDP -Program $literalProgram } else { New-NetFirewallRule -Name '$name' -DisplayName 'iori Host' -Direction Inbound -Action Allow -Enabled True -Profile Any -Protocol UDP -Program $literalProgram | Out-Null }; Get-NetFirewallApplicationFilter | Where-Object { `$_.Program -ieq $literalProgram } | Get-NetFirewallRule | Where-Object { `$_.Direction -eq 'Inbound' -and `$_.Action -eq 'Block' } | Remove-NetFirewallRule;exit 0 } catch { exit 1 }"
$encoded = [Convert]::ToBase64String([Text.Encoding]::Unicode.GetBytes($script))
try {
    $child = Start-Process -FilePath (Join-Path $PSHOME 'powershell.exe') -Verb RunAs -WindowStyle Hidden -ArgumentList @('-NoProfile', '-NonInteractive', '-EncodedCommand', $encoded) -Wait -PassThru
    if ($child.ExitCode -eq 0) { 'true' } else { 'false' }
} catch { [Console]::Error.WriteLine($_.Exception.Message); 'false' }
