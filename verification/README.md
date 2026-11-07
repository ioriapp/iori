# 検証

通常の開発ではLinuxでブラウザーの画面E2Eを使う。実機と本物のCLIを使う追加の検証には、対象OSや端末などの設備が要る。

## 見本と製品の画面を同じ状態で比べる

画面の作業の受入では、`node verification/ui-states/server.mjs` の開発用ページで状態とテーマを選ぶ。製品の部品に状態のデータを渡して描き、nativeやHostは呼ばない。製品のbuildには入らず、操作列や状態遷移の試験の代わりにはしない。

`node verification/ui-states/capture.mjs` は見本の全idをPC（1440×900）・WQHD（2560×1440）・狭い窓（390×844）の明暗で撮る。画像・高さの実測値・見本を左、製品を右に並べた `index.html` は `.local/evidence/v16-state-shots/` の実行ごとのフォルダーに出る。高さは合否を判定せず、描けない状態や見本の画像が無い場合は理由を一覧に残す。

見本の状態一覧は `--catalog=〈host-setup-states.ts〉`、見本の画像は `--reference=〈フォルダー〉`、保存先は `--output=〈フォルダー〉` で変えられる（開発用ページでは `IORI_UI_STATE_CATALOG`）。既定は作業用の `.local/ui-sample/v16-host-setup/src/host-setup-states.ts` と `.local/ui-sample/dist-shots-v16-host-setup/`。一部だけ撮る時は `--only=A0,B2b` を使う。既存のPlaywrightとChromiumを使い、導入場所は `IORI_PLAYWRIGHT_MODULE` と `IORI_CHROMIUM_PATH` で指定できる。描画データは `verification/ui-states/fixtures.ts` に置き、画面の非公開の初期状態を渡す対応は開発用サーバーだけが持つ。

## 追加の実機検証

`verification/local.example.json` を `~/.config/iori/verification.json` にコピーし、検証環境に合わせて設定する。通信・端末登録、Clientの更新とHostの導入、Terminal・CLI・通知などの実機検証は `verification/` の各機能のrunnerを使う。Windows、Linux、Androidの対象設備とSSH・ADBなどが必要で、ブラウザーのE2Eとは別の確認である。runnerの一部は特定の検証環境のパスや利用者を前提とする。日常用の保存先と端末を使わず、検証用の環境を分ける。

## Clientの鍵の紛失からの回復（Linux）

専用の `IORI_VERIFICATION_EVIDENCE_ROOT` を設定し、Node 24で `node scripts/run-bounded-check.mjs node verification/linux-client/build.mjs`、続いて同じ入口から `verification/linux-client/registration-reset.mjs` を実行する。Linux検証機の鍵とgate、専用の保存先・DBus・キーリングを使い、招待からHostへ登録し、Clientを終了して専用キーリングのioriの項目を削除し、起動の失敗画面から確認つきの「登録をリセット」で最初の登録画面へ戻る。Host一覧が空になったことを確かめる。終了時はClient・Host・招待と専用のフォルダーを回収する。`--keep-build` を付けた時はbuildだけを保持する。Windows・Androidはこの操作列では扱わない。

Linux Clientの共通helperは、専用のXvfb画面をGDKで撮影する。画面操作や起動に失敗した時も、WebDriverの撮影に依存せず画像を残す。必要なPythonのGDK bindingは `verification/linux-client/prepare.mjs` で準備する。

画面の4状態（Linux・Windowsの鍵の読み込み失敗、確認、リセットの失敗）は `node verification/ui-states/capture.mjs --catalog=verification/ui-states/registration-states.ts --sizes=pc,phone` でPCとスマホ幅のライト・ダークを撮影する。nativeやHostへは接続せず、処理の確認には上の操作列を使う。

## 検証の道具の書き方

- 画面は共通の操作helper（`verification/ui.mjs` の待機・スクロール・可視判定・入力）と安定した識別子（`data-iori-*`）で操作し、表示文言や画面の偶然の状態に頼らない。
- メニューを開くボタンは `screen.click` を使う。スマホの指操作の確認は `screen.tap` を使い、フォルダー選択の「開く」では `{ dismissKeyboard: true }` でIMEの退場と座標の安定を共通helper側で待ってから押す。Radixのメニューが受け取るpointerdownをhelperが送る。クリック後の描画と予約されたスクロール・focusが終わってから次の操作へ進む。クリック・右クリック・指操作では、閉じる途中のメニューやダイアログが消え、対象の中央が他の要素に覆われなくなってから操作する。
- サイドバーを開く時は `e2e/connection/scenario.mjs` の `openSidebar` を使い、開いていればそのまま操作する。再読込後も入口の表示を待ってから開閉を判定する。閉じる時は同じ共通helperの `closeSidebar` を使う。シナリオ内の直接のトグル操作はlintで止める。Mobileの開始画面には作業画面の `mobile-location` がないため、作業画面のボタンだけに対象を限定しない。
- 並べ替えなどのpointerドラッグは `verification/ui.mjs` の `screen.drag`、長押しは `screen.longPress` を使う。並べ替えのtouch sensorを使う長押しも、終了直後にはクリックが抑制される。どちらも抑制が解けるまでhelperが待つので、操作列へ独自の待ちを足さない。
- 本文の文字をドラッグで選ぶ操作列では、既に選んだ文字の中からドラッグを始めるとブラウザーの文字のドラッグ＆ドロップになり、新しい選択が始まらない。選び直す前に、選択の外を本物のクリックで1回押して選択を外す。ドラッグ中にホイールでスクロールする時は、押したままの印（`buttons: 1`）を渡す。
- headless のChromiumでは、CDPのtouchの長押しで文字の選択が起きない（ただの選べる文でも起きない）。スマホのOSの文字選択（つまみと「コピー」）は道具で確かめず、Androidの実機でOwnerが目で見る。E2Eは、iori のメニューが開かないことなど、画面の要素で確かめられることだけを確かめる。
- 画像の大きさや縮尺など、読み込みの後の描画でそろう値は、読み込みを待った直後に1回測らず、`waitFor` の条件として待つ。開発版のHostでは通っても、応答の速い配布物のHostでそろう前の1回の描画に当たる（0.1.102 の `git-image-diff`、#298）。
- Files・Git・Boardを開く時は `verification/workspace/interaction.mjs` の `openWorkspaceView` を使う。PCは開いているタブまたは「＋」の一覧、Mobileはドロワーの入口を使う。新しいタブを置くペインが決まっている操作は第3引数にそのgroup IDを渡す。 `sidebar-open-*` を直接押す操作はlintで止める。
- MobileのFiles・Gitで開いた本文から一覧へ戻る時は、作業画面の `mobile-location` が見えていればスマホの戻る操作（`screen.key("Alt+ArrowLeft")`）、見えていなければ `reading-back` を押す（`e2e/web/files-reading.mjs` の `open`）。Mobileでworktreeを選び直すと、そのworktreeで開いていたファイルの本文へ移り、上端のworktreeの切替は隠れる。
- RadixのSelectの項目は、headlessのChromiumでは `screen.click` でも本物のマウスの押下と解放（`clickWithin`）でも選べない（#302、前の版でも同じ）。欄に焦点を置き、Home・↓で項目へ移るたびに焦点の移った項目を `waitFor` で確かめてからEnterで選ぶ（`e2e/workspace/scenario.mjs` の `selectFolderHost`）。選んだ後に続けて入力する時は、入力の欄を押してから入力する（閉じた後の焦点の戻りと入力が重なる）。
- 新しい操作列を書く前に、同じ操作の共通helperがないか確かめて使う。既知の失敗への対策は、その操作のhelperに入れ、誤った書き方は静的検査で止める。
- Piの検証用ファイルは `verification/cli/home.mjs` の `piAgentDirectory` が返す専用HOME内へ置く。呼び出し元の `PI_CODING_AGENT_DIR` は引き継がず、シナリオからの直接参照はlintで止める。
- 長い依頼本文だけを渡すWeb E2Eは `e2e/web/cli-input.mjs` の `pasteToCli` で通常の貼り付けを使い、CLIの画面に本文または貼り付けの印が出てからEnterを送る。文字入力の経路を確かめる操作は1文字ずつの共通helperを使う。
- 転送・作成・更新・モデルの応答など処理の量や提供元で時間が変わる待ちは、`verification/ui.mjs` の `waitForOperation(観測名, 読む, 完了の判定, 失敗の観測)` で、完了か失敗が見えるまで待つ。全体の上限は `run-bounded-check` が持つ。失敗の観測は `verification/web/operation.mjs`（CLIの失敗・子の失敗・画面の警告）を使い、失敗を待つ所では反対側の終わり（失敗せずに報告した、警告なしで閉じた等）を失敗として観測する。観測できない待ちは期限付きの `waitFor` のままにする。画面の反応の待ちは `waitFor`・`screen.wait` を使う。

  Webの待ちでは、CLIが応答中のままHostの状態が90秒変わらなければ止まりとして落とし、受入の流し直しへ回す。進行の印には `cliStatus` だけを使い、読み取りの間の変化もHostの出来事から数える。

- 時間の絶対値（何ms以内に返る等）は画面E2Eで判定しない。判定は試験の4種類目（負荷試験）に置き、画面E2Eは順序と、製品が判断に使った時刻での下限で確かめる。
- Terminalの文字は `observed` で受信画面を解析して読む。画面に出ない制御信号は文字として待たず、`observedTerminalMode` で同じ受信画面のモードを読む。
- 実機で走らせる前に静的検査を通す。
- 検証資材の不具合は `.local` のコピーで直さず、その場で `verification/` を直して変更に含める。
- 失敗時の診断が巨大な値（DOM要素・React内部など）を展開しないよう、比較は真偽値・文字列など小さな値で行う。

Linuxの実機用buildもNode 24から起動する。`verification/connection/prepare-linux.mjs` は起動元のNodeでpnpmとその子scriptを動かし、Hostへ同梱するNodeに合わせてnode-ptyを作り直す。tool managerが別のNodeを選ぶ環境や、別のNodeで作ったpnpm cacheを再利用する時も、通常の準備の入口を使う。

Linuxの検証用debの導入・回収は `verification/native/linux-packages.mjs` の共通helperを使い、apt-getの `DPkg::Lock::Timeout=-1` で鍵が空くまで待つ。鍵ファイルの削除や別のapt処理の停止はしない。

## ブラウザーの画面E2E

Web runnerも `~/.config/iori/verification.json` の `windows.home` を読込時に必要とし、cacheの一部は固定パスを使う。別の環境ではそのパスに書き込めず、手順どおりに流せない場合がある。

スマホ操作の共通helper `mobile()` と `phone()` は、Terminalを作る前にタッチ対応を有効にする。画面幅だけを変えてもxtermの指操作は登録されない。`desktop()` はタッチの模擬を解除する。

Webで複数Hostを確認する時は `startWebHost(distribution, { dataRoot, port })` へ検証専用の保存先とportを渡し、返る `close({ stopTerminals: true })` で後始末する。サイドバーの並べ替えは `pnpm e2e:web --only=sidebar-order` で確認する。

`verification/web/run.mjs --only=<操作列>` は操作列を1つだけ受け取る。指定なしの長い一括実行は使わず、複数の操作列は1つずつ流す（`--only=a,b` で複数は選べない）。接続中のHostをまとめて更新するダイアログは `client-update` ではなく `client-host-update` が通す。

基本の操作列は次のまとまりに分ける。どれも通常の招待で登録し、必要なフォルダーやTerminalを共通helperで開く。`web-recovery` は会話の保存からHost再起動・再開・通信断のFiles/Git・同じTerminalへの復帰までを一緒に通す。`web-terminal` はペインを閉じた後のTerminalで切断と再接続を通す。

| `--only` の名前      | 内容                                                                                      |
| -------------------- | ----------------------------------------------------------------------------------------- |
| `host-update-mark`   | 選択中のHostと一覧の更新の印、外したHostの印の消去                                        |
| `web-workspace`      | 登録、Git/非Gitの初期タブ、再読込・worktreeの往復、Host設定、登録解除と再登録後のTerminal |
| `worktree-removal`   | worktreeの削除と取り込み済みの片付け                                                      |
| `files-transfer`     | Filesのアップロードとダウンロード                                                         |
| `git-image-diff`     | Gitの画像の変更前後・拡大・前後の切替、スマホの表示と戻る                                 |
| `reading-text-copy`  | 本文のドラッグ・スクロール後のコピー、Gitの本文、スマホの長押しと行選択                   |
| `reading-worktrees`  | worktree間のFiles/Git、Markdown・画像の表示                                               |
| `web-terminal`       | 日本語、ペイン操作、読み位置と通信復帰、出来事の継続、PC・スマホの寸法、shellの初期化     |
| `web-cli`            | CLI設定・初回起動、最大化、状態と通知、hooksの失敗と再試行、CLI一覧、長い承認待ち         |
| `web-recovery`       | Codexの会話の再開、会話IDの無いCLI、Files/Gitの通信復帰、スマホで同じTerminalへ戻る       |
| `automations`        | 自動化の作成・実行と履歴                                                                  |
| `automation-webhook` | Webhookの受信・履歴・token更新・受信範囲・待受の変更                                      |
| `automation-issue`   | Issueのラベルによる起動・履歴・PR作成・接続の回復                                         |
| `teams`              | チーム編集・保存とHost再起動後の保持                                                      |
| `child-rows`         | 候補なし委譲の通知、PC・Mobileの子の行の配置                                              |
| `worktree-create`    | worktreeの作成                                                                            |
| `forge-status`       | フォルダーの無い時の連携設定、Forgeの状態                                                 |
| `forge-issues`       | ForgeのIssue一覧と詳細                                                                    |

`web-cli`・`team-delegation` はClaude CodeとCodexをlocalhostの偽のモデルAPIへ向ける。`claude-status`・`long-approval` も同じClaude Codeの台本を単独で使う。`web-cli` のPiも偽のResponses APIを使う。`--real-models` を付けると、同じ操作列をClaude Codeのhaiku・Codex/Piのgpt-6-lunaの実モデルで通す。`web-recovery`・`automations`・`automation-webhook`・`automation-issue`・`forge-issue-start`・`host-update`・`host-uninstall`・`mobile-batch-input`・`mobile-images` は偽のAPIを使う。`web-terminal` は本物のPiを起動するがモデルへ依頼しない。残りのCLIとfixtureは各操作列の説明に従う。Releaseの範囲の受入も同じ名前を `--scenarios=web-cli,web-recovery` のように指定する。

`pnpm e2e:web --only=pane-maximize` は入れ子の分割を含む4ペインでTerminal・Pi・Filesを最大化し、タブを切り替えてからTerminal外へ焦点を移したEscape・復元ボタン・外側のクリック・タブのダブルクリックで戻す。背景が消え、内容が元の位置と大きさへ戻り、非表示タブの描画面もワークスペースからはみ出さないことを確かめる。比較元は選んだタブの内容がペインに収まってから取得する。Terminalに焦点がある時のEscapeは、最大化を保ったまま実PTYへ0x1bが届くことを確かめる。同じ操作列は `web-cli` にも含める。

`pnpm e2e:web --only=web-cli` は本物のPiを「＋」から開いて終了し、同じshellでコマンドを実行する。設定の「AI エージェント」でバージョンを確認してCLIを追加し、検索して開く。shellが終了した後の空のペインからも続ける。PCの一覧・CLIのタブとサイドバー・設定を見本v9と同じ1440×1000の構図で明暗撮影する。操作列は [CLIの画面](../e2e/cli-screen/scenario.mjs) に置く。`--only=web-terminal` の[shell起動](../e2e/cli-screen/shell-startup.mjs)はrun専用のINPUTRCでBashの準備通知を止め、通常のキー入力による起動保留の取消と、後の通知で勝手な入力が起きないことを確かめ、既定shellを実物のdashへ変えてCLIの起動と終了も通す。CLIのHOMEとPiの会話保存先 `PI_CODING_AGENT_SESSION_DIR` はrun専用に分ける。認証の共有は[本物のCLIで確かめる時](#本物のcliで確かめる時)に従い、偽APIを使うCLIは共有しない。利用者の設定は写さず、モデルは検証HOMEでCodexの `gpt-6-luna` とPiの `openai/gpt-6-luna` を指定する。[状態と判断待ち](../e2e/cli-screen/status.mjs) は短い応答、承認が要るコマンド、Running撮影用のコマンドをそれぞれ一つ頼み、状態の印・完了を表示して待機中になること・PCとMobileの判断待ち・CLI内の回答による解消を通す。検証用の利用者hookを残し、ioriのhookとその信頼だけが撤去されることも確かめる。Claude Codeは分離した設定で `claude-haiku-4-5` を指定し、偽API（`--real-models` の時だけ試験専用トークン）で起動する。CLIの承認画面が表示されたことを確かめてEscで断り、実物の中断表示とioriの判断待ちの解消を通す。Mobileの最初の画面は400×900で明暗撮影する。Piの入力準備は共通の `waitForPiInput` で、そのTerminalの入力画面にある空のコンテキスト表示を待つ。起動案内は小さいペインの保存画面から消えることがあるため、準備の判定に使わない。shell履歴の照合ではreadlineのカーソル移動も除く。

CLI一覧を開いても未使用CLIの設定が変わらず、初めて開くCodexも最初の会話から状態の印が出ることを確かめる。`pnpm e2e:web --only=cli-launcher` はhookの無いHOMEで、初めて開くPiの会話に起動直後から待機中の印が出ることも確認する。Claude Codeでは専用HOMEのhook用フォルダーに書き込みを妨げるファイルを置き、取り付けに失敗しても起動できること、障害を取り除いた後の起動で再試行し、その会話から待機中・承認待ちを観測できることを通す。このClaude Codeの操作列だけを流す時は `pnpm e2e:web --only=claude-status` を使う。

`pnpm e2e:web --only=web-recovery` は、偽のAPIにつながるCodexへ記憶を頼み、Host再起動後に最後の画面と再開行を確認してから、同じ会話と記憶を戻す。会話IDを持たないCLIの元のコマンドでの起動し直し、閉じるも通す。通知はnativeの口の代わりの記録で、対象を見ていない時の文面と1回の要求、見ている時の抑制を確かめる。OSの通知の代用にはしない。通知の確認は `--only=web-cli` を使う。

チームの子の表示・停止・再開と保留回答は `pnpm e2e:web --only=team-delegation` で確認する。親の終了で待機中の委譲を取り消す確認では、共通の直接実行helperで実物のioriを呼び、対象2件を一つずつ作る。子を別のworktreeの一覧から開かず、サイドバーの子の行から親の配置へ開く。チームをfixtureとして作る時は、Hostが返す役割と候補のIDを使い、作成要求のIDを再利用しない。残量の表示は本物のCodex app-serverから読み、残量の下限の選択は純粋関数の試験で確認する。

`pnpm e2e:web --only=child-lifecycle` は最初から道具なしの親を起動し、保留回答、親・子の終了、Claude Codeの子の停止から親のsendでの再開、Hostと係の再起動後のClaude Codeの親の開き直しを確認する。`--only=team-notifications` はモデルを呼ばずClientの通知入口を確認する。Claude CodeとCodexのモデル要求は偽のAPIへ向ける。

### ブラウザーE2Eの既知の失敗と対策

- 手元の全体の受入（`scripts/release/acceptance.mjs`）の1組目は、実行した作業ツリーのsourceをそのまま使い、画面のserverがその変更を途中から読み込む（Viteの更新）。受入の実行中に同じ作業ツリーのsourceを直すと、残りの操作列が直した後の画面で流れ、結果がどちらの版のものか分からなくなる。受入の途中で直す時は、受入が終わるのを待つか、別の作業ツリーで直す。

- E2Eでメモリ上に合成した大きいFile（`new File([new Uint8Array(N)])`、およそ200MiB以上。同じページで繰り返すと192MiBでも）は、Clientの `FileReader` が `NotReadableError` で読めない（製品の不具合ではない。ディスク上の実物のファイルは同じChromiumで256MiBを読める）。大きいファイルはrunのフォルダーに実物を作り、ファイルの入力欄から取り出したFileを渡す（`e2e/web/files-transfer.mjs`）。

- 名前を中ほどで省略する部品（`MiddleEllipsis`）の文字は表示の幅で変わる。E2Eで全文を確かめる時は `screen.text` でなく `data-iori-full-name` の属性を読む。表示の文字の組み立てを変える時は、その要素を読むE2Eを `grep` で洗い出して合わせる。

- フォルダー選択のボタンは `e2e/workspace/scenario.mjs` の `openFolder` で選択画面内に限定する。同じパスのサイドバーの「＋」も `data-iori-folder-path` を持つため、画面を限定しないと再度開く操作でCLIの開始画面を押す。無限定なセレクターの組立てはlintで止める。

- Gitでない検証用フォルダーはGitの作業ツリーの外に作る。中に作ると親のrepoに解決される。[Web runner](web/run.mjs) の `createPlainFolder` で作り、全シナリオの保存先を `/var/tmp/iori-web-runs/` へ分離する。

- CLIへの文字入力と送信は、人のキー操作の間隔で文字と送信キーを分ける共通helper [`submitToCli`](../e2e/cli-screen/input.mjs) を使う。

- Terminalを別画面の裏で終了させるWeb E2Eは、shellが待機を始めた出力を観測し、移動先の画面が出てからFIFOで終了を知らせる。キー送信直後の画面移動や決まった秒数を、shellが入力を受け取った根拠にしない。

### 偽のモデルAPI

`verification/web/fake-model-scenarios.mjs` の `clis` で指定したCLIは、試験の中で起動する `verification/fake-model/server.mjs` へ接続する。CLI本体・Host・画面・hooksは本物を使い、合否の判定も実モデルと同じにする。Claude Codeは `ANTHROPIC_BASE_URL` と試験専用の `ANTHROPIC_AUTH_TOKEN`、Codexは分離したHOMEの `config.toml` のproviderで接続先を変える。偽APIを使うCodexには通常本人の `auth.json` へのリンクを作らず、Claude Codeには試験用OAuthトークンを渡さない。残量の確認がある操作列では `codexAccount: true` を宣言してCodexのログインを共有し、残量は本物のapp-serverから取得する。モデルの要求は偽のproviderへ向けたままにする。呼び出し側の偽API用の環境変数も引き継がない。

`cli-definition-plugin`（Pi・Claude Code）、`clipboard`（Claude Code・Codex・Pi）、`cli-omp`（omp・Claude Code）、`opencode-delegation`（OpenCode V1・Claude Code）も通常は偽APIを使う。Piの `models.json`、OpenCode V1の `opencode.json`、ompの通常・profile両方の `models.yml` でResponses APIの接続先を変え、Pi・OpenCode V1・omp本人の認証は共有しない。ompの各会話役割は同じ偽の接続先へ揃える。OpenCode V2は無料モデルを使う。`opencode-delegation` は既存の残量表示の確認に `codexAccount: true` を宣言し、Codexのモデル要求の接続先も偽へ向ける。

操作列ごとの対象CLIと台本は `verification/web/fake-model-scenarios.mjs` に、操作列名をキーとする `{ clis, scripts, codexAccount? }` で宣言する。台本は `e2e/fake-model/` に置く。新しい操作列を偽へ移す時は、依頼に `fakeMarker(名前)` を付け、同じ名前の台本を作り、宣言へ対象CLIと台本を追加する。helperは偽のrunで台本選択の印を返し、実モデルのrunでは空文字を返す。基本の操作列の一覧は変更しない。

台本の印の段の応答は既定で1秒後に始め（実モデルも最初の応答まで1秒以上かかるため）、`delayMs` で変更できる。配送ファイルを読ませる段と `hold: true` の段は待たずに始める。`after` にPromiseを渡すと、その完了後に応答を返す。`error` の段は指定したHTTP status・type・messageのAPIエラーを返す。

依頼文の `[fake-model:名前]` と、印のあるuser発言または配送ファイルの読み込み結果の後のassistant応答数（連続する文と道具の項目を1応答として数える）から返す文・道具の呼び出しを毎回選び、会話の状態はサーバーに保存しない。印の無い要求には通常 `OK` を返す。例外はioriの配送文で、パスをCLIのReadまたはcatへ渡し、CLI自身にファイルを順に読ませる。配送文には `Read <path> and follow its instructions.` と2ファイルを `Then read` で続ける形も含む。この配送文をioriが変えた時は試験の種類5（実モデル）で確認する。`hold: true` の段は接続が閉じるまで応答中を保ち、`delayMs` は指定した時間の後に次の文や道具を返す。`result.json` の `fakeModelRequests` は時刻・method・path・形式・model・印・台本の番号・`toolsProvided`（道具の一覧が指定されたか）・道具名を記録し、要求本文・システム指示・認証は保存しない。

要求本文の照合の例外として、画像項目の数を `imageCount` に、台本の段で `expectTokens` に明示した目印がsystem・instructions・会話に含まれるかを `tokensPresent` の真偽へ記録する。画像と本文は保存せず、clipboard・mobile-imagesは画像の到達、cli-omp・automationsは指示ファイル、web-recovery・cli-definitionは再開した会話、automation-webhookは本文、mobile-batch-inputは入力、repo-delegationは子が読んだファイルの目印の到達を操作列で確認する。

Releaseの受入は `verified.json` に記録したすべてのCLIの版と指示ファイルのcommitを現在と比べ、変更に関係する操作列を偽の後に実モデルでも流す。版を取れないCLIや記録のcommitを比べられない場合も変更扱いで受入を続け、変更したCLIの操作列が範囲外なら判断時と更新案に一覧を出す。成功後、証拠先へ出た更新案を確認して `verification/fake-model/verified.json` に反映しcommitする。各CLIの版はそのCLIを使う全体受入の操作列、指示のcommitは全体受入の偽の操作列をすべて実モデルで通した時だけ更新される。全体受入に含まれない `claude-status`・`long-approval`・`repo-delegation`・`cli-omp` は更新の条件から外し、対象外の一覧はログにも出す。 全体受入にそのCLIの操作列が無い場合は、そのCLIを使う偽の操作列をこの受入で1本以上実モデルで通した時だけ版を更新する。

`node scripts/run-bounded-check.mjs node verification/web/run.mjs --only=web-cli --real-models` で実モデルへ切り替える。依頼文や指示ファイルに台本選択の印は入れず、本人のCLI認証とClaude Codeの試験用トークンを使う。

PCの画面（`client`）とスマホの画面（`phone()`）は同じブラウザーで動き、Clientの設定（`verification/web/bridge.mjs` の保存先）を共有する。PC側で変えたサイドバーの開閉などの端末ごとの設定はスマホの画面にも引き継がれる（実際の端末どうしは共有しない）。スマホの節は、PC側の操作の結果に頼らず、必要な状態を自分の操作でそろえる。

画面の変更ごとに、リポジトリのrootで `pnpm e2e:web --only=<操作列>` を使う。Node.js 24・pnpm 11で依存を準備し、現在のsourceから `node scripts/run-bounded-check.mjs pnpm --filter @iori/host build:native` を一度実行しておく。製品のnative境界を変えていない画面の短い確認用であり、Windows/Android ClientやWindows Hostの実機E2Eを置き換えない。

共通のCSS・部品（サイドバーの行、設定の行、タブ）を変えた時は、変えた画面を撮る操作列だけでなく、その部品の位置・大きさを確かめる操作列も流す。部品のclass名（例: `nav-worktree-controls`）を `grep -rln` で `e2e/` から探して選ぶ。サイドバーの行の右の組は `forge-status`・`sidebar-order`・`child-running` が行の枠に収まることを確かめている。

画面のChromiumは、PCのClientと同じくスクロールバーが幅を取る形で描く（Playwrightの既定の `--hide-scrollbars` を外す）。幅767px以下の画面だけは、AndroidのWebViewと同じく幅を取らない形にする。どちらも `verification/web/run.mjs` の共通の起動と画面の初期化が受け持つので、操作列ごとに書かない。

配布物のLinux Hostで確認する時は、展開したフォルダーの絶対pathを `IORI_WEB_HOST_DISTRIBUTION` に指定して同じ `pnpm e2e:web --only=<操作列>` を実行する。同梱Nodeと配布物のJavaScript・native moduleから起動し、保存先とportは通常のrunnerと同じ専用環境へ分ける。

このrunnerは専用環境を使う。日常Hostのservice・保存・port、SSH、ADB、実機には触れない。runごとに `/var/tmp/iori-web-runs/` の新しいfolderへHost・bridgeの保存とGit fixtureを作り、空きUDP portのHost、127.0.0.1のbridgeと画面server、headless Chromiumを起動する。通常の招待で登録してフォルダーとlinked worktreeを開き、本物のPTYで日本語のコマンドと実出力、Filesの本文、Gitの変更前後、400×900のドロワーから同じworktreeの各Viewへの移動を確認する。操作は既存の `data-iori-*` と `verification/ui.mjs`、登録・フォルダー・Terminalの共通操作列を使う。クリックと入力は、対象が見えるために必要な分だけスクロールし、見えている対象を中央へ移動させない。スマホのドロワーを開く時は共通の `openSidebar` を使う。退場中のドロワーが消え、トリガーへ操作点が届いてから押し、入場の動きが終わってドロワーへ操作点が届くことを待ってから指の座標を取る。

PC幅とスマホ幅の2ページで同じTerminalを表示し、表示中の選び直しがその場で寸法を取り、スマホ側のvisibilitychangeからの復帰ではPCの寸法を奪わないことも通す。visibilitychangeは開発Clientが読むブラウザーの前面状態の境界であり、Android実機の代用とは扱わない。Gitでは1ページを超えるcommitの未読ファイルと、切断中に選んだcommit本体を、再接続後に開き直さず読めることを確認する。通信断は画面の接続状態を待ってから未読の操作を行い、その操作後の画面応答を検査する（接続表示を待つ時間を空回りの検査へ混ぜない）。

`pnpm e2e:web --only=reading-responsiveness` は、生成物を含む大きなフォルダーでFilesの初回・復帰直後とGitの差分表示を通す。画面の操作から本物のHostへ送った読取要求の往復を測り、監視開始による停止を検出する。監視の準備中の外部変更も画面へ反映されることを確かめる。計測は検証画面内だけで行い、製品へ記録は残さない。Releaseの受入にも含める。

`IORI_AUTOMATION_ISSUE_CAPTURE=1 pnpm e2e:web --only=automation-issue` はIssueの設定・履歴・接続できない理由をPC 1440×1000、WQHD 2560×1440、スマホ 390×844のライト・ダークで撮影する。

`IORI_AUTOMATION_WEBHOOK_CAPTURE=1 pnpm e2e:web --only=automation-webhook` はWebhookの設定・履歴・ダイアログをPC 1440×1000、WQHD 2560×1440、スマホ 390×844のライト・ダークで撮影する。

同じ操作列が後で成功すると、前の成功したrunの撮影（png）は消える（`verification/web/cleanup.mjs` の `pruneScreenshots`）。reviewに渡す撮影は、撮った後に `.local/evidence/web-shots/<操作列>/` へ写す。

チーム編集の操作列は `pnpm e2e:web --only=teams` で実行する。CLIのモデル一覧は実物から読み、チームの作成・候補の検索と並べ替え・上限・保存・履歴・メモ・復元と、Host再起動後の保持を確かめる。`IORI_TEAMS_CAPTURE=1` を付けると、PC 1440×1000のライト・ダークとMobile 390×844のダークを撮影する。`IORI_TEAMS_CAPTURE_VIEWS=teams,worker-candidates,ai-agents` のように指定すると、指定した画面だけを撮る。

`pnpm e2e:web --only=terminal-daemon` は実CLI（Claude Codeのhaiku）とTerminalで出力を続けたままHost本体を再起動し、同じプロセス・保持した画面・出力の続き・hooks・ioriコマンドを確認する。終了した子を残した再起動後も同じ役割への新しい委譲が始まり、終了した親は「会話を再開」で応答できることを通す。委譲の共通helperは、子が一覧に現れただけで取得を終えず、Terminal IDが付いた記録を返すまで読み直す。画面がRunningになっても、先に取得した起動中の記録は更新されないため、その記録でCLIのhook状態を待たない。係の異常終了ではCLIの再開待ちへ戻ることも通す。`restartHostLosingTerminals` はPTY消失の確認に使い、この操作列だけ `restartPreservingHost` でHost本体を止める。終了時は保存先ごとの係も明示的に止める。ソース・配布物のどちらも製品と同じ起動経路を使い、`verification/terminal/daemon-process.mjs` がそのrunの係のunitへMemoryMax=4G・MemorySwapMax=0を設定する。Web・Release受入・systemdの確認は同じhelperを通り、終了時は係とunitを回収する。Linuxの専用unitがある時は、そのunit全体を停止する。Escapeの入力待ちなどでshellがSIGHUPに応じない場合も、PTYごとの正常終了待ちに後始末を止められないようにする。結果の `daemonUnits` には適用値と回収の確認を残す。 Claude Codeのモデル要求は偽のAPIへ向ける。

`pnpm e2e:web --only=terminal-daemon --replace-host-distribution` は、専用フォルダーに二つの配布物を作り、Hostだけの題名判定を変えてHost停止中にフォルダーごと交換する。同じ係・PTYを保ち、新しいHostの判定が適用されることを `terminal.list` の応答で確認する。係のコピーに含めるファイルも実際の配布物と同じ生成一覧を使う。`--only terminal-daemon` の空白区切りも同じ選択として扱う。

`pnpm e2e:web --only=mobile-batch-input` は、スマホ幅のまとめて入力で、文字の貼り付け・複数行の送信・全画面の入力と下書きの復元・Terminal別の入力方式・キーボードを閉じた後の焦点の解除とtapでの再開を確認する。Claude Codeは偽のAPIを使う。

`pnpm e2e:web --only=mobile-key-band` は、スマホ幅のキーの帯で、先頭のボタンの名前と設定のON/OFF、Ctrl・Altの保持（IMEの変換中の入力を含む）と上スワイプを実PTYで確認する。`--only=mobile-images` は、「画像」で実寸のJPEGと1MB超のPNGを選び、元の形式でHostへ保存してCLIへ入れ、Claude Codeが偽のAPIから赤と青の応答を受けることを確認する。

`pnpm e2e:web --only=terminal-size-ownership` は、PCとスマホの大きさの持ち主の受け渡し（前面への復帰・読み取り中の幅の変更で奪わない）を確認する。`--only=terminal-width-handoff` は、スマホが幅を取った後、焦点を保ったPCのTerminalのクリックでPTYがPCの幅に戻ることを確認する。

`pnpm e2e:web --only=terminal-retention`（ほかの選択肢は `event-tolerance`、`long-approval`、`cli-resize`）で、読み位置の保持・出来事の受信継続・長い承認待ち・実CLIの境界ドラッグだけを選んで実行できる。境界ドラッグはモデルへ依頼せず、ドラッグ中の端末寸法の保持、終了時の最終寸法一回の通知、直後の入力を確かめる。CLIへ有料の依頼を送った回は、選択実行でも実際のモデルを確認する。

`pnpm e2e:web --only=cli-settings` は、実物のPiの起動・起動直後のCtrl+C・shellへの復帰と、AIエージェントの画面で名前とコマンドから足したCLIの追加（`--help` からのモデルの引数の自動入力）・編集・削除を既存の操作列で確認する。モデルへ依頼は送らない。

`pnpm e2e:web --only=cli-definition-plugin` は、実物のPiをユーザーの定義（`plugin-file`の部品、トークン量・利用枠のスクリプト）としてJSONの欄から足し、不足の案内から「ファイルを選ぶ」でスクリプトと部品を選び足せること、確認に部品の置く先とスクリプトのコマンドが出ること、部品が送る共通の形で応答中→完了の印が出ること、利用枠の窓が出ること、チームの子として委譲した時のトークン量、定義の削除でioriが置いた部品だけが消えて同じ名前の利用者のファイルが残ることを通す。部品はPiの拡張のフォルダーへ置き、トークン量はPi自身の会話ファイルから読む。モデルはPiの `gpt-6-luna`。

`pnpm e2e:web --only=cli-omp` は、同梱のompの定義と部品を実物のompで確かめる。通常は専用HOMEの通常の保存先と `--profile verification` の保存先の `models.yml` でResponses APIを偽へ向け、本人の `agent.db` を共有しない。`--real-models` の時だけ両方の `agent.db` は元の `~/.omp/agent/agent.db` へのsymlinkで参照する（コピーしない）。両方の `config.yml` に役割のモデル `openai-codex/gpt-6-luna` と `tools.approvalMode: write` を書く。「＋」からの1回目の起動で状態の印が出ること、応答中→完了、コマンドの承認待ちとCLIの画面での承認、Hostの再起動の後も `-r` で同じ会話へ戻り状態の印が出ること、チームの子として役割のモデル・許可の引数・最初の指示を受け `iori report` で報告すること、Boardの子の行にトークン量が出ることを通す。設定の起動時の引数に `--profile verification` を保存しても状態の印が出ることと、専用HOMEの `~/.omp/agent/hooks/`・`~/.omp/agent/extensions/` にioriの部品を書かないことも確かめる。実モデルの時はSQLiteがsymlinkを辿るので、`agent.db-wal`・`-shm` は元の `~/.omp/agent/` にできる。

`pnpm e2e:web --only=cli-definition` は、AIエージェントの画面の「CLIを追加」から実物のClaude Codeを名前とコマンド（`claude --help` からのモデルの引数の自動入力）とJSON（正式対応と別の `id` のユーザーの定義）で足し、確認の変更する設定ファイル、対応状況、定義の編集、単独の起動での応答中→完了の印、チームの子としてモデルを指定した起動と報告（haiku）、Hostの再起動後の会話の再開、形の合わない定義の理由の行、確認からの削除とhookの片付け、TOMLの `list` の形のhooksの定義（Kimi Codeの形。起動コマンドは `cat`）の確認の変更する設定ファイル・起動で利用者のコメント入りの設定ファイルへ入るioriの項目・確認からの削除で元の内容に戻ること、同梱の定義の上書きと「同梱の定義に戻す」を通す。定義のJSONとSVGの選び足し・同じ名前の選び直し・一覧から外す操作と選択直後の不足の案内、JSONの追加・編集で不足する画像を選べること、最小の定義とアイコンだけの変更では確認を出さず、同じidの追加では項目が無くても上書きの確認を出し、名前とコマンドでも上書きでき、新しい定義が使う既存ファイルを残して使わなくなった画像を消すこと、hooksの確認に該当する項目だけを出すこと、一覧・「＋」・タブの画像、詳細の「画像を選ぶ」でライトとダークを同じPNGに替えることと共通アイコンへの復元、不正な画像では替えないこと、同梱ロゴの保持と復元、フォルダーの外を指す `icon` の拒否も通す。CLI の起動一覧の撮影は `definitionPictures.launcher` で各幅と元の幅へ戻した後に一覧を開き直し、PC のポップアップとスマホの `shell-picker` ダイアログを使い分ける（スマホの境界を越えると一覧が閉じ、表示の形も変わるため）。定義のhooksの書き込み先はこのrunの設定ファイルで、起動時の引数の `--settings` でClaude Codeに読ませ、Claude Codeの本来の設定（`CLAUDE_CONFIG_DIR`）には書かない。`IORI_CLI_DEFINITION_CAPTURE=1` を付けると、AIエージェントの画面（ユーザーの定義が無い一覧、全ての種類の行がそろった一覧の先頭と末尾、詳細（アイコンの「画像を選ぶ」を含む）、アイコン付きの「＋」の一覧、CLIを追加の3つの方法と入力の誤り、選択した2つのファイルと不足の案内、定義の編集、5つの確認）をPC 1440・WQHD 2560・スマホ 390のライト・ダークで、端末の登録の取り消しの確認をPC 1440・スマホ 390のライト・ダークで撮る。全ての種類の行のため、この撮影の間だけ同梱の定義のCLIの代わりの `qoder`（版を出すだけ）と、同梱の上書き・見つからない定義・読めない定義の定義ファイルを置き、撮った後に消す。 Claude Codeのモデル要求は偽のAPIへ向ける。

shell初期化を変えた時は、`node scripts/run-bounded-check.mjs node verification/terminal/shell-integration.mjs <Debianパッケージの展開先> <証拠の保存先>` で本物のbash・zsh・fishも確認する。`zsh`・`zsh-common`・`fish`・`fish-common`を`apt-get download`でscratchpadへ取得し、`dpkg-deb -x`で同じ展開先へ置く（systemへはインストールしない）。Fishは実行ファイルからの相対配置に`usr/etc/fish`も必要なので、展開先の`usr/etc`を作り、そこで`ln -s ../../etc/fish fish`を実行する。runnerは証拠の保存先に専用HOMEとHost資材を作り、利用者ファイルの読込順・alias・プロンプト・PATH・履歴・終了時の設定を実PTYで確かめる。Bashの`.bash_logout`の実行有無は結果へ記録するだけにし、Zshは明示したHISTFILEとPrezto型の既定値について通常の`zsh -l`と同じ履歴ファイルを使い、元のZDOTDIR・`.zlogout`へ戻ることを確認する。通常UIのCLI起動・履歴は上記の`cli-settings`、会話の再開は`--only=web-recovery`で別に確かめる。

`pnpm e2e:web --only=cli-launcher` は、開いたCLI一覧へ実HostのCLI一覧を取り直した応答にある残量・版を出来事として再送し、選択項目・検索語・入力位置を保つことと、タブ選択の直後に「＋」を開いてCLIを選べることを確認する。初回の一覧取得後に版が分かった時、値が変わらず更新の出来事が届かない時、残量が無い時も同じ方法で確認する。モデルへ依頼は送らない。`web-cli` でも、Codexの応答・承認とClaude Codeの操作の後に同じ確認を通す。結果JSONの `launcherObservation` は出来事の種類、DOM要素の継続、フォーカス呼出しの場所を記録し、会話本文・認証値は保存しない。

画像の貼り付けは `pnpm e2e:web --only=clipboard-image`（Claude Code）、`--only=clipboard-image:codex`、`--only=clipboard-image:pi` で確認する。検証用の安価なモデルに画像の色を尋ね、文字の優先、実際のCLIでの画像の受け取り、Terminalを閉じた時の回収を通す。CLIがパスを添付表示へ変換したり、長いパスを折り返したりするため、画面の観測は添付表示またはファイル名の末尾を読む。`--only=clipboard-transfer` はモデルへ依頼せず、1フレームを超えるPNGをCtrl+Shift+Vと右クリックの貼り付けから送り、Hostでの保存と閉じる操作での回収を確認する。Chromiumはクリップボードへ置く時にPNGを再符号化するため、転送サイズはcanvasの生成物ではなくクリップボード内のPNGとHostのファイルを比較する。WindowsのOSクリップボードの読取は別途実機で確認する。

各Web runは `/var/tmp` の専用run folder内に短い `TMPDIR` を作り、ChromiumとHost・CLIなどの子プロセスへ渡す。runの後始末で一緒に回収する。画面serverの起動前に、同じVite設定を使う別プロセスで依存の準備を済ませて終了する。既存cacheの再利用はViteに任せる。準備はVite 8の内部（`depsOptimizer`）の完了を待つので、Viteを上げる時は、準備がすぐ抜けて本番のViteが依存を作り直していないか（run.logに出る）と、並行の受入の最大値を見直す。

PlaywrightとChromiumを用意し、`IORI_PLAYWRIGHT_MODULE` と `IORI_CHROMIUM_PATH` でそれぞれの場所を指定できる。無ければ起動前に止まり、自動installはしない。キーの自動入力は日本語IMEの変換・確定を検証しない。ブラウザーのクリップボード権限は共通runnerのcontext作成時に付与する。Terminalのコピー時に共通の左の余白を外す動作（Ctrl+Shift+C・Ctrl+C・Ctrl+Insert）は `pnpm e2e:web --only=terminal-clipboard` で確かめる。Terminalの文字サイズと右クリックは `pnpm e2e:web --only=terminal-preferences` で、実PTYの列数とコピー・貼り付け・メニュー切替を確かめる。タッチを有効にしたスマホ幅で上下にスワイプし、マウス報告を求める実PTYのプログラムに、慣性分も含む正しい座標のホイール報告だけが届くことも通す。

結果JSONの `lastUiOperation` は最後の画面操作であり、失敗した待機の条件ではない。出力待ちの失敗は `error` で識別し、`terminalState` で各Terminalの表示・streamの状態と、そのstreamの保存画面・後続出力の受信を確認する。結果JSONと起動から後始末までの秒数は `.local/evidence/web/run-*/` に残し、画面の撮影は失敗した回と、同じシナリオ（同じ `--only`、指定なしは全体）ごとの最新の1回を残す。共通helperは別のシナリオの撮影を削除しない。招待・鍵・本文の通信記録は保存しない。終了時は自分が起動したChromium、bridge、画面server、Hostを閉じ、専用run folderだけを削除する。後始末に失敗した場合は専用folderを残して結果に対象を記録する。次回起動時は `/var/tmp/iori-web-runs/` の古い `run-*` を回収し、別の実行中のrunは残す。手動起動は[開発手順](../DEVELOPMENT.md#ブラウザーで画面を開発する)を参照する。

チームのE2Eが失敗した時だけ、開いている子のTerminalタブ（親の背後にあるタブも含む）の画面を `failure-child-screens.json` へ残す。共通の失敗処理でHostの最新の保存画面を読み、会話IDの有無・hookの状態・保留入力の件数も記録する。成功時の操作は増やさない。

`pnpm e2e:web --only=forge-token` は、検証の時だけ立てる使い捨てのForgejo（公式のコンテナイメージ `codeberg.org/forgejo/forgejo:16.0.5`、`verification/forge/forgejo-container.mjs`）をサインイン必須で立て、非公開のリポジトリ・PR・失敗したcommit status・読み取りのtokenを作る。設定の「連携」での登録・間違ったtokenの拒否・替える・削除・サイトを追加、サイトで取り消したtoken・権限の足りないtoken・つながらないサイトの行の表示と再試行、非公開のリポジトリのPR・CIの印、CIの印から開くCIのタブとIssuesのタブを通す。CI・Issuesのタブでは、tokenが無い・無効・権限が足りない・つながらない・リポジトリが見つからない時の理由と回復の操作（「連携を開く」で連携の行へ移る、つながった後の「再試行」、「ワークスペースの設定を開く」でそのワークスペースのGitの設定へ移る）を確かめる。削除の後の読み直しがtokenを送らないことはサイトのアクセスの記録で、Forgejo・Giteaでないサイトにtokenを送らないことは手元のHTTPのserverで確かめる。コンテナは127.0.0.1だけで待ち受け、このrunのlabelとowner PIDを付けて終了時に消す。前のrunの残りは、owner PIDが終わったものだけを消す。Dockerを使い、既存のForgejoと既存のコンテナには触らない。tokenは使い捨てのサイトのもので、記録・証拠へ出さない。`IORI_FORGE_CAPTURE=1` を付けると、連携の画面をPC 1440・WQHD 2560のライト・ダークとスマホ 390（一番下までスクロールした所も）で、CI・Issuesのタブの読めない理由とサイドバーのCIの実行中の印をPC 1440・WQHD 2560のライト・ダーク（印はスマホ 390も）で撮る。この操作列は全体の受入の追加画面の組にも入るので、受入の機械にもDockerと公式のForgejoのイメージ（無ければ初回にcodeberg.orgから取得する）が要る。

`pnpm e2e:web --only=forge-status` は、公開Forgejoの検証用cloneを開き、ブランチ名・最新pushの実際のチェック・未pushブランチでの印の不在・表示設定の切替を通す。PC幅とスマホ幅で長い名前の中央省略と末尾・印の収まりも確認する。CIの印からCIのタブを開き、実APIと同じ実行・job・ブラウザーで開く先、失敗した実行（run 161）のログが失敗したstepの終わりで開くこと、CIの無いcommit（最初のcommit）と、CIを読めない時（検証用のHostはghにログインしていないので、GitHubのremoteを追うworktreeは読めない）のghにログインしていない理由と「連携を開く」の表示、スマホの一覧と詳細の行き来を確かめる。CIのタブのworktreeの切替の一覧は、PC 1440・スマホ 390のライト・ダークで撮る。古いcommitはcloneの中だけのremote-tracking refで追い、pushしない。cloneのremoteへpushせず、認証値は使わない。このE2Eは実行する機械に `gh` があることを前提とし、検証専用の設定ではログインせず、HostのGitHubの未ログイン表示も確認する。

この操作列は特定のForgejoの履歴を前提とする。

`pnpm e2e:web --only=forge-issues` は、同じ公開Forgejoのcloneでリポジトリの行のIssuesから一覧を開き、続きのページ・ラベルの絞り込み（全てを持つ）・本文と全てのコメント・タブの行き来と再読込での保持・別のworktreeの配置・スマホ幅の一覧と詳細の行き来を通す。実在のIssueは変わるので、文言でなくその時のForgejoのAPIの答え（番号・件数）と照合する。GitHubのcloneは検証専用の設定の `gh` が未ログインなので、読めない時の表示（ghにログインしていない理由と `gh auth login` の案内、「連携を開く」で連携のGitHubの節へ移ること）の確認に使う。`IORI_ISSUES_CAPTURE=1` を付けると、PC 1440・WQHD 2560・スマホ 390のライト・ダークを撮る。`pnpm e2e:web --only=host-uninstall` に `IORI_UNINSTALL_CAPTURE=1` を付けると、撤去の確認と結果をPC 1440・WQHD 2560・スマホ 390、撤去した後のスマホ 390の設定をライト・ダークで撮る。`--only=reading-worktrees` に `IORI_READING_CAPTURE=1` を付けると、列の多い表とコードの長い行を持つMarkdownをPC 1440・WQHD 2560（ふだんの幅と最大化）・スマホ 390で、表とコードを横にスクロールした所をPC 1440の最大化で、開いたファイルを消して読み込み直した時のFilesの読めない表示をPC 1440で、表示領域より大きく拡大した画像をPC 1440・スマホ 390で、短い名前を表示したまま開いたFiles・Gitのworktreeの切替の一覧（長い名前のworktreeを含む）をPC 1440・スマホ 390で、それぞれライト・ダークで撮る。

`pnpm e2e:web --only=forge-issue-start` は、同じ公開Forgejoのcloneで、Issueの詳細の「このIssueで始める」から名前と最初の指示が入った作成画面を開き、「作る」で始めたClaude Code（haiku）の最初の入力が、指示を写した配送用のファイルを読む1行になることを、Claude自身のuser入力の記録とファイルの本文で確かめる。リポジトリの「＋」で入れた複数行の最初の指示を「この場所で」で渡すこと、スマホの幅の全画面の作成画面と、「＋」がIssueの値を持ち越さないことも通す。最初の指示は製品の決まった文なので、文言で照合する。`IORI_START_CAPTURE=1` を付けると、PC 1440・WQHD 2560・スマホ 390のライト・ダークを撮る。

この操作列は特定のForgejoの履歴を前提とする。

`pnpm e2e:web --only=forge-commands` は、チームでない会話として始めたClaude Codeのプロセスの環境と作業フォルダーで、PATHの先頭の実物の `iori` を `verification/web/team-command.mjs` の `cliCommand` から呼ぶ。公開ForgejoのIssues（既定の30件・`--limit`・`--label`・本文とコメント）とCI（失敗したjobとログ全体）をその時のForgejoのAPIの答えと照合し、チームのコマンドを使えないこと、ghにログインしていないGitHubと、tokenの無い非公開のForgejo（`forge-token` と同じ使い捨てのForgejo）の理由の文、連携でtokenを登録した後に読めてtokenがCLIの環境と答えに出ないこと、消えたIssueの答えを確かめる。ASCIIの題名のIssueから開いた作成画面の名前も確かめ、`IORI_START_CAPTURE=1` で撮る。

この操作列は特定のForgejoの履歴を前提とする。

子の行の見た目は `pnpm e2e:web --only=child-rows` でも確かめる。既存の通知用fixtureで候補待ちの委譲を作り、本物のCLIやモデルを呼ばず、PC・Mobile幅の行の開始位置・字下げ・2段の内容の収まりを確認する。全体の受入にも含め、実CLIの委譲の受入でも同じ寸法確認を残す。 `--only=child-running` は報告・質問後の状態表示に加え、worktreeごとの開閉、畳んだ行のCLI種類・件数と省略、親子の字下げ、MobileのドロワーからFilesへの移動を通す。CLI一覧のfixtureはClientの読込前に登録する。子の表示fixtureは一時的な出来事なので、再読込後はHostの子の行が現れてから同じfixtureを適用する。適用中はイベントと子・Terminalの一覧応答へ同じ状態を差し込み、Hostの再取得で表示が戻らないようにする。開閉の検査はアニメーション後の可視状態を共通helperで待つ。

AIエージェントの折り畳み行を操作する時は、`saveStartupArguments` と同じく行の `data-state` で開閉を確かめる。入力欄が画面外にあることを閉じている条件にせず、共通の入力操作でスクロールしてから編集する。

Boardの実行中の操作は `pnpm e2e:web --only=board-activity` で確認する。子のCodex（gpt-6-luna）に画面からコマンド実行・ファイル編集・報告を依頼し、Boardに出たツール名・対象・Thinking・Reportedを観測する。`IORI_BOARD_ACTIVITY_CLI=claude` を付けると子もClaude Code（haiku）で同じ操作を通す。Claudeの検証用候補は `acceptEdits` を指定し、Boardを表示したままファイル編集を観測する。通知が無い時のRunningとPC・スマホの長い表示の省略は `--only=child-running` で確認する。Claude CodeとCodexのモデル要求は偽のAPIへ向ける。

チームの委譲・質問・報告・受け入れは `pnpm e2e:web --only=team-delegation` で実行する。保存済みの低コストのチームを使い、チーム機能の切替、PCとMobile幅の「＋」の一覧、実物の親Claude Codeと、許可を指定しない新しいworktreeの子Codex（通常は偽のAPI、`--real-models` でhaiku・gpt-6-luna）、Terminalの初回表示と開き直し、親への知らせ、子への回答、SQLiteの判定を一つの操作列で通す。専用Hostのfixtureは両CLIの利用履歴を持ち、Hostが実際のhooksを準備する。専用のClaude設定では作ったリポジトリだけを信頼する。ioriコマンドとチームのファイルへの許可は製品の起動引数で付ける。生成するHost・CLI HOME・リポジトリはディスク上の `/var/tmp/iori-web-runs/run-*` へ分離し、作業元のCLAUDE.md・rules・MCPを継承しない。アカウントのclaude.aiのコネクターもMCPの道具として残るので、共通の `prepareCliHome` が検証用のClaude設定で `mcp__*` を拒否する。`/tmp` がメモリ上の領域の場合、CLIが保存するruntimeやcacheも4GBの上限に含まれる。ソースの外にあるディスク領域を使い、repositoryの指示ファイルを継承せずにメモリ消費を抑える。終了時と残ったrunの回収は同じ所有確認付きhelperを使い、証拠は通常の.local/evidence/webへ保存する。Codexの検証用HOMEにはネットワークアクセス・sandbox・承認方針の上書きを置かない。入力待ちはHostの実際のhook状態とCLIの応答記録で観測し、TUIの案内や状態ラベルの文字を待たない。質問と報告の知らせは実際に委譲された子の役割名・題名を使ってClaude自身のuser入力、回答はCodex自身のuser入力の記録で照合し、Codexの実sandbox policyも確認する。試験が行う `iori` の操作は `verification/web/team-command.mjs` から実物のRustの `iori` を起動する。専用Hostの最新の親会話IDと、Claude自身が専用設定フォルダーの `sessions/<PID>.json` に保存した会話IDを専用Terminal係の子孫だけで照合し、その親の環境と作業フォルダーを子processへ引き継ぐ。PATHの先頭の実行ファイルから、親と同じ認証・通信・Hostの保存経路を通す。環境の値はログ・結果・証拠へ出さず、親の再開や係の再起動後も毎回最新の経路を取得する。本物の親モデルには、本体とは別の確認用の子への委譲を一度だけ依頼する。その子は直ちに短い報告を返し、製品の許可とPATHで実行できることと、報告の知らせが親の実入力へ届くことを確かめる。親がその報告を受け入れても本体の前提は変わらない。知らせの配送と親の自然な応答終了を待って `/exit` し、既存の `cli.arguments.set` で共通の `claudeWithoutTools`（`--tools ""`）を指定して同じ会話を再開する。確認用の子を終了済みに揃えてから、試験が本体の子を直接委譲する。本体の保存記録と初回応答は対象の役割と会話IDで選び、確認用の子を混ぜない。Board/Recordsは本体の行・Plan・タスクを選び、MobileのBoardsの状態件数は確認用のFinishedも含めて照合する。以降のtasks・read・send・finish・plan・delegateは試験が直接実行し、JSONの返答を照合する。通知を受ける親はClaude標準の道具なし起動とし、モデルが子へ追加依頼や判定を送らないようにする。親の再開では毎回同じ引数を適用し、起動後は元のCLI設定へ戻して本物のClaudeの子の道具を保つ。親のモデルの返答の文面・判断は合否に使わない。親の終了 `/exit` は `e2e/web/team-parent-input.mjs` で、子の応答と候補なし・失敗を含むHost側の通知配送、親の実入力記録、通知の応答終了と入力待ちを確かめてから送る。hookのidleだけで次のCLI操作を始めない。報告も質問も無く入力待ちになった子への知らせは初回と親の `send` 後にそれぞれ一度だけ届き、`iori tasks` に未報告の待ち理由が出ることを確かめる。ユーザーが子へ直接入力した応答と、親の依頼への応答中にEscで中断した場合は、その知らせが増えないことも同じ操作列で確認する。子の代替画面でホイールから入力が発生することを観測し、`iori tasks` でスクロール後には `userInput` が付かず、文字入力後には付くことを確かめる。証拠にはCLIごとの到達状況・sandbox policy・モデルの集計を残し、会話本文は残さない。承認選択中の保留と解放は別の保留入力試験が扱う。

別リポジトリへの委譲は `pnpm e2e:web --only=repo-delegation` で、最初から道具なしで起動した親Claude Codeの経路から実物のioriを直接呼び、子Codex（gpt-6-luna）の編集・報告、Files/Gitの切替、削除まで通す。同じ操作は `team-delegation` にも含む。runnerが作る2つ目のリポジトリも、共通の `prepareCliHome` の `repositories` に渡して検証用CLIの信頼済み設定へ含める。製品が信頼確認へ自動で答える処理は加えない。 Claude CodeとCodexのモデル要求は偽のAPIへ向ける。

worktreeの削除は `pnpm e2e:web --only=worktree-removal` で、merge・squashの印と取り込み済みの削除の候補、未取り込みブランチの保持、実Terminalの停止、スマホの長押しを確認する。長押しはWeb runnerが公開する共通の `screen.longPress` を使い、右クリックイベントをタッチの代用にしない。Windows Hostのプロセス停止とフォルダー削除は `node scripts/run-bounded-check.mjs node verification/workspace/worktree-removal.mjs` で、専用Hostへ開発Clientから接続して確認する。検証環境の鍵・gate・source転送・起動と回収は共通helperを使う。登録の共通helperは接続を確認した「端末」設定画面で終わるため、フォルダー操作へ進むrunnerは「設定を閉じる」を押す。リポジトリを開いてからサイドバーの対象worktreeを選び、選択先を確認してTerminalを起動する。同じ実行で、別プロセスがファイルを開いているworktreeの削除は理由を示して拒み、ファイルとGitの登録が残ることも確認する。

`pnpm e2e:web --only=model-failure` は、未ログインのCursor CLIを専用HOMEで使い、AIエージェントの行にCLI自身の認証エラーがシェルの警告や色の制御文字なしで表示されること、「詳細」で全文を開けること、再試行で詳細が閉じることを確認する。Cursor CLIの認証は共有・作成しない。

`pnpm e2e:web --only=child-cli-failure` は、本物のCodex・Claude Code・OpenCodeの子を使えないモデル（OpenCodeは `verification/web/cli-error-fixture.mjs` の再試行しないHTTP 400）でエラーにし、子の行・Board・親への知らせに失敗とCLIの理由が出ること、再入力と親の `send` でRunningへ戻ること、Hostの不在中の失敗が復元されること、親の `--continue` で失敗した候補を飛ばし前の依頼を新しい子へ渡すことを確認する。

`pnpm e2e:web --only=opencode-delegation` は、親Claude Code（haiku）から、Effortを持つ保存済み候補のOpenCodeへ委譲し、子の報告までを確認する。V1は通常、認証を共有せず偽のResponses APIへ `openai/gpt-6-luna` で接続し（`--real-models` の時だけChatGPTのログインをsymlinkで共有）、V2は認証を共有せず `opencode/deepseek-v4.1-flash-free` を使う。CLIのHOME・データはチームの操作列と同じ専用の保存先を使う。 専用HOMEで `bash` と `external_directory` を `ask` に設定し、自動承認なしの子が製品pluginによって依頼書だけを追加承認なしで読み、報告コマンドの実行承認に答えて完了することを確認する。 停止した子へ親の `send` で追加依頼を送り、同じ会話で再開して報告できることも通す。報告も質問もない初回と `send` 後の応答終了では親への一行と `iori tasks --json` の `no_report` を確かめ、Auto-approveの子の初回も同じように確認する。 V2では、同じ操作列の中で「＋」からの通常起動、作業中・質問待ちから回答後の完了、HostとTerminalの係の停止後の「再開」も通す。再開は会話に保存されたモデルを使い、起動ごとのモデル指定を付け直さない。

V1（`opencode-ai`）とV2（`@opencode/cli`）を比べる時は、隔離した場所へ入れた版の実行ファイルを指す `opencode` を、そのrunのPATHの先頭へ置く。本人の `opencode` と `~/.config/opencode` は変えない。runのCLI一覧へ実際の版を記録し、V2の通常起動用モデルも専用HOMEだけに設定する。V2のシェル実行の承認はV2の正式名 `shell` で表示する。V2はTerminalごとの `--standalone` で起動し、チーム候補のモデルは `OPENCODE_CONFIG_CONTENT` で渡す。共有設定にV2専用の項目を書かず、V1/V2共通の1つの `iori-status.js` を使う。

## 本物のCLIで確かめる時

- 検証HostのClaude Code・Codex・Piは使った版を記録する。版を上げた時は本物のCLIとの照合を行う。古い版は消さず残す。
- 有料の入力には安いモデルを明示する。Claude Codeは `claude-haiku-4-5`、Codexは `gpt-6-luna`、PiとOpenCode V1は提供元 `openai` の `gpt-6-luna`。試験の費用の自己確認として、実際に使われたモデルはCLIの記録で確かめる。製品の受入判定の根拠にはしない。製品のモデルの既定値を試験用に変えない。
- 認証ファイルをコピーして使わない。ブラウザーのE2Eは検証用の設定へ分離し、実モデルを使うCodex・Pi・OpenCode V1は認証ファイルをCLI自身の保存先へのsymlinkで参照する。認証をコピー・書き戻ししない。OAuthの更新が起きるとコピー側だけが新しいrefresh tokenを受け取り、元のCLIが認証できなくなる。共通のCLI HOME準備helperは、共有認証ファイル（Codex・Pi・OpenCode V1）を読み書き用に開いてすぐ閉じ、本文を読み書きせず更新権限を確認する。書き込み制限がある実行環境では、CLIの通常のOAuth更新ができる権限（Codexの制限付き実行では `require_escalated`）で検証を実行する。検証HostのCLI自身の認証をそのまま使う。
- Claude Codeは認証ファイルを一時ファイルからrenameで置き換えるため、symlinkでは新しいrefresh tokenを検証用ホームへ書いてしまい、元のログインが使えなくなる。実モデルを使う検証のClaude Codeは、`claude setup-token` で作った試験専用のトークンを 準備時のエラーが示すファイル（0600、`CLAUDE_CODE_OAUTH_TOKEN=<トークン>` の1行）から読み、環境変数 `CLAUDE_CODE_OAUTH_TOKEN` だけで受け取る。検証用ホームに `.credentials.json` は置かず、元のファイルは開かない。Windowsで起動する時は標準入力で渡し、sshやPowerShellのコマンドラインに載せない。ファイルが無い時は準備の始めに置き場所を伝えて止まる。トークンの値はログ・証拠・結果・撮影・会話へ出さない。検証コードがClaudeの `.credentials.json` をリンク・コピーしようとするとlint（`iori/no-claude-credentials-link-copy`）が止める。

## SSHでWindows Hostを導入する

`verification/host-setup/build.mjs --client Windows --ssh-windows` でWindows・Linuxの検証用Clientと署名済みのWindows Hostを作る。準備から回収まで `IORI_VERIFICATION_CONFIG=verification/host-setup/tauri.conf.json`・`IORI_VERIFICATION_EVIDENCE_ROOT`・`IORI_VERIFICATION_PORT` を同じ値にし、Node 24で `node scripts/run-bounded-check.mjs node` に続けて各入口を実行する。

`verification/host-setup/run-ssh.mjs --host Windows --client Windows --shell=cmd --keep-build` と `--host Windows --client Linux --shell=powershell --keep-build` は、SSHの接続先の選択・確認への回答・導入・登録・Direct接続・SSH終了後の継続・既存Hostの登録・撤去結果の読取りを画面から通す。管理者の接続先では、選択なしでWindowsファイアウォールの規則が加わる。`--signed-out` を加えた実行は、管理者でない使い捨てユーザーを使い、導入に進まず「この PC」での導入と招待を案内し、招待の入口へ進むことを確かめる。最後の実行では `--keep-build` を外してbuildのフォルダーも回収する。途中で打ち切った時は、同じ設定で `verification/host-setup/run-ssh.mjs --host Windows --client Windows --cleanup-build` を実行し、共通helperでbuild・ClientのSSH秘密鍵・配布元の使い捨ての鍵を回収する。

`--shell=powershell` は既定のshellをPowerShell 7にし、Windows標準のPowerShell 5.1へ渡す経路も確かめる。検証用CAには失効の情報が無いため、検証ソースのcurlだけに `--ssl-revoke-best-effort` を付け、CAと名前の確認は維持する。取得の終了コードと標準エラーは各runの `download.json`、後片付けが失敗した時の残ったフォルダーとプロセスは `host-cleanup.json` に残す。

Linux Clientは使い捨てユーザーの実ホームで動かし、OpenSSHの設定と鍵も同じホームへ置く。ユーザーとホームは終了時に回収する。Hostの回収だけを確かめる時は、同じ設定で `--host Windows --client Windows --cleanup-host` を使う。

Windowsが使い捨てユーザーのprofileをLoadedのまま保持している時は、追加の待ち・プロセスの停止・hiveの強制解放をせず、`cleanup.user` にユーザー名とprofileの場所を残して回収未完とする。Ownerに検証機の再起動を依頼し、再起動後にそのユーザーのprofileとアカウントだけを回収する。

Windows・Linux検証機と配布元の鍵・gateを使う。日常の保存先・portは使わず、検証用Hostは本人のLocalAppDataの専用フォルダーへ置く。既定のshellは実行中だけ切り替え、終了時に元の値へ戻す。追加した鍵・規則・ユーザー・導入物・起動の登録も回収し、結果と作成・回収したものは証拠先の `windows-ssh-*/result.json` へ残す。回答・招待・秘密鍵・パスワードは撮影・記録しない。
