param([Parameter(Mandatory=$true)][string]$Bundle, [switch]$StartOnly, [switch]$InstallOnly)
$ErrorActionPreference = 'Stop'
$destination = Join-Path $env:LOCALAPPDATA 'Programs\iori-host'
$first = -not (Test-Path -LiteralPath (Join-Path $destination 'iori-host.cmd'))
$work = Join-Path (Split-Path $destination) ('.iori-host-setup-' + [Guid]::NewGuid().ToString())
New-Item -ItemType Directory -Path $work -Force | Out-Null
try {
    if (-not $StartOnly) {
        Copy-Item -LiteralPath "$bundle\runtime\node.exe" -Destination "$work\node.exe"
        Copy-Item -LiteralPath "$bundle\move-bundle.mjs" -Destination "$work\move-bundle.mjs"
        if (-not $first) {
            & "$bundle\runtime\node.exe" "$bundle\terminal-daemon.mjs" --status
            if ($LASTEXITCODE -eq 0) {
                Write-Host '実行中のTerminalとエージェントは止まりません。全端末の接続が一度切れ、iori Hostが起動し直すと自動で戻ります。'
            } else {
                Write-Host '実行中のTerminalとCLIの画面のプロセスを止めて更新します。会話はCLIに保存されており、更新後に再開できます。'
            }
            & "$destination\runtime\node.exe" "$destination\stop.mjs"
            if ($LASTEXITCODE -ne 0) { throw 'iori Hostを停止できませんでした。' }
            & "$work\node.exe" "$work\move-bundle.mjs" $destination "$work\previous"
            if ($LASTEXITCODE -ne 0) { throw 'iori Hostの前のバージョンを移動できませんでした。' }
        }
        & "$work\node.exe" "$work\move-bundle.mjs" $bundle $destination
        if ($LASTEXITCODE -ne 0) { throw 'iori Hostの新しいバージョンを配置できませんでした。' }
        if (Test-Path -LiteralPath "$work\previous") { Remove-Item -LiteralPath "$work\previous" -Recurse -Force }
        $run = 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Run'
        New-Item -Path $run -Force | Out-Null
        New-ItemProperty -Path $run -Name 'iori Host' -Value ('"' + $destination + '\iori-host-background.exe"') -PropertyType String -Force | Out-Null
        $userPath = [Environment]::GetEnvironmentVariable('Path', 'User')
        if ($destination -notin ($userPath -split ';')) { [Environment]::SetEnvironmentVariable('Path', (([string]$userPath).TrimEnd(';') + ';' + $destination), 'User') }
        if ($destination -notin ($env:Path -split ';')) { $env:Path += ';' + $destination }
    }
    if ($InstallOnly) { return }
    $errorFile = Join-Path $work 'startup-error.txt'
    $launcher = Start-Process -FilePath "$destination\iori-host-background.exe" -WorkingDirectory $destination -ArgumentList ('"' + $errorFile + '"') -WindowStyle Hidden -PassThru
    $ready = [Threading.EventWaitHandle]::new($false, [Threading.EventResetMode]::ManualReset, ('Local\iori-host-ready-' + $launcher.Id))
    $exited = [Threading.ManualResetEvent]::new($false)
    $exited.SafeWaitHandle = [Microsoft.Win32.SafeHandles.SafeWaitHandle]::new($launcher.Handle, $false)
    try {
        $null = [Threading.WaitHandle]::WaitAny([Threading.WaitHandle[]]@($exited, $ready))
        if ($launcher.HasExited) { throw ('iori Hostを起動できませんでした（終了コード: ' + $launcher.ExitCode + '）。' + [IO.File]::ReadAllText($errorFile)) }
    } finally { $exited.Dispose(); $ready.Dispose(); $launcher.Dispose() }
} finally {
    if (Test-Path -LiteralPath $work) { Remove-Item -LiteralPath $work -Recurse -Force }
}
