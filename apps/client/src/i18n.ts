import { teamJapanese } from "./teams/translations.ts";
const japanese: Record<string, string> = {
  "The SSH connection to {host} was lost, so the uninstall result could not be checked.":
    "{host}とのSSH接続が切断されたため、アンインストールの結果を確認できませんでした。",
  "Restart your PC, then delete this folder.":
    "PCを再起動してから、このフォルダーを削除してください。",
  "The uninstall result was saved, but its receipt file could not be deleted.":
    "アンインストールの結果を保存しましたが、結果のファイルを削除できませんでした。",
  "Could not remove iori entries from CLI settings.":
    "CLIの設定からioriの項目を削除できませんでした。",
  "Could not remove the automatic startup registration.":
    "自動起動の登録を解除できませんでした。",
  "Could not stop iori Host.": "iori Hostを停止できませんでした。",
  "Could not prepare the uninstall.":
    "アンインストールの準備ができませんでした。",
  "Stopped Terminals and agents": "TerminalとAgentを停止しました",
  "Deleting Forgejo and Gitea tokens": "Forgejo・Giteaのトークンを削除中",
  "Deleted Forgejo and Gitea tokens": "Forgejo・Giteaのトークンを削除しました",
  "Deleted the iori Host program": "iori Hostのプログラムを削除しました",
  "Deleted iori Host saved data": "iori Hostの保存データを削除しました",
  "Checked the uninstall result": "アンインストールの結果を確認しました",

  "Could not sign in to {host}. Retry.":
    "{host}にログインできませんでした。もう一度お試しください。",
  "Could not connect to {host} over SSH. Check that an SSH server is running on {host}, then retry.":
    "{host}にSSHで接続できませんでした。{host}でSSHサーバーが起動しているか確認してから、もう一度お試しください。",
  "{host} did not respond. Check the network, then retry.":
    "{host}から応答がありませんでした。ネットワークを確認してから、もう一度お試しください。",
  "This is the first connection to {host}. Check that the displayed key fingerprint matches the one for {host}.":
    "{host}に初めて接続します。表示された鍵のフィンガープリントが{host}のものと一致するか確認してください。",
  "iori Host will stop when you log out of {host}. To keep it running after logout, run this command with administrator privileges as the user running iori Host.":
    "{host}からログアウトすると、iori Hostが停止します。ログアウト後も停止しないようにするには、iori Hostを実行しているユーザーで、次のコマンドを管理者権限で実行してください。",
  "SSH output": "SSHの出力",
  Progress: "進行状況",
  Log: "ログ",
  "Download on {host}": "{host}でダウンロード",
  "Extract files": "ファイルを展開",
  "Start iori Host": "iori Hostを起動",
  "Register this device": "このデバイスを登録",
  "Add firewall permission": "ファイアウォールの許可を追加",
  "Destination: {platform} · {user} · {home}":
    "接続先: {platform} · {user} · {home}",
  "Verified SHA-256 ({hash})": "SHA-256を確認しました（{hash}）",
  "Enter host, user@host, or ssh://user@host:port.":
    "host、user@host、ssh://user@host:portのいずれかの形式で入力してください。",
  "This name appears in the iori Host device list.":
    "iori Hostのデバイスの一覧に表示される名前です。",
  "Example: user@192.168.1.24": "例: user@192.168.1.24",
  "Choose from the list": "一覧から選ぶ",
  "Use this SSH destination": "この接続先を使う",
  "Hosts in {path}": "{path}のHost",
  "No destinations match “{query}”.":
    "「{query}」に一致する接続先はありません。",
  "Could not sign in to {user}@{host}. Check the password and enter it again.":
    "{user}@{host}にログインできませんでした。パスワードを確認して、もう一度入力してください。",
  "Choose a destination": "接続先を選んでください",
  "Enter a destination": "接続先を入力してください",
  "Register this device with iori Host.":
    "このデバイスをiori Hostに登録します。",
  "Install iori Host and register this device.":
    "iori Hostをインストールして、このデバイスを登録します。",
  "Windows will ask for administrator approval once during installation.":
    "インストール中に、「ユーザー アカウント制御」の確認画面が1回表示されます。",
  "Only this PC can use it.": "この PCからだけ使えます。",
  "Enter a name for this device": "このデバイスの名前を入力してください",
  "There are no Hosts in {path}. Select “Enter manually…” to enter a destination.":
    "{path}にHostがありません。「手動で指定する…」から接続先を入力してください。",
  "OpenSSH Client was not found. Add “OpenSSH Client” in Windows Settings → Optional features, then retry.":
    "OpenSSH クライアントが見つかりません。Windowsの設定の「オプション機能」で「OpenSSH クライアント」を追加してから、もう一度お試しください。",
  "Open Windows Settings": "Windowsの設定を開く",
  "OpenSSH client was not found. Install the OpenSSH client (openssh-client), then retry.":
    "OpenSSHクライアントが見つかりません。OpenSSHクライアント（openssh-client）をインストールしてから、もう一度お試しください。",
  "Could not connect to {host} ({address}) over SSH. Check that an SSH server is running on {host}, then retry.":
    "{host}（{address}）にSSHで接続できませんでした。{host}でSSHサーバーが起動しているか確認してから、もう一度お試しください。",
  "Could not find the address of {host}. Check the destination name, then retry.":
    "{host}のアドレスが見つかりませんでした。接続先の名前を確認してから、もう一度お試しください。",
  "{host} ({address}) did not respond. Check the network, then retry.":
    "{host}（{address}）から応答がありませんでした。ネットワークを確認してから、もう一度お試しください。",
  "Do not connect": "接続しない",
  "This is the first connection to {host} ({address}). Check that the displayed key fingerprint matches the one for {host}.":
    "{host}（{address}）に初めて接続します。表示された鍵のフィンガープリントが{host}のものと一致するか確認してください。",
  "The host key for {host} has changed since the last connection, so the connection was refused. Check why it changed, then remove the old host key with this command and retry.":
    "{host}のホストキーが前回の接続から変わっているため、接続しませんでした。変わった理由を確認し、次のコマンドで古いホストキーを削除してから、もう一度お試しください。",
  "Touch your security key.": "セキュリティキーにタッチしてください。",
  "{user}@{host} password": "{user}@{host}のパスワード",
  "Could not sign in to {user}@{host}. Retry.":
    "{user}@{host}にログインできませんでした。もう一度お試しください。",
  "Installation cancelled.": "インストールをキャンセルしました。",
  "During installation, incoming connections for iori Host will be allowed in Windows Firewall.":
    "インストール中に、Windows ファイアウォールでiori Hostの受信接続を許可します。",
  "{user} on {host} is not an administrator, so installation over SSH is not available. Open iori Client on {host} and install iori Host using “This PC” in “Set up iori Host”. Windows will ask for an administrator password once during installation. Then, in iori Client on {host}, select Devices → Invite a new device, and read the invitation using “Connect with an invitation” on this device.":
    "{host}の{user}は管理者ではないため、SSHではインストールできません。{host}でiori Clientを開き、「iori Hostをセットアップする」の「この PC」でiori Hostをインストールしてください。インストール中に、Windowsの管理者のパスワードが1回求められます。その後、{host}のiori Clientの「デバイス」→「新しいデバイスを招待する」で表示した招待を、このデバイスの「招待で接続する」で読み取ってください。",
  "iori Host does not support {platform}. Linux x64 and Windows x64 are supported.":
    "iori Hostは{platform}に対応していません。対応しているのはLinux x64とWindows x64です。",
  "Choose another destination": "ほかの接続先を選んでください",
  "The SSH connection to {host} was lost during installation. Retry.":
    "インストール中に{host}とのSSH接続が切断されました。もう一度お試しください。",
  "Installed iori Host on {host} and registered this device.":
    "{host}にiori Hostをインストールし、このデバイスを登録しました。",
  "iori Host will stop when {user} logs out of {host}. To keep it running after logout, run this command with administrator privileges.":
    "{user}が{host}からログアウトすると、iori Hostが停止します。ログアウト後も停止しないようにするには、次のコマンドを管理者権限で実行してください。",
  "Installed iori Host on {host}. Sign in to {host} as {user}, then select “Register with this iori Host”. To register later, sign in to {host}, then select {host} in “Set up iori Host”.":
    "{host}にiori Hostをインストールしました。{host}に{user}でサインインしてから、「このiori Hostに登録する」を押してください。後で登録するときは、{host}にサインインした後に「iori Hostをセットアップする」で{host}を選んでください。",
  "iori Host has not started on {host} yet. Sign in to {host} as {user}, then select “Register with this iori Host” again.":
    "{host}でiori Hostがまだ起動していません。{host}に{user}でサインインしてから、もう一度「このiori Hostに登録する」を押してください。",
  "Could not extract iori Host on {host}. Retry.":
    "{host}でiori Hostを展開できませんでした。もう一度お試しください。",
  "Neither curl nor wget is installed on {host}. Install one of them, then retry.":
    "{host}にcurlとwgetのどちらもインストールされていません。どちらかをインストールしてから、もう一度お試しください。",
  "Installed iori Host on {host}, but this device cannot connect. Check that incoming connections are allowed by the firewall between this device and {host}, then retry. To retry later, check the firewall, then select {host} in “Set up iori Host”.":
    "{host}にiori Hostをインストールしましたが、このデバイスから接続できません。{host}との間のファイアウォールで受信が許可されているか確認してから、もう一度お試しください。後で再接続する場合は、ファイアウォールを確認してから「iori Hostをセットアップする」で{host}を選んでください。",
  "Addresses tried (UDP): {addresses}": "試したアドレス（UDP）: {addresses}",
  "iori Host on {host} is version {version}, so this device cannot be registered. It will be updated to {clientVersion} before registration.":
    "{host}のiori Hostはバージョン{version}のため、このデバイスを登録できません。{clientVersion}に更新してから登録します。",
  "Update iori Host and register": "iori Hostを更新して登録する",
  "Updating and registration will continue after closing":
    "閉じても更新と登録は続きます。",
  "Could not update iori Host on {host}, so this device could not be registered.":
    "{host}のiori Hostを更新できなかったため、このデバイスを登録できませんでした。",
  "Could not extract iori Host on {host}. Check the state of iori Host on {host}, then retry.":
    "{host}でiori Hostを展開できませんでした。{host}でiori Hostの状態を確認してから、もう一度お試しください。",
  "iori Host {version} is already installed on {host}. This device will be registered with it.":
    "{host}には既にiori Host {version}がインストールされています。このデバイスをこのiori Hostに登録します。",
  "After registration, select “Update iori Host” in Settings to update to the latest version.":
    "登録後、設定の「iori Hostを更新」から最新バージョンに更新してください。",
  "Registered this device with iori Host on {host}.":
    "{host}のiori Hostにこのデバイスを登録しました。",
  "{host} ({platform}) · This device: {device}":
    "{host}（{platform}） · このデバイス: {device}",
  "{host} · This device: {device}": "{host} · このデバイス: {device}",
  "Remove iori settings": "ioriの設定を削除",
  "Stop work": "作業を停止",
  "Delete iori Host": "iori Hostのプログラムを削除",
  "Check the result": "結果を確認",
  "Removed iori entries from CLI settings":
    "CLIの設定からioriの項目を削除しました",
  "Removed automatic startup registration": "自動起動の登録を解除しました",
  "Stopped Terminals and agents ({count})":
    "TerminalとAgentを停止しました（{count}件）",
  "Stopped iori Host": "iori Hostを停止しました",
  "Checking the removal result": "アンインストールの結果を確認中",
  "Restart iori Host on {host}.": "{host}のiori Hostを再起動します。",
  "Uninstall iori Host from a PC using iori.":
    "PCのioriからアンインストールしてください。",
  "Remove the iori Host program and automatic startup registration from {host}.":
    "{host}からiori Hostのプログラムを削除し、自動起動の登録を解除します。",
  "Uninstall iori Host on {host}?":
    "{host}のiori Hostをアンインストールしますか？",
  "All devices using this Host will no longer be able to connect.":
    "このHostを使っているすべてのデバイスから接続できなくなります。",
  "The iori Host program and automatic startup registration will be removed, along with entries added by iori to CLI settings. Development files and CLI conversations, settings, and sign-ins will remain.":
    "iori Hostのプログラムを削除し、自動起動の登録を解除します。CLIの設定からioriが追加した項目を削除します。開発ファイルと、CLIの会話・設定・ログイン情報は残ります。",
  "Device registrations, work records, and Forgejo and Gitea tokens will be deleted. They will remain if this is not selected.":
    "デバイスの登録・作業記録・Forgejo・Giteaのトークンを削除します。選択しない場合は残ります。",
  "No work will be interrupted.": "中断される作業はありません。",
  "Could not load work that will be interrupted. Retry.":
    "中断される作業を読み込めませんでした。もう一度お試しください。",
  "When uninstalling without SSH, you will not see whether iori Host has been completely removed.":
    "SSHを使わずにアンインストールした場合、iori Hostの削除が完了したかどうかは表示されません。",
  "Uninstall without SSH": "SSHを使わずにアンインストールする",
  "Uninstalling will continue after closing":
    "閉じてもアンインストールは続きます。",
  "The SSH connection to {host} was lost during uninstall, so the result could not be checked. Retry.":
    "アンインストール中に{host}とのSSH接続が切断されたため、結果を確認できませんでした。もう一度お試しください。",
  "Started uninstalling iori Host on {host}.":
    "{host}のiori Hostのアンインストールを開始しました。",
  "Uninstalled iori Host on {host}.":
    "{host}のiori Hostをアンインストールしました。",
  "Deleted iori Host and its saved data on {host}.":
    "{host}のiori Hostをアンインストールし、保存データを削除しました。",
  "Uninstalled iori Host on {host}. Some items need your attention.":
    "{host}のiori Hostをアンインストールしました。確認が必要な項目があります。",
  "Could not uninstall iori Host on {host}.":
    "{host}のiori Hostをアンインストールできませんでした。",
  "Could not delete the tokens for these sites. Revoke each token on its site, then delete it from Credential Manager.":
    "次のサイトのトークンを削除できませんでした。各サイトでトークンを無効にしてから、資格情報マネージャーから削除してください。",
  "Could not delete the tokens for these sites. Revoke each token on its site, then delete it from the keyring.":
    "次のサイトのトークンを削除できませんでした。各サイトでトークンを無効にしてから、キーリングから削除してください。",
  "Could not delete the tokens for these sites. Revoke each token on its site, then delete it from Credential Manager or the keyring.":
    "次のサイトのトークンを削除できませんでした。各サイトでトークンを無効にしてから、資格情報マネージャーやキーリングから削除してください。",
  "Could not delete some iori Host files.":
    "iori Hostのファイルの一部を削除できませんでした。",
  "Remaining folders:": "残ったフォルダー:",
  "Restart {host}, then delete this folder on {host}.":
    "{host}を再起動してから、{host}でこのフォルダーを削除してください。",
  "Could not uninstall iori Host. The iori entries could not be removed from CLI settings. You do not have permission to change the settings file. iori Host was restored to its state before uninstall and can still be used.":
    "iori Hostをアンインストールできませんでした。CLIの設定からioriの項目を削除できませんでした。設定ファイルを変更する権限がありません。iori Hostはアンインストール前の状態に戻り、そのまま使えます。",
  "Could not uninstall iori Host. Terminals and agents could not be stopped. iori Host is running, but will not start automatically after {host} restarts.":
    "iori Hostをアンインストールできませんでした。TerminalとAgentを停止できませんでした。iori Hostは実行中ですが、{host}の再起動後は自動で起動しません。",
  "Could not stop Terminals and agents: {error}":
    "TerminalとAgentを停止できませんでした: {error}",
  "Could not stop Terminals and agents.":
    "TerminalとAgentを停止できませんでした。",
  "Could not uninstall iori Host.":
    "iori Hostをアンインストールできませんでした。",
  "The iori entries could not be removed from CLI settings. You do not have permission to change the settings file.":
    "CLIの設定からioriの項目を削除できませんでした。設定ファイルを変更する権限がありません。",
  "iori Host was restored to its state before uninstall and can still be used.":
    "iori Hostはアンインストール前の状態に戻り、そのまま使えます。",
  "iori Host is running, but will not start automatically after {host} restarts.":
    "iori Hostは実行中ですが、{host}の再起動後は自動で起動しません。",
  "iori Host uninstallation": "iori Hostのアンインストール",
  Status: "状態",
  "Relay URL": "RelayのURL",
  "Relay access token (only if required)":
    "Relayのアクセストークン（必要な場合のみ）",
  "Use a Relay you provide to connect outside your LAN or VPN. Clear the URL to use direct connections only.":
    "LANやVPNの外から接続するときに、自分で用意したRelayを使います。直接接続だけを使う場合は、URLを空にしてください。",
  "Connection: Relay": "接続の経路: Relay",
  "Connection: Direct": "接続の経路: 直接",
  "Could not save Relay settings. Check the URL and token, then save again.":
    "Relayの設定を保存できませんでした。URLとトークンを確認してから、もう一度お試しください。",
  "Changes to these settings have not been saved.":
    "この設定の変更は保存されていません。",
  "Could not change the automation. Retry.":
    "有効・無効を切り替えられませんでした。もう一度お試しください。",
  Workspace: "ワークスペース",
  "Workspace settings…": "ワークスペースの設定…",
  "No workspaces are open on this Host.":
    "このHostで開いているワークスペースはありません。",
  "This workspace is not a Git repository, so there are no Git settings.":
    "このワークスペースはGitリポジトリではないため、Gitの設定はありません。",
  "Could not verify": "確認できません",
  "Checking website…": "Webサイトを確認中",
  "Website URL": "WebサイトのURL",
  "Remotes and websites": "リモートとWebサイト",
  "GitHub account": "GitHubのアカウント",
  Automatic: "自動",
  "Automatic ({account})": "自動（{account}）",
  "Active account": "アクティブなアカウント",
  "gh was not found.": "ghが見つかりません。",
  Integrations: "連携",
  "This Host uses its gh login.": "このHostのghのログイン情報を使います。",
  "Register a token for each site to also read private repositories and Issues.":
    "非公開のリポジトリとIssueを表示するには、サイトごとにトークンを登録してください。",
  "No sites yet.": "サイトはまだありません。",
  "Cannot connect ({time})": "接続できません（{time}）",
  "The site does not accept the token": "トークンが無効です",
  "The token does not have the {scope} permission":
    "トークンに{scope}の権限がありません",
  "The token does not have enough permissions":
    "トークンの権限が不足しています",
  "This Host's gh is not signed in to GitHub. Run gh auth login in a Terminal on this Host.":
    "このHostのghはGitHubにログインしていません。このHostのTerminalでgh auth loginを実行してください。",
  "No token is registered for {site}.":
    "{site}のトークンが登録されていません。",
  "{site} does not accept the token.": "{site}のトークンが無効です。",
  "GitHub does not accept this Host's gh sign-in.":
    "このHostのghのGitHubへのログインが無効です。",
  "No GitHub account on this Host can read this repository.":
    "このリポジトリにアクセスできるGitHubアカウントが、このHostにありません。",
  "The token does not have the {scope} permission.":
    "トークンに{scope}の権限がありません。",
  "The token does not have enough permissions.":
    "トークンの権限が不足しています。",
  "The repository {repository} was not found.":
    "リポジトリ{repository}が見つかりません。",
  "The repository was not found.": "リポジトリが見つかりません。",
  "Cannot connect to {site}.": "{site}に接続できません。",
  "{site} has reached its API rate limit.":
    "{site}のAPIの利用回数の上限に達しました。",
  "{site} has reached its API rate limit. You can read again at {time}.":
    "{site}のAPIの利用回数の上限に達しました。{time}以降にもう一度お試しください。",
  "Open Integrations": "連携を開く",
  "Open workspace settings": "ワークスペースの設定を開く",
  "Registered as {account}": "{account}として登録済み",
  Registered: "登録済み",
  "Not registered · reading public repositories only":
    "未登録 · 公開のリポジトリだけを読み込みます",
  "Register token": "トークンを登録",
  "Replace token": "トークンを変更",
  "Save token": "登録",
  "Add site": "サイトを追加",
  "Site URL": "サイトのURL",
  "Token for the site to add": "追加するサイトのトークン",
  "Enter a token with the read:repository and read:issue permissions. Add read:user to show the account name and to run automations from issues, and write:repository to let agents create pull requests.":
    "read:repositoryとread:issueの権限を持つトークンを入力してください。アカウント名の表示とIssueからのAutomationの実行にはread:userを、AgentにPRを作成させるにはwrite:repositoryも追加してください。",
  "This Host can't use Credential Manager, so the token is saved in a file in the Host's data folder that only this user can read.":
    "このHostでは資格情報マネージャーを使えないため、トークンはHostのデータフォルダー内の、このユーザーだけが読み取れるファイルに保存します。",
  "This Host has no keyring, so the token is saved in a file in the Host's data folder that only this user can read.":
    "このHostではキーリングを使えないため、トークンはHostのデータフォルダー内の、このユーザーだけが読み取れるファイルに保存します。",
  "This Host can't use Credential Manager or a keyring, so the token is saved in a file in the Host's data folder that only this user can read.":
    "このHostでは資格情報マネージャーやキーリングを使えないため、トークンはHostのデータフォルダー内の、このユーザーだけが読み取れるファイルに保存します。",
  "With an http site, the token travels over the network without encryption.":
    "httpのサイトでは、トークンが暗号化されずに送信されます。",
  "The site did not respond as Forgejo or Gitea. Check the URL.":
    "ForgejoまたはGiteaのサイトとして認識できませんでした。URLを確認してください。",
  "The site did not accept this token.": "このトークンは無効です。",
  "Could not connect to the site.": "サイトに接続できませんでした。",
  "The token contains characters that cannot be used.":
    "トークンに使えない文字が含まれています。",
  "Enter a token.": "トークンを入力してください。",
  "Credential Manager did not accept the token, so it is kept in a file in the Host's data folder that only this user can read.":
    "資格情報マネージャーに保存できなかったため、トークンはHostのデータフォルダー内の、このユーザーだけが読み取れるファイルに保存しました。",
  "The keyring did not accept the token, so it is kept in a file in the Host's data folder that only this user can read.":
    "キーリングに保存できなかったため、トークンはHostのデータフォルダー内の、このユーザーだけが読み取れるファイルに保存しました。",
  "Credential Manager or the keyring did not accept the token, so it is kept in a file in the Host's data folder that only this user can read.":
    "資格情報マネージャーやキーリングに保存できなかったため、トークンはHostのデータフォルダー内の、このユーザーだけが読み取れるファイルに保存しました。",
  "Could not save. Press the button or Enter to retry.":
    "保存できませんでした。もう一度お試しください。",
  "Could not check the site. Retry.":
    "サイトを確認できませんでした。もう一度お試しください。",
  "Could not remove the token. Retry.":
    "トークンを削除できませんでした。もう一度お試しください。",
  "Remove the token for {site}?": "{site}のトークンを削除しますか？",
  "This removes the token for {site} from this Host. Private repositories and Issues can no longer be read. The token itself stays usable until you revoke it on the site.":
    "このHostから{site}のトークンを削除します。非公開のリポジトリとIssueは表示できなくなります。トークン自体は、サイトで無効にするまで使用できます。",
  "Run gh auth login in a Terminal on this Host.":
    "このHostのTerminalでgh auth loginを実行してください。",
  "Use gh auth switch in a Terminal on this Host to change the active account.":
    "このHostのTerminalでgh auth switchを実行して、アクティブなアカウントを切り替えてください。",
  "Other workspaces using {host}{workspaces} use the same URL.":
    "「{host}」を使うほかのワークスペース{workspaces}にも同じURLを使います。",
  "Enter an http or https URL.": "httpまたはhttpsのURLを入力してください。",
  "Could not save. Press Save or Enter to retry.":
    "保存できませんでした。もう一度お試しください。",
  "Could not save the account. Choose it again to retry.":
    "アカウントを保存できませんでした。アカウントをもう一度選択してください。",
  "Could not save settings. Choose it again to retry.":
    "設定を保存できませんでした。項目をもう一度選択してください。",
  "Terminal font": "Terminalのフォント",
  "Font name": "フォントの名前",
  "To use several fonts, separate them with commas. The first font installed on this device is used; if the field is empty or none are installed, the default font is used.":
    "複数を指定するときは、カンマで区切ってください。このデバイスにある最初のフォントを使い、空のときやどれもないときは既定のフォントを使います。",
  "Settings saved": "保存しました",
  "Show PR and CI status": "PR・CIの状態を表示",
  "CI passed": "CI成功",
  "CI failed": "CI失敗",
  "CI running": "CI実行中",
  "Pull request #{number} open": "PR #{number} Open",
  "Pull request #{number} draft": "PR #{number} Draft",
  "Pull request #{number} merged": "PR #{number} Merged",
  "Pull request #{number} closed": "PR #{number} Closed",
  "Fetch failed. Merged worktrees are checked against local references, which may be out of date.":
    "fetchできませんでした。Mergedの表示が最新でない可能性があります。",
  "Connection lost. Check the sidebar and delete the worktree again if it remains.":
    "接続が切断されました。サイドバーにworktreeが残っている場合は、もう一度削除してください。",
  "A program has files open in this worktree. Close it and retry deleting the worktree.":
    "このworktreeのファイルを開いているプログラムがあります。プログラムを閉じてから、もう一度お試しください。",
  "Could not stop a Terminal.":
    "Terminalを停止できませんでした。もう一度お試しください。",
  "A child worktree could not be removed. Retry after resolving its error.":
    "子のworktreeを削除できませんでした。表示されたエラーを解決してから、もう一度お試しください。",
  "Could not delete the worktree.":
    "worktreeを削除できませんでした。もう一度お試しください。",
  "Delete worktree": "worktreeを削除",
  "Delete merged worktrees": "Mergedのworktreeを削除",
  "Delete merged worktrees…": "Mergedのworktreeを削除…",
  "{name} will be deleted.": "{name}を削除します。",
  "Uncommitted changes will be lost": "未commitの変更は削除されます",
  "Commits not on any branch will be lost":
    "どのブランチにもないcommitは削除されます",
  "1 file": "1ファイル",
  "{count} files": "{count}ファイル",
  "Work in progress will be stopped": "実行中の作業を停止します",
  "Branches with commits not in {target}": "{target}にないcommitがあるブランチ",
  "1 commit": "1件のcommit",
  "{count} commits": "{count}件のcommit",
  "Also delete the branch": "ブランチも削除する",
  "1 commit will be lost.": "1件のcommitが削除されます。",
  "{count} commits will be lost.": "{count}件のcommitが削除されます。",
  "{count} worktrees will be deleted.": "{count}件のworktreeを削除します。",
  "Fetching and checking worktrees…": "worktreeを確認中",
  "No merged worktrees to delete.": "削除できるMergedのworktreeはありません。",
  "Could not load worktrees. Check Git and retry.":
    "worktreeを読み込めませんでした。Gitの状態を確認してから、もう一度お試しください。",
  "Some worktrees could not be deleted. Review the result and retry.":
    "削除できなかったworktreeがあります。結果を確認してから、もう一度お試しください。",
  Deleted: "削除済み",
  "Not deleted": "未削除",
  "Git refused removal. Check whether the worktree is locked or files are open, then retry.":
    "Gitでworktreeを削除できませんでした。worktreeがロックされていないか、ファイルが開かれていないかを確認してから、もう一度お試しください。",
  "The worktree was removed, but Git could not delete its branch.":
    "worktreeは削除しましたが、ブランチを削除できませんでした。",

  Home: "ホーム",
  "Host settings": "Hostの設定",
  Start: "開始",
  "Create worktree": "作成",
  "New worktree": "worktreeを作成",
  "Start CLI or team": "CLI・Teamを開始",
  "Name (optional)": "名前（任意）",
  "Base branch": "ベースブランチ",
  "Command to run after creating a worktree":
    "worktree作成後に実行するコマンド",
  "Run again": "再実行",
  "Start anyway": "このまま開始",
  "Setup command failed (exit {code})":
    "作成後のコマンドが失敗しました（終了コード{code}）",
  "Setup command was interrupted": "作成後のコマンドが中断されました",
  "CLI or team": "CLI・Team",
  "First instruction (optional)": "最初の指示（任意）",
  "Work on Issue #{number}. Read its body and comments with `iori issue show {number}`.":
    "Issue #{number} を進めてください。本文とコメントは `iori issue show {number}` で読めます。",
  "Here (without a worktree)": "この場所で（worktreeを作成しない）",
  "Check creation result": "作成結果を確認する",
  "Could not load choices. Retry.":
    "候補を読み込めませんでした。もう一度お試しください。",
  "That branch or folder already exists. Choose another name.":
    "同じ名前のブランチまたはフォルダーが既にあります。名前を変更してください。",
  "This name cannot be used for a branch. Choose another name.":
    "この名前はブランチに使えません。名前を変更してください。",
  "Could not create the worktree. Check the repository and try again.":
    "worktreeを作成できませんでした。リポジトリを確認して、もう一度お試しください。",
  "Could not start the CLI or team. Check its settings and try again.":
    "CLI・Teamを開始できませんでした。設定を確認して、もう一度お試しください。",
  Details: "詳細",
  "Jump to latest": "最新へ",
  ", ": "、",
  ...teamJapanese,
  "Could not remove this Host from the list. Retry.":
    "Hostを一覧から削除できませんでした。もう一度お試しください。",
  "Terminals and agents": "TerminalとAgent",
  "Could not prepare the uninstall request":
    "アンインストールを準備できませんでした",
  "Could not save uninstall progress":
    "アンインストールの進行状況を保存できませんでした",
  "CLI hooks": "CLI hooks",
  "iori Host is being uninstalled. Wait for it to finish.":
    "iori Hostをアンインストール中です。完了までお待ちください。",
  "Remove from list": "一覧から削除",
  "Could not stop these processes:": "停止できなかったプロセス:",
  "Remove “{name}” from the list?": "「{name}」を一覧から削除しますか？",
  "This removes only this Client’s list entry and connection information. Device registrations, data and programs on the Host stay unchanged. To use this Host again, connect with an invitation.":
    "このClientの一覧と接続情報だけを削除します。Hostに登録したデバイス・データ・プログラムはそのまま残ります。このHostをまた使うときは、招待で接続してください。",
  "Uninstall requested": "アンインストールを開始しました",
  Connecting: "接続中",
  Checking: "確認中",
  "Passphrase for {key}": "{key}のパスフレーズ",
  "Uninstall iori Host": "iori Hostをアンインストール",
  "Also delete iori Host saved data": "iori Hostの保存データも削除する",
  Uninstall: "アンインストールする",
  "Could not uninstall iori Host":
    "iori Hostをアンインストールできませんでした",
  "iori Host uninstalled": "iori Hostをアンインストールしました",
  "Uninstalling iori Host": "iori Hostをアンインストール中",
  "Could not finish uninstalling iori Host. Check the failed step, then retry.":
    "iori Hostのアンインストールを完了できませんでした。失敗した処理を確認して、もう一度お試しください。",
  "Stopping Terminals and agents": "TerminalとAgentを停止中",
  "Removing iori CLI hooks": "CLIの設定からioriの項目を削除中",
  "Removing automatic startup": "自動起動の登録を解除中",
  "Removing iori Host program files": "iori Hostのプログラムを削除中",
  "Removing iori Host saved data": "iori Hostの保存データを削除中",
  Command: "コマンド",
  "Host did not respond": "Hostから応答がありませんでした",
  "Host closed the connection without a response":
    "Hostが応答せずに接続を切断しました",
  "SSH connection closed": "SSH接続が切断されました",
  "Invalid release SHA-256":
    "iori Hostのダウンロード情報を確認できませんでした。もう一度お試しください。",
  "Release version does not match this Client":
    "ダウンロードするiori HostのバージョンがこのClientと一致しません。もう一度お試しください。",
  "Missing Linux Host release":
    "Linux用のiori Hostが見つかりませんでした。もう一度お試しください。",
  "Invalid response from the SSH destination":
    "SSHの接続先から正しい応答を受け取れませんでした。もう一度お試しください。",
  "Missing SSH destination information":
    "SSHの接続先を確認できませんでした。もう一度お試しください。",
  "Invalid SSH destination information":
    "SSHの接続先を確認できませんでした。もう一度お試しください。",
  "Cancel the previous SSH connection first":
    "前のSSH接続をキャンセルしてから、もう一度お試しください。",
  "Could not find the user profile":
    "ユーザーのホームフォルダーが見つかりません。",
  "Could not open the SSH input stream":
    "SSHで通信できませんでした。もう一度お試しください。",
  "Could not open the SSH output stream":
    "SSHで通信できませんでした。もう一度お試しください。",
  "Could not open the SSH error stream":
    "SSHで通信できませんでした。もう一度お試しください。",

  Change: "変更",
  Connect: "接続する",
  "Another machine (SSH)": "別のマシン（SSH）",
  "SSH destination": "接続先",
  "Filter SSH destinations": "接続先を絞り込む",
  "Enter manually…": "手動で指定する…",
  "SSH response": "SSHの確認への回答",
  Cancelling: "キャンセル中",
  Allow: "許可する",
  Cancelled: "キャンセルしました",
  "OpenSSH Client was not found. Install OpenSSH Client and try again.":
    "OpenSSH クライアントが見つかりません。OpenSSH クライアントをインストールして、もう一度お試しください。",
  "OpenSSH Client was not found. Add OpenSSH Client in Windows Settings → Optional features.":
    "OpenSSH クライアントが見つかりません。Windowsの設定の「オプション機能」から「OpenSSH クライアント」を追加してください。",
  "Enter [user@]host or ssh://[user@]host[:port].":
    "[user@]hostまたはssh://[user@]host[:port]の形で入力してください。",
  "Set up iori Host": "iori Hostをセットアップする",
  "Connect with an invitation": "招待で接続する",
  "Add iori Host": "iori Hostを追加する",
  Destination: "インストール先",
  "Register with this iori Host": "このiori Hostに登録する",
  Install: "インストールする",
  "Register this device with the existing iori Host without reinstalling it.":
    "再インストールせずに、このデバイスをこのiori Hostに登録します。",
  "Allow connections from other devices": "ほかのデバイスからの接続を許可する",
  "Windows will ask for administrator approval to allow other devices to connect.":
    "ほかのデバイスからの接続を許可すると、「ユーザー アカウント制御」の確認画面が表示されます。",
  "This PC can connect. To connect from other devices, select “Allow connections from other devices” in Connection settings.":
    "この PCからは接続できます。ほかのデバイスから接続するには、設定の「接続」で「ほかのデバイスからの接続を許可する」を押してください。",
  "Connections from other devices are allowed":
    "ほかのデバイスからの接続は許可済みです",
  "Could not allow connections. This PC can connect. To connect from other devices, select “Allow connections from other devices” in Connection settings.":
    "接続を許可できませんでした。この PCからは接続できます。ほかのデバイスから接続するには、設定の「接続」で「ほかのデバイスからの接続を許可する」を押してください。",
  "Could not download iori Host. Check the connection and retry.":
    "iori Hostをダウンロードできませんでした。接続を確認して、もう一度お試しください。",
  "Could not verify iori Host. Retry downloading.":
    "iori Hostを検証できませんでした。もう一度ダウンロードしてください。",
  "Could not install or start iori Host. Retry the installation.":
    "iori Hostをインストールまたは起動できませんでした。もう一度インストールしてください。",
  "Could not request an invitation from this PC’s Host. Check that it is running and retry.":
    "この PCのHostから招待を取得できませんでした。Hostが起動していることを確認して、もう一度お試しください。",
  "Could not complete registration. Retry registration.":
    "登録を完了できませんでした。もう一度登録してください。",
  "Choose how to add iori Host.": "iori Hostの追加方法を選んでください。",
  "Checking iori Host on this PC": "このPCのiori Hostを確認中",

  Version: "バージョン",
  "Downloading the Host update": "ダウンロード中",
  "Extracting the Host update": "展開中",
  "Preparing the Host update": "更新を準備中",
  "Stopping iori Host": "iori Hostを停止中",
  "Backing up iori Host": "iori Hostをバックアップ中",
  "Replacing iori Host": "iori Hostを入れ替え中",
  "Starting iori Host": "iori Hostを起動中",
  "Restoring iori Host": "iori Hostを復元中",
  "Update to": "更新先のバージョン",
  "Update iori Host": "iori Hostを更新",
  "This iori Host is not running as a service. Uninstall it on the Host machine.":
    "このiori Hostはサービスとして実行されていません。Hostのマシンでアンインストールしてください。",
  "Sort ascending": "昇順に並べ替える",
  "Sort descending": "降順に並べ替える",
  "Restart iori Host": "iori Hostを再起動",
  "Open Client updates": "Clientの更新欄を開く",
  "Preparing confirmation": "準備中",
  Update: "更新する",
  Restart: "再起動する",
  "{name} will be restarted.": "{name}を再起動します。",
  "{name} will be updated from {from} to {to}.":
    "{name}を{from}から{to}に更新します。",
  "All open CLIs and Terminals will stop. CLI conversations can be resumed later.":
    "開いているCLIとTerminalはすべて停止します。CLIの会話は後で再開できます。",
  "All open CLIs and Terminals will stop.":
    "開いているCLIとTerminalはすべて停止します。",
  "Work that will be interrupted": "中断される作業",
  "Stop and restart": "停止して再起動する",
  "Stop and update": "停止して更新する",
  "Stop and uninstall": "停止してアンインストールする",
  "Could not update iori Host": "iori Hostを更新できませんでした",
  "Could not restart iori Host": "iori Hostを再起動できませんでした",
  "iori Host updated": "iori Hostを更新しました",
  "iori Host restarted": "iori Hostを再起動しました",
  "Updating iori Host": "iori Hostを更新中",
  "Restarting iori Host": "iori Hostを再起動中",
  "This iori Host is not running as a service. Start it using the installation script to update or restart it here.":
    "このiori Hostはサービスとして実行されていないため、ここから更新・再起動できません。Hostのマシンでインストールスクリプトを実行して起動してください。",
  "The Host could not reach the release source. Retry, or run the installation script on the Host machine.":
    "Hostが配布元に接続できませんでした。もう一度お試しください。または、Hostのマシンでインストールスクリプトを実行して更新してください。",
  "The Host update could not be verified. Retry the update.":
    "Hostの更新を検証できませんでした。もう一度更新してください。",
  "The Host update process exited without leaving a result. Retry the update.":
    "Hostの更新結果を確認できませんでした。もう一度更新してください。",
  "The Host could not download the update. Retry the update.":
    "Hostが更新をダウンロードできませんでした。もう一度更新してください。",
  "The new version of iori Host could not start, so iori Host was returned to the previous version. Saved data is unchanged.":
    "新しいバージョンのiori Hostを起動できなかったため、前のバージョンに戻しました。保存データは変わっていません。",
  "The previous iori Host could not start. Check the service on the Host machine, then reconnect.":
    "前のバージョンのiori Hostも起動できませんでした。Hostのマシンでサービスの状態を確認してから、再接続してください。",
  "The saved data could not be restored. Check the Host and its backup on the Host machine before retrying.":
    "保存データを復元できませんでした。HostのマシンでHostとバックアップの状態を確認してから、もう一度更新してください。",
  "The Host update could not be installed. Check the service on the Host machine, then retry.":
    "Hostの更新をインストールできませんでした。Hostのマシンでサービスの状態を確認して、もう一度お試しください。",
  "Could not restart iori Host. On the iori Host's machine, check that iori Host is running, then try again.":
    "iori Hostを再起動できませんでした。iori Hostのマシンでiori Hostが実行されていることを確認して、もう一度お試しください。",
  "This Host is newer than this Client. Update the Client in General settings.":
    "Hostの方が新しいバージョンです。「一般」の更新欄でClientを更新してください。",
  "Running Terminals will stop, and work in progress will be lost.":
    "実行中のTerminalは停止し、途中の処理は失われます。",
  "The Host has not reconnected yet. You can keep waiting, or check the service on the Host machine.":
    "Hostにまだ再接続していません。このまま待つか、Hostのマシンでサービスの状態を確認してください。",

  "Update available": "更新があります",
  Updates: "更新",
  "Receive development versions": "開発バージョンを受け取る",
  "Also update to versions that are still being tested.":
    "テスト中のバージョンにも更新します。",
  "The update could not be verified. Try checking for updates again.":
    "更新を検証できませんでした。もう一度更新を確認してください。",
  "Current version": "現在のバージョン",
  "New version": "新しいバージョン",
  "Release notes": "変更内容",
  "Check for updates": "更新を確認",
  "Also update connected iori Hosts ({count})":
    "接続中のiori Hostも更新する（{count}台）",
  "Restart to update": "再起動して更新",
  "Updating asks for administrator approval.":
    "更新には管理者の承認が必要です。",
  "Cannot update the AppImage in this location. Move it to a folder you can write to, then open it again.":
    "この場所のAppImageは更新できません。書き込み可能なフォルダーへ移動してから、もう一度開いてください。",
  "Cannot store iori's key in the system keyring (Secret Service). Turn on a keyring such as GNOME Keyring or KWallet, then open iori again.":
    "ioriの鍵をOSのキーリング（Secret Service）に保存できません。GNOME KeyringやKWalletなどのキーリングを有効にしてから、ioriをもう一度開いてください。",
  "Unlocking the keyring was cancelled. You can try again.":
    "キーリングのロック解除をキャンセルしました。もう一度お試しください。",
  "To use iori on this device again, reset its registration. You will need to register with each Host again from its invitation.":
    "このデバイスでioriをもう一度使うには、登録をリセットしてください。各Hostには、招待からもう一度登録する必要があります。",
  "Reset registration…": "登録をリセット…",
  "Cannot read iori's key on this device.":
    "このデバイスのioriの鍵を読み込めません。",
  "Reset this device's registration?": "このデバイスの登録をリセットしますか？",
  "This deletes the list of Hosts and the settings saved on this device. To connect to a Host, register again from its invitation.":
    "このデバイスに保存したHostの一覧と設定を削除します。Hostに接続するには、招待からもう一度登録してください。",
  Reset: "リセット",
  "Could not reset this device's registration. Reset it again.":
    "このデバイスの登録をリセットできませんでした。もう一度リセットしてください。",
  "Cannot read iori's key from the system keyring.":
    "OSのキーリングからioriの鍵を読み込めません。",
  "Retry download": "ダウンロードを再試行",
  "Download and install": "ダウンロードしてインストール",
  "Downloading update": "ダウンロード中",
  "Installing update": "インストール中",
  "Installation cancelled. You can try again.":
    "インストールをキャンセルしました。もう一度お試しください。",
  "Continue installation": "インストールを続ける",
  "You are up to date": "最新のバージョンです",
  "Allow apps from this source in Android settings, then return to continue.":
    "Androidの設定で「この提供元のアプリを許可」をオンにして、ioriへ戻ってください。",
  "Could not reach the update source. Check your connection and try again.":
    "配布元に接続できませんでした。接続を確認して、もう一度お試しください。",
  "Could not download the update. Try again.":
    "更新をダウンロードできませんでした。もう一度お試しください。",
  "Could not install the update. Try again.":
    "更新をインストールできませんでした。もう一度お試しください。",

  Open: "開く",
  Reopen: "もう一度開く",
  "Could not display this terminal. Reopen it to continue.":
    "Terminalを表示できませんでした。もう一度開いてください。",
  Exit: "終了",
  "The CLI has exited": "CLIが終了しました",
  "Could not resume the CLI. Retry.":
    "CLIを再開できませんでした。もう一度お試しください。",
  Resume: "再開",
  "The CLI was interrupted": "CLIが中断されました",
  "Could not load teams. Retry.":
    "Teamを読み込めませんでした。もう一度お試しください。",
  "Could not start the team. Check its parent CLI settings and try again.":
    "Teamを開始できませんでした。親のCLI設定を確認して、もう一度お試しください。",
  "Could not configure notifications. Retry in notification settings.":
    "通知を設定できませんでした。設定の「通知」でもう一度お試しください。",
  "iori receives notifications from connected Hosts.":
    "接続中のHostから通知を受け取ります。",
  "Connected in the background": "バックグラウンドで接続中",
  "Allow only while using the app": "アプリの使用中だけ許可",
  "Allow and keep connected": "許可して接続を維持",
  "To receive notifications while the app is in the background, keep the connection active. This shows one persistent notification and uses battery.":
    "アプリがバックグラウンドにあるときも通知を受け取るには、バックグラウンドで接続を維持してください。通知が常に1件表示され、バッテリーを消費します。",
  "Receive notifications": "通知を受け取る",
  "Allow OS notifications": "OSの通知を許可",
  "Background connection shows a persistent notification and uses battery. When it is off or notifications are denied, return to the app to check pending decisions.":
    "通知が常に1件表示され、バッテリーを消費します。オフの場合や通知を拒否した場合は、アプリを開いてAttentionを確認してください。",
  "Keep connected in the background": "バックグラウンドで接続を維持",
  "Waiting for approval": "承認待ち",
  "Completion notifications": "完了の通知",
  "Attention notifications": "Attentionの通知",
  "No remotes. Add a remote in a Terminal.":
    "リモートはありません。Terminalでリモートを追加してください。",
  "Needs input": "入力待ち",
  Failed: "失敗",
  "Exit when the window closes": "ウィンドウを閉じたら終了する",
  Notifications: "通知",
  General: "一般",
  Attention: "Attention",
  Idle: "待機中",
  Done: "完了",
  Stopped: "停止",
  "No decisions waiting.": "Attentionはありません。",
  "No open team conversations.": "開いているTeamの会話はありません。",
  "No agents running.": "実行中のAgentはありません。",
  Teams: "Teams",
  "No teams yet": "Teamはまだありません",
  "AI Agents": "AI Agents",
  "Add CLI": "CLIを追加",
  Name: "名前",
  "Launch command": "起動コマンド",
  "Could not load CLIs. Retry.":
    "CLIの一覧を読み込めませんでした。もう一度お試しください。",

  Keyboard: "キーボード",
  "Key band": "キーバー",
  "Show button names": "ボタンの名前を表示",
  Live: "直接",
  Batch: "まとめて",
  Phone: "スマートフォンの幅",
  Desktop: "PCの幅",
  "Swipe up": "上スワイプ",
  "Swipe up on a key to send its assigned key.":
    "キーを上にスワイプして、割り当てたキーを送信してください。",
  "Reset to defaults": "既定に戻す",
  "Drag to reorder": "ドラッグして並べ替え",
  Remove: "削除",
  "Add a key": "キーを追加",
  Key: "キー",
  "Special key": "特殊キー",
  "Typed character": "文字を入力",
  Modifiers: "修飾キー",
  Text: "文字列",
  "Send Enter": "最後にEnterを送信",
  Add: "追加",
  "Enter one key or one text string.":
    "キーか文字列のどちらか1つを入力してください。",
  "This key cannot be sent to a terminal.":
    "このキーはTerminalに送信できません。",
  "Close tab": "タブを閉じる",
  "Close pane": "ペインを閉じる",
  "Show key": "キーを表示",
  "Hide key": "キーを非表示",
  "Collapse {name}": "{name}を折りたたむ",
  "Expand {name}": "{name}を展開",
  "Start in {name}": "{name}で開始",
  "New tab": "新しいタブ",
  "Resize sidebar": "サイドバーの幅を変更",
  "Toggle sidebar": "サイドバーの表示を切り替える",
  "Select a worktree in the sidebar.":
    "サイドバーからworktreeを選んでください。",
  "Open a folder from the sidebar.":
    "サイドバーからフォルダーを開いてください。",
  "No shells on this Host": "このHostで使えるシェルはありません。",
  "Discard invitation input?": "入力した招待を破棄しますか？",
  "Your invitation input will be cleared.":
    "入力した招待の文字列は消去されます。",
  "Keep editing": "編集を続ける",
  Discard: "破棄する",
  "Connect to a Host": "Hostに接続する",
  "Use an invitation from iori-host invite on the Host or Devices → Invite a new device on a registered device.":
    "Hostでiori-host inviteを実行するか、登録済みのデバイスで「デバイス」→「新しいデバイスを招待する」を選んで招待を発行し、下に貼り付けてください。",
  Invitation: "招待の文字列",
  "Enlarge QR code": "QRコードを拡大",
  Continue: "次へ",
  "Scan QR code": "QRコードを読み取る",
  "Confirm registration": "登録の確認",
  Host: "Host",
  Address: "接続先",
  "This device’s name": "このデバイスの名前",
  Register: "登録する",
  Back: "戻る",
  Connected: "Connected",
  "Reconnecting…": "再接続中",
  Reconnect: "再接続",
  Devices: "デバイス",
  Connection: "接続",
  "This device": "このデバイス",
  New: "新規",
  "Invite a new device": "新しいデバイスを招待する",
  "Valid for 10 minutes. Can be used once.": "10分間・1回だけ使えます。",
  "Creating a new invitation invalidates the previous one.":
    "新しく発行すると、それまでの招待は使えなくなります。",
  "This invitation has expired.": "招待の期限が切れました。",
  "This invitation was invalidated by a newer invitation.":
    "新しい招待が発行されたため、この招待は使えなくなりました。",
  "Create a new invitation": "新しい招待を発行する",
  "Copy invitation": "招待をコピー",
  Webhook: "Webhook",
  Issue: "Issue",
  "Run from issues": "Issueから実行する",
  "Runs each open issue labeled by this Host's account, one at a time, in a new worktree per issue.":
    "このHostのアカウントがラベルを付けたOpenのIssueごとに、新しいworktreeでAutomationを1件ずつ実行します。",
  Label: "ラベル",
  "This folder's repository has no known forge.":
    "このフォルダーのリポジトリのForgeがわかりません。",
  "Could not read the issues for this automation.":
    "このAutomationのIssueを読み込めませんでした。",
  "Run from webhook": "Webhookで実行する",
  "Accept from": "受信元",
  "LAN and VPN": "LAN・VPN",
  "This machine only": "このマシンだけ",
  URL: "URL",
  Token: "トークン",
  "Regenerate token": "トークンを再生成",
  "Regenerate the token?": "トークンを再生成しますか？",
  "The current token will stop working.": "現在のトークンは使えなくなります。",
  Regenerate: "再生成",
  "curl example": "curlの例",
  "Save to create the URL and token.":
    "保存してください。URLとトークンが作成されます。",
  "If the CLI permission skips approvals, the agent can run commands without approval after reading what was received.":
    "CLIの許可の設定で承認を省略している場合、受信した内容を読み込んだAgentが承認なしでコマンドを実行する可能性があります。",
  "Webhooks are not being accepted because port {port} could not be opened.":
    "ポート{port}を使えないため、Webhookを受信できません。",
  From: "送信元",
  "Not run yet.": "まだ実行していません。",
  "Received content": "受信した内容",
  "Received at": "受信日時",
  Query: "クエリ",
  Headers: "ヘッダー",
  Body: "本文",
  "Could not copy. Select the text and copy it.":
    "コピーできませんでした。文字を選んでコピーしてください。",
  Copied: "コピーしました",
  Close: "閉じる",
  "Revoke registration": "登録を解除",
  "Could not revoke this registration. Retry.":
    "登録を解除できませんでした。もう一度お試しください。",
  Revoke: "解除",
  Cancel: "キャンセル",
  "This device will no longer connect to this Host. Files and work on the Host, and data on this device, are not deleted.":
    "このデバイスからこのHostに接続できなくなります。Hostのファイルと作業、このデバイスに残っているデータは削除されません。",
  "This device’s registration was revoked.":
    "このデバイスの登録は解除されました。",
  "Get a new invitation and register again.":
    "新しい招待を取得して、再登録してください。",
  "Register again": "再登録",
  "Check the invitation and paste it again.":
    "招待の文字列を確認して、もう一度貼り付けてください。",
  "This invitation cannot be used. Create a new invitation on the Host.":
    "この招待は使えません。Hostで新しい招待を発行してください。",
  "Could not reach the Host. Retry with this invitation or check that the Host is running.":
    "Hostに接続できませんでした。Hostが起動していることを確認して、もう一度お試しください。",
  "Could not save the registration. Retry saving.":
    "登録を保存できませんでした。もう一度お試しください。",
  "Could not load this device’s key and registrations. Retry.":
    "このデバイスの鍵と登録を読み込めませんでした。もう一度お試しください。",
  "The Host could not complete this operation. Retry.":
    "Hostが操作を完了できませんでした。もう一度お試しください。",
  "The Host could not read this request. Retry.":
    "Hostで操作を処理できませんでした。もう一度お試しください。",
  "Could not read the QR code. Paste the invitation instead.":
    "QRコードを読み取れませんでした。招待の文字列を貼り付けてください。",
  "Could not copy. Select and copy the invitation below.":
    "コピーできませんでした。下の招待の文字列を選んでコピーしてください。",
  Retry: "再試行",
  "Retry saving": "保存を再試行",
  Save: "保存",
  "IP address or name, including port. One address per line.":
    "IPアドレスまたは名前とポートを、1行に1つ入力してください。",
  "Enter an address and port.": "接続先とポートを入力してください。",
  "Example: my-host:49171": "例: my-host:49171",
  "Could not create a terminal. Check the folder and try again.":
    "Terminalを作成できませんでした。フォルダーを確認して、もう一度お試しください。",
  Running: "実行中",
  "Running {command}": "{command}を実行中",
  Exited: "Exited",
  "Close terminal": "Terminalを閉じる",
  "Could not close this terminal. Choose Close terminal again.":
    "Terminalを閉じられませんでした。もう一度「Terminalを閉じる」を選択してください。",
  "The previous shell ended when the Host restarted. A new shell will start when this terminal is opened.":
    "Hostの再起動時にシェルが終了しました。このTerminalを開くと新しいシェルが起動します。",
  "Search terminal output": "Terminal内を検索",
  "Case sensitive": "大文字と小文字を区別",
  "Previous match": "前の一致項目",
  "Next match": "次の一致項目",
  "Opening terminal…": "Terminalを起動中",
  "Could not open this terminal. Refresh the list to check its state.":
    "Terminalを開けませんでした。一覧を更新して状態を確認してください。",
  "Could not reopen this terminal. Refresh the list to check its state.":
    "Terminalを開き直せませんでした。一覧を更新して状態を確認してください。",
  "Could not listen for terminal updates.":
    "Terminalの更新を受け取れませんでした。",
  "Input could not be sent. Check the connection before continuing.":
    "入力を送信できませんでした。接続を確認してください。",
  "Could not copy terminal selection.":
    "選択した文字をコピーできませんでした。",
  "Could not send the image.": "画像を送信できませんでした。",
  "Could not read the clipboard.": "クリップボードを読み取れませんでした。",
  "Could not open this link.": "リンクを開けませんでした。",
  "Exited with code": "終了コード",
  Search: "検索",
  Copy: "コピー",
  Paste: "貼り付け",
  Image: "画像",
  "Terminal actions": "Terminalの操作",
  "Select as text": "テキストとして選択",
  "A command is running": "コマンドを実行中です",
  "{command} is running": "{command}を実行中です",
  "Closing this terminal will stop its process and remove its saved screen.":
    "Terminalを閉じると、実行中の処理が停止し、保存した画面も削除されます。",
  "Expand input": "広げる",
  Input: "入力",
  "Type a command…": "コマンドを入力…",
  Send: "送信",
  "Switch to batch input": "まとめて入力に切り替え",
  "Switch to live input": "直接入力に切り替え",
  "Device width": "スマートフォンの幅",
  "Desktop width": "PCの幅",
  Escape: "Esc",
  "Forward delete": "前方削除",
  "Arrow up": "上矢印",
  "Arrow down": "下矢印",
  "Arrow left": "左矢印",
  "Arrow right": "右矢印",
  Tab: "Tab",
  Enter: "Enter",
  "Shift Tab": "Shift+Tab",
  Space: "Space",
  Backspace: "Backspace",
  "Interrupt terminal": "処理を中断",
  "Send EOF": "EOFを送信",
  "Clear screen": "画面を消去",
  "Suspend process": "処理を一時停止",
  "Reverse search": "後方検索",
  "Start of line": "行頭へ移動",
  "End of line": "行末へ移動",
  "Delete word backward": "前の単語を削除",
  "Clear line before cursor": "カーソルより前を消去",
  "Folder path": "フォルダーのパス",
  "Type a path to find a folder.":
    "パスを入力して、フォルダーを検索してください。",
  "Enter a folder path.": "フォルダーのパスを入力してください。",
  "No matching folders": "一致するフォルダーはありません",
  "Add folder": "フォルダーを追加",
  "Client and Host settings": "ClientとHostの設定",
  "Could not browse Host folders. Retry.":
    "Hostのフォルダーを表示できませんでした。もう一度お試しください。",
  "Could not change the default shell. Choose it again to retry.":
    "既定のシェルを変更できませんでした。シェルをもう一度選択してください。",
  "Could not load settings. Retry.":
    "設定を読み込めませんでした。もう一度お試しください。",
  "Could not load folders. Retry.":
    "フォルダーの履歴を読み込めませんでした。もう一度お試しください。",
  "Could not load shells. Retry.":
    "シェルの一覧を読み込めませんでした。もう一度お試しください。",
  "Could not open this folder. Retry.":
    "このフォルダーを開けませんでした。もう一度お試しください。",
  "Could not remove this folder from the sidebar. Retry.":
    "フォルダーをサイドバーから削除できませんでした。もう一度お試しください。",
  "Could not restore this workspace layout.":
    "ワークスペースの配置を復元できませんでした。",
  "Discard the layout and open": "配置を破棄して開く",
  "Could not save this workspace layout. Retry saving.":
    "ワークスペースの配置を保存できませんでした。もう一度お試しください。",
  "Could not save settings. Retry saving.":
    "設定を保存できませんでした。もう一度お試しください。",
  "Could not update the Host address. Retry saving.":
    "Hostの接続先を更新できませんでした。もう一度お試しください。",
  Icon: "アイコン",
  "Choose an image": "画像を選ぶ",
  "Remove {file}": "{file}を削除",
  "Choose files": "ファイルを選ぶ",
  "Choose one definition JSON file.": "定義のJSONを1つ選んでください。",
  "Choose an SVG or PNG image.": "SVGかPNGの画像を選んでください。",
  "Revert to the bundled icon": "同梱のアイコンに戻す",
  "Revert to the common icon": "共通のアイコンに戻す",
  "Also select these files: {files}": "次のファイルも選んでください: {files}",
  Dark: "ダーク",
  "Default shell": "既定のシェル",
  Disconnected: "未接続",
  Display: "表示",
  "Display language": "表示言語",
  Files: "Files",
  "Full width": "全幅",
  Light: "ライト",
  "Loading available shells": "シェルを読み込み中",
  Maximize: "最大化",
  "Minimize window": "最小化",
  "Maximize window": "最大化",
  "Restore window": "元に戻す",
  "Close window": "閉じる",
  "Double-click a tab to maximize": "タブをダブルクリックで最大化",
  "No shells found": "シェルが見つかりませんでした",
  "No shells were returned by this Host":
    "このHostで使えるシェルはありません。",
  "Open sidebar": "サイドバーを開く",
  "Open tabs": "開いているタブ",
  "Open this folder": "このフォルダーを開く",
  "Opened folder": "開いたフォルダー",
  "Could not reorder folders. Retry.":
    "フォルダーを並べ替えられませんでした。もう一度お試しください。",
  "Picked up.": "移動を開始しました。",
  "Move to this position.": "この位置へ移動します。",
  "Dropped.": "移動しました。",
  "Reordering cancelled.": "並べ替えをキャンセルしました。",
  Reorder: "並べ替え",
  "Remove from sidebar": "サイドバーから削除",
  Repository: "リポジトリ",
  "Restore pane": "最大化を解除",
  "Select a shell": "シェルを選択",
  Settings: "設定",
  "Split below": "下に分割",
  "Split right": "右に分割",
  "System default": "システムの設定に合わせる",
  Terminal: "Terminal",
  Theme: "テーマ",
  "Text size": "文字サイズ",
  "Terminal text size": "Terminalの文字サイズ",
  "Right-click": "右クリック",
  Menu: "メニュー",
  "Copy/paste": "コピー／貼り付け",
  "Open links": "リンクを開く",
  "Links in Terminal and CLI screens": "TerminalとCLIの画面のリンク",
  Click: "クリック",
  "Ctrl+click": "Ctrl+クリック",
  "This PC": "この PC",
  "Use saved width": "保存した幅に戻す",
  "Working directory": "作業ディレクトリ",
  Worktree: "Worktree",
  invalid_request: "入力内容を確認してください。",
  not_registered:
    "このデバイスはHostに登録されていません。招待を使って登録してください。",
  invite_rejected: "この招待は使えません。Hostで新しい招待を発行してください。",
  device_not_found: "デバイスが見つかりません。",
  path_not_found: "フォルダーが見つかりません。",
  not_a_directory: "指定した場所はフォルダーではありません。",
  permission_denied: "フォルダーを読み取る権限がありません。",
  internal_error: "Hostで処理できませんでした。もう一度お試しください。",
  host_uninstalling:
    "iori Hostをアンインストール中です。完了までお待ちください。",
  "Could not connect to the Host.": "Hostに接続できませんでした。",
  "Check that the Host is running.":
    "Hostが起動していることを確認してください。",
  "Could not connect to the Host. Check that the Host is running, then try again.":
    "Hostに接続できませんでした。Hostが起動していることを確認して、もう一度お試しください。",
};
const englishErrors: Record<string, string> = {
  invalid_request: "Check the input and try again.",
  not_registered:
    "This device is not registered with the Host. Register using an invitation.",
  invite_rejected:
    "This invitation cannot be used. Create a new invitation on the Host.",
  device_not_found: "The device was not found.",
  path_not_found: "The folder was not found.",
  not_a_directory: "This location is not a folder.",
  permission_denied: "You do not have permission to read this folder.",
  internal_error: "The Host could not complete this operation. Retry.",
  host_uninstalling: "iori Host is being uninstalled. Wait for it to finish.",
};
export function translator(language: string) {
  return (key: string) =>
    language.toLowerCase().startsWith("ja")
      ? (japanese[key] ?? englishErrors[key] ?? key)
      : (englishErrors[key] ?? key);
}
export function registeredMessage(language: string, name: string) {
  return language.toLowerCase().startsWith("ja")
    ? `${name}を登録しました。`
    : `${name} was registered.`;
}

export function registeredDateMessage(language: string, registeredAt: number) {
  const date = new Intl.DateTimeFormat(language, {
    dateStyle: "medium",
  }).format(registeredAt);
  return language.toLowerCase().startsWith("ja")
    ? `${date}に登録`
    : `Registered ${date}`;
}
