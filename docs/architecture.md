# iori 技術設計

製品の目的・画面・ユーザーの操作は [製品仕様](product.md) が持つ。この文書は、実装を変えても守る技術上の責任の境界と、採用した方式を定める。

## 作りの原則

- **入力も出力もそのまま渡す。** ユーザーの入力はそのままCLIへ渡し、CLIの出力はそのまま画面へ届ける。本文に独自の前置き・隠れた指示を足さず、意味を組み替えない。
- **会話の正本はCLI自身の保存。** Hostは会話本文のコピーを持たない。過去の会話はCLI自身の再開機能で開き、HostはCLIの会話IDとiori自身の情報だけを持つ。
- **照合して拒否しない。** iori自身が保存したもの・自分が送るものを、revision・世代・byte位置・hashなどで照合して正常な読取や送信を拒否しない。検査は、外から受け取った値で保存や他の対象を壊さないための入口（形・範囲・権限）だけに置き、知らない項目は読み捨てる。
- **状態不明を失敗にしない。** 応答が遅い・状態が分からないだけで失敗と判定せず、画面へ「不明」等を出さない。固定の時間切れで「失敗した」「起きなかった」と決めない。上限は資源を守るためだけに置き、超えた時もページ送り等で内容を失わない。
- **結果不明の作用を自動で繰り返さない。** 送信・停止・回答がCLIへ届いたか分からない時は、同じ作用を自動で再送しない。再送はユーザーの操作にする。
- **CLI固有のことはCLIごとのアダプタが持つ。** 共通の処理と画面はCLIの名前・モデル名・設定IDで分岐しない。アダプタが能力と設定の説明を返し、共通側はそれを不透明な値として扱う。

上の原則のうち機械的に止められるもの（状態不明の表示、CLIの名前による分岐、固定の時間切れによる失敗判定、保存済みの値の照合による拒否）は、lintの規則で止める（[DEVELOPMENT](../DEVELOPMENT.md)）。

## 構成

```text
iori Client（Windows・Android。将来は他のOSも）
  React の共通の画面と操作
  └ Tauri の native 部分（Rust）
      ├ 通信: iroh、端末の鍵
      ├ 保存: 下書き・配置・読み位置（OSの鍵で暗号化）
      └ OS: QR の読取、ファイルの選択と保存、更新の導入
              │ LAN / VPN の直接接続。端末と Host の鍵で相手を確かめ、間を暗号化
iori Host（Windows・Linux。本人のユーザーで常駐）
  ├ 接続: 端末の登録・招待・失効、要求の受付
  ├ CLI: CLI自身の画面（PTY）
  │        └ CLI自身の会話の保存・設定・認証
  ├ Terminal: 別のデーモンへ入力・出力を中継
  ├ Files・Git: OS のファイルと本人の Git を読むだけ
  └ 小さい SQLite: 端末の登録、ワークスペース、チーム、CLIの会話ID
Terminalのデーモン（Host本体と別のNodeプロセス）
  ├ node-pty、画面の保持、CLI hooks
  └ ioriコマンドの受け口（Host本体へ渡す）
```

| 部分     | 採用                                                                                        |
| -------- | ------------------------------------------------------------------------------------------- |
| Host     | Node.js LTS・TypeScript。node-ptyを直接使える。ClientにNodeを要求しない                     |
| Client   | Tauri 2・React。PCとAndroidで同じ画面を使う。部品・見た目は画面のモックアップv8・v9から作る |
| 通信     | iroh。HostもClientもRustの`iroh`を使い、Hostは自前の小さいNode addonで呼ぶ                  |
| 保存     | Hostは小さいSQLite、Clientはnativeの暗号化したSQLite                                        |
| Terminal | 別のデーモンのnode-ptyとheadlessのterminal emulator、Clientのxterm.js                       |

資源の使い方と性能の目標は[HostとClientの資源の使い方](design/resource-use.md)が定める。

依存のバージョン、native ABI、lockfileは固定する。調査時のバージョンや一つの環境での成功を、将来のバージョンや全OSの保証にしない。開発環境のマシン・ユーザー・パス・port・モデルを製品の既定値にしない。

## 共通の処理とOSの境界

共通の画面と処理は実行中のOSを知らない。OSの分岐、native path、鍵のAPI、DBのdriverは持たず、必要な操作を小さい口として受け取る。Rust・Kotlin・Hostのadapterは入出力と観測した事実を返し、成功・失敗の判断を作らない。画面から任意のSQL・シェル・native呼び出しを使える機能を作らない。

画面を閉じる、Clientを終了する、スマホが休止する、のどれもHost上の作業を止めない。HostはClientがいない間もCLIとTerminalを動かし続け、Clientが戻ったら現在の状態を返す。

Windowsの通知は標準のWinRT通知にprotocol activationのURLを付け、Tauri公式のdeep-linkとsingle-instance pluginで起動中・終了後とも同じ入口へ渡す。単一起動pluginが通知の押下で起動したprocessから前面表示の権限を既存Clientへ渡す。通知センターの履歴からも開けるように、実行中process内だけの通知callbackには依存しない。URLにフォルダーのパスや起動コマンドは載せず、Host公開鍵とTerminal IDから登録済みHost上の既存の対象を探す。

Hostは応答を通知用の一時状態にだけ持ち、会話の保存はCLIが担う。通知に出す文字は共通の処理で秘密を伏せ、制御文字を除く。WindowsのTagとGroupはTerminal IDとHost公開鍵、AndroidのIDは同じ対象からの安定した整数を使う。

Clientの自己更新はHostとの通信から独立する。Reactは確認・取得・導入の小さなnativeのAPIと取得の進捗を使う。Windows・LinuxはTauri公式updaterが取得と署名確認を持ち、WindowsのNSISとLinuxのAppImageを入れ替える。Linuxのdebは確認済みのbytesだけを本人限定の一時フォルダーへ置き、nativeが `pkexec dpkg -i` を1回実行し、成否に関わらず一時ファイルを回収する。AndroidはRustでRelease署名とAPKのサイズ・SHA-256を確認してからnative installerへ渡す。取得先の正本は `release-source.txt` とし、buildに固定したHTTPSだけを許可する。AndroidのHTTPSはバージョンを固定したMozilla公開CA集（`webpki-root-certs`）で検証し、依存の更新に合わせてCA集を更新する。

ClientからのSSH導入ではnativeがOpenSSHの子processとその終了待ちを持つ。取消は接続のIDを指定し、導入と撤去結果の読取りが互いの接続を止めない。確認入力はClient実行ファイルの補助モードからloopbackへ渡し、起動ごとに作る秘密値を示した接続だけを受ける。回答・鍵・招待をログへ残さず、接続先でClient同梱の補助をHost同梱Nodeで実行し、本人限定の手元接続からHostの情報と招待を受け取る。OpenSSH configの候補解析と応答行の解析はOSに依存しない部分としてdesktop共通に置き、LinuxのCIでも検査する。利用手順と対象は[Hostの導入と更新](design/host-install-update.md#別のマシンssh)に従う。

## デバイスとHostの信頼

HostとClientはそれぞれEd25519の鍵を持ち、irohの接続で互いの公開鍵を確かめる。名前・パス・IPアドレスから相手の同一性や信頼を推測しない。到達先（IPアドレス）は接続の手がかりであり、変わっても登録は変わらない。

- **最初のデバイス**: Hostを導入したデバイス（SSH・このマシンの経路でHostを用意したClient）が、その経路でHostに招待を発行させ、すぐ使って登録する。
- **招待**: HostのID（公開鍵）、到達先、一回限りの乱数secret、期限を持つ。登録済みのデバイスまたはHost側で発行し、QRまたは文字列で本人のデバイスへ渡す。Clientは招待が指すHostの鍵へ接続した上でsecretを示し、Hostはsecretの照合・消費・デバイスの登録を一つのtransactionで一度だけ確定する。発行した画面に追加されたデバイスを表示し、取り消せるようにする。招待した側での再承認や指紋の目視照合は求めない。
- **失効**: 登録を削除したら、そのデバイスの既存の接続も閉じ、新しい要求を受けない。失効はデバイスに残ったデータの遠隔消去ではない。
- **鍵が変わったHost**: 名前やIPが同じでも自動で受け入れない。新しいHostで発行した招待による明示的な登録し直しだけを受ける。登録し直しが確定するまで、前の登録・下書き・配置は残す。
- **鍵の保存**: Clientの秘密鍵はnative側に置き、画面（WebView）へ渡さない。ClientはWindows DPAPI・LinuxのSecret Service（GNOME Keyring・KWalletなど）・Android Keystoreで保護し、使えない時に平文へ逃げない。HostはHost専用の保存先に置き、Windowsは本人のDPAPI、Linuxはdirectory 0700・file 0600で保護する。壊れた鍵・読み込めない鍵を黙って作り直さない。Clientの鍵が失われた・壊れたと確定した場合だけ、確認つきの「登録をリセット」で、ClientのデータベースとWindowsのDPAPIの鍵ファイル、Linuxの該当するioriのキーリング項目を削除して初期化し直せる。一時的なキーリングの失敗やロック解除のキャンセルでは削除しない。Host側の登録やioriの保存先の外のファイル、他のアプリのキーリング項目には触れない。
- **QRの読取**: Androidは同梱のdecoderでデバイス内で読み取り、画像を保存・送信しない。読み取った内容は貼り付けと同じ招待の処理へ渡す。

登録前の相手には、Files・CLI・Terminalを一切開かない。認証前の入口は大きさ・接続数・招待の試行を制限する。未登録の接続とハンドシェイクの枠が埋まった時は古いものから閉じて新しい接続を受け、登録済みのデバイスは未登録の接続枠に含めず、未登録の要求は招待の登録に足りる1KiBまでとする。

## 通信

irohのQUIC接続を使い、用途名（ALPN）で接続の種類を分ける。既定はLAN・VPNの直接接続だけで、Hostで設定した時だけユーザーが用意したRelayを使う。公開のDNS・Pkarr・DHTによる探索と自動のポート開放は使わない。HostはIPv4の`0.0.0.0:<port>`とIPv6の`[::]:<port>`で全interfaceに待ち受ける。portはHostの保存先に保存し、再起動後も同じ値を使う。保存が無い時は49171を試し、使えなければOSが選んだ空きportで起動して保存する。`IORI_HOST_PORT`の指定は保存値より優先し、保存しない。保存済みportでのbind失敗は別portへの変更では回避しない。Clientは保存した直接のアドレスと、設定があればRelayのURLを同じHostの公開鍵へ結び付けて接続する。Relayの有無でデバイスの登録・鍵の確認・Hostでの認可は変えない。

- ClientとHostの間はALPN `iori` の接続1本を使う。要求ごとにClientが双方向streamを開き、要求1件と応答を流して閉じる。出来事は購読要求のstreamへ継続して流す。streamの最初のJSONで種類を区別し、Terminal・大きい転送は別のstreamとして足せる。枠は4 byte big endianの長さとUTF-8のJSONである。大量の出力が承認や停止を待たせないようにする。
- 要求と通知の型は `packages/protocol` に置き、HostとClientで共有する。受け取った側は知らない項目を読み捨て、必要な項目の形・範囲・権限だけを検査する。開発バージョンでは古いHost・Clientとの互換の分岐は持たない。
- 送信が完了したことを、CLIが受け取ったこと・作用が終わったことと混同しない。作用の要求には操作IDを付け、同じIDの重複だけを抑える。接続が切れた時、結果の分からない要求を自動で送り直さない。
- 接続が切れても作業は失われない。Clientはユーザーの操作なしに再接続し、Hostから現在の状態を取り直す。CLIの画面とTerminalは保持した画面から戻る。生存確認の失敗は接続を閉じる理由であって、作業の消失とは扱わない。
- スマホが背面にある間は接続を保つことを前提にしない。前面へ戻った時に再接続して追いつく。
- HostのローカルAPIはloopback TCPとトークンを使う。portとトークンはHost専用の保存先に本人だけが読めるファイルで置く。`iori invite`はこのAPIから招待を発行し、登録されたデバイス名を受け取る。

### endpointの設定

Hostは `apps/host/native/` の自前Node addon（napi-rs）からRustのirohを呼ぶ。設定は `crates/iori-iroh-config/` に置き、Clientも同じコードを使う。両側のirohは1.1.0、ALPNは `iori`。addonは汎用の接続・stream・鍵・切断通知だけを扱い、要求形式・デバイスの登録・認可はHost側が持つ。

自動のポート開放・公開の探索・GSO・MTU探索は両側で無効にする。Relay未設定時は `RelayMode::Disabled`、設定時は指定した1か所だけを含む `RelayMode::Custom` とし、n0の既定Relayは使わない。指定Relayに対するQUICのアドレス発見は `RelayConfig::from` の既定値を使い、直接経路への切替とholepunchはirohに任せる。初期MTU・keep-alive・idleとQUICの経路設定はirohの既定値を使い、アプリに固定の時間切れや独自の生存確認を持たない。Clientは同じデバイスの鍵を持つendpointを1つ共有し、登録済みHostのRelayをRelayMapへまとめる。同じRelayの同じデバイス鍵への重複接続を避け、別URLのトークンはRelayConfigごとに分ける。同じURLのトークンが異なる時は、最後に変更を受け取ったものを使い、この順序もOSで保護した領域へ保存する。AndroidのJNIの初期化はTauri（tao）の起動処理に任せ、二重に行わない。

### Hostの通信診断

Hostはstderrへ `iori-host <event> key=value ...` の1行で起動、Endpointの喪失・再作成の失敗・復旧、接続上限・ハンドシェイク失敗、1秒を超えるイベントループの遅れを記録する。接続の開始と終了は公開鍵の先頭8文字・その時点の登録状態を付け、終了には理由と接続していた秒数も残す。Host停止中の終了は記録しない。同種の繰り返しは1分ごとに件数と最後の値をまとめ、接続の開始・終了はデバイスごとに分ける。Linuxでは10秒ごとに、自分のsocket inodeと待受portに一致するUDP受信キューを読み、0より大きい値が3回続いた時（`udp-receive-queue-stuck`）と、その後0に戻った時（`udp-receive-queue-drained`）を記録する。読めない環境では省略する。Rustのiroh/noqは標準のtracing形式でwarn以上をstderrへ出し、`RUST_LOG` があればその指定に従う。鍵・トークン・招待・環境変数は記録せず、ioriの記録ではエラー中の公開鍵を先頭8文字に短縮する。Rustのtracingは公開鍵を短縮しない（公開鍵は秘密ではない）。受信キューやイベントループの観測から接続を閉じたり再起動したりはしない。irohは大きなネットワークの変化（dockerのネットワークの作成・削除でも起きる）で待受ソケットを閉じて同じportへ作り直し、それがport使用中などで失敗すると、全transportの受信失敗として受信の担当（noqのEndpointDriver）が終わり、以後は戻らない（[iroh #4289](https://github.com/n0-computer/iroh/issues/4289)）。このためHost停止中でないのに `accept()` がnullまたは例外で終わった時は、古いEndpointを閉じ、同じ鍵・待受先で作り直して受付を再開する。bindに失敗した時や、作り直した後に1件も受付できないまま再び止まった時は、1秒から倍増、最大30秒の間隔でHost停止まで再試行し、1件受付できたら間隔を戻す。接続中のClientは一度切れて自動で再接続し、Host本体・Terminal・CLI・チームは続ける。addonは接続が閉じた時にConnectionとそのStreamのnative資源を明示的に解放し、JavaScriptのGCが走るまで古いsocketを保持しない。同じ理由で、Clientが取り消したstream（STOP_SENDING）にはHostがRESET_STREAMを返し、eventsの購読もその時点で解除する。返さないと、取り消したstreamがGCまでQUICの同時stream数の枠を持ち、取り消しを繰り返すと接続の全ての要求が止まる。閉じた後の操作はエラーを返し、終了通知と相手の公開鍵は引き続き読める。

Linuxで接続不能が再発したら、再起動の前に次を採る。`ss` はClientで再接続する前後にも採り、時刻と受信量の変化を比べる。同じユーザーの `iori-host invite` はHost手元のlocal経路を通るため、応答するかでJSが動いているかを確かめる。応答しなければこのコマンドだけCtrl+Cで中断し、以降の採取へ進む。招待コードは記録へ貼らない。journalに `diagnostic-report-unavailable` が出ていたら `kill -USR2` は送らない。診断用のsignal受付が設定されておらず、既定の動きでHostが終了する。

```sh
journalctl --user -u iori-host.service --since today --no-pager
iori-host invite
ss -uanmp '( sport = :49171 )'
host_pid=$(systemctl --user show iori-host.service -p MainPID --value)
# journalにdiagnostic-report-unavailableが出ていない場合だけ
kill -USR2 "$host_pid"
top -H -b -n 1 -p "$host_pid"
cat /proc/"$host_pid"/task/*/wchan
# gdbがある場合（採取中だけHostを一時停止する）
gdb -batch -p "$host_pid" -ex 'thread apply all bt'
```

SIGUSR2はNodeの診断レポートをHost保存先の `diagnostics/` へ出す。JSのメインスレッドで書くため、JSが止まっていると出ない。環境変数とnetwork interfaceの列挙を除外し、Nodeのスレッド・資源・stackの状況を残す。tokioのスレッドはレポートに含まれないため、`wchan` と、あればgdbでスレッドごとの状況を採る。レポートにはローカルpath等が含まれるため共有前に確認する。WindowsではSIGUSR2による取得は行わない。

## CLI

どのCLIも、CLI自身の画面（PTY）で使え、チームを含む主な機能を使える。

- **起動と認証**: Hostは本人のユーザー・環境・PATHで、本人が入れた未改造のCLIを起動する。CLIの認証・設定・Skill・hooks・MCP・sandboxをそのまま使い、認証情報をioriへコピーしない。独自のlogin、認証トークンの収集、APIへの暗黙の切替をしない。CLIの画面は、Hostの既定シェルを開いたTerminalでCLIの起動コマンドを実行する（Orcaと同じ）。シェルの設定・alias・PATHがそのまま適用され、CLIを抜けるとシェルに戻る。CLIの検出は本人のログインシェルの環境（PATHなど）で行う。解決したコマンドのファイルが変わった時はバージョンを取り直し、次の起動の引数とhooksの可否に反映する。

  Windows以外の対話シェルでは、bash・zsh・fishは初期化ファイルを読み込んだ後にioriコマンドの場所をPATHへ足し（bashはVS Codeと同じく非login シェルの初期化でlogin用ファイルの読み込みを代行するため、`.bash_logout`は実行せず、`shopt login_shell`はoffになり、`logout`ではなく`exit`で抜ける）、それ以外のシェルでは起動・再開の行にPATH設定の前置きが出る。

  Windowsでは、CLIの一覧等のコマンド解決でNodeも同じシェルから求め、同じ更新の契機で取り直す。起動・再開・バージョンの取得ではその結果を使い、Nodeを探すためのシェルを増やさない。起動ごとに標準のnpm・pnpmのNode用 `.cmd` shimを読み、その場所の `node.exe`（無ければ解決済みのNode）と本体のスクリプト・固定引数を直接呼ぶ。Nodeが実行ファイル（`.exe` / `.com`）でない場合や、本体のパスに `%` を含む場合は元のshimを呼ぶ。再開用には元のCLIコマンドを保存する。独自のバッチ・alias・functionは迂回しない。ioriが作る引数は共通の起動処理で、シェルの実行ファイルからPowerShellのバージョンを選び、PowerShell 7の外部実行ファイルへは呼出し内だけ `Standard` の渡し方、Windows PowerShell 5.1へはWindowsのCランタイムの引用規則と `--%`（シェルによる再解釈の停止）を使い、一時的な環境変数から渡して終了時に元へ戻す。5.1は引数の値を環境変数へ代入する式を外に置き、`--%` を含む短い呼出し本体だけを同じシェル内で復元する1行のスクリプトにし、表示中のシェルへ送る再開の入力に実改行を含めない。cmdへは同じ引用にcmdの特殊文字の保護を重ねる。PowerShell内のスクリプト・alias・functionにはシェルの文字列として渡す。バッチを呼ぶ時も、ユーザーの起動時の引数はPowerShell自身に評価させ、ioriが作る引数だけをcmd向けに保護して渡す。ユーザーが書いた起動時の引数はシェルの式のまま保つ。 `NODE_PATH` などの環境変数を設定するpnpm shimの派生形はバッチのまま呼び、JSONの値は保つが改行は保証しない。cmdの起動行に含めた実改行はコマンドの行の境界になるため、実行ファイルと解決したnpm shimにもそのまま渡せない。 cmdからnpm shim以外の独自バッチへ渡す引数は、先頭の `^` が失われる場合があり、この組合せは保証しない。PowerShellの文字列内では通常の単引用符と `‘`・`’`・`‚`・`‛` を二重にする（[PowerShellのコード生成](https://github.com/PowerShell/PowerShell/blob/master/src/System.Management.Automation/engine/lang/codegen.cs)）。引用の規則は [PowerShell](https://learn.microsoft.com/en-us/powershell/module/microsoft.powershell.core/about/about_parsing?view=powershell-5.1#the-stop-parsing-token) と [WindowsのCランタイム](https://learn.microsoft.com/en-us/cpp/c-language/parsing-c-command-line-arguments?view=msvc-170) に従う。

- **一つの会話に書き込むのは一つ**: 同じ会話を複数のデバイスで開いても、CLIのプロセスはHostが一つだけ持ち、出力を全てのデバイスへ届ける。操作したデバイスへ操作権が移る。
- **CLI自身の画面（PTY）**: CLIをPTYで動かし、Terminalと同じ仕組みで画面を届ける。使い勝手と各CLIへの対応は、PTYでCLIを使う既存製品のOrca（[stablyai/orca](https://github.com/stablyai/orca)）を手本にする。
- **worktreeの準備**: Hostはmain worktreeの実パスをキーに準備コマンドをSQLiteへ保存する。新しいworktreeを使う起動だけ、同じTerminalの既定シェルへコマンドを渡し、`IORI_ROOT_PATH` はPTYの環境へ渡す。POSIX系は `-l -i -c`、PowerShellは `-Command`、cmdは `/s /c` を使い、PowerShellの外部コマンドの終了コードは `$LASTEXITCODE` で保つ。Host本体が終了を受け取り、成功した時だけ、そのTerminalの画面・購読を保ったまま通常のCLI起動へ進む。コマンドと保留中の起動・失敗の終了コードはHost本体が保存し、Terminalのデーモンに新しい処理を持たせない。
- OpenCode V2 は Terminal ごとに `--standalone` で起動し、モデルとvariantの一覧も `opencode api --standalone model.list` で取る（`--standalone` が無いと固定のポートの常駐サービスを使い、HOME を分けても本人や他の実行のサービスとぶつかる）。チームの候補で選んだvariantはモデル名に `#variant` を付けて起動時の `OPENCODE_CONFIG_CONTENT` に渡す。V1は起動時のvariant指定に対応しない。止めた子へ `send` して再開する時は、手引き・履歴・保留中の依頼を1つの `--prompt` にまとめて `--session` と一緒に渡し、PTY へ貼らない（V2 は会話とモデルの準備が済んでから `--prompt` を自動で送る。貼ると準備の前の Enter が捨てられて送信されない。#329）。V1 は今までどおり貼り付けで渡す。
- Codex は iori のタブごとに状態を分けるため共有 server を使わずに起動する（iori で開いた Codex は `codex agents` に出ない）。バージョンを確認できない時や、共有 server を使わない起動に対応していないバージョンでは、状態のインジケーターを出さない。
- **承認待ちと状態**: Claude Code・Codex・Pi・OpenCode・Antigravity CLIは、CLIのhooks・extensionから承認待ち・入力待ち・応答中・完了を受け取り、Attentionと通知へ出す。Host内部の待ちの判定と入力の保留は即時に行い、全CLI共通の公開経路で承認・質問待ちの表示だけを1秒遅らせる。見せる前に待ちが解消して直前に公開していた状態へ戻った場合は、内部・公開の開始時刻を引き継ぐ。Cursor CLIは承認待ちを外へ知らせる仕組みを持たないため、hooksから応答中と完了だけを受け取り、承認はCLIの画面で答える。CLIが自動の審査に回した承認は、ユーザーの判断待ちにしない。その他のCLIは、CLIがTerminalへ出す題名（OSC 0/2）と注意音（BEL）だけを補助に使い、承認待ちは推測しない。Claude Codeは中断時に通知が来ないことがあるため、判断待ちの間にそのCLIの画面へ送ったEsc・Ctrl+Cでも判断待ちを解く。この規則はClaude Codeの定義が持つ。画面の文字の規則や出力の静止から承認待ち・完了を決めない。CLIが応答をエラーで終えた合図は、アダプタが失敗と短い理由へ変換する。Codexではエラー時にStopが来ないため、UserPromptSubmitの会話ファイルを変更通知と応答中だけの定期的な補助読取で読み、rolloutの`task_complete.error`を使う。Stop・中断・次の入力・CLI終了で監視を終え、Host再接続時は保存済みの会話ファイルから最新の応答の監視を再開する。未対応の記録は状態の根拠にしない。理由はエラー専用の文字列から選び、通知と同じ秘密値の除去を通して一行に短くし、生のpayloadや会話本文を理由として転送しない。
- **hooksの取り付け**: ioriはCLIの設定（`~/.claude/settings.json`、`~/.codex/hooks.json` など）にioriのhookの項目を足す。一覧ではioriで開いたことがあるCLIだけを先に準備する。初めての起動から状態のインジケーターを出すため、どのCLIもhookの取り付けを終えてから起動する（チームの起動、部品を起動の引数で読ませる定義（`plugin-file` の `args`）の部品のコピーも同じ）。OpenCodeでは、セッションの通信フォルダーの許可を足すconfig hookの配置も含む。配置に失敗しても起動を続け、CLI自身の許可確認に任せる。同じCLIの取り付けはシェルをまたいで共有し、失敗した時は次の起動で再試行する。開いたCLIは最後に使ったCLIと同じHostの保存先に記録する。hookの送信は応答の正常終了・失敗・切断で待ちを解き、後の状態の送信を止めない。hookはioriが起動したPTYに渡す環境変数がある時だけHostへ知らせ、iori の外で直接起動したCLIでは、CLIが必要とする中立の応答だけを返して終わる。ユーザーの項目は変えず、取り付け・片付け・撤去ではHOME共通の `~/.iori/hooks/hosts/` にHostの保存先と使用する項目を記録し、ほかのHostが使う出来事と共有の部品を残す。保存先が既に無いHostの記録は次の操作で削除する。hookのコマンドはそのCLIの定義の `id` を持ち、Terminalは他のCLIの `id` の知らせを捨てる。`id` の無い知らせ（更新の前から動いているCLIの旧いコマンド）はそのTerminalのCLIの知らせとして受けるので、Hostの更新をまたいで続くCLIの状態は途切れない（[CLIの定義ファイル](design/cli-definitions.md#hooks)）。CLIが新しいhookに信頼の確認を求める場合（Codex）は、CLI自身の形で信頼を記録し、直接起動した時に確認の画面を出さない。
- **CLIごとの違い**: hooks・使用量・モデル候補・起動定義はCLIごとに違う。アダプタがその違いを持ち、CLIが返す候補と値をそのまま使う。CLIが返さない値をHostが推測して補わない。アダプタは、値で書いた定義ファイルと、定義で表せない処理だけを持つコードからなり、Hostは他の人が書いたコードを自分のプロセスへ読み込まない（[CLIの定義ファイル](design/cli-definitions.md)）。
- **定義のアイコン**: 正式対応と同梱の定義のアイコンはClientに同梱した素材を名前で引き、最初の表示から出す。ユーザーが定義のフォルダーへ置いたアイコンは、Hostが画像の中身の要約（hash）をCLIの一覧に載せ、Clientが認証済みの要求で中身を受け取って `<img>` で描く。Clientは外のURLを読まない。
- **定義ファイルの部品とスクリプト**: プラグインだけを持つCLIの部品は、CLIのフォルダーへ置く（`to`）か、ioriのフォルダーへコピーして起動の引数で読ませる（`args`。CLIの設定の場所の切り替えに左右されない）。部品は、hookと同じ受け口（`IORI_CLI_HOOK_URL`）へ `"iori": 1` の共通の形を送り、Hostは型・列挙・数値だけを確かめて同じ状態へ合流させる。トークン量・利用枠のスクリプトは、Hostが同梱するNode.jsでHostとは別のプロセスとして、本人のログインシェルで起動する。環境はログインに要る変数を土台とし、WindowsではWindowsのログオンと同じ順（システムのレジストリ → 土台 → ユーザーのレジストリ。`PATH`はシステム;ユーザーを連結し、`REG_EXPAND_SZ`は組み立て中の値で展開する）で組み立てる。レジストリはWindows PowerShell 5.1からUTF-8で読み（`reg.exe`は日本語版で非ASCIIが化ける）、読めない時は土台だけで続けて `iori-host windows-login-environment-unreadable` を記録する。Hostの環境変数は引き継がず、ioriの秘密（`IORI_*`・Forgeのトークン・チームの秘密値）を渡さない。シェルの初期化の表示と分けるため、実行の前に区切りを出させて区切りの後の出力だけを読み取る。同じ定義のスクリプトは順に動かし、固定の時間切れで失敗にしない。Boardの表示は、スクリプトで測る子は前回の値を使い、測り直しを待たない（止まったスクリプトが画面を止めないため）。
- **Hostの再起動**: CLIのプロセスが失われた応答は中断として閉じ、同じ会話を続けられる。止まった応答を自動で続行・再送しない。
- **CLIの更新**: 検証と日常の環境は公開されている最新バージョンを使い、古いバージョンへの互換は作らない。バージョンを上げたらリリースノートを読み、アダプタを合わせる。

## Terminal

TerminalのデーモンがPTYを持ち、入力・サイズ変更・出力をTerminalごとに順序付ける。Terminalの所属するworktreeは作成時に保存し、シェルが知らせる現在のcwdと分ける。デーモンはheadlessのterminal emulatorで画面と一定量の履歴を保持し、Clientは再表示・再接続の時に保持した画面から復元してから後続の出力を受ける。Clientが離れてもPTYは続く。PTYの大きさは、その画面を最後に開いた・操作したデバイスに合わせる。他のデバイスの入力は止めず、そのデバイスで開くか操作すると大きさがそちらへ移る。PTYと画面の保持はHost本体と別のデーモンが持ち、Host本体の再起動・更新をまたいで続ける（[Hostの再起動・更新をまたいでTerminalを続ける](design/terminal-daemon.md)）。デーモンごと失われたPTYを、同じPTYが続いているように見せない。Terminalの出力に含まれる制御文字からclipboard・URL・OSの操作を自動で起こさない。

Terminalごとに専用の双方向streamを使い、snapshotと後続出力の境界をデーモンが確定し、Host本体が中継する。Clientのnative側は画面が一つのframeを適用してから次を読み、受け手が遅い時は通信へ待ちを伝える。Hostは出力を短い間隔でまとめて1つのframeにして送る（PTYの細かい読み取りごとにframeを作ると、受け手のframeごとの往復が上限になり、止めた後の出力が長く続く）。接続している全ての受け手に送信待ちが溜まっている間だけPTYの読み取りを止め、どれか一つでも追いついたら読み続ける（スマホを置いてPCで見ている時に、スマホの受信が止まってもPCの出力を止めない）。入力はこの待ちを通らず先にPTYへ届く。追いつけない受け手は更新の出力が1つのまとまり分を超えて待つ時にそのstreamだけを閉じ、保存画面から開き直す。更新の出力と復元用の保存画面のbytesは別に数え、大きな保存画面そのものを理由に開き直しを繰り返さない。Hostは現在のPTY寸法とは別に直近のPCの寸法を保存し、スマホの縮小表示へ渡す。受け付けた入力はstreamの付け替え（幅の変更・全履歴の再読み込み・開き直し・タブを閉じる）をまたいでも捨てない。Clientは開通を待つ間の入力も列に受け付けてそのstreamの開通後に順に送り、列を送り終えてから古いstreamを解除する。送信はRESETでなくFINで閉じる。Hostは出力を打ち切った受け手からもFINまで入力を読み、置き換えられた古いstreamの入力では寸法を変えない。PTYへ渡した入力は結果が不明でも自動で再送しない。

デーモンとHost本体は保存先ごとに分かれたローカル接続を使う。Linuxは本人だけが読めるUnix socket、Windowsは実行ユーザーのSIDだけを許すnamed pipeを使う。接続の最初にデーモンが生成したトークンとやり取りのバージョンを確かめる。要求・応答・PTYの生出力を同じ接続で中継する。Hostが出力を処理した応答と受け手の送信待ちをデーモンへ返し、PTYの読み取りを制御する。画面を開く時はデーモンの出力を順序どおりに一時保留してsnapshotを取り、後続出力へ戻す。デーモンはSQLiteを開かず、Host本体が現在のTerminalと画面の保存を担う。同じバージョンのデーモンへ再接続した時はデーモンの現在の状態を取り込み、バージョンが違う時は画面を受け取ってデーモンを止め、既存の再開経路へ戻す。Windowsのnode-ptyはPTYの終了を出力のsocketの`close`で知らせるので、出力の読み取りを止めたまま止めると終了が届かない。デーモンは同じsessionの停止を1回だけ始めて後の要求に共有し、停止中は読み取りの一時停止を解いて出力を捨てる。バージョン4〜13の古いデーモンはshutdownの中で読み取りを止めたまま終了を待つため、新しいHostは古いデーモンを止める時、`attach`・`activate`で出力を流しながら全sessionを`kill`し、終わってから`shutdown`を送る（復元にはkillの前の画面を使う）。デーモンの異常終了も同じ再開経路を使う。

デーモンのバージョンをまたぐ停止用の約束は変更しない。`<保存先>/terminal-daemon/connection.json` の場所と、`endpoint`・`token` の名前・型・意味は変えない。ローカル接続のframeは4 byteのbig-endian長さとUTF-8 JSONで、要求は `{kind:"request", id, method, args}`、応答は `{kind:"response", id, value}`（失敗時は `error`）とする。最初の `hello` は `args:[token]`、応答は `{version:number, pid:number}`。認証後の `shutdown` は `args:[]` で、PTYを止めて最後の画面の配列を返し、応答を送ってから接続を閉じる。これらの名前・型・意味を、`DAEMON_PROTOCOL` を上げても変えてはいけない。

停止応答の各画面は `{id, pid, live, exit?, snapshot, title?, cwd}` を維持する。`snapshot` はANSI文字列の `snapshotAnsi`・`scrollbackAnsi`・`rehydrateSequences`、`cols`・`rows`、`modes` を必須とし、`pendingEscapeTailAnsi`・`frameRestoreAnsi`・`oscLinks` とデーモン用のメタデータを任意とする。既存項目の型と意味は変えず、項目追加だけを認める。Hostが読み込めない画面は捨て、SQLiteの保存画面で再開を続ける。connection.jsonが読み込めない時もデーモンなしとして起動する。Unix socketのdirectoryとWindows named pipe名は起動ごとの乱数を含み、古い口と衝突させない。connection.jsonは書込みをfsyncしてからrenameする。

デーモンが持つのはPTY・emulator・出力の順序と流量制御・生のhooksとioriコマンドの受け口である。CLIの起動引数・環境変数・cwd、hooksの解釈、題名・OSC/BELの意味づけ、入力待ちとkittyキー入力の判定、チームと使用量はHost本体が持つ。デーモンはHost不在中もTerminalへの問い合わせに答えるため、emulatorのmode・色・Terminal属性の応答を持つ。Hostの投影用emulatorは題名・mode・cwdを読み取るためだけに使い、その画面をClientへ送ったり保存したりしない。画面の正本はデーモンだけで、両者の内容や出来事の番号・件数を照合せず、違いによる拒否・停止・作り直しをしない。再接続ではデーモンの現在のsnapshotを再読み込みする。

CLI hooksとioriコマンドの受け口はデーモンの寿命に合わせる。Host本体が不在の間は生のhook payload、iori要求、PTY終了をデーモンが保持し、hooksとPTY終了は本体が受け取った時点で取り除く。チーム処理は本体内で順序付けて進め、失敗は記録し、後の出来事の配送を止めない。iori要求は本体の処理結果を返す。生出力の履歴やHost内部状態はデーモンへ保存しない。不在中の途中の題名やBELは再送せず、現在の画面から再開する。HostはCLIの観測済み状態・起動の記録・保留入力をSQLiteへ保存し、シェルへ戻ったかは再接続時に実プロセスの前面状態も観測する。ioriコマンドは本体のチーム処理の準備を待って渡す。渡した後に接続が切れた要求は結果が不明なので自動再実行しない。チーム・CLIの探索と起動定義・デバイス認証・Files・GitはHost本体が持つ。画像の一時ファイルはHost再接続では残し、Terminalを閉じた時と新しいデーモンの起動時に回収する。

配布物のNode・native・デーモンが読み込むコードと依存パッケージだけを、保存先の `terminal-daemon/runtime/<版>/<起動ごとのID>` へ複写する。読み込み範囲はbuild時に生成し、CLI定義・チーム・Hostの全コードは複写しない。Windowsの権限を扱う小さなnative addonを通信のiroh addonから分け、デーモンには前者だけを含める。稼働中のデーモンは入れ替える配布フォルダーを参照しない。新しいデーモンの起動時に以前の複写を回収し、Windowsで終了直後のファイルがまだ開かれている時は次の起動で回収する。Linuxではsystemd userが使える場合に別の一時unitで動かすため、Host本体のunitを再起動してもデーモンは残る。固定unitの導入を増やさず、保存先ごとの検証Hostにも同じ分離を使える。systemd userの無い開発環境とWindowsでは短いbootstrapから切り離して起動し、bootstrapは起動完了後に終了する。Host本体の通常終了はデーモンを止めない。撤去・検証の後片付けは `iori-host stop-terminals` で明示的に止める。

WindowsのPTYのbackendとOSのbuildはHostが知らせ、ClientのOSから推測しない。Clientはこの情報をxtermのWindows互換設定に使い、ConPTYの時はVS Codeと同じくカーソル行も折り返し直す（`reflowCursorLine`。Hostの画面も同じ条件にする）。狭めた時にプロンプトの末尾が欠けるのを防ぐためで、広げた後に入力がプロンプトに重なるのはPSReadLineの不具合（PowerShell/PSReadLine#3637）なので扱わない。Hostは新しいTerminalを、PCの画面が最後に取った寸法で始める（Host起動の直後でまだ無い時は80×24）。チームの子のように誰も開かないまま動くCLIは、その幅で行を描き、終了後は描き直されないため。Clientは操作していない画面の自動fitで共有PTYの大きさを奪わない。streamのopenには大きさを取るかを渡し、自動の開き直しでは現在の持ち主のviewが離れていても大きさの持ち主を変えない。ユーザーが開く・操作する時だけ大きさを取る。Clientは画面の寸法の変化が落ち着いてから一度だけ測り（初回・再表示・サイドバーの開閉・ウィンドウの幅の変更を同じ経路で集約し、ペインの境界のドラッグは離した時）、実寸法が0の間は測らない。最初のstreamは測った寸法で開き、途中の寸法をCLIへ送らない。途中の寸法の往復でCLI自身が落ちることがある。Androidの背面移行ではstreamを閉じ、前面復帰では保持した画面から大きさを取らずに開き直す。

## Orcaから流用する部品

CLIの画面とTerminalは、Orca（[stablyai/orca](https://github.com/stablyai/orca)、MIT）の次の部品を持ってくる。コピーしたファイルには元の著作権表示と許諾文を残す。

| 部品             | 持ってくるもの                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| ---------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 題名とBEL        | OSC 0/1/2の題名とBELの解析（`osc-title-extraction.ts`ほか）                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| 既知のCLIの題名  | CLIの見分けと「動いている」表示だけ。題名から承認待ちを出さない                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| CLIの起動と探索  | 起動定義の一覧とPATHの探索（`command-path-resolver.ts`の探索部分、GUI用のinstall dirの探索）。`claude-agent-teams`と`--trust`系の引数は削除する                                                                                                                                                                                                                                                                                                                                                                     |
| 会話の再開       | CLIごとの会話IDの取り出しと再開の引数（Piはsession fileが要る）。IDの無いCLIは同じコマンドで起動し直す                                                                                                                                                                                                                                                                                                                                                                                                              |
| hooks            | 5つのCLIの設定への取り付け・script・状態の対応表（Cursorは観測のeventだけで、許可を返すhookは登録しない）。受け口はTerminalデーモンのローカルAPI。Codexの信頼はCodex自身のhash（app-serverの`hooks/list`）で記録し、自動reviewの担当がいる時の承認は判断待ちにしない                                                                                                                                                                                                                                                |
| スマホのキー     | キーの定義・送るbyte・並べ替えの計算（`terminal-key-definitions.ts`、`terminal-accessory-keys.ts`、`terminal-accessory-layout.ts`の純粋な部分）。画面はioriで作る                                                                                                                                                                                                                                                                                                                                                   |
| 画面の保持と復元 | headlessのemulatorと復元の補助（`headless-emulator.ts`と関係するhelper）。xterm系のバージョンとpatchはOrcaにそろえる。復元した画面へのTerminalの問い合わせに答えない。新しいプロセスと再接続でmodeのリセットを分ける                                                                                                                                                                                                                                                                                                |
| node-pty         | 1.1.0に、OrcaのpatchのうちLinux・Windowsに適用されるもの（FDの継承、閉じたFDへの書き込み、EAGAIN、Windowsの子プロセスの後始末とpipe）を当てる。Windowsは作者のprebuildを使わず、Windowsの全てのbuildの入口が共通helperでpatchから作り直し、配布物の静的検査でpatchのexportsと、動いているTerminalの判定に使うコンソールのプロセス一覧の部品（`conpty_console_list.node`）を読めることを確かめる（prebuildのままだと二重のConPTYの停止でデーモンが落ちる。一覧の部品が無いと動いているTerminalを閉じる確認が出ない） |
| 日本語IME        | Orcaのxtermのpatch（確定の取り合い、未確定文字の表示、変換窓の位置）とPCのIMEの補正                                                                                                                                                                                                                                                                                                                                                                                                                                 |

持ってこないもの: PCの入力のlock・取り戻す操作・自動復帰の時間、hookのeventのspool、完了の通知の保留・題名の時間による解除・画面の静止の判定、`--trust`系の引数、Codexの設定フォルダーの分離。

## FilesとGit

worktreeの削除はHostが確認用の対象を保持し、CLI・Terminalの終了を待ってから子、親の順にGitへ削除を依頼する。lockの解除や削除の自動再送は行わない。削除直後にパスの有無を確かめる。取り込み判定は作成時の起点と `git merge-tree` のtreeで行う。ioriが作成したworktreeの起点はそのGit管理ディレクトリに保存し、worktreeと一緒に削除する。外部で作られたworktreeはブランチの作成reflogを使う。

FilesはHostのOSのファイルを読み込むだけで、編集しない。Gitは本人のGitで状態・差分・履歴を読み込むだけで、書き込み操作は作らない。Gitの読取でexternal diff・textconv・pagerを起動しない。開いたフォルダーの外へsymlinkやパスで逃げる読取はしない。「ファイル」のタブは、そのファイルのフォルダーを開いたフォルダーとして読む（登録したデバイスはHostのどのフォルダーも開けるので、読める範囲は広がらない）。Agentが触れる範囲はCLI自身の許可に任せ、Hostは許可フォルダーを持たない。

FilesとGitのOS監視はHost内の共通Workerで動かす。変更の通知は短い間まとめてから一度だけgitを読む（通知1件ごとにgitを起動しない。Hostはメモリが大きくforkが重い）。.gitの中はHEAD・refs・config・worktreesなど一覧とpush先に影響する変化だけで再取得する。再帰監視の開始・変更時の同期走査が、本文・一覧・ほかの要求の処理を止めないようにする。同じdirectoryの監視は共有し、最後の購読が終わると回収する。監視の準備中にも読み取りを進め、準備完了時に再取得を知らせて、その間の変更を反映する。

Filesのsyntax highlightは、HostがShiki（TextMateの文法。Onigurumaのwasm）でファイル全体を先頭から色分けし、行ごとの色の種類（コメント・文字列などの固定の分類）を行の範囲の要求に応じて返す。色分けはHostのworker threadで行い、本文の読取・Terminal・ほかの要求の処理を止めない。結果はfileのrevisionに結び、変わったら捨てて色分けし直す。ただし同じfileが大きくなっただけ（追記）の時は、前の色分けを引き継いで増えた所から続ける。取り消された要求と古いrevisionの色分けは途中でやめる。1行の色分けはVS Codeと同じく500msで打ち切り、その行は色を付けずに次へ進む。色そのものはClientのテーマのトークンが決める。

ForgejoやGitHubなどのForgeのAPIへのアクセスはHostが行う。Forgeの認証情報はHostで管理して対象のForgeへの通信にだけ使い、Client・会話・Agentの入力や道具の結果・診断へ渡さない。GitHubはHostの `gh` CLIのログインを使う。`gh auth status` のJSONからアカウント名と有効状態だけを取り、リポジトリで選んだ名前と、自動選択で実際にアイコンを取得できた名前を別々にHostのSQLiteに保存する。別のアカウントで読む時は `gh auth token --user` でトークンを一時的に受け取り、APIを読み込む `gh` 子processの `GH_TOKEN` だけへ渡す。APIの権限不足・不存在と通信障害はghの終了結果とHTTPエラーの出力で区別し、通信障害ではアカウントを替えず最後のアイコンを保つ。トークンは保存せず、ghのstderrも外へ出さない（[Git View](design/git-view.md#画面の構成)）。

Forgejo・Giteaのトークンは、サイト（Webのorigin）ごとにHostのOSの資格情報マネージャー（Windows、Credential Manager）・キーリング（Linux、Secret Service）へ置き、それらが無い・使えないHostでは、Hostの保存先の本人だけが読めるファイル（Linuxは0600、Windowsは本人だけのACL）へ置く（`gh` と同じ）。HostのSQLiteには、サイト、保管先の種類、トークンの持ち主のアカウント名だけを持つ。トークンはそのサイトのoriginへの要求の `Authorization` にだけ付け、別のoriginへのredirectには付けない。外から受け取ったサイトのURLとトークンは設定の入口で形を確かめ、記録・エラー・Clientへの応答に含めない（[Forgeとの連携](design/forge.md#連携の設定)）。資格情報マネージャー・キーリングは `@napi-rs/keyring`（keyring-rsのNode binding）を使う時に読み込み、読めない環境ではファイルへ置いてHostを動かし続ける。LinuxではSecret Serviceを指定する（指定しないと、再起動で消えるkernelのキーリングへ黙って移るため）。資格情報マネージャー・キーリングが書き込みを拒んだ時もファイルへ置き、ファイルはWindowsではDPAPIでも暗号化する。資格情報マネージャー・キーリングの項目はHostの公開鍵で分け、同じOSユーザーの別のHostと混ざらないようにする。redirectは追わずに失敗にし、トークンを送り返すForgejoの401の本文は読み込まない。サイトの判定（登録・連携の一覧・アイコン）は、トークンを付けずに `/api/v1/version` を読み込み、バージョンか、サインイン必須のサイトが匿名の要求に返す403（`Only signed in user is allowed to call APIs.`）が返った時にForgejo・Giteaとする。トークンはそう分かったサイトにだけ送り、打ち間違えたURLへは送らない。登録はClientの取り消しでHostの問い合わせも止め、後で保存しない。Hostの撤去で保存データも削除する時は、Hostが止まる前に資格情報マネージャー・キーリングの項目を削除する。

Forgeを読み込めない理由は、画面とコマンドが共有する形（protocolの `ForgeReadFailure`）で返す。Forgejo・GiteaはHTTPの状態で決め、トークンの無いサイトの401・403・404は「トークンが無い」とする（非公開と不存在を区別できないため）。403は本文から足りない権限（`read:issue` など）を取る。GitHubは `gh api` の終了コード（4はログインなし）とstderrのHTTPの状態で決める。連携の行の状態は最後に読み込んだ結果とその時刻で、接続できないはサイトが答えた時、トークンが無効はトークンを付けた読み取りが通った時、権限不足はトークンを付けた同じ種類の読み取りが通った時に戻す。

Forgeの判定・CI（実行・ジョブ・ログ）・PR・Issue・開くURLは共通のインターフェースを通し、GitHub（gh）とForgejo/Gitea（`/api/v1`）のadapterがそれぞれ持つ。adapterはそのForgeで使える機能（CIのジョブとログを読み込めるか）を返し、画面とコマンドは使えない操作を出さない。GitHubのIssueの一覧に混ざるPull requestはadapterが除く。CIのログは範囲で読み、全体を一度に転送・保持しない。Forgejoは `Range` で範囲を読み取る。GitHubは `gh api` がログの転送先へ `Range` を渡さないため、Hostが一度ログを全部受け取り、頼まれた範囲だけをClientへ送る。Hostはアイコンを取得する時の判定をoriginごとに持ち、リポジトリのGit設定も同じ事実とGitのリモートを使う。リモートのホスト名とWebのoriginの対応はHostで共有し、作成後のコマンドとGitHubのアカウント名はmain worktreeのパスでリポジトリに結び付ける。

大きいファイル・差分・履歴は範囲で読み、一度に転送・保持・描画する量は有限にするが、それを読める総量の上限にしない。末尾まで読み進められる。

## 保存

**Host**: SQLite一つに、デバイスの登録・招待・失効、ワークスペースとフォルダーの履歴、チーム、CLIの会話IDとワークスペースの対応、Terminalの保持した画面だけを持つ。会話の本文、本文のコピー、照合用の番号は持たない。保存形式は現行の形だけを読み書きし、一般公開までは古い形式の変換を持たない。

チームは現在の定義、バージョンごとの定義・変更点・メモ、Hostのチーム設定を別の表へ保存する。定義・履歴・操作結果は一つのtransactionで保存し、メモの保存ではバージョンを上げない。同時実行の上限はCLI・プロバイダ・モデルの対象を明示して保存し、モデル一覧の取得に失敗しても対象を推測し直さない。CLI登録では、通常のタブを起動するコマンドを保ち、モデル・Effortの埋込用コマンドを別の項目に保存する。

Automationsの定義と次の予定は`automations`、実行の記録は`automation_runs`へ保存する。同じ自動化と予定時刻の実行は一つだけにし、起動前に記録を確保する。起動の結果が分からない回を自動でやり直さない。チームの会話・委譲の表は実行の記録に流用しない。予定の計算はHostのタイムゾーンで行い、起動には通常のCLI・チームの経路を使う。タイマーは最大60秒で掛け直して現時刻から予定を見直し、予定時刻まで60秒以内ならその時刻に合わせる。同じ分での発火は通常の実行、後の分での発火とHost起動時の過去の予定は停止中の予定として扱う。

AutomationのWebhookはHost本体のHTTPのエンドポイントで受け、Terminalのデーモンには置かない。Webhookで実行する自動化がある間だけ、irohの待受と同じ番号のTCPで待ち受ける（全てが「このマシンだけ」ならloopbackだけ）。送り元のアドレスとBearerのトークンを本文を読み込む前に確かめ、本文は1MiBまでだけ読み取る。トークンは`automations`とは別の表に保存して定義のJSONに混ぜず、比較は時間が一定の比較で行う。受けた内容は回ごとにHostの非公開領域へファイルで残し、指示ファイルのコピーにも付ける。

AutomationのIssueの契機は、Hostが自動化ごとに1分ごとにForgeを読み込む（Issueの一覧、更新時刻が変わったIssueだけ出来事の記録、読むアカウント）。Forgeの読み取りはAutomationsの直列の処理の外で行い、作業中の判定・回の確保・worktreeの作成・起動だけを直列の処理の中で行う。拾ったラベル（Issueとラベルを付けた時刻）は回の記録で一度だけにする。`iori pr create` はHostが呼んだCLIのworktreeでGitの普段の認証を使ってpushし（明示した1本のrefspec、forceとtagを送らない）、PRの作成だけをForgeの認証（`gh` のアカウント、登録済みのトークン）で行う。Forgeのトークンをgitへ渡さない。

**Client**: nativeのSQLiteに下書き・入力先・読み位置・配置をデバイスと入力先ごとに保存し、OSの鍵で守った鍵で暗号化する。切替・再起動・切断で削除しない。

Androidの鍵の暗号文とデバイス登録DBは、cloud backupとデバイス間の移行から除外する。鍵を復元できない状態で自動的に作り直さない。

**CLIの保存**: CLIの会話・設定・認証はCLI自身のもので、ioriは書き換えない。例外は、状態を知るためにCLIの設定へ足すioriのhookの項目だけである（[CLI](#cli)）。

## 表示と失敗

失敗が確定し、ユーザーが回復の操作をできる時だけ、対象のそば一か所に起きたことと回復の操作を表示する（[表示と失敗の案内](product.md#表示と失敗の案内)）。値の無い項目は項目ごと出さない。診断のための記録には本文・認証情報を常に複製しない。

Filesやチームの記録のMarkdownは生のHTML・scriptを実行しない。リンクを開く・保存するなどのOSの作用は、ユーザーの明示操作でだけ行う。

## 配布と更新

ClientはOSごとのTauriの成果物（WindowsはNSISの本人用インストーラー、Androidは同じ署名証明書のAPK）として配る。Androidのpackage名は `io.github.ioriapp.iori` とし、公開の後は変えない。署名鍵は作り直さない。HostはNodeのruntimeとnative moduleを含む自己完結の配布物として配り、ユーザーにNodeやpackage managerを求めない。HostはLinuxではsystemdのuser service、Windowsでは本人ユーザーで常駐し、導入にユーザーのアカウントのパスワードを求めない。

配布物はRelease情報にバージョンと各配布物のSHA-256を載せ、Ed25519で署名する。公開鍵の正本は [release-public-key.txt](../release-public-key.txt) で、秘密鍵はリポジトリに入れない。Release情報の署名鍵、APKの署名鍵、Windowsのコード署名、通信の鍵は別の鍵として扱う。

Hostの更新と再起動は、登録済みClientから通常の認証済み要求で受け付ける。Hostは接続時に現在のバージョン・起動ごとの識別子・Terminalデーモンの継続可否を伝える。配布物の場所はserviceの有無とは独立して受け取り、バージョンの取得に使う。Linuxのservice名は自身のcgroupから得て、得られない時も通常のHostとして起動する。更新先はClient自身のバージョンで、Hostが配布物に固定したHTTPS配布元の同じtagを取得する。署名済みRelease情報のバージョン・デーモンのprotocol・配布物の大きさとSHA-256を確かめ、公開鍵と更新処理をHostの配布物に含める。

更新処理は導入先の隣に作る専用フォルダーへruntimeと一緒に置き、Hostの外で実行する。Windowsでは置換対象のフォルダーを作業ディレクトリとして保持しないよう、bootstrapとworkerの両方を専用フォルダーで起動する。手動インストーラーも置換中は専用フォルダーへ移る。Windowsのフォルダー移動は、使用中の一時的な拒否をgraceful-fsの慣例（最大60秒、間隔は10msずつ増やして最大100ms）で再試行し、復元と手動導入でも同じ処理を使う。Host停止後に前のフォルダーとSQLite一式を控え、新しいHostのreadyを成功とする。ready前の終了では両方を戻して起動する。ready後の結果保存の失敗では、起動したHostを戻さない。停止済み・対象が無い時の停止は成功とし、Windowsの停止は更新と手動導入で同じ処理を使う。復元は停止・フォルダー・保存データ・起動をそれぞれ試み、一段の失敗で残りを飛ばさず、最初の失敗を結果へ残す。ただし停止を確かめられない時のSQLite上書きだけは、動作中のデータを壊さないため行わない。今回の控えは次の更新まで保持し、次の取得を始める時に前回の作業フォルダーごと回収する。回収できないフォルダーは記録して次回に再試行し、今回の更新を進める。Linuxではsystemdのnotifyを使い、更新中だけ自動再起動を解除し、更新処理が終了した時にも元へ戻す。WindowsのZIP展開はOSの.NETを使い、launcherのreadyと終了の通知を待つ。再起動はLinuxのsystemd、Windowsのlauncherが担当し、継続できるTerminalデーモンを止めない。Hostのバージョン・起動IDはready後に返す。操作IDごとの進行・結果はHostの保存先へ置き、再接続後に取得する。動作中のHostはLinuxの更新unit、Windowsの更新用の子の終了を検知し、結果が無ければ失敗を記録して次の明示操作を受け付ける。Clientは新しい起動IDの成功を古い起動からの応答で上書きしない。残った進行記録だけを理由に次の明示操作を拒否しない。

撤去は同じ認証済み要求と操作記録を使う。iori hooksと自動起動の登録を先に解除し、失敗したら変更した設定を復元して通常要求の受付へ戻す。復元できなかった段も結果に残す。その後、Terminalデーモンを止めて最後の画面を保存する。Hostの停止とファイル削除はOSのshell/PowerShellを使う別処理が担い、削除するbundleに実行中のruntimeを残さない。停止に失敗した場合は結果票と操作記録の両方へ失敗を書き、動いているHostは通常要求の受付へ戻って既存の監視からClientへ知らせる。結果票はHost保存先の隣の本人限定領域 `iori-host-uninstall` に置き、Host公開鍵と操作IDのJSON配列をSHA-256にしたファイル名で区別する。中身はHost公開鍵と操作のstatus（操作ID・段ごとの結果）で、鍵・登録・作業本文を含めない。Hostは実際の保存先から決めた結果票の絶対パスを、停止前の認証済み応答でClientへ渡す。このPCのClientは直接、SSH導入のClientは撤去の前につないだOpenSSHの接続を保ち、渡されたパスをシェルの引数として引用して読む。結果をClientへ保存してから結果票を削除する。招待だけのHostでは結果票が残り、回収の常駐処理や時間切れは持たない。Clientの撤去記録は既存の暗号化保存を使う。Hostが停止した後は、そのHostを一覧から削除する。

## Relay

利用の流れと表示は[Relay](design/relay.md)が持つ。Relayは暗号化したままの通信を運ぶだけで、復号の鍵・Hostの認可を持たない。Relayを通すかどうかで、Hostでの認可・失効・再接続の扱いを変えない。

HostはRelayのURLとトークンをHost設定へ保存し、WindowsではDPAPI、Linuxでは本人限定のSQLiteファイルで守る。認可済みの接続の応答・snapshotと設定変更のイベントでClientへ渡す。Clientは登録情報に結び付け、既存のOSで保護した保存領域へ保存する。招待はURLだけを持ち、トークンを含めない。外から受け取るURLとトークンはプロトコルの入口で形を検査し、トークンは `RelayConfig::with_auth_token` へ渡す。記録・エラー・招待へトークンを含めない。

保存済みのRelayの設定を読み取れない・復号できない時は、登録情報を保ち、Relay無しで起動する。Hostは秘密を含めず、そのことを1行だけ記録する。

設定変更の応答がデバイスへ届いたら、Hostは同じ鍵・portでendpointを作り直し、既存の自動再接続へ戻す。作業を持つHost本体・Terminal・CLIは止めない。Clientは次の接続で共有endpointへ最新のRelayMapを適用する。RelayMapが変わった時は共有endpointを作り直すため、ほかのHostも短く切れて自動で再接続する。接続の経路はirohの `Connection::paths_stream` の選択中の経路から取り、設定のHostの「接続」だけに表示する。

## チーム

チームの設定、計画、委譲とその記録はHostが持つ。子は通常のCLIの会話で、CLI自身の画面（PTY）で動き、Hostが渡すコマンド（`iori delegate` など）で委譲・報告・質問できる。子の状態はCLIの構造化された出来事やhooksから得て、子が書く文の書式に頼らない。親と子は同じHostで動く。時刻・外部の通知・別の作業の完了などで仕事を起こす機能を足す時は、その起動の記録をチームの記録と分ける。詳しい振る舞いは [Linked Agent](design/linked-agents.md) が定める。

ioriが起動するCLIのPTY（チームの親・子、チームでない会話、Automationの会話）にはRustのコマンド `iori` をPATHへ足し、呼び出し元のIDと秘密値を環境変数で渡す。ログインシェルのprofileはPATHを置き換えることがある（Debianの `/etc/profile` など）ので、POSIX系のシェルではCLIの起動コマンドの前でコマンドの場所をPATHへ置き直す。チームのコマンドはチームの親と子だけが使え、Forgeを読み込むコマンド（[Forgeとの連携](design/forge.md#aiエージェント向けのコマンド)）は全てのCLIが使える。CLIが書ける一時領域に、セッションごとの本人限定のフォルダーを作り、依頼と応答をファイルで渡す。完成したファイルへrenameし、変更の通知で読み、依頼は読み込んだ時に削除する。Linuxはdirectory 0700・file 0600、WindowsはHost本人のユーザー識別子を指定したACLを使い、sandboxの別ユーザーが作る通信ファイルにもHost本人の読み書きの権限を継承させる。OS共通のRustクライアントが引数と標準入力を依頼に変え、応答を標準出力と終了コードへ返す。Linuxの実行ファイルはsandboxから書けないTerminalデーモンのruntimeに置く。Windowsは実行ファイル1つだけを各セッションの通信フォルダーへ複製する。依頼・回答・固定の手引きなどCLIへ渡すファイルの配送用のコピーは、LinuxではHost保存先の `team-deliveries/` のセッション別フォルダーへ、Windowsではそのセッションの通信フォルダーへ置き、別セッションのsandboxから書き換えられないようにする。保存する正本と記録の参照はHostの非公開領域に残し、CLIへの一文と起動オプションはコピーの場所を渡す。再開時は新しいセッションの場所へコピーし直し、手引きのコマンドの絶対パスもそのセッションへ揃える。Windowsの実行ファイルのコピーと配送用のコピーは、セッションの通信フォルダーの回収と一緒に削除する。Automationの単独CLIも同じ一時領域の作成・配送・回収を使うが、チームのコマンドは受け付けない。コピーのフォルダーはチームと同じCLI定義の起動引数・環境変数で渡し、そのフォルダーを読めるようにする。それ以外の許可・sandbox・ネットワークは変えない。コピーはTerminalを閉じた時に回収する。通信フォルダーの場所をHostの本人限定の一覧へ作成前に記録し、Terminalデーモンを新しく起動する時には前のデーモンが残したコピーを片付ける。削除できなかった場所は記録に残して次の起動で再試行し、回収の失敗や記録の破損でデーモンの起動を止めない。継続中のデーモンのコピーは残す。CodexはOSの一時領域、Claude CodeはCLIが定める書き込み可能な一時領域を選び、ネットワークの許可を広げない。CLIのチーム起動時の許可は[Linked Agent](design/linked-agents.md#子の起動と作業場所)に従う。コマンドの依頼ファイルは一つずつ固定量で走査して認証情報だけを保持し、秘密値が合うものだけ本文を読み込む。Hostは秘密値を照合して親と子・所属会話を決め、他会話の子の操作と孫への委譲を拒否する。秘密値はメモリー・PTYの環境・処理中の依頼ファイルだけに持ち、画面・SQLite・起動引数へ出さない。この境界が防ぐのはAIの誤用であり、同じOSユーザーの悪意あるプロセスは防げない。

コマンドの受付は子ごとに進め、別の子の起動やworktree作成を待たせない。委譲・再開の割り当てはHost内で直列に進め、PTYの実際の終了まで同時実行の枠を数える。CLI固有のモデル・Effort・許可・指示の引数と、その引数の別名・値の取り方は各CLIの起動定義が持つ。保存する再開用コマンドにはセッションのパスを含めず、親と子の再開のたびに現在のチームの起動設定から引数を作り直す。チームの起動・再開では、保存した起動時の引数をシェルの規則で分け、その起動で役割から付ける項目と、その項目と同じ意味の別のフラグ（承認・sandboxを省くフラグなど）をユーザーの引数から値ごと削除する。重ねると足し合わされることをCLIが明記する引数は残す。語に分けられない場合はユーザーの引数を付けずに起動を続ける。Codexの再開時の回答は、公式の `resume SESSION_ID PROMPT` の引数で渡し、開始hookを受けるまで未配送の参照を残す。承認待ちのPTYへの入力は保留し、PTYへ書き込んだ時にだけ配送済みにする。チームの会話、タスク、子の担当と状態はSQLiteの別の表へ保存し、依頼・報告・質問・回答のファイルへの参照を持つ。本文そのものはSQLiteへ複製しない。

### 利用枠の残量

利用枠の残量は、CLIの起動定義が持つ監視アダプタで取得する。既存のログインシェル・CLIの認証と設定を使い、モデルを呼ばない。CLIの応答終了、利用枠のリセット、AIエージェントの画面を開いた時、Clientからの再取得の依頼（画面を表示している間の5分ごとと、ポップオーバーの「利用枠を更新」。[利用枠の表示](design/usage-display.md#再取得する契機)）で再取得し、まだ値の無いCLIは一覧の取得でも読む。同じCLIの再取得は60秒に1回までにまとめ、画面の移動ごとには再取得しない。値には読んだ時刻を付けて送る。取得できない値は表示・割り当ての根拠にせず、契約から返った枠だけを扱う。CLIが枠をモデルやグループごとに返す時は、その名前と対象のモデルを枠に持たせる。監視はHostの終了と一緒に閉じる。

- Codex: [公式app-server](https://learn.chatgpt.com/docs/app-server#6-rate-limits-chatgpt)の `account/rateLimits/read` と `account/rateLimits/updated`。
- Claude Code: CLI自身の `claude -p "/usage"`（セッションを保存しない指定付き）。モデルを呼ばず利用枠も使わない。結果は文で返るので、読み取れない形なら値を出さない。Claude.aiの資格情報をioriが読んで使用量のAPIを呼ぶ方法は、[Anthropicの規約](https://code.claude.com/docs/en/legal-and-compliance)が資格情報の収集・仲介を禁じるため採らない。
- Antigravity CLI: 取得しない。`agy -p "/usage"` はヘッドレスモードで、[Antigravityの案内](https://antigravity.google/docs/faq/)は個人向けプランでサードパーティのアプリの中から `agy` を包んで使うことを認めていないため。ユーザーが自分の判断で[定義ファイルの利用枠のスクリプト](design/cli-definitions.md#利用枠usage)を書くことは止めない。
- Cursor CLI: 取得しない。公式の手段が無く、保存されたトークンで非公開のAPIを読み込む方法は[Cursorの利用規約](https://cursor.com/terms-of-service)の1.5（サービスからのデータの抜き出しの禁止）に近いため。ioriが同梱するのは各CLIの公式の手段だけで、それ以外はユーザーが自分の判断で[定義ファイルの利用枠のスクリプト](design/cli-definitions.md#利用枠usage)に書く。
