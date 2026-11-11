# 検証

通常の開発ではLinuxでブラウザーの画面E2Eを使う。実機と本物のCLIを使う追加の検証には、対象OSや端末などの設備が要る。

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
- 本文の文字をドラッグで選ぶシナリオでは、既に選んだ文字の中からドラッグを始めるとブラウザーの文字のドラッグ＆ドロップになり、新しい選択が始まらない。選び直す前に、選択の外を本物のクリックで1回押して選択を外す。ドラッグ中にホイールでスクロールする時は、押したままの状態（`buttons: 1`）を渡す。
- headless のChromiumでは、CDPのtouchの長押しで文字の選択が起きない（ただの選べる文でも起きない）。スマホのOSの文字選択（つまみと「コピー」）は道具で確かめず、Androidの実機でOwnerが目で見る。E2Eは、iori のメニューが開かないことなど、画面の要素で確かめられることだけを確かめる。
- 画像の大きさや縮尺など、読み込みの後の描画でそろう値は、読み込みを待った直後に1回測らず、`waitFor` の条件として待つ。開発版のHostでは通っても、応答の速い配布物のHostでそろう前の1回の描画に当たる（0.1.102 の `git-image-diff`、#298）。
- Files・Git・Boardを開く時は `verification/workspace/interaction.mjs` の `openWorkspaceView` を使う。PCは開いているタブまたは「＋」の一覧、Mobileはドロワーの入口を使う。新しいタブを置くペインが決まっている操作は第3引数にそのgroup IDを渡す。 `sidebar-open-*` を直接押す操作はlintで止める。
- MobileのFiles・Gitで開いた本文から一覧へ戻る時は、作業画面の `mobile-location` が見えていればスマホの戻る操作（`screen.key("Alt+ArrowLeft")`）、見えていなければ `reading-back` を押す（`e2e/web/files-reading.mjs` の `open`）。Mobileでworktreeを選び直すと、そのworktreeで開いていたファイルの本文へ移り、上端のworktreeの切替は隠れる。
- RadixのSelectの項目は、headlessのChromiumでは `screen.click` でも本物のマウスの押下と解放（`clickWithin`）でも選べない（#302、前のバージョンでも同じ）。欄に焦点を置き、Home・↓で項目へ移るたびに焦点の移った項目を `waitFor` で確かめてからEnterで選ぶ（`e2e/workspace/scenario.mjs` の `selectFolderHost`）。選んだ後に続けて入力する時は、入力の欄を押してから入力する（閉じた後の焦点の戻りと入力が重なる）。
- 新しいシナリオを書く前に、同じ操作の共通helperがないか確かめて使う。既知の失敗への対策は、その操作のhelperに入れ、誤った書き方は静的検査で止める。
- Piの検証用ファイルは `verification/cli/home.mjs` の `piAgentDirectory` が返す専用HOME内へ置く。呼び出し元の `PI_CODING_AGENT_DIR` は引き継がず、シナリオからの直接参照はlintで止める。
- 長い依頼本文だけを渡すWeb E2Eは `e2e/web/cli-input.mjs` の `pasteToCli` で通常の貼り付けを使い、CLIの画面に本文または貼り付けのインジケーターが出てからEnterを送る。文字入力の経路を確かめる操作は1文字ずつの共通helperを使う。
- 転送・作成・更新・モデルの応答など処理の量や提供元で時間が変わる待ちは、`verification/ui.mjs` の `waitForOperation(観測名, 読む, 完了の判定, 失敗の観測)` で、完了か失敗が見えるまで待つ。全体の上限は `run-bounded-check` が持つ。失敗の観測は `verification/web/operation.mjs`（CLIの失敗・子の失敗・画面の警告）を使い、失敗を待つ所では反対側の終わり（失敗せずに報告した、警告なしで閉じた等）を失敗として観測する。観測できない待ちは期限付きの `waitFor` のままにする。画面の反応の待ちは `waitFor`・`screen.wait` を使う。

  Webの待ちでは、CLIが応答中のままHostの状態が90秒変わらなければ止まりとして落とし、受け入れの流し直しへ回す。進行のインジケーターには `cliStatus` だけを使い、読み取りの間の変化もHostの出来事から数える。

- 時間の絶対値（何ms以内に返る等）は画面E2Eで判定しない。判定は試験の4種類目（負荷試験）に置き、画面E2Eは順序と、製品が判断に使った時刻での下限で確かめる。
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

## main 後の画面E2E

Linux の専用作業場所で、main の新しい commit を30分ごとに確認する。4組まで並行し、結果は `~/.local/share/iori-background-e2e/latest.json`、証拠は同じ場所の `evidence/` に残る。失敗時は Forgejo の Issue #321 に通知する。日常 Host は使わない。

Node 24・pnpm 11・Rust・Chromium・各 CLI と、このページのブラウザーE2Eの準備が必要。導入元のリポジトリで次を実行する。`PATH` は timer からも同じ道具を見つけるため保存する。

```sh
mkdir -p ~/.local/share/iori-background-e2e ~/.config/systemd/user ~/.config/iori
git clone "$(git remote get-url origin)" ~/.local/share/iori-background-e2e/repo
printf 'PATH=%s\n' "$PATH" > ~/.config/iori/background-e2e.env
cp .forgejo/.env ~/.local/share/iori-background-e2e/repo/.forgejo/.env
cp scripts/background-e2e/iori-background-e2e.{service,timer} ~/.config/systemd/user/
systemctl --user daemon-reload
systemctl --user enable --now iori-background-e2e.timer
```

サービスはメモリを10 GiBに制限し、CPUの優先度を下げる。自動起動するログインの user service と Forgejo の認証が必要。状態とログは `systemctl --user status iori-background-e2e.timer` と `journalctl --user -u iori-background-e2e.service` で見られる。

## ブラウザーの画面E2E

Web runnerも `~/.config/iori/verification.json` の `windows.home` を読込時に必要とし、cacheの一部は固定パスを使う。別の環境ではそのパスに書き込めず、手順どおりに流せない場合がある。

スマホ操作の共通helper `mobile()` と `phone()` は、Terminalを作る前にタッチ対応を有効にする。画面幅だけを変えてもxtermの指操作は登録されない。`desktop()` はタッチの模擬を解除する。

Webで複数Hostを確認する時は `startWebHost(distribution, { dataRoot, port })` へ検証専用の保存先とportを渡し、返る `close({ stopTerminals: true })` で後始末する。サイドバーの並べ替えは `pnpm e2e:web --only=sidebar-order` で確認する。

`verification/web/run.mjs --only=<シナリオ>` はシナリオを1つだけ受け取る。指定なしの長い一括実行は使わず、複数のシナリオは1つずつ流す（`--only=a,b` で複数は選べない）。接続中のHostをまとめて更新するダイアログは `client-update` ではなく `client-host-update` が通す。

基本のシナリオは次のまとまりに分ける。どれも通常の招待で登録し、必要なフォルダーやTerminalを共通helperで開く。`web-recovery` は会話の保存からHost再起動・再開・通信断のFiles/Git・同じTerminalへの復帰までを一緒に通す。`web-terminal` はペインを閉じた後のTerminalで切断と再接続を通す。

| `--only` の名前      | 内容                                                                                          |
| -------------------- | --------------------------------------------------------------------------------------------- |
| `host-update-mark`   | 選択中のHostと一覧の更新のインジケーター、外したHostのインジケーターの消去                    |
| `web-workspace`      | 登録、Git/非Gitの初期タブ、再読込・worktreeの切り替え、Host設定、登録解除と再登録後のTerminal |
| `worktree-removal`   | worktreeの削除と取り込み済みの片付け                                                          |
| `files-transfer`     | Filesのアップロードとダウンロード                                                             |
| `git-image-diff`     | Gitの画像の変更前後・拡大・前後の切替、スマホの表示と戻る                                     |
| `reading-text-copy`  | 本文のドラッグ・スクロール後のコピー、Gitの本文、スマホの長押しと行選択                       |
| `reading-worktrees`  | worktree間のFiles/Git、Markdown・画像の表示                                                   |
| `web-terminal`       | 日本語、ペイン操作、読み位置と通信復帰、出来事の継続、PC・スマホの寸法                        |
| `web-cli`            | CLI設定・初回起動、最大化、状態と通知、hooksの失敗と再試行、CLI一覧、長い承認待ち             |
| `web-recovery`       | Codexの会話の再開、Files/Gitの通信復帰、スマホで同じTerminalへ戻る                            |
| `automations`        | 自動化の作成・実行と履歴                                                                      |
| `automation-webhook` | Webhookの受信・履歴・token更新・受信範囲・待受の変更                                          |
| `automation-issue`   | Issueのラベルによる起動・履歴・PR作成・接続の回復                                             |
| `teams`              | チーム編集・保存とHost再起動後の保持                                                          |
| `child-rows`         | 候補なし委譲の通知、PC・Mobileの子の行の配置                                                  |
| `worktree-create`    | worktreeの作成                                                                                |
| `forge-status`       | フォルダーの無い時の連携設定、Forgeの状態                                                     |
| `forge-issues`       | ForgeのIssue一覧と詳細                                                                        |

`web-cli`・チームのシナリオはClaude CodeとCodexをlocalhostの偽のモデルAPIへ向ける。`claude-status`・`long-approval` も同じClaude Codeの台本を単独で使う。`web-cli` のPiも偽のResponses APIを使う。`--real-models` を付けると、同じシナリオをClaude Codeのhaiku・Codex/Piのgpt-6-lunaの実モデルで通す。`web-recovery`・`automations`・`automation-webhook`・`automation-issue`・`forge-issue-start`・`host-update`・`host-uninstall`・`mobile-batch-input`・`mobile-images` は偽のAPIを使う。`web-terminal` は本物のPiを起動するがモデルへ依頼しない。残りのCLIとfixtureは各シナリオの説明に従う。Releaseの範囲の受け入れも同じ名前を `--scenarios=web-cli,web-recovery` のように指定する。

`pnpm e2e:web --only=pane-maximize` は入れ子の分割を含む4ペインでTerminal・Pi・Filesを最大化し、タブを切り替えてからTerminal外へ焦点を移したEscape・復元ボタン・外側のクリック・タブのダブルクリックで戻す。背景が消え、内容が元の位置と大きさへ戻り、非表示タブの描画面もワークスペースからはみ出さないことを確かめる。比較元は選んだタブの内容がペインに収まってから取得する。Terminalに焦点がある時のEscapeは、最大化を保ったまま実PTYへ0x1bが届くことを確かめる。同じシナリオは `web-cli` にも含める。

`pnpm e2e:web --only=web-cli` は本物のPiを「＋」から開いて終了し、同じshellでコマンドを実行する。設定の「AI エージェント」でバージョンを確認してCLIを追加し、検索して開く。shellが終了した後の空のペインからも続ける。PCの一覧・CLIのタブとサイドバー・設定をモックアップv9と同じ1440×1000の構図で明暗のスクリーンショットを撮る。シナリオは [CLIの画面](../e2e/cli-screen/scenario.mjs) に置く。shellの起動と履歴は[Host API の E2E](../e2e/host/cli-shell-startup.test.mjs)で確かめる。CLIのHOMEとPiの会話保存先 `PI_CODING_AGENT_SESSION_DIR` はrun専用に分ける。認証の共有は[本物のCLIで確かめる時](#本物のcliで確かめる時)に従い、偽APIを使うCLIは共有しない。ユーザーの設定はコピーせず、モデルは検証HOMEでCodexの `gpt-6-luna` とPiの `openai/gpt-6-luna` を指定する。[状態と判断待ち](../e2e/cli-screen/status.mjs) は短い応答、承認が要るコマンド、Runningスクリーンショット取得用のコマンドをそれぞれ一つ頼み、状態のインジケーター・完了を表示して待機中になること・PCとMobileの判断待ち・CLI内の回答による解消を通す。検証用のユーザーhookを残し、ioriのhookとその信頼だけが撤去されることも確かめる。Claude Codeは分離した設定で `claude-haiku-4-5` を指定し、偽API（`--real-models` の時だけ試験専用トークン）で起動する。CLIの承認画面が表示されたことを確かめてEscで断り、実物の中断表示とioriの判断待ちの解消を通す。Mobileの最初の画面は400×900で明暗のスクリーンショットを撮る。Piの入力準備は共通の `waitForPiInput` で、そのTerminalの入力画面にある空のコンテキスト表示を待つ。起動案内は小さいペインの保存画面から消えることがあるため、準備の判定に使わない。

CLI一覧を開いても未使用CLIの設定が変わらず、初めて開くCodexも最初の会話から状態のインジケーターが出ることを確かめる。`pnpm e2e:web --only=cli-launcher` はhookの無いHOMEで、初めて開くPiの会話に起動直後から待機中のインジケーターが出ることも確認する。Claude Codeでは専用HOMEのhook用フォルダーに書き込みを妨げるファイルを置き、取り付けに失敗しても起動できること、障害を取り除いた後の起動で再試行し、その会話から待機中・承認待ちを観測できることを通す。このClaude Codeのシナリオだけを流す時は `pnpm e2e:web --only=claude-status` を使う。

`pnpm e2e:web --only=web-recovery` は、偽のAPIにつながるCodexへ記憶を頼み、Host再起動後に最後の画面と再開行を確認してから、同じ会話と記憶を戻す。会話IDを持たないCLIの起動し直しと閉じる操作は[Host API の E2E](../e2e/host/cli-shell-startup.test.mjs)で確かめる。通知はnativeのインターフェースの代わりの記録で、対象を見ていない時の文面と1回の要求、見ている時の抑制を確かめる。OSの通知の代用にはしない。通知の確認は `--only=web-cli` を使う。

チームの画面のシナリオは `team-command-route`（親Claude Codeから実delegateと報告の通知）、`team-child-tabs`（子Codexの既定sandbox・残量・タブ・Mobileのドロワー）、`team-messages`（質問・回答・報告の実CLIの記録）、`team-board`（Plan・Agents・MobileのBoardsの行き来）、`team-records`（日付・チーム名の絞り込み・候補の点からタスクの経緯と最後の画面）へ分ける。各シナリオは `node scripts/run-bounded-check.mjs node verification/web/run.mjs --only=〈名前〉` で、専用Host・通常の招待・独立したチームから実行する。チーム作成と親の起動は共通の `e2e/web/team-fixture.mjs`、子の準備は `team-worker.mjs` を使う。残量は本物のCodex app-serverから読み、下限の選択は純粋関数の試験で確認する。

子のライフサイクルは `child-read-only`（承認なしの報告と終了画面のPC・Mobile表示）、`child-cli-exit`（Codexの承認待ちと各CLIの終了操作）、`child-background`（Claude Codeのバックグラウンド処理完了から報告）、`child-claude-resume`（子を停止して親のsendから同じ会話を再開）へ分ける。どれも独立した親と子を起動する。保留回答と親の終了は `e2e/host/team-lifecycle.test.mjs`、Hostとデーモンの再起動での未起動の子の停止は `e2e/host/team-candidates.test.mjs`、親の再開は `e2e/host/team-instruction-recovery.test.mjs` と `e2e/host/team-parent-reconnect.test.mjs` で確認する。

### ブラウザーE2Eの既知の失敗と対策

- 手元の全体の受け入れ（`scripts/release/acceptance.mjs`）の1組目は、実行した作業ツリーのsourceをそのまま使い、画面のserverがその変更を途中から読み込む（Viteの更新）。受け入れの実行中に同じ作業ツリーのsourceを直すと、残りのシナリオが直した後の画面で流れ、結果がどちらのバージョンのものか分からなくなる。受け入れの途中で直す時は、受け入れが終わるのを待つか、別の作業ツリーで直す。

- E2Eでメモリ上に合成した大きいFile（`new File([new Uint8Array(N)])`、およそ200MiB以上。同じページで繰り返すと192MiBでも）は、Clientの `FileReader` が `NotReadableError` で読めない（製品の不具合ではない。ディスク上の実物のファイルは同じChromiumで256MiBを読める）。大きいファイルはrunのフォルダーに実物を作り、ファイルの入力欄から取り出したFileを渡す（`e2e/web/files-transfer.mjs`）。

- 名前を中ほどで省略する部品（`MiddleEllipsis`）の文字は表示の幅で変わる。E2Eで全文を確かめる時は `screen.text` でなく `data-iori-full-name` の属性を読む。表示の文字の組み立てを変える時は、その要素を読むE2Eを `grep` で洗い出して合わせる。

- フォルダー選択のボタンは `e2e/workspace/scenario.mjs` の `openFolder` で選択画面内に限定する。同じパスのサイドバーの「＋」も `data-iori-folder-path` を持つため、画面を限定しないと再度開く操作でCLIの開始画面を押す。無限定なセレクターの組立てはlintで止める。

- Gitでない検証用フォルダーはGitの作業ツリーの外に作る。中に作ると親のrepoに解決される。[Web runner](web/run.mjs) の `createPlainFolder` で作り、全シナリオの保存先を `/var/tmp/iori-web-runs/` へ分離する。

- CLIへの文字入力と送信は、人のキー操作の間隔で文字と送信キーを分ける共通helper [`submitToCli`](../e2e/cli-screen/input.mjs) を使う。

- Terminalを別画面の裏で終了させるWeb E2Eは、shellが待機を始めた出力を観測し、移動先の画面が出てからFIFOで終了を知らせる。キー送信直後の画面移動や決まった秒数を、shellが入力を受け取った根拠にしない。

- シナリオの途中でページを読み込み直すと、Terminalの出力の観測（`observed` が読む記録）が失われる。読み込み直しを足す前に要るかを考え、要る時は `observeAfterReload` で張り直す。ページを閉じる代わりに about:blank へ移す時、初期化のスクリプト（`addInitScript`）はアプリのoriginのページでだけ動かす（about:blankで `/src/...` を読み込もうとして未処理の例外になる）。

- 偽のモデルの台本（`fakeMarker`）に頼る段は、実モデルの回（`result.realModels`）では飛ばす。実モデルは台本の指示（「承認を2回求めて」など）に従わず、聞き返して止まる。

- 新しいシナリオを `verification/web/scenarios.mjs` に足したら、全体の受け入れで流すかを決め、流すなら `scripts/release/acceptance.mjs` の `fullScenarioOrder` にも足す（足し忘れると全体の受け入れで一度も流れない）。

- Releaseの作成（`scripts/release/build.mjs`）はAndroid・Linux Client・Windowsの作成と範囲の受け入れを同時に流すので、負荷の下でだけシナリオが落ちることがある（#305、web-cliで画面が空になった）。落ちたら同じ配布物でそのシナリオだけを負荷の無い時に流し直して分類する。

### 偽のモデルAPI

`verification/web/fake-model-scenarios.mjs` の `clis` で指定したCLIは、試験の中で起動する `verification/fake-model/server.mjs` へ接続する。CLI本体・Host・画面・hooksは本物を使い、合否の判定も実モデルと同じにする。Claude Codeは `ANTHROPIC_BASE_URL` と試験専用の `ANTHROPIC_AUTH_TOKEN`、Codexは分離したHOMEの `config.toml` のproviderで接続先を変える。偽APIを使うCodexには通常本人の `auth.json` へのリンクを作らず、Claude Codeには試験用OAuthトークンを渡さない。残量の確認があるシナリオでは `codexAccount: true` を宣言してCodexのログインを共有し、残量は本物のapp-serverから取得する。モデルの要求は偽のproviderへ向けたままにする。呼び出し側の偽API用の環境変数も引き継がない。

`cli-definition-plugin`（Pi・Claude Code）、`clipboard`（Claude Code・Codex・Pi）、`cli-omp`（omp・Claude Code）、`opencode-delegation`（OpenCode・Claude Code）も通常は偽APIを使う。Piの `models.json`、OpenCodeの `opencode.json`、ompの通常・profile両方の `models.yml` でResponses APIの接続先を変え、Pi・OpenCode・omp本人の認証は共有しない。ompの各会話役割は同じ偽の接続先へ揃える。`opencode-delegation` は既存の残量表示の確認に `codexAccount: true` を宣言し、Codexのモデル要求の接続先も偽へ向ける。

シナリオごとの対象CLIと台本は `verification/web/fake-model-scenarios.mjs` に、シナリオ名をキーとする `{ clis, scripts, codexAccount? }` で宣言する。台本は `e2e/fake-model/` に置く。新しいシナリオを偽へ移す時は、依頼に `fakeMarker(名前)` を付け、同じ名前の台本を作り、宣言へ対象CLIと台本を追加する。helperは偽のrunで台本選択のマーカーを返し、実モデルのrunでは空文字を返す。基本のシナリオの一覧は変更しない。

台本のマーカーの段の応答は既定で1秒後に始め（実モデルも最初の応答まで1秒以上かかるため）、`delayMs` で変更できる。配送ファイルを読ませる段と `hold: true` の段は待たずに始める。`after` にPromiseを渡すと、その完了後に応答を返す。`error` の段は指定したHTTP status・type・messageのAPIエラーを返す。

依頼文の `[fake-model:名前]` と、マーカーのあるuser発言または配送ファイルの読み込み結果の後のassistant応答数（連続する文と道具の項目を1応答として数える）から返す文・道具の呼び出しを毎回選び、会話の状態はサーバーに保存しない。マーカーの無い要求には通常 `OK` を返す。例外はioriの配送文で、パスをCLIのReadまたはcatへ渡し、CLI自身にファイルを順に読ませる。配送文には `Read <path> and follow its instructions.` と2ファイルを `Then read` で続ける形も含む。この配送文をioriが変えた時は試験の種類5（実モデル）で確認する。`hold: true` の段は接続が閉じるまで応答中を保ち、`delayMs` は指定した時間の後に次の文や道具を返す。`result.json` の `fakeModelRequests` は時刻・method・path・形式・model・マーカー・台本の番号・`toolsProvided`（道具の一覧が指定されたか）・道具名を記録し、要求本文・システム指示・認証は保存しない。

要求本文の照合の例外として、画像項目の数を `imageCount` に、台本の段で `expectTokens` に明示した目印がsystem・instructions・会話に含まれるかを `tokensPresent` の真偽へ記録する。画像と本文は保存せず、clipboard・mobile-imagesは画像の到達、cli-omp・automationsは指示ファイル、web-recovery・cli-definitionは再開した会話、automation-webhookは本文、mobile-batch-inputは入力、repo-delegationは子が読んだファイルの目印の到達をシナリオで確認する。

Releaseの受け入れは `verified.json` に記録したすべてのCLIのバージョンと指示ファイルのcommitを現在と比べ、変更に関係するシナリオを偽の後に実モデルでも流す。バージョンを取れないCLIや記録のcommitを比べられない場合も変更扱いで受け入れを続け、変更したCLIのシナリオが範囲外なら判断時と更新案に一覧を出す。成功後、証拠先へ出た更新案を確認して `verification/fake-model/verified.json` に反映しcommitする。各CLIのバージョンはそのCLIを使う全体の受け入れのシナリオ、指示のcommitは全体の受け入れの偽のシナリオをすべて実モデルで通した時だけ更新される。全体の受け入れに含まれない `claude-status`・`long-approval`・`repo-delegation`・`cli-omp` は更新の条件から外し、対象外の一覧はログにも出す。 全体の受け入れにそのCLIのシナリオが無い場合は、そのCLIを使う偽のシナリオをこの受け入れで1本以上実モデルで通した時だけバージョンを更新する。

`node scripts/run-bounded-check.mjs node verification/web/run.mjs --only=web-cli --real-models` で実モデルへ切り替える。依頼文や指示ファイルに台本選択のマーカーは入れず、本人のCLI認証とClaude Codeの試験用トークンを使う。

PCの画面（`client`）とスマホの画面（`phone()`）は同じブラウザーで動き、Clientの設定（`verification/web/bridge.mjs` の保存先）を共有する。PC側で変えたサイドバーの開閉などの端末ごとの設定はスマホの画面にも引き継がれる（実際の端末どうしは共有しない）。スマホの節は、PC側の操作の結果に頼らず、必要な状態を自分の操作でそろえる。

画面の変更ごとに、リポジトリのrootで `pnpm e2e:web --only=<シナリオ>` を使う。Node.js 24・pnpm 11で依存を準備し、現在のsourceから `node scripts/run-bounded-check.mjs pnpm --filter @iori/host build:native` を一度実行しておく。製品のnative境界を変えていない画面の短い確認用であり、Windows/Android ClientやWindows Hostの実機E2Eを置き換えない。

共通のCSS・部品（サイドバーの行、設定の行、タブ）を変えた時は、変えた画面を撮るシナリオだけでなく、その部品の位置・大きさを確かめるシナリオも流す。部品のclass名（例: `nav-worktree-controls`）を `grep -rln` で `e2e/` から探して選ぶ。サイドバーの行の右の組は `forge-status`・`sidebar-order`・`child-running` が行の枠に収まることを確かめている。

画面のChromiumは、PCのClientと同じくスクロールバーが幅を取る形で描く（Playwrightの既定の `--hide-scrollbars` を外す）。幅767px以下の画面だけは、AndroidのWebViewと同じく幅を取らない形にする。どちらも `verification/web/run.mjs` の共通の起動と画面の初期化が受け持つので、シナリオごとに書かない。

配布物のLinux Hostで確認する時は、展開したフォルダーの絶対pathを `IORI_WEB_HOST_DISTRIBUTION` に指定して同じ `pnpm e2e:web --only=<シナリオ>` を実行する。同梱Nodeと配布物のJavaScript・native moduleから起動し、保存先とportは通常のrunnerと同じ専用環境へ分ける。

このrunnerは専用環境を使う。日常Hostのservice・保存・port、SSH、ADB、実機には触れない。runごとに `/var/tmp/iori-web-runs/` の新しいfolderへHost・bridgeの保存とGit fixtureを作り、空きUDP portのHost、127.0.0.1のbridgeと画面server、headless Chromiumを起動する。通常の招待で登録してフォルダーとlinked worktreeを開き、本物のPTYで日本語のコマンドと実出力、Filesの本文、Gitの変更前後、400×900のドロワーから同じworktreeの各Viewへの移動を確認する。操作は既存の `data-iori-*` と `verification/ui.mjs`、登録・フォルダー・Terminalの共通シナリオを使う。クリックと入力は、対象が見えるために必要な分だけスクロールし、見えている対象を中央へ移動させない。スマホのドロワーを開く時は共通の `openSidebar` を使う。退場中のドロワーが消え、トリガーへ操作点が届いてから押し、入場の動きが終わってドロワーへ操作点が届くことを待ってから指の座標を取る。

PC幅とスマホ幅の2ページで同じTerminalを表示し、表示中の選び直しがその場で寸法を取り、スマホ側のvisibilitychangeからの復帰ではPCの寸法を奪わないことも通す。visibilitychangeは開発Clientが読むブラウザーの前面状態の境界であり、Android実機の代用とは扱わない。Gitでは1ページを超えるcommitの未読ファイルと、切断中に選んだcommit本体を、再接続後に開き直さず読めることを確認する。通信断は画面の接続状態を待ってから未読の操作を行い、その操作後の画面応答を検査する（接続表示を待つ時間を空回りの検査へ混ぜない）。

`pnpm e2e:web --only=reading-responsiveness` は、生成物を含む大きなフォルダーでFilesの初回・復帰直後とGitの差分表示を通す。画面の操作から本物のHostへ送った読取要求のラウンドトリップを測り、監視開始による停止を検出する。監視の準備中の外部変更も画面へ反映されることを確かめる。計測は検証画面内だけで行い、製品へ記録は残さない。Releaseの受け入れにも含める。

`IORI_AUTOMATION_ISSUE_CAPTURE=1 pnpm e2e:web --only=automation-issue` はIssueの設定・履歴・接続できない理由をPC 1440×1000、WQHD 2560×1440、スマホ 390×844のライト・ダークでスクリーンショットを撮る。

`IORI_AUTOMATION_WEBHOOK_CAPTURE=1 pnpm e2e:web --only=automation-webhook` はWebhookの設定・履歴・ダイアログをPC 1440×1000、WQHD 2560×1440、スマホ 390×844のライト・ダークでスクリーンショットを撮る。

同じシナリオが後で成功すると、前の成功したrunのスクリーンショット（png）は消える（`verification/web/cleanup.mjs` の `pruneScreenshots`）。reviewに渡すスクリーンショットは、撮った後に `.local/evidence/web-shots/<シナリオ>/` へコピーする。

チーム編集のシナリオは `pnpm e2e:web --only=teams` で実行する。CLIのモデル一覧は実物から読み、チームの作成・候補の検索と並べ替え・上限・保存・履歴・メモ・復元と、Host再起動後の保持を確かめる。`IORI_TEAMS_CAPTURE=1` を付けると、PC 1440×1000のライト・ダークとMobile 390×844のダークのスクリーンショットを撮る。`IORI_TEAMS_CAPTURE_VIEWS=teams,worker-candidates,ai-agents` のように指定すると、指定した画面だけを撮る。

`pnpm e2e:web --only=terminal-daemon` は実CLI（Claude Codeのhaiku）とTerminalで出力を続けたままHost本体を再起動し、同じプロセス・保持した画面・出力の続き・hooks・ioriコマンドを確認する。終了した子を残した再起動後も同じ役割への新しい委譲が始まり、終了した親は「会話を再開」で応答できることを通す。委譲の共通helperは、子が一覧に現れただけで取得を終えず、Terminal IDが付いた記録を返すまで読み直す。画面がRunningになっても、先に取得した起動中の記録は更新されないため、その記録でCLIのhook状態を待たない。デーモンの異常終了ではCLIの再開待ちへ戻ることも通す。`restartHostLosingTerminals` はPTY消失の確認に使い、このシナリオだけ `restartPreservingHost` でHost本体を止める。終了時は保存先ごとのデーモンも明示的に止める。ソース・配布物のどちらも製品と同じ起動経路を使い、`verification/terminal/daemon-process.mjs` がそのrunのデーモンのunitへMemoryMax=4G・MemorySwapMax=0を設定する。Web・Release受け入れ・systemdの確認は同じhelperを通り、終了時はデーモンとunitを回収する。Linuxの専用unitがある時は、そのunit全体を停止する。Escapeの入力待ちなどでshellがSIGHUPに応じない場合も、PTYごとの正常終了待ちに後始末を止められないようにする。結果の `daemonUnits` には適用値と回収の確認を残す。 Claude Codeのモデル要求は偽のAPIへ向ける。

`pnpm e2e:web --only=terminal-daemon --replace-host-distribution` は、専用フォルダーに二つの配布物を作り、Hostだけの題名判定を変えてHost停止中にフォルダーごと交換する。同じデーモン・PTYを保ち、新しいHostの判定が適用されることを `terminal.list` の応答で確認する。デーモンのコピーに含めるファイルも実際の配布物と同じ生成一覧を使う。`--only terminal-daemon` の空白区切りも同じ選択として扱う。

`pnpm e2e:web --only=mobile-batch-input` は、スマホ幅のまとめて入力で、文字の貼り付け・複数行の送信・全画面の入力と下書きの復元・Terminal別の入力方式・キーボードを閉じた後の焦点の解除とtapでの再開を確認する。Claude Codeは偽のAPIを使う。

`pnpm e2e:web --only=mobile-key-band` は、スマホ幅のキーの帯で、先頭のボタンの名前と設定のON/OFF、Ctrl・Altの保持（IMEの変換中の入力を含む）と上スワイプを実PTYで確認する。`--only=mobile-images` は、「画像」で実寸のJPEGと1MB超のPNGを選び、元の形式でHostへ保存してCLIへ入れ、Claude Codeが偽のAPIから赤と青の応答を受けることを確認する。

`pnpm e2e:web --only=terminal-size-ownership` は、PCとスマホの大きさの持ち主の受け渡し（前面への復帰・読み取り中の幅の変更で奪わない）を確認する。`--only=terminal-width-handoff` は、スマホが幅を取った後、焦点を保ったPCのTerminalのクリックでPTYがPCの幅に戻ることを確認する。

`pnpm e2e:web --only=terminal-retention`（ほかの選択肢は `event-tolerance`、`long-approval`、`cli-resize`）で、読み位置の保持・出来事の受信継続・長い承認待ち・実CLIの境界ドラッグだけを選んで実行できる。境界ドラッグはモデルへ依頼せず、ドラッグ中の端末寸法の保持、終了時の最終寸法一回の通知、直後の入力を確かめる。CLIへ有料の依頼を送った回は、選択実行でも実際のモデルを確認する。

`pnpm e2e:web --only=cli-settings` は、実物のPiの起動・起動直後のCtrl+C・shellへの復帰と、AIエージェントの画面で名前とコマンドから足したCLIの追加（`--help` からのモデルの引数の自動入力）・編集・削除を既存のシナリオで確認する。モデルへ依頼は送らない。

`pnpm e2e:web --only=cli-definition-plugin` は、実物のPiをユーザーの定義（`plugin-file`の部品、トークン量・利用枠のスクリプト）としてJSONの欄から足し、不足の案内から「ファイルを選ぶ」でスクリプトと部品を選び足せること、確認に部品の置く先とスクリプトのコマンドが出ること、部品が送る共通の形で応答中→完了のインジケーターが出ること、利用枠が出ること、チームの子として委譲した時のトークン量、定義の削除でioriが置いた部品だけが消えて同じ名前のユーザーのファイルが残ることを通す。部品はPiの拡張のフォルダーへ置き、トークン量はPi自身の会話ファイルから読む。モデルはPiの `gpt-6-luna`。

`pnpm e2e:web --only=cli-omp` は、同梱のompの定義と部品を実物のompで確かめる。通常は専用HOMEの通常の保存先と `--profile verification` の保存先の `models.yml` でResponses APIを偽へ向け、本人の `agent.db` を共有しない。`--real-models` の時だけ両方の `agent.db` は元の `~/.omp/agent/agent.db` へのsymlinkで参照する（コピーしない）。両方の `config.yml` に役割のモデル `openai-codex/gpt-6-luna` と `tools.approvalMode: write` を書く。「＋」からの1回目の起動で状態のインジケーターが出ること、応答中→完了、コマンドの承認待ちとCLIの画面での承認、Hostの再起動の後も `-r` で同じ会話へ戻り状態のインジケーターが出ること、チームの子として役割のモデル・許可の引数・最初の指示を受け `iori report` で報告すること、Boardの子の行にトークン量が出ることを通す。設定の起動時の引数に `--profile verification` を保存しても状態のインジケーターが出ることと、専用HOMEの `~/.omp/agent/hooks/`・`~/.omp/agent/extensions/` にioriの部品を書かないことも確かめる。実モデルの時はSQLiteがsymlinkを辿るので、`agent.db-wal`・`-shm` は元の `~/.omp/agent/` にできる。

CLIの定義は `cli-definition-editor`（名前・コマンド・JSONと画像の追加、編集、アイコン、隠す操作）、`cli-definition-session`（実物のClaude Codeのhooks・状態のインジケーター・Host再起動後の同じ会話の再開）、`cli-definition-team`（定義のCLIへモデル・指示・フォルダーを渡して子の報告）、`cli-definition-removal`（読めない定義の理由、削除、TOMLのhooks、同梱の定義へ戻す）へ分ける。各シナリオは新しいHostと専用の設定ファイルを使い、後ろのシナリオはHostの公開APIで定義を準備する。Claude Codeのモデル要求は偽のAPIへ向ける。`IORI_CLI_DEFINITION_CAPTURE=1` のスクリーンショットは各シナリオで使える。

shell初期化を変えた時は、`node scripts/run-bounded-check.mjs node verification/terminal/shell-integration.mjs <Debianパッケージの展開先> <証拠の保存先>` で本物のbash・zsh・fishも確認する。`zsh`・`zsh-common`・`fish`・`fish-common`を`apt-get download`でscratchpadへ取得し、`dpkg-deb -x`で同じ展開先へ置く（systemへはインストールしない）。Fishは実行ファイルからの相対配置に`usr/etc/fish`も必要なので、展開先の`usr/etc`を作り、そこで`ln -s ../../etc/fish fish`を実行する。runnerは証拠の保存先に専用HOMEとHost資材を作り、ユーザーファイルの読込順・alias・プロンプト・PATH・履歴・終了時の設定を実PTYで確かめる。Bashの`.bash_logout`の実行有無は結果へ記録するだけにし、Zshは明示したHISTFILEとPrezto型の既定値について通常の`zsh -l`と同じ履歴ファイルを使い、元のZDOTDIR・`.zlogout`へ戻ることを確認する。通常UIのCLI起動・履歴は上記の`cli-settings`、会話の再開は`--only=web-recovery`で別に確かめる。

`pnpm e2e:web --only=cli-launcher` は、開いたCLI一覧へ実HostのCLI一覧を取り直した応答にある残量・バージョンを出来事として再送し、選択項目・検索語・入力位置を保つことと、タブ選択の直後に「＋」を開いてCLIを選べることを確認する。初回の一覧取得後にバージョンが分かった時、値が変わらず更新の出来事が届かない時、残量が無い時も同じ方法で確認する。モデルへ依頼は送らない。`web-cli` でも、Codexの応答・承認とClaude Codeの操作の後に同じ確認を通す。結果JSONの `launcherObservation` は出来事の種類、DOM要素の継続、フォーカス呼出しの場所を記録し、会話本文・認証値は保存しない。

画像の貼り付けは `pnpm e2e:web --only=clipboard-image`（Claude Code）、`--only=clipboard-image:codex`、`--only=clipboard-image:pi` で確認する。検証用の安価なモデルに画像の色を尋ね、文字の優先、実際のCLIでの画像の受け取り、Terminalを閉じた時の回収を通す。CLIがパスを添付表示へ変換したり、長いパスを折り返したりするため、画面の観測は添付表示またはファイル名の末尾を読む。`--only=clipboard-transfer` はモデルへ依頼せず、1フレームを超えるPNGをCtrl+Shift+Vと右クリックの貼り付けから送り、Hostでの保存と閉じる操作での回収を確認する。Chromiumはクリップボードへ置く時にPNGを再符号化するため、転送サイズはcanvasの生成物ではなくクリップボード内のPNGとHostのファイルを比較する。WindowsのOSクリップボードの読取は別途実機で確認する。

各Web runは `/var/tmp` の専用run folder内に短い `TMPDIR` を作り、ChromiumとHost・CLIなどの子プロセスへ渡す。runの後始末で一緒に回収する。画面serverの起動前に、同じVite設定を使う別プロセスで依存の準備を済ませて終了する。既存cacheの再利用はViteに任せる。準備はVite 8の内部（`depsOptimizer`）の完了を待つので、Viteを上げる時は、準備がすぐ抜けて本番のViteが依存を作り直していないか（run.logに出る）と、並行の受け入れの最大値を見直す。

PlaywrightとChromiumを用意し、`IORI_PLAYWRIGHT_MODULE` と `IORI_CHROMIUM_PATH` でそれぞれの場所を指定できる。無ければ起動前に止まり、自動installはしない。キーの自動入力は日本語IMEの変換・確定を検証しない。ブラウザーのクリップボード権限は共通runnerのcontext作成時に付与する。Terminalのコピー時に共通の左の余白を外す動作（Ctrl+Shift+C・Ctrl+C・Ctrl+Insert）は `pnpm e2e:web --only=terminal-clipboard` で確かめる。Terminalの文字サイズと右クリックは `pnpm e2e:web --only=terminal-preferences` で、実PTYの列数とコピー・貼り付け・メニュー切替を確かめる。タッチを有効にしたスマホ幅で上下にスワイプし、マウス報告を求める実PTYのプログラムに、慣性分も含む正しい座標のホイール報告だけが届くことも通す。

結果JSONの `lastUiOperation` は最後の画面操作であり、失敗した待機の条件ではない。出力待ちの失敗は `error` で識別し、`terminalState` で各Terminalの表示・streamの状態と、そのstreamの保存画面・後続出力の受信を確認する。結果JSONと起動から後始末までの秒数は `.local/evidence/web/run-*/` に残し、画面のスクリーンショットは失敗した回と、同じシナリオ（同じ `--only`、指定なしは全体）ごとの最新の1回を残す。共通helperは別のシナリオのスクリーンショットを削除しない。招待・鍵・本文の通信記録は保存しない。終了時は自分が起動したChromium、bridge、画面server、Hostを閉じ、専用run folderだけを削除する。後始末に失敗した場合は専用folderを残して結果に対象を記録する。次回起動時は `/var/tmp/iori-web-runs/` の古い `run-*` を回収し、別の実行中のrunは残す。手動起動は[開発手順](../DEVELOPMENT.md#ブラウザーで画面を開発する)を参照する。

チームのE2Eが失敗した時だけ、開いている子のTerminalタブ（親の背後にあるタブも含む）の画面を `failure-child-screens.json` へ残す。共通の失敗処理でHostの最新の保存画面を読み、会話IDの有無・hookの状態・保留入力の件数も記録する。成功時の操作は増やさない。

`pnpm e2e:web --only=forge-token` は、検証の時だけ立てる使い捨てのForgejo（公式のコンテナイメージ `codeberg.org/forgejo/forgejo:16.0.5`、`verification/forge/forgejo-container.mjs`）をサインイン必須で立て、非公開のリポジトリ・PR・失敗したcommit status・読み取りのtokenを作る。設定の「連携」での登録・間違ったtokenの拒否・替える・削除・サイトを追加、サイトで取り消したtoken・権限の足りないtoken・つながらないサイトの行の表示と再試行、非公開のリポジトリのPR・CIのインジケーター、CIのインジケーターから開くCIのタブとIssuesのタブを通す。CI・Issuesのタブでは、tokenが無い・無効・権限が足りない・つながらない・リポジトリが見つからない時の理由と回復の操作（「連携を開く」で連携の行へ移る、つながった後の「再試行」、「ワークスペースの設定を開く」でそのワークスペースのGitの設定へ移る）を確かめる。削除後の読取とForgejo・Giteaでないサイトへのtokenの不送信はHost API の E2Eで確かめる。コンテナは127.0.0.1だけで待ち受け、このrunのlabelとowner PIDを付けて終了時に消す。前のrunの残りは、owner PIDが終わったものだけを消す。Dockerを使い、既存のForgejoと既存のコンテナには触らない。tokenは使い捨てのサイトのもので、記録・証拠へ出さない。`IORI_FORGE_CAPTURE=1` を付けると、連携の画面をPC 1440・WQHD 2560のライト・ダークとスマホ 390（一番下までスクロールした所も）で、CI・Issuesのタブの読めない理由とサイドバーのCIの実行中のインジケーターをPC 1440・WQHD 2560のライト・ダーク（インジケーターはスマホ 390も）で撮る。このシナリオは全体の受け入れの追加画面の組にも入るので、受け入れの機械にもDockerと公式のForgejoのイメージ（無ければ初回にcodeberg.orgから取得する）が要る。

`pnpm e2e:web --only=forge-status` は、公開Forgejoの検証用cloneを開き、ブランチ名・最新pushの実際のチェック・未pushブランチでのインジケーターの不在・表示設定の切替を通す。PC幅とスマホ幅で長い名前の中央省略と末尾・インジケーターの収まりも確認する。CIのインジケーターからCIのタブを開き、実APIと同じ実行・job・ブラウザーで開く先、失敗した実行（run 161）のログが失敗したstepの終わりで開くこと、CIの無いcommit（最初のcommit）と、CIを読めない時（検証用のHostはghにログインしていないので、GitHubのremoteを追うworktreeは読めない）のghにログインしていない理由と「連携を開く」の表示、スマホの一覧と詳細の行き来を確かめる。CIのタブのworktreeの切替の一覧は、PC 1440・スマホ 390のライト・ダークで撮る。古いcommitはcloneの中だけのremote-tracking refで追い、pushしない。cloneのremoteへpushせず、認証値は使わない。このE2Eは実行する機械に `gh` があることを前提とし、検証専用の設定ではログインせず、HostのGitHubの未ログイン表示も確認する。

このシナリオは特定のForgejoの履歴を前提とする。

`pnpm e2e:web --only=forge-issues` は、同じ公開Forgejoのcloneでリポジトリの行のIssuesから一覧を開き、続きのページ・ラベルの絞り込み（全てを持つ）・本文と全てのコメント・タブの行き来と再読込での保持・別のworktreeの配置・スマホ幅の一覧と詳細の行き来を通す。実在のIssueは変わるので、文言でなくその時のForgejoのAPIの答え（番号・件数）と照合する。GitHubのcloneは検証専用の設定の `gh` が未ログインなので、読めない時の表示（ghにログインしていない理由と `gh auth login` の案内、「連携を開く」で連携のGitHubの節へ移ること）の確認に使う。`IORI_ISSUES_CAPTURE=1` を付けると、PC 1440・WQHD 2560・スマホ 390のライト・ダークを撮る。`pnpm e2e:web --only=host-uninstall` に `IORI_UNINSTALL_CAPTURE=1` を付けると、撤去の確認と結果をPC 1440・WQHD 2560・スマホ 390、撤去した後のスマホ 390の設定をライト・ダークで撮る。`--only=reading-worktrees` に `IORI_READING_CAPTURE=1` を付けると、列の多い表とコードの長い行を持つMarkdownをPC 1440・WQHD 2560（ふだんの幅と最大化）・スマホ 390で、表とコードを横にスクロールした所をPC 1440の最大化で、開いたファイルを消して読み込み直した時のFilesの読めない表示をPC 1440で、表示領域より大きく拡大した画像をPC 1440・スマホ 390で、短い名前を表示したまま開いたFiles・Gitのworktreeの切替の一覧（長い名前のworktreeを含む）をPC 1440・スマホ 390で、それぞれライト・ダークで撮る。

`pnpm e2e:web --only=forge-issue-start` は、同じ公開Forgejoのcloneで、Issueの詳細の「このIssueで始める」から名前と最初の指示が入った作成画面を開き、「作る」で始めたClaude Code（haiku）の最初の入力が、指示をコピーした配送用のファイルを読む1行になることを、Claude自身のuser入力の記録とファイルの本文で確かめる。リポジトリの「＋」で入れた複数行の最初の指示を「この場所で」で渡すこと、スマホの幅の全画面の作成画面と、「＋」がIssueの値を持ち越さないことも通す。最初の指示は製品の決まった文なので、文言で照合する。`IORI_START_CAPTURE=1` を付けると、PC 1440・WQHD 2560・スマホ 390のライト・ダークを撮る。

このシナリオは特定のForgejoの履歴を前提とする。

チーム外のCLIからのForgeの読取と認証の理由は、偽のForgeと実際のPTY・CLIを使うHost API の E2Eで確かめる。

子の行の見た目は `pnpm e2e:web --only=child-rows` でも確かめる。既存の通知用fixtureで候補待ちの委譲を作り、本物のCLIやモデルを呼ばず、PC・Mobile幅の行の開始位置・字下げ・2段の内容の収まりを確認する。全体の受け入れにも含め、実CLIの委譲の受け入れでも同じ寸法確認を残す。 `--only=child-running` は報告・質問後の状態表示に加え、worktreeごとの開閉、畳んだ行のCLI種類・件数と省略、親子の字下げ、MobileのドロワーからFilesへの移動を通す。CLI一覧のfixtureはClientの読込前に登録する。子の表示fixtureは一時的な出来事なので、再読込後はHostの子の行が現れてから同じfixtureを適用する。適用中はイベントと子・Terminalの一覧応答へ同じ状態を差し込み、Hostの再取得で表示が戻らないようにする。開閉の検査はアニメーション後の可視状態を共通helperで待つ。

AIエージェントの折り畳み行を操作する時は、`saveStartupArguments` と同じく行の `data-state` で開閉を確かめる。入力欄が画面外にあることを閉じている条件にせず、共通の入力操作でスクロールしてから編集する。

Boardの実行中の操作は `pnpm e2e:web --only=board-activity` で確認する。子のCodex（gpt-6-luna）に画面からコマンド実行・ファイル編集・報告を依頼し、Boardに出たツール名・対象・Thinking・Reportedを観測する。`IORI_BOARD_ACTIVITY_CLI=claude` を付けると子もClaude Code（haiku）で同じ操作を通す。Claudeの検証用候補は `acceptEdits` を指定し、Boardを表示したままファイル編集を観測する。通知が無い時のRunningとPC・スマホの長い表示の省略は `--only=child-running` で確認する。Claude CodeとCodexのモデル要求は偽のAPIへ向ける。

チームの実CLIの操作は `verification/web/team-command.mjs` から実物のioriを呼び、親と同じ環境・作業フォルダー・認証の経路を使う。通知を受ける親は通常の道具なし起動とし、親CLIから委譲するシナリオだけ道具を有効にする。親モデルの返答や判断は合否に使わず、Claude Code・Codex自身の入力の記録とhookで確認する。知らせの回数・未報告の待ち理由・停止後のsend・引き継ぎは `e2e/host/team-messages.test.mjs`、worktreeの準備コマンドと環境は `e2e/host/worktrees.test.mjs` で確認し、画面のシナリオへ重ねない。Codexの既定sandboxと起動引数、代替画面のホイールと文字入力は実物のCLIを使う `team-child-tabs` に残す。

別リポジトリへの委譲は `pnpm e2e:web --only=repo-delegation` で、最初から道具なしで起動した親Claude Codeの経路から実物のioriを直接呼び、子Codex（gpt-6-luna）の編集・報告、Files/Gitの切替、削除まで通す。runnerが作る2つ目のリポジトリも、共通の `prepareCliHome` の `repositories` に渡して検証用CLIの信頼済み設定へ含める。製品が信頼確認へ自動で答える処理は加えない。 Claude CodeとCodexのモデル要求は偽のAPIへ向ける。

worktreeの削除は `pnpm e2e:web --only=worktree-removal` で、merge・squashのインジケーターと取り込み済みの削除の候補、未取り込みブランチの保持、実Terminalの停止、スマホの長押しを確認する。長押しはWeb runnerが公開する共通の `screen.longPress` を使い、右クリックイベントをタッチの代用にしない。Windows Hostのプロセス停止とフォルダー削除は `node scripts/run-bounded-check.mjs node verification/workspace/worktree-removal.mjs` で、専用Hostへ開発Clientから接続して確認する。検証環境の鍵・gate・source転送・起動と回収は共通helperを使う。登録の共通helperは接続を確認した「端末」設定画面で終わるため、フォルダー操作へ進むrunnerは「設定を閉じる」を押す。リポジトリを開いてからサイドバーの対象worktreeを選び、選択先を確認してTerminalを起動する。同じ実行で、別プロセスがファイルを開いているworktreeの削除は理由を示して拒み、ファイルとGitの登録が残ることも確認する。

`pnpm e2e:web --only=model-failure` は、未ログインのCursor CLIを専用HOMEで使い、AIエージェントの行にCLI自身の認証エラーがシェルの警告や色の制御文字なしで表示されること、「詳細」で全文を開けること、再試行で詳細が閉じることを確認する。Cursor CLIの認証は共有・作成しない。

`pnpm e2e:web --only=child-cli-failure` は、本物のCodex・Claude Code・OpenCodeの子を使えないモデル（OpenCodeは `verification/web/cli-error-fixture.mjs` の再試行しないHTTP 400）でエラーにし、子の行・Board・親への知らせに失敗とCLIの理由が出ること、親の `send` でRunningへ戻ることとHostの不在中の失敗が復元されることを確認する。再入力でRunningへ戻ることと `--continue` で次の候補へ依頼を渡すことは `e2e/host/team-lifecycle.test.mjs` で確認する。

`pnpm e2e:web --only=opencode-delegation` は、親Claude Code（haiku）から、Effortを持つ保存済み候補のOpenCodeへ委譲し、子の報告までを確認する。通常はV1・V2とも認証を共有せず偽のResponses APIへ `openai/gpt-6-luna` で接続する。`--real-models` の時は、V1はChatGPTのログインをsymlinkで共有し、V2は無料モデル `opencode/deepseek-v4.1-flash-free` を使う。CLIのHOME・データはチームのシナリオと同じ専用の保存先を使う。 専用HOMEで `bash` と `external_directory` を `ask` に設定し、自動承認なしの子が製品pluginによって依頼書だけを追加承認なしで読み、報告の前の `iori` の探索（`iori --help` など）と報告コマンドの実行承認に答えて完了（依頼書のフォルダーの外を求める承認は失敗にする）することを確認する。 停止した子へ親の `send` で追加依頼を送り、同じ会話で再開して報告できることも通す。報告も質問もない初回の応答終了では親への一行と `iori tasks --json` の `no_report` を確かめる（その後の回数と子ごとの宛先はHost API の E2E）。 V2では、同じシナリオの中で「＋」からの通常起動、作業中・質問待ちから回答後の完了、HostとTerminalのデーモンの停止後の「再開」も通す。再開は会話に保存されたモデルを使い、起動ごとのモデル指定を付け直さない。

V1（`opencode-ai`）とV2（`@opencode/cli`）を比べる時は、隔離した場所へ入れたバージョンの実行ファイルを指す `opencode` を、そのrunのPATHの先頭へ置く。本人の `opencode` と `~/.config/opencode` は変えない。runのCLI一覧へ実際のバージョンを記録し、V2の通常起動用モデルも専用HOMEだけに設定する。V2のシェル実行の承認はV2の正式名 `shell` で表示する。V2はTerminalごとの `--standalone` で起動し、チーム候補のモデルは `OPENCODE_CONFIG_CONTENT` で渡す。共有設定にV2専用の項目を書かず、V1/V2共通の1つの `iori-status.js` を使う。

## 本物のCLIで確かめる時

- 検証HostのClaude Code・Codex・Piは使ったバージョンを記録する。バージョンを上げた時は本物のCLIとの照合を行う。古いバージョンは消さず残す。
- 有料の入力には安いモデルを明示する。Claude Codeは `claude-haiku-4-5`、Codexは `gpt-6-luna`、PiとOpenCode V1は提供元 `openai` の `gpt-6-luna`。試験の費用の自己確認として、実際に使われたモデルはCLIの記録で確かめる。製品の受け入れ判定の根拠にはしない。製品のモデルの既定値を試験用に変えない。
- 認証ファイルをコピーして使わない。ブラウザーのE2Eは検証用の設定へ分離し、実モデルを使うCodex・Pi・OpenCode V1は認証ファイルをCLI自身の保存先へのsymlinkで参照する。認証をコピー・書き戻ししない。OAuthの更新が起きるとコピー側だけが新しいrefresh tokenを受け取り、元のCLIが認証できなくなる。共通のCLI HOME準備helperは、共有認証ファイル（Codex・Pi・OpenCode V1）を読み書き用に開いてすぐ閉じ、本文を読み書きせず更新権限を確認する。書き込み制限がある実行環境では、CLIの通常のOAuth更新ができる権限（Codexの制限付き実行では `require_escalated`）で検証を実行する。検証HostのCLI自身の認証をそのまま使う。
- Claude Codeは認証ファイルを一時ファイルからrenameで置き換えるため、symlinkでは新しいrefresh tokenを検証用ホームへ書いてしまい、元のログインが使えなくなる。実モデルを使う検証のClaude Codeは、`claude setup-token` で作った試験専用のトークンを 準備時のエラーが示すファイル（0600、`CLAUDE_CODE_OAUTH_TOKEN=<トークン>` の1行）から読み、環境変数 `CLAUDE_CODE_OAUTH_TOKEN` だけで受け取る。検証用ホームに `.credentials.json` は置かず、元のファイルは開かない。Windowsで起動する時は標準入力で渡し、sshやPowerShellのコマンドラインに載せない。ファイルが無い時は準備の始めに置き場所を伝えて止まる。トークンの値はログ・証拠・結果・スクリーンショット・会話へ出さない。検証コードがClaudeの `.credentials.json` をリンク・コピーしようとするとlint（`iori/no-claude-credentials-link-copy`）が止める。

## SSHでWindows Hostを導入する

`verification/host-setup/build.mjs --client Windows --ssh-windows` でWindows・Linuxの検証用Clientと署名済みのWindows Hostを作る。準備から回収まで `IORI_VERIFICATION_CONFIG=verification/host-setup/tauri.conf.json`・`IORI_VERIFICATION_EVIDENCE_ROOT`・`IORI_VERIFICATION_PORT` を同じ値にし、Node 24で `node scripts/run-bounded-check.mjs node` に続けて各入口を実行する。

`verification/host-setup/run-ssh.mjs --host Windows --client Windows --shell=cmd --keep-build` と `--host Windows --client Linux --shell=powershell --keep-build` は、SSHの接続先の選択・確認への回答・導入・登録・Direct接続・SSH終了後の継続・既存Hostの登録・撤去結果の読取りを画面から通す。管理者の接続先では、選択なしでWindowsファイアウォールの規則が加わる。`--signed-out` を加えた実行は、管理者でない使い捨てユーザーを使い、導入に進まず「この PC」での導入と招待を案内し、招待の入口へ進むことを確かめる。最後の実行では `--keep-build` を外してbuildのフォルダーも回収する。途中で打ち切った時は、同じ設定で `verification/host-setup/run-ssh.mjs --host Windows --client Windows --cleanup-build` を実行し、共通helperでbuild・ClientのSSH秘密鍵・配布元の使い捨ての鍵を回収する。

`--shell=powershell` は既定のshellをPowerShell 7にし、Windows標準のPowerShell 5.1へ渡す経路も確かめる。検証用CAには失効の情報が無いため、検証ソースのcurlだけに `--ssl-revoke-best-effort` を付け、CAと名前の確認は維持する。取得の終了コードと標準エラーは各runの `download.json`、後片付けが失敗した時の残ったフォルダーとプロセスは `host-cleanup.json` に残す。

Linux Clientは使い捨てユーザーの実ホームで動かし、OpenSSHの設定と鍵も同じホームへ置く。ユーザーとホームは終了時に回収する。Hostの回収だけを確かめる時は、同じ設定で `--host Windows --client Windows --cleanup-host` を使う。

Windowsが使い捨てユーザーのprofileをLoadedのまま保持している時は、追加の待ち・プロセスの停止・hiveの強制解放をせず、`cleanup.user` にユーザー名とprofileの場所を残して回収未完とする。Ownerに検証機の再起動を依頼し、再起動後にそのユーザーのprofileとアカウントだけを回収する。

Windows・Linux検証機と配布元の鍵・gateを使う。日常の保存先・portは使わず、検証用Hostは本人のLocalAppDataの専用フォルダーへ置く。既定のshellは実行中だけ切り替え、終了時に元の値へ戻す。追加した鍵・規則・ユーザー・導入物・起動の登録も回収し、結果と作成・回収したものは証拠先の `windows-ssh-*/result.json` へ残す。回答・招待・秘密鍵・パスワードはスクリーンショットの取得・記録をしない。
