# Releaseと公開

Releaseの配布物・版と公開方針を変える時に読む。コマンドでのHostの導入と更新は[Hostの導入と更新](host-install-update.md#コマンドでの導入と更新)、Clientの自己更新は[Clientの自己更新](client-update.md)が持つ。

## 配布物

配布元はGitHubのReleaseで、tagは `v<版>` とする。各Releaseに次を置く。名前に版を入れず、`latest/download/<名前>` で最新版を取れるようにする。

| 名前                                                      | 内容                                                                                               |
| --------------------------------------------------------- | -------------------------------------------------------------------------------------------------- |
| `iori-setup-windows-x64.exe`                              | Windows Client。TauriのNSISによる本人ユーザー向けのインストーラー                                  |
| `iori-linux-x64.deb`、`iori-linux-x64.AppImage`           | Linux Client。Ubuntu 22.04のDockerでbuildし、Ubuntu 22.04・Debian 12以降で動かす                   |
| `iori-android-arm64.apk`                                  | Android Client。安定の署名鍵で署名する。package名は `io.github.ioriapp.iori`                       |
| `iori-host-linux-x64.tar.gz`、`iori-host-windows-x64.zip` | Host。Nodeのruntimeとnative module（irohのaddon、node-pty）を含み、Nodeやpackage managerを求めない |
| `install.sh`、`install.ps1`                               | Hostをコマンドで導入・更新するスクリプト                                                           |
| `release.json`、`release.json.sig`                        | 版、commit、各配布物の名前・サイズ・SHA-256と、`release.json`の元のbyte列へのEd25519署名           |
| `updater.json`と各Client配布物の `.sig`                   | Tauri updater用の版・Windowsのインストーラーと形式ごとのLinux配布物のURL・署名                     |

Release情報、Tauri updater、APK、Windowsのコード署名は別の鍵である。updaterの公開鍵はClientの `tauri.conf.json` に埋め込む。Release情報の署名の公開鍵の正本は [release-public-key.txt](../../release-public-key.txt)。Android Clientはこの署名を自己更新の時に確かめる。人がコマンドで実行する導入スクリプトはHTTPSの取得に任せ、署名を確かめない。ClientからのSSH導入では、ClientがRelease情報の署名を確かめ、そのSHA-256を同梱の導入スクリプトへ渡して接続先の取得物を確かめる。Windowsのコード署名は[公開の準備](#公開の準備)に従う。

## 版

版の正本はrepository rootの`release-version.json`の`version`（SemVer）だけである。Client、Host、APK、Release情報に同じ版を埋め込む。Androidの`versionCode`は版から `major × 1,000,000 + minor × 1,000 + patch` で求め、別の連番を持たない。公開のたびに版を上げるcommitをmainへ載せる。

## 届けることと戻すこと

Windows ClientはReleaseから前のインストーラーを入れ直して戻せる。Android Clientは小さい`versionCode`のAPKへ戻せないため、より新しい版の修正版を出す。Hostは版を指定して同じコマンドを実行すると前の版へ戻せる。ClientからのHostの更新で新しい版が起動できなかった時は、[ClientからのHostの更新](host-update.md#進行と結果)のとおり前の版と保存データへ自動で戻す。それ以外に戻すための専用の仕組みは作らない。

## 公開の準備

最低限のOSSとして一般公開する。ドメインは取らない。名前は iori とする。公開用リポジトリはGitHubのOrganization `ioriapp` の `ioriapp/iori` に置き、アプリのID（Windowsのidentifier・Androidのpackage）は `io.github.ioriapp.iori` にする。個人のアカウントで出すとIDに個人の名前が永久に残り、個人の活動とioriを切り離せないため、Organizationを使う。LICENSEの著作権者は `The iori Authors` と書く。IDは公開の後に変えると全ての利用者が入れ直しと端末の登録のし直しになり、Google Playでは一度出すと変えられない。リポジトリを後で移してもIDは変わらない。Google Play・Apple・Microsoft StoreはIDのドメインの持ち主を確かめず、Flathubは `io.github.<持ち主>.<リポジトリ名>` に対応するGitHubのURLが実在することを求める。時期は準備ができ次第。

- **アイコン**: 藍の地に斜めの帯3本のアイコンへ、公開の前に替える。
- **ライセンス**: MIT。同梱するNodeのruntime・フォント（OFL）・caniuse-lite（CC-BY）などの第三者のライセンス表示を配布物とリポジトリに置く。
- **配布の経路と更新のチャンネル**: 公開の後は、Releaseを公開用のGitHubリポジトリだけに置き、ForgejoのReleaseはやめる。開発はForgejoのまま。Windowsのインストーラー、LinuxのClient、AndroidのAPK、Hostを置く。開発版は細かい直しごとにpre-releaseとして出す。安定版は、確かめた開発版のReleaseのpre-releaseの印を外して出し、作り直さない。ClientとHostの更新は、既定では安定版だけを対象にし、Clientの設定「開発バージョンを受け取る」でpre-releaseも対象にする。配布物は作成機で作って署名し、GitHubのCIに秘密を置かない。
- **版の間の互換**: 公開の後は、最後の安定版の保存データ・設定・端末の登録を、後の版がそのまま引き継ぐ。安定版の間の開発版だけで使った一時的な形は、引き継がなくてよい。
- **公開用のREADME**: 英語を主にし、日本語版（`README.ja.md`）を並べる。何ができるか、入れ方、つなぎ方（LAN・VPNか、自分で立てたRelay）、WindowsのSmartScreenの警告の進み方を書く。個人の開発で対応を約束しないことも書く。
- **報告の窓口**: 使う人からの報告はGitHubのIssueで受ける。脆弱性は `SECURITY.md` とGitHubの非公開の報告（private vulnerability reporting）で受ける。
- **LinuxのClient**: debとAppImage。自己更新はTauri updater（[Clientの自己更新](client-update.md#linux)）。WebKitGTK 4.1が要るので、Ubuntu 22.04・Debian 12以降を対象にする。Flatpak・Snapは隔離がPTYとHostの常駐とぶつかるので出さない。
- **AppImageのソース**: buildで同梱ライブラリとruntimeのソースを集め、公開時にGitHubの `appimage-sources` Releaseと、必要に応じて番号を付けた後続のReleaseへ自動で追加する。これらはpre-releaseとする。
- **Linuxの「このPC」**: Clientから既存の `install.sh` を呼んで導入する（SSH導入と同じく、ClientがRelease情報の署名を確かめる）。
- **Android**: ReleaseのAPKを直接配る（ObtainiumでGitHubのReleaseを追える）。Google Playは個人アカウントのテスト要件（12人×14日）があるので公開の後に回す。
- **Androidの実機受入**: 安定版にする版は、実機の段を通したものに限る。実機の段を飛ばした開発版は、安定版にしない。端末につながらない・画面がロックされている時に実機の段を飛ばせるのは、開発版（pre-release）だけである。
- **Windowsのコード署名**: 初回の公開は署名なしで出し、READMEにSmartScreenの警告の進み方を書く。公開用リポジトリができたらSignPath Foundation（OSS向けの無償の署名）へ申し込む。
- **他のOS**: macOS・iOSは公開の後。Apple Developer Programの登録と、日単位で借りるMacの実行環境の準備ができてから、集中してbuildと試験をする。
