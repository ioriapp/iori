param([switch]$Remote, [string]$ProgramPath, [switch]$AdministratorConnection, [switch]$Query)
$ErrorActionPreference = 'Stop'
$program = if ($AdministratorConnection) { $ProgramPath } else { Join-Path $env:LOCALAPPDATA 'Programs\iori-host\runtime\node.exe' }
# Stable per-installation name; paths differ between users on the same PC.
$sha = [Security.Cryptography.SHA256]::Create()
$name = 'iori-host-' + [BitConverter]::ToString($sha.ComputeHash([Text.Encoding]::UTF8.GetBytes($program.ToLowerInvariant()))).Replace('-', '').Substring(0,16)
$sha.Dispose()
if (-not $Remote -and $env:IORI_FIREWALL_QUERY -eq '1') {
    $rule = Get-NetFirewallRule -Name $name -ErrorAction SilentlyContinue
    $application = if ($rule) { $rule | Get-NetFirewallApplicationFilter }
    $port = if ($rule) { $rule | Get-NetFirewallPortFilter }
    if ($rule -and $rule.Enabled -eq 'True' -and $rule.Action -eq 'Allow' -and $rule.Direction -eq 'Inbound' -and $rule.Profile -eq 'Any' -and $application.Program -ieq $program -and $port.Protocol -eq 'UDP') { 'true' } else { 'false' }
    exit
}
# The elevated process receives a literal path, never code from the WebView.
$literalProgram = "'" + [Management.Automation.Language.CodeGeneration]::EscapeSingleQuotedStringContent($program) + "'"
# A readable command for either elevated PowerShell 5.1 or PowerShell 7.
$command = '$program=' + $literalProgram + '; $name=' + "'" + $name + "'" + "; " + '& { $ErrorActionPreference=''Stop''; if (Get-NetFirewallRule -Name $name -ErrorAction SilentlyContinue) { Set-NetFirewallRule -Name $name -Direction Inbound -Action Allow -Enabled True -Profile Any -Protocol UDP -Program $program } else { New-NetFirewallRule -Name $name -DisplayName ''iori Host'' -Direction Inbound -Action Allow -Enabled True -Profile Any -Protocol UDP -Program $program }; Get-NetFirewallApplicationFilter | Where-Object { $_.Program -ieq $program } | Get-NetFirewallRule | Where-Object { $_.Direction -eq ''Inbound'' -and $_.Action -eq ''Block'' } | Remove-NetFirewallRule }'
if ($Query) {
    $allowed = $null
    try {
        # INetFwPolicy2 reads policy without elevation. Its Name is the
        # user-facing rule name; compare the actual program and rule scope.
        $policy = New-Object -ComObject HNetCfg.FwPolicy2
        $allowed = @($policy.Rules | Where-Object { $_.Name -eq 'iori Host' -and $_.ApplicationName -ieq $program -and $_.Enabled -and $_.Direction -eq 1 -and $_.Action -eq 1 -and $_.Protocol -eq 17 -and $_.Profiles -eq 0x7fffffff }).Count -gt 0
    } catch { $allowed = $null }
    [Console]::WriteLine('IORI_SETUP ' + (ConvertTo-Json -Compress @{type='firewall';allowed=$allowed;command=$command;program=$program}))
    return
}
$rules = " `$rule=Get-NetFirewallRule -Name '$name' -ErrorAction SilentlyContinue; if (`$rule) { Set-NetFirewallRule -Name '$name' -Direction Inbound -Action Allow -Enabled True -Profile Any -Protocol UDP -Program $literalProgram } else { New-NetFirewallRule -Name '$name' -DisplayName 'iori Host' -Direction Inbound -Action Allow -Enabled True -Profile Any -Protocol UDP -Program $literalProgram | Out-Null }; Get-NetFirewallApplicationFilter | Where-Object { `$_.Program -ieq $literalProgram } | Get-NetFirewallRule | Where-Object { `$_.Direction -eq 'Inbound' -and `$_.Action -eq 'Block' } | Remove-NetFirewallRule"
$script = "`$ErrorActionPreference='Stop';try { $rules;exit 0 } catch { exit 1 }"
$encoded = [Convert]::ToBase64String([Text.Encoding]::Unicode.GetBytes($script))
function Start-IoriFirewallChild([switch]$Elevated) {
    $options = @{FilePath=(Join-Path $PSHOME 'powershell.exe'); WindowStyle='Hidden'; ArgumentList=@('-NoProfile', '-NonInteractive', '-EncodedCommand', $encoded); Wait=$true; PassThru=$true}
    if ($Elevated) { $options.Verb = 'RunAs' }
    $modulePath = $env:PSModulePath
    try {
        [Environment]::SetEnvironmentVariable('PSModulePath', $null, 'Process')
        Start-Process @options
    } finally { [Environment]::SetEnvironmentVariable('PSModulePath', $modulePath, 'Process') }
}
if ($Remote -or $AdministratorConnection) {
    $allowed = $false
    $reason = $null
    $identity = [Security.Principal.WindowsIdentity]::GetCurrent()
    $principal = [Security.Principal.WindowsPrincipal]::new($identity)
    $administrator = $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
    try {
        if ($administrator) {
            if ($AdministratorConnection) {
                $installedPath = @(Get-CimInstance -ClassName Win32_UserProfile | Where-Object { $_.LocalPath -and (Join-Path $_.LocalPath 'AppData\Local\Programs\iori-host\runtime\node.exe') -ieq $program }).Count -gt 0
                if (-not $installedPath -or -not (Test-Path -LiteralPath $program -PathType Leaf)) { throw 'Invalid SSH destination information' }
            }
            & ([scriptblock]::Create($rules)) | Out-Null
            $allowed = $true
        }
    } catch { $reason = $_.Exception.Message }
    [Console]::WriteLine('IORI_SETUP ' + (ConvertTo-Json -Compress @{type='firewall';allowed=$allowed;administrator=$administrator;command=$command;program=$program;message=$reason}))
    return
}
try {
    $child = Start-IoriFirewallChild -Elevated
    if ($child.ExitCode -eq 0) { 'true' } else { 'false' }
} catch { [Console]::Error.WriteLine($_.Exception.Message); 'false' }
