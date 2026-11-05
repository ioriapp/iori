param([Parameter(Mandatory=$true)][string]$Bundle, [switch]$StartOnly, [switch]$InstallOnly, [switch]$Ssh)
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
    $start = {
        param([string]$destination, [string]$work)
        $errorFile = Join-Path $work 'startup-error.txt'
        $launcher = Start-Process -FilePath "$destination\iori-host-background.exe" -WorkingDirectory $destination -ArgumentList ('"' + $errorFile + '"') -WindowStyle Hidden -PassThru
        $ready = [Threading.EventWaitHandle]::new($false, [Threading.EventResetMode]::ManualReset, ('Local\iori-host-ready-' + $launcher.Id))
        $exited = [Threading.ManualResetEvent]::new($false)
        $exited.SafeWaitHandle = [Microsoft.Win32.SafeHandles.SafeWaitHandle]::new($launcher.Handle, $false)
        try {
            $null = [Threading.WaitHandle]::WaitAny([Threading.WaitHandle[]]@($exited, $ready))
            if ($launcher.HasExited) { throw ('iori Hostを起動できませんでした（終了コード: ' + $launcher.ExitCode + '）。' + [IO.File]::ReadAllText($errorFile)) }
        } finally { $exited.Dispose(); $ready.Dispose(); $launcher.Dispose() }
    }
    if (-not $Ssh) { & $start $destination $work; return }
    # LSA exposes the caller's own logon sessions without elevation. Compare
    # SIDs and numeric logon types, including disconnected/locked desktops.
    # https://learn.microsoft.com/windows/win32/api/ntsecapi/nf-ntsecapi-lsagetlogonsessiondata
    Add-Type -TypeDefinition @'
using System;
using System.ComponentModel;
using System.Runtime.InteropServices;
using System.Security.Principal;
public static class IoriInteractiveLogon {
    [StructLayout(LayoutKind.Sequential)] struct Luid { public uint Low; public int High; }
    [StructLayout(LayoutKind.Sequential)] struct UnicodeString { public ushort Length, MaximumLength; public IntPtr Buffer; }
    [StructLayout(LayoutKind.Sequential)] struct LogonData {
        public uint Size;
        public Luid LogonId;
        public UnicodeString UserName, LogonDomain, AuthenticationPackage;
        public uint LogonType, Session;
        public IntPtr Sid;
    }
    [DllImport("secur32.dll")] static extern uint LsaEnumerateLogonSessions(out uint count, out IntPtr sessions);
    [DllImport("secur32.dll")] static extern uint LsaGetLogonSessionData(ref Luid id, out IntPtr data);
    [DllImport("secur32.dll")] static extern uint LsaFreeReturnBuffer(IntPtr buffer);
    [DllImport("advapi32.dll")] static extern uint LsaNtStatusToWinError(uint status);
    public static bool HasSession(SecurityIdentifier user) {
        uint count;
        IntPtr sessions;
        uint status = LsaEnumerateLogonSessions(out count, out sessions);
        if (status != 0) throw new Win32Exception((int)LsaNtStatusToWinError(status));
        try {
            int stride = Marshal.SizeOf(typeof(Luid));
            for (uint i = 0; i < count; i++) {
                var id = (Luid)Marshal.PtrToStructure(IntPtr.Add(sessions, checked((int)i * stride)), typeof(Luid));
                IntPtr buffer;
                // Other users' sessions are inaccessible to a standard user.
                if (LsaGetLogonSessionData(ref id, out buffer) != 0) continue;
                try {
                    if (buffer == IntPtr.Zero) continue;
                    var data = (LogonData)Marshal.PtrToStructure(buffer, typeof(LogonData));
                    if (data.Session != 0 && data.Sid != IntPtr.Zero &&
                        (data.LogonType == 2 || data.LogonType == 10 || data.LogonType == 11 || data.LogonType == 12) &&
                        user.Equals(new SecurityIdentifier(data.Sid))) return true;
                } finally { if (buffer != IntPtr.Zero) LsaFreeReturnBuffer(buffer); }
            }
            return false;
        } finally { LsaFreeReturnBuffer(sessions); }
    }
}
'@
    if (-not [IoriInteractiveLogon]::HasSession([Security.Principal.WindowsIdentity]::GetCurrent().User)) {
        [Console]::WriteLine('IORI_SETUP {"type":"signInRequired"}')
        return
    }
    # InteractiveToken uses the caller's existing sign-in, without a password
    # or elevation. The launcher must not belong to the SSH job object.
    $taskName = 'iori-host-start-' + [Guid]::NewGuid().ToString()
    $worker = Join-Path $work 'start.ps1'
    $resultFile = Join-Path $work 'start-result.json'
    function literal([string]$value) { "'" + [Management.Automation.Language.CodeGeneration]::EscapeSingleQuotedStringContent($value) + "'" }
    $workerSource = '$ErrorActionPreference="Stop";try { & {' + $start.ToString() + '} ' + (literal $destination) + ' ' + (literal $work) + ';$result=@{started=$true} } catch { $result=@{started=$false;message=$_.Exception.Message} };[IO.File]::WriteAllText(' + (literal ($resultFile + '.tmp')) + ',(ConvertTo-Json -Compress $result));[IO.File]::Move(' + (literal ($resultFile + '.tmp')) + ',' + (literal $resultFile) + ')'
    [IO.File]::WriteAllText($worker, $workerSource, [Text.UTF8Encoding]::new($false))
    $invokeWorker = '& ([scriptblock]::Create([IO.File]::ReadAllText(' + (literal $worker) + ')))'
    $encoded = [Convert]::ToBase64String([Text.Encoding]::Unicode.GetBytes($invokeWorker))
    # Task Scheduler has no per-action environment override. This hidden
    # bootstrap uses only language/.NET operations, then starts a clean 5.1.
    $invokeWorker = '[Environment]::SetEnvironmentVariable("PSModulePath",$null,"Process"); & ([IO.Path]::Combine($PSHOME,"powershell.exe")) -NoProfile -NonInteractive -WindowStyle Hidden -ExecutionPolicy Bypass -EncodedCommand ' + $encoded
    $encoded = [Convert]::ToBase64String([Text.Encoding]::Unicode.GetBytes($invokeWorker))
    # COM permits a standard user to register an Interactive task as themself;
    # the ScheduledTasks CIM provider can deny that same SSH token.
    $scheduler = New-Object -ComObject Schedule.Service
    $scheduler.Connect()
    $folder = $scheduler.GetFolder('\')
    $definition = $scheduler.NewTask(0)
    $definition.Principal.UserId = [Security.Principal.WindowsIdentity]::GetCurrent().Name
    $definition.Principal.LogonType = 3 # TASK_LOGON_INTERACTIVE_TOKEN
    $definition.Principal.RunLevel = 0 # TASK_RUNLEVEL_LUA
    $definition.Settings.DisallowStartIfOnBatteries = $false
    $definition.Settings.StopIfGoingOnBatteries = $false
    $definition.Settings.ExecutionTimeLimit = 'PT0S'
    $action = $definition.Actions.Create(0) # TASK_ACTION_EXEC
    $action.Path = Join-Path $env:SystemRoot 'System32\WindowsPowerShell\v1.0\powershell.exe'
    $action.Arguments = '-NoProfile -NonInteractive -WindowStyle Hidden -ExecutionPolicy Bypass -EncodedCommand ' + $encoded
    $action.WorkingDirectory = $env:SystemRoot
    $registered = $false
    $notStarted = @(267011, -2147020576, 2147946720, -2147216608, 2147750688)
    try {
        $task = $folder.RegisterTaskDefinition($taskName, $definition, 2, $null, $null, 3, $null) # TASK_CREATE
        $registered = $true
        try { $null = $task.Run($null) } catch {
            $errorCode = $_.Exception
            while ($errorCode -and $errorCode.HResult -notin $notStarted) { $errorCode = $errorCode.InnerException }
            if ($errorCode) {
                [Console]::WriteLine('IORI_SETUP {"type":"signInRequired"}')
                return
            }
            throw
        }
        while (-not (Test-Path -LiteralPath $resultFile)) {
            # A failed Interactive run has no IRunningTask to refresh. The
            # registered task retains its actual completion result instead.
            if ($task.State -ne 4 -and $task.State -ne 2) {
                if (Test-Path -LiteralPath $resultFile) { break }
                # A sign-out between the LSA read and Run can leave a task
                # unstarted: HAS_NOT_RUN, REQUEST_REFUSED or USER_NOT_LOGGED_ON.
                if (-not $task.LastRunTime -or $task.LastRunTime -eq [DateTime]::FromOADate(0) -or
                    $task.LastTaskResult -in $notStarted) {
                    [Console]::WriteLine('IORI_SETUP {"type":"signInRequired"}')
                    return
                }
                throw ('iori Hostを起動できませんでした（終了コード: ' + $task.LastTaskResult + '）。')
            }
            Start-Sleep -Milliseconds 100
        }
        $result = ConvertFrom-Json ([IO.File]::ReadAllText($resultFile))
        if (-not $result.started) { throw $result.message }
    } finally {
        if ($registered) { $folder.DeleteTask($taskName, 0) }
    }

} finally {
    if (Test-Path -LiteralPath $work) { Remove-Item -LiteralPath $work -Recurse -Force }
}
