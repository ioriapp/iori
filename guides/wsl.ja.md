# WSL で iori Host を動かす

[English](wsl.md)

iori Client は WSL を自動では用意しません。Windows 11（22H2 以降。mirrored のネットワークに必要です）の WSL 2 の中で Host を動かすには、次の手順で用意します。

1. ディストリビューションで [systemd を有効](https://learn.microsoft.com/ja-jp/windows/wsl/systemd)にします。`wsl --install` で入れた Ubuntu は最初から有効です。
2. Windows の `%USERPROFILE%\.wslconfig` に次を足し、`wsl --shutdown` を実行します。

   ```ini
   [general]
   # ターミナルを閉じた後も WSL を動かし続ける
   instanceIdleTimeout=-1

   [wsl2]
   # スマートフォンやほかの PC から Host に接続できるようにする
   networkingMode=mirrored

   [experimental]
   # 同じ PC の Client から Host に接続できるようにする
   hostAddressLoopback=true
   ```

3. WSL の中で、Linux のインストールのコマンドを実行します。

   ```sh
   curl -fsSL https://github.com/ioriapp/iori/releases/latest/download/install.sh | sh
   ```

4. ほかのデバイスから接続する時は、管理者の PowerShell で Host のポートを許可します。

   ```powershell
   New-NetFirewallHyperVRule -Name 'iori-host-wsl' -DisplayName 'iori Host (WSL)' -Direction Inbound -VMCreatorId '{40E0AC32-46A5-438A-A0B2-2B479E8F2E90}' -Protocol UDP -LocalPorts 49171
   ```

5. Windows にサインインした時に Host を起動するには、タスクを登録します。

   ```powershell
   $user = [Security.Principal.WindowsIdentity]::GetCurrent().Name
   $action = New-ScheduledTaskAction -Execute "$env:WINDIR\System32\wsl.exe" -Argument '-d Ubuntu --exec /usr/bin/systemctl --user start iori-host.service'
   $trigger = New-ScheduledTaskTrigger -AtLogOn -User $user
   $principal = New-ScheduledTaskPrincipal -UserId $user -LogonType Interactive -RunLevel Limited
   $settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries
   Register-ScheduledTask -TaskName 'iori Host (WSL)' -Action $action -Trigger $trigger -Principal $principal -Settings $settings
   ```

`Ubuntu` は使っているディストリビューションの名前に置き換えてください。`wsl --shutdown` は WSL の中で動いているものをすべて止めます。サインインの時、Host が起動する間はターミナルのウィンドウが表示されます。
