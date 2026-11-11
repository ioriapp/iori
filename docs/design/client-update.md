# Clientの自己更新

Clientの更新の確認、取得、入れ替えを変える時に読む。更新の入口は[設定](settings.md)、Hostの更新は[Hostの導入と更新](host-install-update.md#更新)、配布物と公開は[Releaseと公開](release.md)に従う。

## 目的

ユーザーは普段のioriから新しいバージョンに気づき、ボタン1つでClientを入れ替える。対象はWindowsのNSISインストーラー、LinuxのdebとAppImage、AndroidのAPK。ClientとHostは同じReleaseを使うが、Clientの更新はHostに触れない。Clientが閉じて戻る間も、HostのAgent・子・Terminalは動き続ける。

## 確認と知らせ

- Clientは起動した時と、起動している間は一定の間隔で、配布元に新しいバージョンがあるかを確かめる。Androidは前面にいる間だけ確かめる。間隔は[VS Codeの通常の更新確認](https://github.com/microsoft/vscode/blob/main/src/vs/platform/update/electron-main/abstractUpdateService.ts)に合わせ、1時間とする。確認は起動・Hostへの接続を待たせない。
- 設定の「この PC」の「一般」に更新欄を置き、今のバージョン、新しいバージョン、変更内容へのリンク、「更新を確認」、更新の操作を並べる。「更新を確認」は時機にかかわらず、その場で確かめる。
- デバイスごとの「開発バージョンを受け取る」（英語は「Receive development versions」）を更新欄に置き、既定はオフにする。説明は「確かめている途中のバージョンにも更新します。」（英語は「Also update to versions that are still being tested.」）。同じ画面のほかの切替と同じく、切り替えるとすぐデバイスの設定へ保存し、その場で更新を確かめ直す。オフにしても古い安定バージョンへは戻さず、今のバージョンより新しい安定バージョンが出るまで更新を知らせない。
- 配布元は `release-source.txt` のGitHub Releaseとする。オフの時はGitHubの最新の安定バージョン（draft・pre-releaseを除く `/releases/latest`）を使い、APIを使わず `/latest/download/〈名前〉` から読み込む。オンの時は、そのリポジトリのRelease一覧をGitHub APIで1回読み込む（先頭の100件）。draftを除き、pre-releaseも含めてSemVerで最も新しいバージョンを選ぶ。どちらも今のバージョンより新しい時だけ更新の候補にする。APIの取得失敗・利用枠の上限は、配布元に届かない時と同じ扱いにする。
- 新しいバージョンがある時は、設定を開く入口と、設定画面の「この PC」の「一般」の項目に小さなインジケーターを付ける。入口を押すと更新欄のある「一般」を開く。自動で設定を開かず、Attentionへ加えず、OSの通知も出さない。
- 配布元に届かない時（LANの外など）の自動の確認は、何も出さずに次の機会に回す。「更新を確認」を押した時だけ、届かないことを更新欄に表示する。届かないことを「最新です」と表示しない。

## Windows

Tauri公式のupdater pluginを使い、署名の検証・取得・NSISでの入れ替えを任せる。

1. 新しいバージョンを見つけたら、裏で取得まで済ませる。
2. 更新欄の「再起動して更新」を押すと、Clientが閉じてインストーラーが入れ替え、新しいバージョンで開き直す。
3. 取得や入れ替えに失敗した時は今のバージョンのまま理由を表示し、もう一度押せるようにする。

updaterの初めてのバージョンは、一度だけ手でインストールする。それより前のClientは自分で更新できない。

## Linux

Windowsと同じくTauri公式のupdater pluginを使い、取得は裏で済ませ、更新欄の「再起動して更新」で入れ替えて開き直す。形式は入れた方法（debかAppImage）で決まり、updaterの一覧は形式ごとに分ける。

- AppImage: 実行中のファイルを同じ場所で新しいバージョンに置き換える。管理者の確認は出ない。ファイルを本人が書き換えられない場所に置いた時は、今のバージョンのまま理由を表示する。
- deb: OSの管理者の確認（`pkexec`）を1回出し、`dpkg` で入れ替える。押す前に、更新の操作の近くで管理者の確認が出ることを一行で表示する。確認を断った・失敗した時は今のバージョンのまま理由を表示し、もう一度押せるようにする。aptのリポジトリは持たない。

## Android

TauriのupdaterはAndroidに対応しないため、AndroidのPackageInstallerへ渡す小さなnativeの処理をioriが持つ。

1. 新しいバージョンを見つけたら、更新欄に「ダウンロードしてインストール」を出す。スマホの通信量を考えて、取得は押した時に始め、進み具合を表示する。
2. 取得したら、Androidの標準のインストールの確認画面へ渡す。ioriに「この提供元のアプリを許可」が無い時は、OSの設定へ案内し、戻ったら再読み込みして続ける。
3. Androidの確認画面は、ioriへ戻っただけでは開き直さない。ホームへ移動して確認画面が消えた時や、裏にいたため確認画面が開かなかった時は、更新欄の「インストールを続ける」から戻れる。この操作は、確認画面を出した後にランチャーや通知からioriを開き直した時、またはioriが裏にいる間に確認画面を開こうとした時に表示する。確認画面を開くと非表示に戻し、確認に答えてioriへ戻っただけでは表示しない。確認後のインストールやPlay プロテクトの検査を、自動の再表示で妨げない。
4. 取消・失敗の時は今のバージョンのまま理由を表示し、もう一度押せるようにする。確認画面を開いたことだけで完了とは表示しない。

## 安全

- WindowsとLinuxは、updater用の署名鍵でReleaseの配布物に署名し、Clientに埋め込んだ公開鍵でupdater pluginが検証する。updaterが読む一覧はReleaseごとに作る。
- Androidは、Releaseの署名付きの `release.json` を埋め込んだ公開鍵で検証し、取得したAPKのSHA-256と大きさを照合してから渡す。package名・APKの署名鍵・versionCodeの一致はAndroidが確かめる。APKの署名鍵は変えず、package名 `io.github.ioriapp.iori` は公開の後に変えない。
- 取得先はbuild時に固定した `release-source.txt` のHTTPS配布元にする。転送は同じorigin（scheme・host・port）と、`release-redirect-hosts.json` に列挙したGitHubの配布物のhostへのHTTPSだけを許す。署名・SHA-256・大きさの検証は転送後も同じく行う。UIから任意のURLや実行ファイルを渡せる入口を作らない。
- 署名鍵の秘密はrepositoryに入れない。
- 更新でClientの保存データ（登録したHost、下書き、配置、鍵）を削除しない。

## Hostとの関係

Clientの入れ替えはHostに触れない。Hostが古くて接続できない時の表示は[接続](connection.md)のとおり。ClientからのHostの更新は[Hostの導入と更新](host-install-update.md#更新)と[Hostの更新](host-update.md)が持つ。

接続中のHostにClientの新しいバージョンより古いものがある時だけ、更新欄の更新の操作の上に「接続中の iori Host も更新する（〈台数〉台）」を出し、既定で選んでおく。Hostの更新先は動いているClientのバージョンなので、選んだまま更新すると、新しいバージョンで開き直したClientが続けて[Hostの更新](host-update.md#clientの更新と一緒に更新する)を始める。この選択は1回の更新ごとのもので、設定として残さない。Clientの入れ替えが取消・失敗で終わった時は、Hostの更新を始めない。

## 受け入れ

- Windows Client実機で、連続する2つのReleaseを使い、「再起動して更新」から新しいバージョンで開き直り、登録したHost・下書きが残る。
- Linux ClientをLinuxの検証機で、連続する2つのReleaseのdebとAppImageそれぞれから、「再起動して更新」で新しいバージョンで開き直り、登録したHost・下書きが残る。Linuxの検証機のデスクトップでの見た目と管理者の確認はReleaseを作る人が目で確かめる。
- Android Client実機で、同じ署名の新しいAPKへ、提供元の許可の案内とOSの確認を通って入れ替わり、保存が残る。
- 「更新を確認」と知らせのインジケーターは、画面E2Eで確かめる。
