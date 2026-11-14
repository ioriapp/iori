param([string]$Root, [string]$Node)
$ErrorActionPreference = 'Stop'
$result = @{ passed = $false; checks = @() }
$launcher = $null
function Check($condition, [string]$name) {
    if (-not $condition) { throw $name }
    $result.checks += $name
}
function Start-Launcher([string]$folder, [string]$errorFile) {
    $arguments = if ($errorFile) { '"' + $errorFile + '"' } else { '' }
    $info = [Diagnostics.ProcessStartInfo]::new((Join-Path $folder 'iori-host-background.exe'), $arguments)
    $info.WorkingDirectory = $folder
    $info.UseShellExecute = $false
    $info.CreateNoWindow = $true
    $info.RedirectStandardError = $true
    $process = [Diagnostics.Process]::Start($info)
    return @{ process = $process; errors = $process.StandardError.ReadToEndAsync() }
}
function Finish-Launcher($running) {
    $running.process.WaitForExit()
    return @{ code = $running.process.ExitCode; stderr = $running.errors.Result }
}
try {
    & "$env:WINDIR\Microsoft.NET\Framework64\v4.0.30319\csc.exe" /nologo /target:winexe "/out:$Root\iori-host-background.exe" "$Root\launcher.cs" | Out-String -OutVariable compiler | Out-Null
    if ($LASTEXITCODE -ne 0) { throw ('Launcher compilation failed: ' + $compiler) }
    New-Item -ItemType Directory -Path "$Root\runtime", "$Root\installer" | Out-Null
    Copy-Item -LiteralPath $Node -Destination "$Root\runtime\node.exe"
    $errorFile = "$Root\installer\startup-error.txt"
    [IO.File]::WriteAllText("$Root\restart", '')
    [IO.File]::WriteAllText("$Root\service.mjs", @'
import { appendFileSync, readFileSync, watch } from 'node:fs';
import { join } from 'node:path';
const starts = join(import.meta.dirname, 'starts');
appendFileSync(starts, 'started\n');
if (readFileSync(starts, 'utf8').trim().split('\n').length === 1) {
  watch(join(import.meta.dirname, 'restart'), () => process.exit(75));
  process.stdout.write('ready\n');
} else {
  process.stdout.write('ready\n');
  process.exit(0);
}
'@)
    $launcher = Start-Launcher $Root $errorFile
    $ready = [Threading.EventWaitHandle]::new($false, [Threading.EventResetMode]::ManualReset, ('Local\iori-host-ready-' + $launcher.process.Id))
    $exited = [Threading.ManualResetEvent]::new($false)
    $exited.SafeWaitHandle = [Microsoft.Win32.SafeHandles.SafeWaitHandle]::new($launcher.process.Handle, $false)
    try {
        $which = [Threading.WaitHandle]::WaitAny([Threading.WaitHandle[]]@($exited, $ready))
        Check ($which -eq 1) 'Initial child became ready'
        Remove-Item -LiteralPath "$Root\installer" -Recurse -Force
        [IO.File]::WriteAllText("$Root\restart", 'restart')
        $finished = Finish-Launcher $launcher
        $result.restart = $finished
        Check ($finished.code -eq 0) 'Launcher exits normally after restart with removed installer folder'
        Check (([IO.File]::ReadAllLines("$Root\starts")).Count -eq 2) 'Exit 75 starts the next child'
        Check (-not (Test-Path -LiteralPath "$Root\installer")) 'Installer folder stays removed'
    } finally { $exited.Dispose(); $ready.Dispose(); $launcher.process.Dispose(); $launcher = $null }

    [IO.File]::WriteAllText("$Root\service.mjs", "process.stderr.write('startup failure');process.exit(23);")
    foreach ($available in @($true, $false)) {
        if ($available) { New-Item -ItemType Directory -Path "$Root\installer" | Out-Null }
        $launcher = Start-Launcher $Root $errorFile
        $finished = Finish-Launcher $launcher
        Check ($finished.code -eq 23 -and $finished.stderr -eq 'startup failure') ('Startup failure keeps stderr and exit code; error folder available=' + $available)
        if ($available) {
            Check ([IO.File]::ReadAllText($errorFile) -eq 'startup failure') 'Installer receives startup failure text'
            Remove-Item -LiteralPath "$Root\installer" -Recurse -Force
        }
        $launcher.process.Dispose(); $launcher = $null
    }
    New-Item -ItemType Directory -Path "$Root\installer" | Out-Null
    [IO.File]::WriteAllText("$Root\service.mjs", "process.stdout.write('ready\n');process.stderr.write('later failure');process.exit(23);")
    $launcher = Start-Launcher $Root $errorFile
    $finished = Finish-Launcher $launcher
    Check ($finished.code -eq 23 -and $finished.stderr -eq 'later failure') 'Failure after ready keeps stderr and exit code'
    Check (-not (Test-Path -LiteralPath $errorFile)) 'Failure after ready does not write installer error file'
    $launcher.process.Dispose(); $launcher = $null
    Remove-Item -LiteralPath "$Root\installer" -Recurse -Force
    Remove-Item -LiteralPath "$Root\runtime\node.exe"
    $launcher = Start-Launcher $Root $errorFile
    $finished = Finish-Launcher $launcher
    Check ($finished.code -eq 1 -and $finished.stderr.Trim().Length -gt 0) 'Launch exception keeps stderr and exit code without error folder'
    $launcher.process.Dispose(); $launcher = $null

    if (Test-Path -LiteralPath "$Root\previous-launcher.exe") {
        Copy-Item -LiteralPath $Node -Destination "$Root\runtime\node.exe"
        [IO.File]::WriteAllText("$Root\service.mjs", "process.stdin.once('data',()=>process.exit(0));process.stdout.write('ready\n');")
        Move-Item -LiteralPath "$Root\iori-host-background.exe" -Destination "$Root\fixed-launcher.exe"
        Move-Item -LiteralPath "$Root\previous-launcher.exe" -Destination "$Root\iori-host-background.exe"
        New-Item -ItemType Directory -Path "$Root\installer" | Out-Null
        foreach ($previous in @($true, $false)) {
            $launcher = Start-Launcher $Root $(if ($previous) { $errorFile } else { '' })
            $ready = [Threading.EventWaitHandle]::new($false, [Threading.EventResetMode]::ManualReset, ('Local\iori-host-ready-' + $launcher.process.Id))
            $exited = [Threading.ManualResetEvent]::new($false)
            $exited.SafeWaitHandle = [Microsoft.Win32.SafeHandles.SafeWaitHandle]::new($launcher.process.Handle, $false)
            try {
                $which = [Threading.WaitHandle]::WaitAny([Threading.WaitHandle[]]@($exited, $ready))
                Check ($which -eq 1) ('Update launcher ready; previous=' + $previous)
                if ($previous) { Remove-Item -LiteralPath "$Root\installer" -Recurse -Force }
                & "$Root\stop.ps1"
                $finished = Finish-Launcher $launcher
                Check ($finished.code -eq 0) ('Product updater stops launcher normally; previous=' + $previous)
            } finally { $exited.Dispose(); $ready.Dispose(); $launcher.process.Dispose(); $launcher = $null }
            if ($previous) {
                Remove-Item -LiteralPath "$Root\iori-host-background.exe"
                Move-Item -LiteralPath "$Root\fixed-launcher.exe" -Destination "$Root\iori-host-background.exe"
            }
        }
        Check (-not (Test-Path -LiteralPath "$Root\installer")) 'Update with previous launcher does not recreate installer folder'
    }
    $result.passed = $true
} catch {
    $result.error = $_.Exception.Message
} finally {
    if ($launcher) { $launcher.process.Dispose() }
}
ConvertTo-Json -InputObject $result -Depth 5 -Compress
