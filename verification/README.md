# 検証

通常の開発では Host API の E2E と画面の試験を使う。実機と本物のCLIを使う追加の検証には、対象OSやデバイスなどの設備が要る。

## モックアップと製品の画面を同じ状態で比べる

画面の作業の受け入れでは、`node verification/ui-states/server.mjs` の開発用ページで状態とテーマを選ぶ。製品の部品に状態のデータを渡して描き、nativeやHostは呼ばない。製品のbuildには入らず、シナリオや状態遷移の試験の代わりにはしない。

`node verification/ui-states/capture.mjs` はモックアップの全idをPC（1440×900）・WQHD（2560×1440）・狭いウィンドウ（390×844）の明暗で撮る。画像・高さの実測値・モックアップを左、製品を右に並べた `index.html` は `.local/evidence/v16-state-shots/` の実行ごとのフォルダーに出る。高さは合否を判定せず、描けない状態やモックアップの画像が無い場合は理由を一覧に残す。

モックアップの状態一覧は `--catalog=〈host-setup-states.ts〉`、モックアップの画像は `--reference=〈フォルダー〉`、保存先は `--output=〈フォルダー〉` で変えられる（開発用ページでは `IORI_UI_STATE_CATALOG`）。既定は作業用の `.local/ui-sample/v16-host-setup/src/host-setup-states.ts` と `.local/ui-sample/dist-shots-v16-host-setup/`。一部だけ撮る時は `--only=A0,B2b` を使う。既存のPlaywrightとChromiumを使い、導入場所は `IORI_PLAYWRIGHT_MODULE` と `IORI_CHROMIUM_PATH` で指定できる。描画データは `verification/ui-states/fixtures.ts` に置き、画面の非公開の初期状態を渡す対応は開発用サーバーだけが持つ。

子の行とCLIの再開失敗の表示は `node verification/ui-states/capture.mjs --catalog=verification/ui-states/child-states.ts` でスクリーンショットを撮る。

## 追加の実機検証

`verification/local.example.json` を `~/.config/iori/verification.json` にコピーし、検証環境に合わせて設定する。通信・端末登録、Clientの更新とHostの導入、Terminal・CLI・通知などの実機検証は `verification/` の各機能のrunnerを使う。Windows、Linux、Androidの対象設備とSSH・ADBなどが必要で、ブラウザーのE2Eとは別の確認である。runnerの一部は特定の検証環境のパスやユーザーを前提とする。日常用の保存先と端末を使わず、検証用の環境を分ける。

## Clientの鍵の紛失からの回復（Linux）

専用の `IORI_VERIFICATION_EVIDENCE_ROOT` を設定し、Node 24で `node scripts/run-bounded-check.mjs node verification/linux-client/build.mjs`、続いて同じ入口から `verification/linux-client/registration-reset.mjs` を実行する。Linux検証機の鍵とgate、専用の保存先・DBus・キーリングを使い、招待からHostへ登録し、Clientを終了して専用キーリングのioriの項目を削除し、起動の失敗画面から確認つきの「登録をリセット」で最初の登録画面へ戻る。Host一覧が空になったことを確かめる。終了時はClient・Host・招待と専用のフォルダーを回収する。`--keep-build` を付けた時はbuildだけを保持する。Windows・Androidはこのシナリオでは扱わない。

Linux Clientの共通helperは、専用のXvfb画面のスクリーンショットをGDKで撮る。画面操作や起動に失敗した時も、WebDriverのスクリーンショットに依存せず画像を残す。必要なPythonのGDK bindingは `verification/linux-client/prepare.mjs` で準備する。

画面の4状態（Linux・Windowsの鍵の読み込み失敗、確認、リセットの失敗）は `node verification/ui-states/capture.mjs --catalog=verification/ui-states/registration-states.ts --sizes=pc,phone` でPCとスマホ幅のライト・ダークのスクリーンショットを撮る。nativeやHostへは接続せず、処理の確認には上のシナリオを使う。

## 検証の道具の書き方

- 画面は共通の操作helper（`verification/ui.mjs` の待機・スクロール・可視判定・入力）と安定した識別子（`data-iori-*`）で操作し、表示文言や画面の偶然の状態に頼らない。
- メニューを開くボタンは `screen.click` を使う。スマホの指操作の確認は `screen.tap` を使い、フォルダー選択の「開く」では `{ dismissKeyboard: true }` でIMEの退場と座標の安定を共通helper側で待ってから押す。Radixのメニューが受け取るpointerdownをhelperが送る。クリック後の描画と予約されたスクロール・focusが終わってから次の操作へ進む。クリック・右クリック・指操作では、閉じる途中のメニューやダイアログが消え、対象の中央が他の要素に覆われなくなってから操作する。
- サイドバーを開く時は `e2e/connection/scenario.mjs` の `openSidebar` を使い、開いていればそのまま操作する。再読込後も入口の表示を待ってから開閉を判定する。閉じる時は同じ共通helperの `closeSidebar` を使う。シナリオ内の直接のトグル操作はlintで止める。Mobileの開始画面には作業画面の `mobile-location` がないため、作業画面のボタンだけに対象を限定しない。
- 並べ替えなどのpointerドラッグは `verification/ui.mjs` の `screen.drag`、長押しは `screen.longPress` を使う。並べ替えのtouch sensorを使う長押しも、終了直後にはクリックが抑制される。どちらも抑制が解けるまでhelperが待つので、シナリオへ独自の待ちを足さない。
- Files・Git・Boardを開く時は `verification/workspace/interaction.mjs` の `openWorkspaceView` を使う。PCは開いているタブまたは「＋」の一覧、Mobileはドロワーの入口を使う。新しいタブを置くペインが決まっている操作は第3引数にそのgroup IDを渡す。 `sidebar-open-*` を直接押す操作はlintで止める。
- RadixのSelectの項目は、headlessのChromiumでは `screen.click` でも本物のマウスの押下と解放（`clickWithin`）でも選べない（#302、前のバージョンでも同じ）。欄に焦点を置き、Home・↓で項目へ移るたびに焦点の移った項目を `waitFor` で確かめてからEnterで選ぶ（`e2e/workspace/scenario.mjs` の `selectFolderHost`）。選んだ後に続けて入力する時は、入力の欄を押してから入力する（閉じた後の焦点の戻りと入力が重なる）。
- 新しいシナリオを書く前に、同じ操作の共通helperがないか確かめて使う。既知の失敗への対策は、その操作のhelperに入れ、誤った書き方は静的検査で止める。
- Piの検証用ファイルは `verification/cli/home.mjs` の `piAgentDirectory` が返す専用HOME内へ置く。呼び出し元の `PI_CODING_AGENT_DIR` は引き継がず、シナリオからの直接参照はlintで止める。
- 転送・作成・更新などの完了を待つ実機の検証には、`verification/ui.mjs` の `waitForOperation(観測名, 読む, 完了の判定, 失敗の観測)` を使う。画面の反応の待ちは `waitFor`・`screen.wait` を使う。
- Terminalの文字は `observed` で受信画面を解析して読む。画面に出ない制御信号は文字として待たず、`observedTerminalMode` で同じ受信画面のモードを読む。
- 実機で走らせる前に静的検査を通す。
- 検証資材の不具合は `.local` のコピーで直さず、その場で `verification/` を直して変更に含める。
- 失敗時の診断が巨大な値（DOM要素・React内部など）を展開しないよう、比較は真偽値・文字列など小さな値で行う。

Linuxの実機用buildもNode 24から起動する。`verification/connection/prepare-linux.mjs` は起動元のNodeでpnpmとその子scriptを動かし、Hostへ同梱するNodeに合わせてnode-ptyを作り直す。tool managerが別のNodeを選ぶ環境や、別のNodeで作ったpnpm cacheを再利用する時も、通常の準備の入口を使う。

Linuxの検証用debの導入・回収は `verification/native/linux-packages.mjs` の共通helperを使い、apt-getの `DPkg::Lock::Timeout=-1` で鍵が空くまで待つ。鍵ファイルの削除や別のapt処理の停止はしない。

## Host API の E2E

`e2e/host/*.test.mjs` に1本1振る舞いで置き、`node scripts/test.mjs` で流れる。1本だけ流す時は `node scripts/run-bounded-check.mjs node --test --test-timeout=60000 e2e/host/<名前>.test.mjs`。

- `verification/host/process.mjs` の `runHostTest(t, body)`（中で `startHostTest(t)`）が、試験ごとの一時の保存先・HOME・PATH（nodeとshellだけ）・Hostの鍵・port・Clientの鍵で本物のHostを別のプロセスで起動し、`t.after` で接続・Host・Terminalのデーモン・一時のフォルダーを片付ける。返る `client` はClientと同じirohのインターフェースで `request`・`events`・`terminal` を送る。Hostの中の関数は差し替えない。
- CLIは `verification/host/scripted-cli.mjs` の台本のCLIを `scripted-definition.mjs` の `registerScriptedCli` で公開の `cli.definition.save` から登録して使う。台本のCLIはHostが作った本物のPTYで動き、hookは製品の送り口、チームの操作はHostが渡した `iori` で送る。PTYへJSONの行を入れて `actorCommand` で結果を待つ。
- 待つのはイベントとPTYの出力の到着だけにし、固定の待ち時間で成否を決めない。上限は `--test-timeout` に任せる。`body` に渡る `stage(名前)` で段の名前を付けると、失敗・打ち切りの時にその名前が出る。
- 止めた子への `send` の成功は再開の受付で、PTY の再起動の完了ではない。再開した子の Terminal を開く前に、`send` の前に作った新しいイベントの購読で、その子の `teams.child.updated` が `state: "running"` になるのを待つ（先に開くと止まった Terminal の画面と終了が届き、`Hostの購読が終了しました` で落ちる。負荷のある CI でだけ起きた）。
- 検証の道具がTerminalのデーモンを止める・上限を付ける時は、そのsystemdのunitのWorkingDirectoryが検証の保存先の中かを確かめてから行う（`verification/terminal/daemon-process.mjs`）。隔離したPATHのHostはデーモンを直接起動するので、デーモンは試験を流したプロセスのcgroupを継ぐ。cgroupのunitの名前だけで止めると、iori のTerminalの中から流した時に日常のTerminalのデーモンを止める（#317）。

## 画面の試験

`e2e/ui/<経路の名前>.spec.ts` に、[製品仕様](../docs/product.md)の受け入れ契約の経路ごとに置く。`bash scripts/ci.sh` の中で毎回実行される。手元では `pnpm e2e:ui`（1本だけなら `pnpm e2e:ui --project=desktop <名前>`。Agent の実行環境では `env -u CLAUDECODE -u CLAUDE_CODE_ENTRYPOINT node scripts/run-bounded-check.mjs node node_modules/@playwright/test/cli.js test --config=e2e/ui/playwright.config.ts <名前>`）。

- 道具は Playwright Test。操作と判定は locator と web-first assertion（`expect(locator).toBeVisible()` など）だけで書く。固定の待ち・`evaluate`・`force`・ElementHandle・自作の「見える」の判定は lint が止める。画面に出ない値（Terminal の中の文字）を待つ所は `e2e/ui/fixtures/test.ts` の `terminalText` だけにある。
- locator は role と名前を先に使い、無い時だけ既にある `data-iori-*` を使う。製品に role・ラベルが足りない時は、試験の側で回避せず製品へ足す。
- 試験ごとに、新しい本物の Host（一時の保存先・HOME・port）と新しい browser context を使う（`e2e/ui/fixtures/`）。Client は製品の画面を Chromium で開き、Tauri の native の代わりに Node 側の bridge（`verification/web/bridge.mjs`）が本物の Host と通信する。CLI は台本の CLI（`verification/host/scripted-cli.mjs`）だけを使い、本物の他社の CLI・モデルの API・機械の設定は使わない。
- `app` は未登録の Client、`registeredApp` は本物の経路で登録を済ませた Client。招待から登録する経路そのものを確かめる試験だけが `app` を使う。要求の失敗・保留は bridge の `client.faults` を通す `app.faults` で再現する。
- fixture が持つ入口: 2つ目の Host（`app.addHost`・`app.registerHost`）、Host の停止・起動・再起動（`app.host.stop`・`start`・`restart`）、接続の切断（`app.setOffline`）、2台目のデバイス（`app.addDevice`）、偽の Forge（`app.host.forge()`）、更新の配信元、ファイルの準備（`app.files`）。ブラウザーの API が OS の境界に当たる所（通知の要求・保存先・クリップボードの画像・指のスワイプと長押し）は `e2e/ui/fixtures/browser.ts` にある。Git のリポジトリは `e2e/ui/support/reading.ts` の `repository()` で作る（本物の git を Host の隔離した PATH へ足す）。
- CLI・モデルなどの値は、使う人と同じ操作で選んでから進める。仕様が決めていない既定値と、一覧の到着の順序を当てにしない。
- Release の受け入れは、環境変数 `IORI_UI_HOST_DISTRIBUTION` に展開した配布物を渡し、配布物の Host に対して `register-first-agent` と `terminal-input-resize` を実行する。
- 幅は project で分ける。試験に `{ tag: "@desktop" }`（1440×900）か `{ tag: "@phone" }`（Pixel 7、タッチあり）を付ける。
- 失敗は1回だけ再実行する（`CI=true` の時）。再実行で通った試験は flaky として結果に出る。trace は最初の再実行で記録する。結果（JSON・HTML の report・失敗時の画像・trace）は `.local/evidence/ui/<実行>/` に出る。
- 1本は1つの手順を短く通す。Host が決める振る舞いは Host API の E2E に置き、画面では操作が届いて結果が表示されることだけを確かめる。実装の値（寸法・行の数・内部の ID）を期待に書かない。

## 他社の CLI の互換の監視

`e2e/cli/` は本物の他社の CLI の hook・session・引数・記録の形を、画面を使わずに確認する。モデルには `verification/fake-model/server.mjs` の偽の API を使い、認証は試験用に分ける。毎日の監視は main と Release を停止しない。結果は `~/.local/share/iori-cli-compat/latest.json` に保存し、失敗は `scripts/agent-hooks/notify.mjs` がセッションの最初に知らせる。

Linux の専用作業場所に Node 24・pnpm・Rust と対象の CLI を用意し、導入元のリポジトリで次を実行する。サービスは `origin/main` を取得して依存と Host の native 部分を準備し、timer は毎日実行する。

```sh
mkdir -p ~/.local/share/iori-cli-compat ~/.config/systemd/user ~/.config/iori
git clone "$(git remote get-url origin)" ~/.local/share/iori-cli-compat/repo
printf 'PATH=%s\n' "$PATH" > ~/.config/iori/cli-compat.env
cp scripts/cli-compat/iori-cli-compat.{service,timer} ~/.config/systemd/user/
systemctl --user daemon-reload
systemctl --user enable --now iori-cli-compat.timer
```

状態とログは `systemctl --user status iori-cli-compat.timer` と `journalctl --user -u iori-cli-compat.service` で確認できる。手元で実行するときは、毎日の結果を上書きしないよう、リポジトリの外のディスク上の場所を指定する。

```sh
IORI_CLI_COMPAT_ROOT=<リポジトリの外のディスクの場所> node scripts/cli-compat.mjs
```

iori がモデルへ渡す指示を変えたときだけ、親が試験用の Claude の専用トークンを使い、`node scripts/cli-compat.mjs --only=claude --real-model` を Release と別に実行する。結果は `real-model-latest.json` に保存する。Owner の CLI のログインは試験で使わない。

## シェルの初期化

shell初期化を変えた時は、`node scripts/run-bounded-check.mjs node verification/terminal/shell-integration.mjs <Debianパッケージの展開先> <証拠の保存先>` で本物のbash・zsh・fishも確認する。`zsh`・`zsh-common`・`fish`・`fish-common`を`apt-get download`でscratchpadへ取得し、`dpkg-deb -x`で同じ展開先へ置く（systemへはインストールしない）。Fishは実行ファイルからの相対配置に`usr/etc/fish`も必要なので、展開先の`usr/etc`を作り、そこで`ln -s ../../etc/fish fish`を実行する。runnerは証拠の保存先に専用HOMEとHost資材を作り、ユーザーファイルの読込順・alias・プロンプト・PATH・履歴・終了時の設定を実PTYで確かめる。Bashの`.bash_logout`の実行有無は結果へ記録するだけにし、Zshは明示したHISTFILEとPrezto型の既定値について通常の`zsh -l`と同じ履歴ファイルを使い、元のZDOTDIR・`.zlogout`へ戻ることを確認する。シェルの起動と履歴は[Host API の E2E](../e2e/host/cli-shell-startup.test.mjs)でも確認する。

## Windows Host の worktree 削除

Windows Hostのプロセス停止とフォルダー削除は `node scripts/run-bounded-check.mjs node verification/workspace/worktree-removal.mjs` で、専用Hostへ開発Clientから接続して確認する。検証環境の鍵・gate・source転送・起動と回収は共通helperを使う。登録の共通helperは接続を確認した「端末」設定画面で終わるため、フォルダー操作へ進むrunnerは「設定を閉じる」を押す。リポジトリを開いてからサイドバーの対象worktreeを選び、選択先を確認してTerminalを起動する。同じ実行で、別プロセスがファイルを開いているworktreeの削除は理由を示して拒み、ファイルとGitの登録が残ることも確認する。

## 本物のCLIで確かめる時

- 検証HostのClaude Code・Codex・Piは使ったバージョンを記録する。バージョンを上げた時は本物のCLIとの照合を行う。古いバージョンは消さず残す。
- 有料の入力には安いモデルを明示する。Claude Codeは `claude-haiku-4-5`、Codexは `gpt-6-luna`、PiとOpenCode V1は提供元 `openai` の `gpt-6-luna`。試験の費用の自己確認として、実際に使われたモデルはCLIの記録で確かめる。製品の受け入れ判定の根拠にはしない。製品のモデルの既定値を試験用に変えない。
- 認証ファイルをコピーして使わない。CLI の互換の監視は検証用の設定へ分離し、OwnerのCLIのログイン（Codex・Pi・OpenCode・omp）を参照しない。本物のモデルを使うのはClaude Codeの試験用トークンだけである。OAuthの更新が試験の側で起きると、元のCLIが認証できなくなるためである。
- Claude Codeは認証ファイルを一時ファイルからrenameで置き換えるため、symlinkでは新しいrefresh tokenを検証用ホームへ書いてしまい、元のログインが使えなくなる。実モデルを使う検証のClaude Codeは、`claude setup-token` で作った試験専用のトークンを 準備時のエラーが示すファイル（0600、`CLAUDE_CODE_OAUTH_TOKEN=<トークン>` の1行）から読み、環境変数 `CLAUDE_CODE_OAUTH_TOKEN` だけで受け取る。検証用ホームに `.credentials.json` は置かず、元のファイルは開かない。Windowsで起動する時は標準入力で渡し、sshやPowerShellのコマンドラインに載せない。ファイルが無い時は準備の始めに置き場所を伝えて止まる。トークンの値はログ・証拠・結果・スクリーンショット・会話へ出さない。検証コードがClaudeの `.credentials.json` をリンク・コピーしようとするとlint（`iori/no-claude-credentials-link-copy`）が止める。

## SSHでWindows Hostを導入する

`verification/host-setup/build.mjs --client Windows --ssh-windows` でWindows・Linuxの検証用Clientと署名済みのWindows Hostを作る。準備から回収まで `IORI_VERIFICATION_CONFIG=verification/host-setup/tauri.conf.json`・`IORI_VERIFICATION_EVIDENCE_ROOT`・`IORI_VERIFICATION_PORT` を同じ値にし、Node 24で `node scripts/run-bounded-check.mjs node` に続けて各入口を実行する。

`verification/host-setup/run-ssh.mjs --host Windows --client Windows --shell=cmd --keep-build` と `--host Windows --client Linux --shell=powershell --keep-build` は、SSHの接続先の選択・確認への回答・導入・登録・Direct接続・SSH終了後の継続・既存Hostの登録・撤去結果の読取りを画面から通す。管理者の接続先では、選択なしでWindowsファイアウォールの規則が加わる。`--signed-out` を加えた実行は、管理者でない使い捨てユーザーを使い、導入に進まず「この PC」での導入と招待を案内し、招待の入口へ進むことを確かめる。最後の実行では `--keep-build` を外してbuildのフォルダーも回収する。途中で打ち切った時は、同じ設定で `verification/host-setup/run-ssh.mjs --host Windows --client Windows --cleanup-build` を実行し、共通helperでbuild・ClientのSSH秘密鍵・配布元の使い捨ての鍵を回収する。

`--shell=powershell` は既定のshellをPowerShell 7にし、Windows標準のPowerShell 5.1へ渡す経路も確かめる。検証用CAには失効の情報が無いため、検証ソースのcurlだけに `--ssl-revoke-best-effort` を付け、CAと名前の確認は維持する。取得の終了コードと標準エラーは各runの `download.json`、後片付けが失敗した時の残ったフォルダーとプロセスは `host-cleanup.json` に残す。

Linux Clientは使い捨てユーザーの実ホームで動かし、OpenSSHの設定と鍵も同じホームへ置く。ユーザーとホームは終了時に回収する。Hostの回収だけを確かめる時は、同じ設定で `--host Windows --client Windows --cleanup-host` を使う。

Windowsが使い捨てユーザーのprofileをLoadedのまま保持している時は、追加の待ち・プロセスの停止・hiveの強制解放をせず、`cleanup.user` にユーザー名とprofileの場所を残して回収未完とする。Ownerに検証機の再起動を依頼し、再起動後にそのユーザーのprofileとアカウントだけを回収する。

Windows・Linux検証機と配布元の鍵・gateを使う。日常の保存先・portは使わず、検証用Hostは本人のLocalAppDataの専用フォルダーへ置く。既定のshellは実行中だけ切り替え、終了時に元の値へ戻す。追加した鍵・規則・ユーザー・導入物・起動の登録も回収し、結果と作成・回収したものは証拠先の `windows-ssh-*/result.json` へ残す。回答・招待・秘密鍵・パスワードはスクリーンショットの取得・記録をしない。
