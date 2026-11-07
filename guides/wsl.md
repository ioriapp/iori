# Running iori Host in WSL

[日本語](wsl.ja.md)

iori Client does not set up WSL for you. Follow these steps to run the Host inside WSL 2 on Windows 11 (22H2 or later, for mirrored networking).

1. Make sure [systemd is enabled](https://learn.microsoft.com/windows/wsl/systemd) in your distribution. Ubuntu installed with `wsl --install` has it enabled by default.
2. Add the following to `%USERPROFILE%\.wslconfig` on Windows, then run `wsl --shutdown`.

   ```ini
   [general]
   # Keep WSL running after its terminals are closed
   instanceIdleTimeout=-1

   [wsl2]
   # Let your phone and other PCs reach the Host
   networkingMode=mirrored

   [experimental]
   # Let the Client on the same PC reach the Host
   hostAddressLoopback=true
   ```

3. In WSL, run the Linux install command:

   ```sh
   curl -fsSL https://github.com/ioriapp/iori/releases/latest/download/install.sh | sh
   ```

4. To connect from other devices, allow the Host's port in an administrator PowerShell:

   ```powershell
   New-NetFirewallHyperVRule -Name 'iori-host-wsl' -DisplayName 'iori Host (WSL)' -Direction Inbound -VMCreatorId '{40E0AC32-46A5-438A-A0B2-2B479E8F2E90}' -Protocol UDP -LocalPorts 49171
   ```

5. To start the Host when you sign in to Windows, register a scheduled task:

   ```powershell
   $user = [Security.Principal.WindowsIdentity]::GetCurrent().Name
   $action = New-ScheduledTaskAction -Execute "$env:WINDIR\System32\wsl.exe" -Argument '-d Ubuntu --exec /usr/bin/systemctl --user start iori-host.service'
   $trigger = New-ScheduledTaskTrigger -AtLogOn -User $user
   $principal = New-ScheduledTaskPrincipal -UserId $user -LogonType Interactive -RunLevel Limited
   $settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries
   Register-ScheduledTask -TaskName 'iori Host (WSL)' -Action $action -Trigger $trigger -Principal $principal -Settings $settings
   ```

Replace `Ubuntu` with your distribution name. `wsl --shutdown` stops everything running in WSL. A terminal window appears at sign-in while the Host starts.
