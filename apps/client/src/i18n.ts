import { teamJapanese } from "./teams/translations.ts";
const japanese: Record<string, string> = {
  Status: "状態",
  "Relay URL": "RelayのURL",
  "Relay access token (only if required)":
    "アクセスのtoken（Relayが求める時だけ）",
  "Use a Relay you provide to connect outside your LAN or VPN. Clear the URL to use direct connections only.":
    "LANやVPNで届かない時に、自分で用意したRelayを使います。URLを空にすると、直接接続だけに戻ります。",
  "Connection: Relay": "接続の経路: Relay",
  "Connection: Direct": "接続の経路: 直接",
  "Could not save Relay settings. Check the URL and token, then save again.":
    "Relayの設定を保存できませんでした。URLとtokenを確認し、もう一度保存してください。",
  "Changes to these settings have not been saved.":
    "この設定の変更は保存されていません。",
  "Could not change the automation. Retry.":
    "有効・無効を切り替えられませんでした。もう一度切り替えてください。",
  Workspace: "ワークスペース",
  "Workspace settings…": "ワークスペースの設定…",
  "No workspaces are open on this Host.":
    "このHostで開いているワークスペースはありません。",
  "This workspace is not a Git repository, so there are no Git settings.":
    "このワークスペースはGitリポジトリではないため、Gitの設定はありません。",
  "Could not verify": "確認できません",
  "Checking website…": "Webサイトを確認しています…",
  "Website URL": "WebサイトのURL",
  "Remotes and websites": "remoteとWebサイト",
  "GitHub account": "GitHubのアカウント",
  Automatic: "自動",
  "Automatic ({account})": "自動（{account}）",
  "Active account": "有効なアカウント",
  "gh was not found.": "ghが見つかりません。",
  Integrations: "連携",
  "This Host uses its gh login.": "このHostのghのログインを使います。",
  "Register a token for each site to also read private repositories and Issues.":
    "サイトごとにtokenを登録すると、非公開のリポジトリとIssueも読めます。",
  "No sites yet.": "サイトはまだありません。",
  "Cannot connect ({time})": "接続できません（{time}）",
  "The site does not accept the token": "サイトがtokenを受け付けません",
  "The token does not have the {scope} permission":
    "tokenに{scope}の権限がありません",
  "The token does not have enough permissions": "tokenの権限が足りません",
  "This Host's gh is not signed in to GitHub. Run gh auth login in a Terminal on this Host.":
    "このHostのghはGitHubにログインしていません。このHostのTerminalでgh auth loginを実行してください。",
  "No token is registered for {site}.": "{site}のtokenが登録されていません。",
  "{site} does not accept the token.": "{site}がtokenを受け付けません。",
  "GitHub does not accept this Host's gh sign-in.":
    "GitHubがこのHostのghのログインを受け付けません。",
  "No GitHub account on this Host can read this repository.":
    "このリポジトリを読めるGitHubのアカウントが、このHostにありません。",
  "The token does not have the {scope} permission.":
    "tokenに{scope}の権限がありません。",
  "The token does not have enough permissions.": "tokenの権限が足りません。",
  "The repository {repository} was not found.":
    "リポジトリ{repository}が見つかりません。",
  "The repository was not found.": "リポジトリが見つかりません。",
  "Cannot connect to {site}.": "{site}に接続できません。",
  "{site} has reached its API rate limit.":
    "{site}のAPIの利用回数の上限に達しました。",
  "{site} has reached its API rate limit. You can read again at {time}.":
    "{site}のAPIの利用回数の上限に達しました。{time}から読めます。",
  "Open Integrations": "連携を開く",
  "Open workspace settings": "ワークスペースの設定を開く",
  "Registered as {account}": "{account}として登録済み",
  Registered: "登録済み",
  "Not registered · reading public repositories only":
    "未登録 · 公開のリポジトリだけを読んでいます",
  "Register token": "tokenを登録",
  "Replace token": "tokenを替える",
  "Save token": "登録",
  "Add site": "サイトを追加",
  "Site URL": "サイトのURL",
  "Token for the site to add": "追加するサイトのtoken",
  "Enter a token with the read:repository and read:issue permissions. Add read:user to show the account name and to run automations from issues, and write:repository to let agents create pull requests.":
    "read:repositoryとread:issueの権限を持つtokenを入れます。アカウント名を表示する時とIssueでAutomationを実行する時はread:userも、AgentにPRを作らせる時はwrite:repositoryも付けます。",
  "This Host has no OS credential store, so the token is saved in a file in the Host's data folder that only this user can read.":
    "このHostにはOSの資格情報の保管所が無いため、tokenはHostのデータフォルダーの本人だけが読めるファイルに保存します。",
  "With an http site, the token travels over the network without encryption.":
    "httpのサイトでは、tokenが暗号化されずにネットワークを流れます。",
  "The site did not respond as Forgejo or Gitea. Check the URL.":
    "サイトがForgejo・Giteaとして応答しませんでした。URLを確認してください。",
  "The site did not accept this token.":
    "サイトがこのtokenを受け付けませんでした。",
  "Could not connect to the site.": "サイトに接続できませんでした。",
  "The token contains characters that cannot be used.":
    "tokenに使えない文字が含まれています。",
  "Enter a token.": "tokenを入れてください。",
  "The OS credential store did not accept the token, so it is kept in a file in the Host's data folder that only this user can read.":
    "OSの資格情報の保管所に保存できなかったため、tokenはHostのデータフォルダーの本人だけが読めるファイルに置いています。",
  "Could not save. Press the button or Enter to retry.":
    "保存できませんでした。ボタンかEnterで、もう一度保存してください。",
  "Could not check the site. Retry.":
    "サイトを確認できませんでした。もう一度押してください。",
  "Could not remove the token. Retry.":
    "tokenを削除できませんでした。もう一度削除してください。",
  "Remove the token for {site}?": "{site}のtokenを削除しますか？",
  "This removes the token for {site} from this Host. Private repositories and Issues can no longer be read. The token itself stays usable until you revoke it on the site.":
    "このHostから{site}のtokenを削除します。非公開のリポジトリとIssueは読めなくなります。tokenそのものは、サイトで無効にするまで使えます。",
  "Run gh auth login in a Terminal on this Host.":
    "このHostのTerminalでgh auth loginを実行してください",
  "Use gh auth switch in a Terminal on this Host to change the active account.":
    "有効なアカウントは、このHostのTerminalでgh auth switchを実行して切り替えます。",
  "Other workspaces using {host}{workspaces} use the same URL.":
    "「{host}」を使うほかのワークスペース{workspaces}にも同じURLを使います。",
  "Enter an http or https URL.": "httpまたはhttpsのURLを入力してください。",
  "Could not save. Press Save or Enter to retry.":
    "保存できませんでした。保存ボタンかEnterで、もう一度保存してください。",
  "Could not save the account. Choose it again to retry.":
    "アカウントを保存できませんでした。もう一度選んでください。",
  "Could not save settings. Choose it again to retry.":
    "設定を保存できませんでした。もう一度選んでください。",
  "Settings saved": "保存しました",
  "Show PR and CI status": "PR・CIの状態を表示",
  "CI passed": "CI通過",
  "CI failed": "CI失敗",
  "CI running": "CI実行中",
  "Pull request #{number} open": "PR #{number} Open",
  "Pull request #{number} draft": "PR #{number} Draft",
  "Pull request #{number} merged": "PR #{number} Merged",
  "Pull request #{number} closed": "PR #{number} Closed",
  "Fetch failed. Merged worktrees are checked against local references, which may be out of date.":
    "fetchできませんでした。取り込み済みかどうかは手元の情報で判断するため、古い可能性があります。",
  "Connection lost. Check the sidebar and delete the worktree again if it remains.":
    "接続が切れました。サイドバーで結果を確認し、残っていればもう一度削除してください。",
  "A program has files open in this worktree. Close it and retry deleting the worktree.":
    "このworktreeのファイルを開いているプログラムがあります。閉じてからもう一度削除してください。",
  "Could not stop a Terminal.":
    "Terminalを停止できませんでした。再試行してください。",
  "A child worktree could not be removed. Retry after resolving its error.":
    "子のworktreeを削除できませんでした。表示された理由を解消してから再試行してください。",
  "Could not delete the worktree.":
    "worktreeを削除できませんでした。再試行してください。",
  "Delete worktree": "worktreeを削除",
  "Delete merged worktrees": "Mergedのworktreeを削除",
  "Delete merged worktrees…": "Mergedのworktreeを削除…",
  "{name} will be deleted.": "{name}を削除します。",
  "Uncommitted changes will be lost": "未commitの変更が消えます",
  "Commits not on any branch will be lost":
    "どのブランチにも無いcommitが消えます",
  "1 file": "1ファイル",
  "{count} files": "{count}ファイル",
  "Work in progress will be stopped": "実行中の作業を停止します",
  "Branches with commits not in {target}": "{target}に無いcommitがあるブランチ",
  "1 commit": "1件のcommit",
  "{count} commits": "{count}件のcommit",
  "Also delete the branch": "ブランチも削除する",
  "1 commit will be lost.": "1件のcommitが消えます。",
  "{count} commits will be lost.": "{count}件のcommitが消えます。",
  "{count} worktrees will be deleted.": "{count}件のworktreeを削除します。",
  "Fetching and checking worktrees…": "fetchしてworktreeを確認しています…",
  "No merged worktrees to delete.": "削除できるMergedのworktreeはありません。",
  "Could not load worktrees. Check Git and retry.":
    "worktreeを取得できませんでした。Gitの状態を確認して再試行してください。",
  "Some worktrees could not be deleted. Review the result and retry.":
    "削除できなかったworktreeがあります。結果を確認して再試行してください。",
  Deleted: "削除済み",
  "Not deleted": "未削除",
  "Git refused removal. Check whether the worktree is locked or files are open, then retry.":
    "Gitが削除を拒否しました。worktreeのlockや開いているファイルを確認して、再試行してください。",
  "The worktree was removed, but Git could not delete its branch.":
    "worktreeは削除しましたが、ブランチを削除できませんでした。",

  Home: "ホーム",
  "Host settings": "Hostの設定",
  Start: "始める",
  "Create worktree": "作成",
  "New worktree": "worktreeを作成",
  "Start CLI or team": "CLI・Teamを始める",
  "Name (optional)": "名前（任意）",
  "Base branch": "ベースブランチ",
  "Command to run after creating a worktree":
    "worktree作成後に実行するコマンド",
  "Run again": "もう一度実行",
  "Start anyway": "このまま始める",
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
    "候補を取得できませんでした。再試行してください。",
  "That branch or folder already exists. Choose another name.":
    "同じブランチ名またはフォルダーが既にあります。名前を変更してください。",
  "This name cannot be used for a branch. Choose another name.":
    "この名前はブランチに使えません。名前を変更してください。",
  "Could not create the worktree. Check the repository and try again.":
    "worktreeを作成できませんでした。リポジトリを確認して再試行してください。",
  "Could not start the CLI or team. Check its settings and try again.":
    "CLI・Teamを始められませんでした。設定を確認して再試行してください。",
  Details: "詳細",
  "Jump to latest": "最新へ",
  ", ": "、",
  "No result is available yet. Wait a moment, then select “Check uninstall result”.":
    "結果がまだありません。しばらくしてから「アンインストールの結果を確認する」を押してください。",
  "The uninstall result was saved, but its receipt file could not be deleted.":
    "アンインストールの結果を保存しましたが、結果のファイルを削除できませんでした。",
  ...teamJapanese,
  "Waiting for iori Host to stop and remove its files":
    "iori Hostの停止と削除を待っています",
  "Could not connect to this Host. Reinstall iori Host, then retry.":
    "Hostに接続できませんでした。iori Hostを再インストールしてから再試行してください。",
  "Could not remove this Host from the list. Retry.":
    "Hostを一覧から外せませんでした。再試行してください。",
  "Terminals and agents stopped": "TerminalとAgentを停止しました",
  "iori CLI hooks removed": "ioriのCLI hooksを解除しました",
  "Automatic startup removed": "自動起動の登録を解除しました",
  "iori Host stopped": "iori Hostを停止しました",
  "iori Host program files removed": "iori Hostのプログラムを削除しました",
  "iori Host saved data removed": "iori Hostの保存データを削除しました",
  "Forgejo and Gitea tokens removed from the OS credential store":
    "OSの資格情報の保管所からForgejo・Giteaのtokenを削除しました",
  "Could not remove the tokens of these sites from the OS credential store:":
    "次のサイトのtokenを、OSの資格情報の保管所から削除できませんでした:",
  "Remove them in the OS credential store. A token stays usable until it is revoked on its site.":
    "保管所から手動で削除してください。tokenそのものは、サイトで無効にするまで使えます。",
  "Could not restore:": "次の項目を元に戻せませんでした:",
  "Terminals and agents": "TerminalとAgent",
  "Could not prepare the uninstall request":
    "アンインストールの準備に失敗しました",
  "Could not save uninstall progress":
    "アンインストールの進行状況を保存できませんでした",
  "CLI hooks": "CLI hooks",
  "Automatic startup": "自動起動",
  "iori Host is being uninstalled. Wait for it to finish.":
    "iori Hostをアンインストールしています。完了をお待ちください。",

  "Uninstall iori Host on “{name}”":
    "「{name}」のiori Hostをアンインストールする",
  "Use iori on a PC to uninstall iori Host.":
    "iori Hostのアンインストールは、PCのioriから操作してください。",
  Uninstalled: "アンインストール済み",
  "Remove from list": "一覧から外す",
  "Could not delete all iori Host files.":
    "iori Hostのファイルをすべて削除できませんでした。",
  "Could not stop these processes:": "停止できなかったプロセス:",
  "Restart the PC, then delete those folders, or reinstall using “Set up iori Host”.":
    "PCを再起動した後にそのフォルダーを削除するか、「iori Hostを用意する」で再インストールしてください。",
  "Reinstall using “Set up iori Host”.":
    "「iori Hostを用意する」で再インストールしてください。",
  "Delete the remaining folders, or reinstall using “Set up iori Host”.":
    "残ったフォルダーを削除するか、「iori Hostを用意する」で再インストールしてください。",
  "You can remove this Host from the list in Settings → Connection.":
    "設定の「接続」から、このHostを一覧から外せます。",
  "Remove “{name}” from the list?": "「{name}」を一覧から外しますか？",
  "This removes only this Client’s list entry and connection information. Device registrations, data and programs on the Host stay unchanged. To use this Host again, connect with an invitation.":
    "外すのは、このClientの一覧と接続の情報だけです。Host側の端末の登録・データ・プログラムは変わりません。また使う時は、招待から再接続してください。",
  "Uninstall requested": "アンインストールを依頼しました",
  "Uninstall requested. Program files will be removed after iori Host stops.":
    "アンインストールを依頼しました。プログラムの削除はiori Hostの停止後に行われます。",
  "Could not read the uninstall result. Retry.":
    "アンインストールの結果を読み取れませんでした。再試行してください。",
  "Check uninstall result": "アンインストールの結果を確認する",
  "Uninstall iori Host": "iori Hostをアンインストール",
  "{name}'s iori Host will be uninstalled.":
    "{name}のiori Hostをアンインストールします。",
  "Development files, CLI conversations, settings, and sign-ins, and iori Host saved data will remain.":
    "開発ファイル、CLI本体の会話・設定・認証、iori Hostの保存データは残ります。",
  "iori Host saved data (device registrations, the Host identity, iori work records and Terminal history, and Forgejo and Gitea tokens, including those in the OS credential store) will also be deleted. Development files and CLI conversations, settings, and sign-ins will remain.":
    "端末の登録・作業記録・tokenなどiori Hostの保存データも削除します。開発ファイルとCLIの会話・設定・認証は残ります。",
  "Also delete iori Host saved data": "iori Hostの保存データも削除する",
  Uninstall: "アンインストールする",
  "Could not uninstall iori Host":
    "iori Hostをアンインストールできませんでした",
  "iori Host uninstalled": "iori Hostをアンインストールしました",
  "Uninstalling iori Host": "iori Hostをアンインストールしています",
  "Could not finish uninstalling iori Host. Check the failed step, then retry.":
    "iori Hostのアンインストールを完了できませんでした。失敗した処理を確認して再試行してください。",
  "Stopping Terminals and agents": "TerminalとAgentを停止しています",
  "Removing iori CLI hooks": "ioriのCLI hooksを解除しています",
  "Removing automatic startup": "自動起動の登録を解除しています",
  "Removing iori Host program files": "iori Hostのプログラムを削除しています",
  "Removing iori Host saved data": "iori Hostの保存データを削除しています",
  "The Host could not complete the request: {message}":
    "Hostへの要求に失敗しました: {message}",
  "SSH exited with code {code}: {message}":
    "SSHが終了コード{code}で終了しました: {message}",
  "The destination command failed ({stage}, exit code {code}): {message}":
    "接続先の処理に失敗しました（{stage}、終了コード{code}）: {message}",
  "SSH closed: {message}": "SSH接続が終了しました: {message}",
  "Could not complete SSH setup: {message}":
    "SSHでのインストールを完了できませんでした: {message}",
  Command: "コマンド",
  "Host did not respond": "Hostから応答がありませんでした",
  "Host closed the connection without a response":
    "応答する前にHostが接続を閉じました",
  "SSH connection closed": "SSH接続が終了しました",
  "Invalid release SHA-256":
    "配布情報のSHA-256が正しくありません。取得を再試行してください。",
  "Release version does not match this Client":
    "配布情報のバージョンがこのClientと一致しません。取得を再試行してください。",
  "Missing Linux Host release":
    "配布情報にLinux Hostがありません。取得を再試行してください。",
  "Invalid response from the SSH destination":
    "SSHの接続先から正しい応答を受け取れませんでした。再試行してください。",
  "Missing SSH destination information":
    "SSHの接続先の情報を受け取れませんでした。再試行してください。",
  "Invalid SSH destination information":
    "SSHの接続先の情報を読み取れませんでした。再試行してください。",
  "Cancel the previous SSH connection first":
    "前のSSH接続を終了してから再試行してください。",
  "Could not find the user profile":
    "ユーザーのホームフォルダーが見つかりません。",
  "Could not open the SSH input stream":
    "SSHの入力を開けませんでした。再試行してください。",
  "Could not open the SSH output stream":
    "SSHの出力を開けませんでした。再試行してください。",
  "Could not open the SSH error stream":
    "SSHのエラー出力を開けませんでした。再試行してください。",

  Change: "変更",
  Connect: "接続する",
  "Update iori Host on the destination with the installation command, then retry registration.":
    "接続先でインストールコマンドを実行してiori Hostを更新してから、登録を再試行してください。",
  "Another machine (SSH)": "別のマシン（SSH）",
  "Set up iori Host on another machine": "別のマシンにiori Hostを用意する",
  "SSH destination": "接続先",
  "Filter SSH destinations": "接続先を絞り込む",
  "Enter manually…": "手動で指定する…",
  "Use this destination": "この接続先を選ぶ",
  "SSH response": "SSHの確認への回答",
  "Checking the SSH destination": "SSHの接続先を確認しています",
  "The destination machine is downloading iori Host":
    "接続先のマシンがiori Hostを取得しています",
  "Extracting iori Host on the destination":
    "接続先でiori Hostを展開しています",
  "Setting up iori Host to run after logout":
    "ログアウト後もiori Hostを動かす設定をしています",
  "Starting iori Host on the destination": "接続先でiori Hostを起動しています",
  "{platform} is not supported yet.": "{platform}にはまだ対応していません",
  "Cancelling SSH…": "SSHの終了を待っています…",
  Cancelled: "キャンセルしました",
  "iori Host will stop after logout. An administrator can enable it with:":
    "ログアウトするとiori Hostが止まります。管理者が次のコマンドで有効にできます:",
  "SSH connected, but the iori connection could not reach the Host. Check the Host’s listening addresses and network route in Connection settings.":
    "SSHでは接続できましたが、ioriの接続先に届きません。設定の「接続」でHostの待受先・ネットワークの経路を確認してください。",
  "OpenSSH Client was not found. Install OpenSSH Client and try again.":
    "OpenSSH クライアントが見つかりません。OpenSSH クライアントをインストールしてから、再試行してください。",
  "OpenSSH Client was not found. Add OpenSSH Client in Windows Settings → Optional features.":
    "OpenSSH クライアントが見つかりません。Windowsの設定の「オプション機能」から「OpenSSH クライアント」を追加してください。",
  "Enter [user@]host or ssh://[user@]host[:port].":
    "[user@]hostまたはssh://[user@]host[:port]の形で入力してください。",

  "Could not use the invitation. Retry to request a new invitation and register.":
    "招待を使用できませんでした。再試行すると新しい招待を取得し、登録します。",
  "Set up iori Host": "iori Hostを用意する",
  "Set up iori Host on this PC": "このPCでiori Hostを用意する",
  "Connect with an invitation": "招待で接続する",
  "Add iori Host": "iori Hostを追加する",
  Destination: "インストール先",
  "Register with this iori Host": "このiori Hostに登録する",
  Install: "インストールする",
  "Cancel setup": "キャンセル",
  "Register this device with the existing iori Host without reinstalling it.":
    "再インストールせずに、この端末をこのiori Hostに登録します。",
  "You can update iori Host in Settings after registration.":
    "登録した後、設定の「iori Hostを更新」から新しいバージョンにできます。",
  "Allow connections from other devices": "ほかの端末からの接続を許可する",
  "Windows will ask for administrator approval to allow other devices to connect.":
    "ほかの端末から接続できるよう、途中でWindowsの管理者の確認が出ます。",
  "You can use this PC. Other devices cannot connect yet. Allow connections in Settings → Connection.":
    "このPCからは使えます。ほかの端末からはまだつなげません。設定の「接続」で許可できます。",
  "Connections from other devices are allowed":
    "ほかの端末からの接続は許可済みです",
  "Could not allow connections. You can use this PC and retry this setting later.":
    "接続を許可できませんでした。このPCからは使えます。後からこの設定を再試行できます。",
  "Downloading iori Host": "iori Hostを取得しています",
  "Verifying iori Host": "iori Hostを確認しています",
  "Extracting iori Host": "iori Hostを展開しています",
  "Allowing connections from other devices":
    "ほかの端末からの接続を許可しています",
  "Registering this device": "この端末を登録しています",
  "Could not download iori Host. Check the connection and retry.":
    "iori Hostを取得できませんでした。接続を確認して再試行してください。",
  "Could not verify iori Host. Retry downloading.":
    "iori Hostを検証できませんでした。取得を再試行してください。",
  "Could not install or start iori Host. Retry the installation.":
    "iori Hostをインストール・起動できませんでした。インストールを再試行してください。",
  "Could not request an invitation from this PC’s Host. Check that it is running and retry.":
    "このPCのHostから招待を取得できませんでした。Hostの起動を確認して再試行してください。",
  "Could not complete registration. Retry registration.":
    "登録を完了できませんでした。登録を再試行してください。",
  "Registered “{name}”": "「{name}」を登録しました",
  "Choose how to add iori Host.": "iori Hostの追加方法を選びます。",
  "Checking iori Host on this PC": "このPCのiori Hostを確認しています",

  Version: "バージョン",
  "Downloading the Host update": "配布物を取得しています",
  "Extracting the Host update": "配布物を展開しています",
  "Preparing the Host update": "更新を準備しています",
  "Stopping iori Host": "iori Hostを停止しています",
  "Backing up iori Host": "iori Hostをバックアップしています",
  "Replacing iori Host": "iori Hostを入れ替えています",
  "Starting iori Host": "iori Hostを起動しています",
  "Restoring iori Host": "iori Hostを復元しています",
  "Update to": "更新先のバージョン",
  "Update iori Host": "iori Hostを更新",
  "This iori Host is not running as a service. Uninstall it on the Host machine.":
    "このiori Hostはサービスとして動いていないため、Hostのマシンでアンインストールしてください。",
  "Sort ascending": "昇順に並べ替える",
  "Sort descending": "降順に並べ替える",
  "Restart iori Host from this Client.":
    "このClientからiori Hostを起動し直します。",
  "Remove the iori Host program and automatic startup.":
    "iori Hostのプログラムと自動起動の登録を削除します。",
  "Restart iori Host": "iori Hostを再起動",
  "Open Client updates": "Clientの更新欄を開く",
  "Preparing confirmation": "確認を準備しています",
  Update: "更新する",
  Restart: "再起動する",
  "{name} will be restarted.": "{name}を再起動します。",
  "{name} will be updated from {from} to {to}.":
    "{name}を{from}から{to}に更新します。",
  "All open CLIs and Terminals will stop. CLI conversations can be resumed later.":
    "開いているCLIとTerminalはすべて止まります。CLIの会話は後で再開できます。",
  "All open CLIs and Terminals will stop.":
    "開いているCLIとTerminalはすべて止まります。",
  "Work that will be interrupted": "中断される作業",
  "Stop and restart": "止めて再起動する",
  "Stop and update": "止めて更新する",
  "Stop and uninstall": "止めてアンインストールする",
  "Could not update iori Host": "iori Hostを更新できませんでした",
  "Could not restart iori Host": "iori Hostを再起動できませんでした",
  "iori Host updated": "iori Hostを更新しました",
  "iori Host restarted": "iori Hostを再起動しました",
  "Updating iori Host": "iori Hostを更新しています",
  "Restarting iori Host": "iori Hostを再起動しています",
  "This iori Host is not running as a service. Start it using the installation script to update or restart it here.":
    "このiori Hostはサービスとして動いていないため、ここから更新・再起動できません。Hostのマシンでインストールスクリプトを使って起動してください。",
  "The Host could not reach the release source. Retry, or run the installation script on the Host machine.":
    "Hostから配布元に届きませんでした。再試行するか、Hostのマシンでインストールスクリプトを使って更新してください。",
  "The Host update could not be verified. Retry the update.":
    "Hostの更新を検証できませんでした。もう一度更新してください。",
  "The Host update process exited without leaving a result. Retry the update.":
    "Hostの更新処理が結果を残さず終了しました。もう一度更新してください。",
  "The Host could not download the update. Retry the update.":
    "Hostが配布物を取得できませんでした。もう一度更新してください。",
  "The new iori Host exited before it was ready. The previous version and saved data have been restored.":
    "新しいiori Hostが起動を完了する前に終了しました。前のバージョンと保存データに戻って動いています。",
  "The previous iori Host could not start. Check the service on the Host machine, then reconnect.":
    "前のバージョンのiori Hostも起動できませんでした。Hostのマシンでサービスの状態を確認してから、再接続してください。",
  "The saved data could not be restored. Check the Host and its backup on the Host machine before retrying.":
    "保存データを元に戻せませんでした。もう一度更新する前に、HostのマシンでHostとバックアップの状態を確認してください。",
  "The Host update could not be installed. Check the service on the Host machine, then retry.":
    "Hostを入れ替えられませんでした。Hostのマシンでサービスの状態を確認してから、再試行してください。",
  "The Host could not request a restart. Check the service on the Host machine, then retry.":
    "Hostの再起動を依頼できませんでした。Hostのマシンでサービスの状態を確認してから、再試行してください。",
  "This Host is newer than this Client. Update the Client in General settings.":
    "Hostの方が新しいバージョンです。「一般」の更新欄でClientを更新してください。",
  "Running Terminals will stop, and work in progress will be lost.":
    "実行中のTerminalは停止し、途中の処理は失われます。",
  "The Host has not reconnected yet. You can keep waiting, or check the service on the Host machine.":
    "iori Hostの再起動をまだ確認できていません。このまま待つか、Hostのマシンでサービスの状態を確認してください。",

  "Update available": "更新があります",
  Updates: "更新",
  "Receive development versions": "開発バージョンを受け取る",
  "Also update to versions that are still being tested.":
    "確認中のバージョンにも更新します。",
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
    "更新の途中で管理者の確認が出ます。",
  "Cannot update the AppImage in this location. Move it to a folder you can write to, then open it again.":
    "この場所のAppImageは更新できません。書き込めるフォルダーへ移してから開き直してください。",
  "Cannot store iori's key in the system keyring (Secret Service). Turn on a keyring such as GNOME Keyring or KWallet, then open iori again.":
    "ioriの鍵をOSのキーリング（Secret Service）に保存できません。GNOME KeyringやKWalletなどのキーリングを有効にしてから、ioriを開き直してください。",
  "Unlocking the keyring was cancelled. You can try again.":
    "キーリングのロック解除をキャンセルしました。再試行してください。",
  "Cannot read iori's key from the system keyring.":
    "OSのキーリングからioriの鍵を読めません。",
  "Retry download": "ダウンロードを再試行",
  "Download and install": "ダウンロードしてインストール",
  "Downloading update": "ダウンロードしています",
  "Installing update": "インストールしています",
  "Installation cancelled. You can try again.":
    "インストールをキャンセルしました。再試行してください。",
  "Continue installation": "インストールを続ける",
  "You are up to date": "最新のバージョンです",
  "Allow apps from this source in Android settings, then return to continue.":
    "Androidの設定で「この提供元のアプリを許可」をオンにして、ioriへ戻ってください。",
  "Could not reach the update source. Check your connection and try again.":
    "配布元に接続できませんでした。接続を確認して、再試行してください。",
  "Could not download the update. Try again.":
    "更新を取得できませんでした。再試行してください。",
  "Could not install the update. Try again.":
    "更新をインストールできませんでした。再試行してください。",

  Open: "開く",
  Reopen: "開き直す",
  "Could not display this terminal. Reopen it to continue.":
    "Terminalを表示できませんでした。開き直してください。",
  Exit: "終了",
  "The CLI has exited": "CLIが終了しました",
  "Could not resume the CLI. Retry.":
    "CLIを再開できませんでした。もう一度「再開」を選んでください。",
  Resume: "再開",
  "The CLI was interrupted": "CLIが中断されました",
  "Could not load teams. Retry.":
    "Teamを読み込めませんでした。再試行してください。",
  "Could not start the team. Check its parent CLI settings and try again.":
    "Teamを開始できませんでした。親のCLI設定を確認して、再試行してください。",
  "Could not configure notifications. Retry in notification settings.":
    "通知を設定できませんでした。設定の「通知」から再試行してください。",
  "iori receives notifications from connected Hosts.":
    "接続中のHostから通知を受け取ります。",
  "Connected in the background": "バックグラウンドで接続しています",
  "Allow only while using the app": "アプリの使用中だけ許可",
  "Allow and keep connected": "許可して接続を保つ",
  "To receive notifications while the app is in the background, keep the connection active. This shows one persistent notification and uses battery.":
    "アプリを閉じていても受け取るには、バックグラウンドで接続を保つ必要があります。常駐の通知が1件表示され、電池を使います。",
  "Receive notifications": "通知を受け取る",
  "Allow OS notifications": "OSの通知を許可",
  "Background connection shows a persistent notification and uses battery. When it is off or notifications are denied, return to the app to check pending decisions.":
    "常駐の通知が1件表示され、電池を使います。オフの場合や通知を拒否した場合は、アプリを開いてAttentionを確認してください。",
  "Keep connected in the background": "バックグラウンドで接続を保つ",
  "Waiting for approval": "承認待ち",
  "Completion notifications": "完了の通知",
  "Attention notifications": "Attentionの通知",
  "No remotes. Add a remote in a Terminal.":
    "remoteはありません。Terminalでremoteを追加してください。",
  "Needs input": "入力待ち",
  Failed: "失敗",
  "Exit when the window closes": "ウィンドウを閉じたら終了する",
  Notifications: "通知",
  General: "一般",
  Attention: "Attention",
  Idle: "待機中",
  Done: "完了",
  "Completed steps": "完了した処理",
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
    "CLIの一覧を読み込めませんでした。再試行してください。",

  Keyboard: "キーボード",
  "Key band": "キーバー",
  "Show button names": "ボタンの名前を表示",
  Live: "直接",
  Batch: "まとめて",
  Phone: "スマホ幅",
  Desktop: "PC幅",
  "Swipe up": "上スワイプ",
  "Swipe up on a key to send its assigned key.":
    "キーを上へスワイプすると、割り当てたキーを送ります。",
  "Reset to defaults": "既定に戻す",
  "Drag to reorder": "ドラッグして並べ替え",
  Remove: "削除",
  "Add a key": "キーを追加",
  Key: "キー",
  "Special key": "特殊キー",
  "Typed character": "文字を入力",
  Modifiers: "修飾キー",
  Text: "文字列",
  "Send Enter": "Enterを付ける",
  Add: "追加",
  "Enter one key or one text string.":
    "キーか文字列のどちらか1つを入力してください。",
  "This key cannot be sent to a terminal.": "このキーはTerminalへ送れません。",
  "Close tab": "タブを閉じる",
  "Close pane": "ペインを閉じる",
  "Show key": "キーを表示",
  "Hide key": "キーを非表示",
  "Collapse {name}": "{name}を折りたたむ",
  "Expand {name}": "{name}を展開",
  "Start in {name}": "{name}で始める",
  "New tab": "新しいタブ",
  "Resize sidebar": "サイドバーの幅を変更",
  "Toggle sidebar": "サイドバーの表示を切り替える",
  "Select a worktree in the sidebar.":
    "サイドバーからworktreeを選んでください。",
  "Open a folder from the sidebar.":
    "サイドバーからフォルダーを開いてください。",
  "No shells on this Host": "このHostで使えるshellはありません。",
  "Discard invitation input?": "入力した招待を破棄しますか？",
  "Your invitation input will be cleared.": "入力した招待の文字列が消えます。",
  "Keep editing": "編集を続ける",
  Discard: "破棄する",
  "Connect to a Host": "Hostに接続する",
  "Use an invitation from iori-host invite on the Host or Devices → Invite a new device on a registered device.":
    "Hostではiori-host invite、登録済み端末では「端末」→「新しい端末を招待する」から招待を発行できます。下に貼り付けてください。",
  Invitation: "招待の文字列",
  "Enlarge QR code": "QRコードを拡大",
  Continue: "次へ",
  "Scan QR code": "QRコードを読み取る",
  "Confirm registration": "登録の確認",
  Host: "Host",
  Address: "接続先",
  "This device’s name": "この端末の名前",
  Register: "登録する",
  Back: "戻る",
  Connected: "Connected",
  "Reconnecting…": "再接続しています…",
  Reconnect: "再接続",
  Devices: "端末",
  Connection: "接続",
  "This device": "この端末",
  New: "新規",
  "Invite a new device": "新しい端末を招待する",
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
  "Run from issues": "Issueで実行する",
  "Runs each open issue labeled by this Host's account, one at a time, in a new worktree per issue.":
    "このHostのアカウントがラベルを付けたOpenのIssueを、1件ずつ新しいworktreeで実行します。",
  Label: "ラベル",
  "This folder's repository has no known forge.":
    "このフォルダーのリポジトリのForgeが分かりません。",
  "Could not read the issues for this automation.":
    "このAutomationのIssueを読み込めませんでした。",
  "Run from webhook": "Webhookで実行する",
  "Accept from": "受け付ける相手",
  "LAN and VPN": "LAN・VPN",
  "This machine only": "このマシンだけ",
  URL: "URL",
  Token: "token",
  "Regenerate token": "tokenを作り直す",
  "Regenerate the token?": "tokenを作り直しますか？",
  "The current token will stop working.": "今のtokenは使えなくなります。",
  Regenerate: "作り直す",
  "curl example": "curlの例",
  "Save to create the URL and token.": "保存するとURLとtokenを作成します。",
  "If the CLI permission skips approvals, the agent can run commands without approval after reading what was received.":
    "CLIの許可で確認を省いていると、外から届いた内容を読んだAgentが確認なしでコマンドを実行できます。",
  "Webhooks are not being accepted because port {port} could not be opened.":
    "ポート{port}を開けないため、Webhookを受け付けていません。",
  From: "送信元",
  "Not run yet.": "まだ実行していません。",
  "Received content": "受け取った内容",
  "Received at": "届いた時刻",
  Query: "クエリ",
  Headers: "ヘッダー",
  Body: "本文",
  "Could not copy. Select the text and copy it.":
    "コピーできませんでした。文字を選んでコピーしてください。",
  Copied: "コピーしました",
  Close: "閉じる",
  "Revoke registration": "登録を取り消す",
  "Could not revoke this registration. Retry.":
    "登録を取り消せませんでした。再試行してください。",
  Revoke: "取り消す",
  Cancel: "キャンセル",
  "This device will no longer connect to this Host. Files and work on the Host, and data on this device, are not deleted.":
    "この端末からこのHostに接続できなくなります。Hostのファイルと作業、この端末に残っているデータは削除されません。",
  "This device’s registration was revoked.":
    "この端末の登録は取り消されました。",
  "Get a new invitation and register again.":
    "招待を受け取って登録し直してください。",
  "Register again": "登録し直す",
  "Check the invitation and paste it again.":
    "招待の文字列を確認して、貼り付け直してください。",
  "This invitation cannot be used. Create a new invitation on the Host.":
    "この招待は使えません。Hostで新しい招待を発行してください。",
  "Could not reach the Host. Retry with this invitation or check that the Host is running.":
    "Hostに接続できませんでした。この招待で再試行するか、Hostが起動していることを確認してください。",
  "Could not save the registration. Retry saving.":
    "登録を保存できませんでした。保存を再試行してください。",
  "Could not load this device’s key and registrations. Retry.":
    "この端末の鍵と登録を読み込めませんでした。再試行してください。",
  "The Host could not complete this operation. Retry.":
    "Hostが操作を完了できませんでした。再試行してください。",
  "The Host could not read this request. Retry.":
    "Hostが要求を読み取れませんでした。再試行してください。",
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
  "Example: my-host:49171": "例：my-host:49171",
  "Could not create a terminal. Check the folder and try again.":
    "Terminalを作成できませんでした。フォルダーを確認して再試行してください。",
  Running: "実行中",
  "Running {command}": "{command}を実行中",
  Exited: "Exited",
  "Close terminal": "Terminalを閉じる",
  "Could not close this terminal. Choose Close terminal again.":
    "Terminalを閉じられませんでした。もう一度「Terminalを閉じる」を選んでください。",
  "The previous shell ended when the Host restarted. A new shell will start when this terminal is opened.":
    "Hostの再起動時にシェルが終了しました。このTerminalを開くと新しいシェルが起動します。",
  "Search terminal output": "Terminal内を検索",
  "Case sensitive": "大文字と小文字を区別",
  "Previous match": "前の一致",
  "Next match": "次の一致",
  "Opening terminal…": "Terminalを開いています…",
  "Could not open this terminal. Refresh the list to check its state.":
    "Terminalを開けませんでした。一覧を更新して状態を確認してください。",
  "Could not reopen this terminal. Refresh the list to check its state.":
    "Terminalを再接続できませんでした。一覧を更新して状態を確認してください。",
  "Could not listen for terminal updates.":
    "Terminalの更新を受け取れませんでした。",
  "Input could not be sent. Check the connection before continuing.":
    "入力を送れませんでした。続ける前に接続を確認してください。",
  "Could not copy terminal selection.":
    "選択した文字をコピーできませんでした。",
  "Could not send the image.": "画像を送れませんでした。",
  "Could not read the clipboard.": "クリップボードを読み取れませんでした。",
  "Could not open this link.": "リンクを開けませんでした。",
  "Exited with code": "終了コード",
  Search: "検索",
  Copy: "コピー",
  Paste: "貼り付け",
  Image: "画像",
  "Terminal actions": "Terminalの操作",
  "Select as text": "テキストで選ぶ",
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
  "Device width": "スマホ幅",
  "Desktop width": "PC幅",
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
  "Type a path to find a folder.": "パスを入力してフォルダーを探します。",
  "Enter a folder path.": "フォルダーのパスを入力してください。",
  "No matching folders": "一致するフォルダーはありません",
  "Add folder": "フォルダーを追加",
  "Client and Host settings": "ClientとHostの設定",
  "Could not browse Host folders. Retry.":
    "Hostのフォルダーを表示できませんでした。再試行してください。",
  "Could not change the default shell. Choose it again to retry.":
    "既定のshellを変更できませんでした。選び直して再試行してください。",
  "Could not load settings. Retry.":
    "設定を読み込めませんでした。再試行してください。",
  "Could not load folders. Retry.":
    "フォルダーの履歴を読み込めませんでした。再試行してください。",
  "Could not load shells. Retry.":
    "shellを読み込めませんでした。再試行してください。",
  "Could not open this folder. Retry.":
    "このフォルダーを開けませんでした。再試行してください。",
  "Could not remove this folder from the sidebar. Retry.":
    "フォルダーをサイドバーから外せませんでした。再試行してください。",
  "Could not restore this workspace layout.":
    "ワークスペースの配置を復元できませんでした。",
  "Discard the layout and open": "配置を破棄して開く",
  "Could not save this workspace layout. Retry saving.":
    "ワークスペースの配置を保存できませんでした。保存を再試行してください。",
  "Could not save settings. Retry saving.":
    "設定を保存できませんでした。保存を再試行してください。",
  "Could not update the Host address. Retry saving.":
    "Hostの接続先を更新できませんでした。保存を再試行してください。",
  Icon: "アイコン",
  "Choose an image": "画像を選ぶ",
  "Remove {file}": "{file}を外す",
  "Choose files": "ファイルを選ぶ",
  "Choose one definition JSON file.": "定義のJSONを1つ選んでください。",
  "Choose an SVG or PNG image.": "SVGかPNGの画像を選んでください。",
  "Revert to the bundled icon": "同梱のアイコンに戻す",
  "Revert to the common icon": "共通のアイコンに戻す",
  "Also select these files: {files}": "次のファイルも選んでください: {files}",
  Dark: "ダーク",
  "Default shell": "既定のshell",
  Disconnected: "未接続",
  Display: "表示",
  "Display language": "表示言語",
  Files: "Files",
  "Full width": "全幅",
  Light: "ライト",
  "Loading available shells": "利用可能なshellを読み込んでいます",
  Maximize: "最大化",
  "Minimize window": "最小化",
  "Maximize window": "最大化",
  "Restore window": "元に戻す",
  "Close window": "閉じる",
  "Double-click a tab to maximize": "タブをダブルクリックで最大化",
  "No shells found": "shellが見つかりませんでした",
  "No shells were returned by this Host": "このHostで使えるshellはありません。",
  "Open sidebar": "サイドバーを開く",
  "Open tabs": "開いているタブ",
  "Open this folder": "このフォルダーを開く",
  "Opened folder": "開いたフォルダー",
  "Could not reorder folders. Retry.":
    "並べ替えを保存できませんでした。もう一度並べ替えてください。",
  "Picked up.": "持ち上げました。",
  "Move to this position.": "この位置へ移動します。",
  "Dropped.": "置きました。",
  "Reordering cancelled.": "並べ替えをキャンセルしました。",
  Reorder: "並べ替え",
  "Remove from sidebar": "サイドバーから外す",
  Repository: "リポジトリ",
  "Restore pane": "最大化を解除",
  "Select a shell": "shellを選ぶ",
  Settings: "設定",
  "Split below": "下に分割",
  "Split right": "右に分割",
  "System default": "OSに合わせる",
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
  "Working directory": "作業フォルダー",
  Worktree: "Worktree",
  invalid_request: "入力内容を確認してください。",
  not_registered:
    "この端末はHostに登録されていません。招待を使って登録してください。",
  invite_rejected: "この招待は使えません。Hostで新しい招待を発行してください。",
  device_not_found: "端末が見つかりません。",
  path_not_found: "フォルダーが見つかりません。",
  not_a_directory: "指定した場所はフォルダーではありません。",
  permission_denied: "フォルダーを読み取る権限がありません。",
  internal_error: "Hostで処理できませんでした。再試行してください。",
  host_uninstalling:
    "iori Hostをアンインストールしています。完了をお待ちください。",
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
    ? `${name}を登録しました`
    : `${name} was registered`;
}

export function registeredDateMessage(language: string, registeredAt: number) {
  const date = new Intl.DateTimeFormat(language, {
    dateStyle: "medium",
  }).format(registeredAt);
  return language.toLowerCase().startsWith("ja")
    ? `${date}に登録`
    : `Registered ${date}`;
}
