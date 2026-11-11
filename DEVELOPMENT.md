# ioriの開発

変更する利用経路の [製品仕様](docs/product.md)、必要な [技術設計](docs/architecture.md) を読む。実装の状態と製品の約束を混同しない。

## ソースの入口

| 場所                                   | 責務                                                    |
| -------------------------------------- | ------------------------------------------------------- |
| `packages/protocol/`                   | HostとReactが共有する要求・出来事・招待・枠と入口の検査 |
| `apps/host/native/`                    | Hostからirohを呼ぶNode addon                            |
| `crates/iori-iroh-config/`             | HostとClientのiroh endpoint設定                         |
| `apps/host/src/main.ts`                | Hostの起動と終了。Node.js 24がTypeScriptを直接実行する  |
| `apps/client/src/`                     | Reactの登録・端末管理とモックアップv9の色・書体         |
| `apps/client/src-tauri/`               | Tauriのnative入口とAndroidプロジェクト                  |
| `scripts/eslint-plugin-iori/`          | 作りの原則を守るESLint規則と純粋な試験                  |
| `scripts/`                             | 検査とCIの道具                                          |
| [verification](verification/README.md) | 実機と本物のCLIによる検証                               |
| `e2e/`                                 | ioriの画面を通すCLI・Terminal・接続のシナリオ           |

Orca（[stablyai/orca](https://github.com/stablyai/orca)、MIT）の実装は流用してよい。コピーしたファイルには元の著作権表示と許諾文を残し、同梱物・依存のライセンスはそのファイルごとに確かめる。

関連する変更は近くに置く。汎用utilsへの寄せ集めやファイル数だけを理由とする階層化を避ける。CLI固有のhooks・使用量・モデル候補・起動定義は各CLIのアダプタに閉じ、共通の処理と画面はCLIの名前で分岐しない。

## 試験

確かめは、故障する境界ごとに最も安く確かめられる場所へ置く。入口は次のとおり。

| 確かめ                                               | 入口                                                                                               | 流す時                                                                                   |
| ---------------------------------------------------- | -------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------- |
| 型・lint・整形・純粋関数・Host API の E2E            | `bash scripts/ci.sh`（Host API の書き方は [verification](verification/README.md#host-api-の-e2e)） | main へ載せる前（必須チェックはこれだけ）                                                |
| 画面の E2E（ブラウザー・本物の CLI・偽のモデル API） | `node scripts/run-bounded-check.mjs node verification/web/run.mjs --only=<シナリオ>`               | 変えた画面の分を作者が1〜2本。全部は main の後に裏で自動（`scripts/background-e2e.mjs`） |
| CLI の実物との照合                                   | `--real-models`                                                                                    | CLI を上げた時、iori がモデルへ渡す指示を変えた時                                        |
| 負荷の試験                                           | 下記                                                                                               | 性能に関わる変更の時と Release の前                                                      |

Release の受入は、配布物でしか確かめられない境界（導入・更新・Terminal のデーモンの入れ替え・接続）の少数だけを流す。同じ版で流し直して通る失敗は揺れとして Issue に記録し、公開を止めない。

読み取りの負荷試験は `node scripts/run-bounded-check.mjs node verification/reading/load.mjs` で流す。専用のブラウザー・本物のHost・通信を使い、1分間、監視の開始・初回の全体更新・停止を繰り返し、その開始と重なる間にFilesの一覧・ファイル情報とGitの状態を並行して要求する。監視の失敗も試験の失敗とし、監視開始と重なった要求の応答を測る。応答の最大値が500ms未満かを判定し、件数・p50・p99・最大値を通常のWeb E2Eと同じ証拠先へ残す。性能に関わる変更時とRelease前に、他の受入やビルドと重ねず単独で流す。通常のE2EとCIからは呼ばない。準備は[ブラウザーの画面E2E](verification/README.md#ブラウザーの画面e2e)と同じ。

画面のE2Eは本物のCLIの接続先を、試験の中で立てる偽のモデルAPI（`verification/fake-model/`）へ向け、台本どおりの応答（文・道具の呼び出し）を返させて流す。CLI本体・Host・画面・hookは本物のまま使い、モデルの沈黙・利用枠・応答の揺れで落ちないようにする。偽にするシナリオとCLIは `verification/web/fake-model-scenarios.mjs` で宣言し、宣言の無いものは安い実モデルで流す。CLIの実物との照合は同じシナリオを `--real-models` で実モデルに流し、偽のAPIの前提（要求の経路・応答のeventの種類・hookの並び）が変わっていないかを確かめ、変わっていれば台本を直す。記録を再生する試験は補助で、本物のCLIを通した受入の代わりにしない。 Releaseの受入は `verification/fake-model/verified.json` とCLIの版・指示ファイルを比べ、変更に関係するシナリオを実モデルでも自動で流す。成功後に証拠先へ出た更新案を確認し、`verified.json` に反映して版の変更と一緒にcommitする。

Linuxで資源の上限付きの検査は `node scripts/run-bounded-check.mjs <command> [args...]` を入口にする。メモリ上限の枠の中ではそのまま時間制限を付けて実行し、枠の外ではsystemdのscopeで制限して実行する。制限を外さない。`node --test` を直接呼ぶ時は `--test-timeout` を指定する。

## 起動と検査

Node.js 24、pnpm 11、[rust-toolchain.toml](rust-toolchain.toml)のRustを使う。

```sh
pnpm install --frozen-lockfile
pnpm --filter @iori/host build:native
pnpm --filter @iori/host dev
pnpm --filter @iori/client dev
pnpm tauri dev
```

動いているHostのマシンで、同じユーザーが次を実行すると、新しいClientを招待できる。表示したQRまたは文字列をClientへ渡す。

```sh
pnpm --filter @iori/host invite
```

Hostは初めての起動で待受portに49171を試し、使用中ならOSが選んだ空きportを使って、そのportを保存先へ記録し以後も使う。開発・検証時は `IORI_HOST_PORT` で指定でき、指定したportは記録しない。Hostの保存先はLinuxでは `$XDG_DATA_HOME/iori-host`（既定 `~/.local/share/iori-host`）、Windowsでは `%LOCALAPPDATA%\iori-host` である。検証用の保存先は[検証手順](verification/README.md)に従って分ける。

### ブラウザーで画面を開発する

依存とHost addonを上の手順で準備した後、`pnpm --filter @iori/client dev:web` で開発専用bridgeと画面serverを起動する。表示されたlocalhostのURLをChromiumで開き、検証用Hostの招待で登録する。Tauriの通常起動・製品buildはnativeを使う。ブラウザー用の実装は製品buildに含めない。

手動確認のHostも日常の保存先・portとは分ける。repository rootの別shellで次を実行し、招待の発行にも同じ環境変数を渡す。

```sh
export XDG_DATA_HOME="$PWD/.local/web-host" IORI_HOST_PORT=49174
pnpm --filter @iori/host dev
# 同じ環境変数を設定した別shellから
pnpm --filter @iori/host invite
```

bridgeのWebSocketは127.0.0.1だけで待ち受ける。irohのUDP endpointは製品Clientと同じ設定でbindし、別machineの検証Hostにも通常の招待で接続する。鍵と画面の保存を `.local/web-client/` に持つ（`IORI_WEB_CLIENT_DATA` で変更可）。製品のDPAPI/Keystoreによる保護とは異なり、開発用の鍵・SQLiteを本人限定のdirectory/fileに保存する。製品Clientの保存先や鍵を指定しない。clipboard・リンクを開く・前面状態はChromiumのAPIを使い、QR読取は使えない。開発ブラウザーではAlt+←でAndroidと同じ戻る処理を呼ぶ。`IORI_WEB_PORT` で画面serverのportを変更できる。

画面の変更ごとの操作確認は `pnpm e2e:web --only=<シナリオ>`。専用Host・bridge・画面server・既存Chromiumを起動し、選んだシナリオを通して後始末する。登録と配置・Terminal・CLIの状態・再開とFiles/Gitなど、内容のまとまりごとに1つずつ流す。各runは既定の4GiBで実行する。準備と結果の場所は[ブラウザーの画面E2E](verification/README.md#ブラウザーの画面e2e)を参照する。Windows/Androidの実機E2EやIME確認の代わりにはしない。

READMEの画像は `node scripts/run-bounded-check.mjs node verification/web/run.mjs --only=readme-shots` でダーク・ライトのPNGと実動画からのGIFを `docs/images/` に撮り直す（ffmpegと `~/.config/iori/publish.json` の公開禁止の値が必要）。

Clientのnative開発には[Tauriの前提条件](https://v2.tauri.app/start/prerequisites/)を揃える。AndroidはSDK 36・Build Tools 36.0.0・NDK 27.2.12479018・JDK 21を設定してから実行する。

アプリのアイコンを作り直す時は `apps/client/` で `pnpm tauri icon icons-source/tauri-icon.json` を実行する。元絵 `icon-1024.png` とAndroidの透過した帯・背景色はマニフェストに指定してある。

```sh
pnpm tauri android build --debug --apk --target aarch64
```

| コマンド                                                                                            | 検査                                                           |
| --------------------------------------------------------------------------------------------------- | -------------------------------------------------------------- |
| `pnpm check`                                                                                        | Host・Client・E2Eの型                                          |
| `pnpm lint`                                                                                         | ESLint・作りの原則・型の抜け道・説明のない抑制                 |
| `pnpm test`                                                                                         | Host・Clientと検査規則の `node --test`。各試験の上限は1分      |
| `pnpm e2e:web --only=<シナリオ>`                                                                    | 開発ClientとLinux Hostで画面のシナリオ（実機の代用にはしない） |
| `pnpm format:check`                                                                                 | Prettier                                                       |
| `pnpm check:docs`                                                                                   | 文書リンクと検査器の自己試験                                   |
| `cargo fmt --all --check`                                                                           | 共有通信crate・Host addonのRust整形                            |
| `cargo clippy --workspace --all-targets --locked -- -D warnings`                                    | 共有通信crate・Host addonのRust静的検査                        |
| `cargo fmt --manifest-path apps/client/src-tauri/Cargo.toml --all --check`                          | ClientとpluginのRust整形                                       |
| `cargo clippy --manifest-path apps/client/src-tauri/Cargo.toml --workspace --locked -- -D warnings` | 実行OS向けのClient/pluginのRust静的検査                        |

Linux上のClient用clippyはAndroid向けのコードを検査しない。Android向けのRust・Kotlinの型の検査は `verification/connection/build-android.mjs` のAPK buildで行う。

Rustの作りの原則は、repo直下の[clippy.toml](clippy.toml)の`disallowed-methods`で固定の時間切れによる失敗判定を止める。抑制は`#[expect(clippy::disallowed_methods, reason = "...")]`だけを使い、理由を書く。crateを足す時は`[lints.clippy]`の`allow_attributes`・`allow_attributes_without_reason`を同じく`deny`にし、CIのclippyへ加える。tokioの時間切れAPIは`allow-invalid`を付けずに規則を適用する。tokioの依存を足す・更新する時は、規則が対象APIを拒否することを一度確かめる。`tokio::select!`と`sleep`を組み合わせた時間切れは機械的に止められないため、reviewで見る。

LinuxでRustを手元で検査する時も、上記の資源制限付きの入口を使う。現在は変更範囲による選択をせず全試験を流す。全体が5分を超えるようになった時に、変更範囲の試験を選ぶ仕組みを作る。

Windowsでは表のコマンドをそのまま実行する。Linuxでは呼ぶ側で資源制限を付ける。

nativeのソース（`crates/`・`apps/host/terminal-native/` など）を含む変更を取り込んだ作業フォルダーでは、`pnpm test` の前に `build:native` をやり直す。古いaddonやRustの `iori` のままだと、その変更に依る試験が製品と関係なく落ちる。

```sh
node scripts/run-bounded-check.mjs pnpm check
node scripts/run-bounded-check.mjs pnpm lint
node scripts/run-bounded-check.mjs pnpm test
node scripts/run-bounded-check.mjs pnpm format:check
node scripts/run-bounded-check.mjs pnpm check:docs
git diff --check
```

## CI

```sh
node scripts/run-bounded-check.mjs bash scripts/ci.sh
```

Dockerが必要。imageを作り直す時は `bash scripts/ci.sh --rebuild-image` を使う。pushの変更がMarkdownだけの時は `--docs-only` で整形・文書のリンク・空白だけを検査する。同じ機械の通常の `ci.sh` は1本ずつ流れ、後から始めた方は前の実行が終わるまで待つ（重なると Host API の試験が負荷で時間切れになるため）。CI imageはLinux用Tauri依存・Rust・pnpmを含み、Dockerfileとtoolchainから決まるtag・labelで再利用する。pnpm store、Cargo registry、Cargo targetは名前付きvolumeを使う。
CIの前にCargo targetへworktreeの絶対パスを記録し、消えたworktreeの保存先と、印がなく2日以上使われていない保存先を片付ける。今のworktreeと実行中のCIの保存先は残す。

ソースを `docker create` → `docker cp` → `docker start` で渡し、型・lint・全試験・format・文書・Clientのfrontend build・Rust fmt/clippyを流す。linked worktreeにも対応する。Gitのobjects・refs・indexはコピーするが、認証・config・hooksはコピーしない。実行のログと所要時間は `.local/evidence/ci/` に保存する。温まった状態で全体5分以内を目標にする。

## 開発の回し方

改善を利用者へ早く届けることを、品質と同じ目的として扱う。確認は速さで3段に分け、遅い確認で開発を待たせない。

1. **取り込み前（変更ごと、数分以内）**: 型・lint・原則の検査・format、変えた範囲の試験。通信・保存・停止・CLI・OSとの境界を変えた時は、本物のCLIでの代表操作も流す。
2. **取り込み後（裏で、待たない）**: mainへ入った後のCIで全検査を流す。失敗したら原因の変更を特定し、直すか戻す。
3. **日常の利用**: 日常利用で見つかった問題を直す。

製品と関係なく結果が揺れる試験は、見つけた時点で直す。原因が製品の不具合なら、試験の期待を製品に合わせて変えない。

取り込み前の確認の重さは、変更の危険で決める。

| 変更                              | 取り込み前の確認                            |
| --------------------------------- | ------------------------------------------- |
| 文言・見た目・試験・文書だけ      | 取り込み前の検査と、親Agentによる差分の確認 |
| 製品の動き                        | 取り込み前の検査と、作者以外のreview        |
| 通信・保存・停止・CLI・OSとの境界 | 上に加えて、本物のCLIでの代表操作           |

実機の検証は、次の段で必要な分だけ流す。追い修正のたびに通しを流し直さない。

| 時                                                                            | 流すもの                                                                                                    |
| ----------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| 変更ごと                                                                      | CIと、変えた所だけを確かめる手早い道具。画面は `pnpm e2e:web --only=<シナリオ>`（開発用ClientとLinux Host） |
| native境界（通信・プロセス・保存・OS統合・Windows/Androidのnative）を変えた時 | 変更が及ぶ組合せを1つ、実機で                                                                               |
| 単位を受け入れる時                                                            | 変更が及ぶ組合せの通しを1回（最大4組合せ）                                                                  |

画面のシナリオ（`e2e/web/scenario.mjs`）へ段を足す・順を変える時は、変更が及ぶ名前付きのシナリオを通す。各シナリオは招待・フォルダー・Terminalなどの前提を自分でそろえる。Host再起動前後の会話や、PC・スマホ間の同じTerminalなど、続きが必要な確認は同じシナリオへ残す。基本のシナリオの一覧は[ブラウザーの画面E2E](verification/README.md#ブラウザーの画面e2e)を参照する。

## 保存形式の変更

一般公開までは、製品のコードは現在の保存形式だけを読み書きする。古い形式を読む分岐、版ずれの吸収、起動時の自動移行は入れない。古いHost・Clientの版を考慮した処理（新しい要求を持たない版で操作を押せなくする判定、「先に更新してください」の案内など）も入れない。古い版で操作した時は既存の失敗の表示のままでよい。一回きりのデータ整理は、実データを読み取りで調べて対象の有無を確かめ、コピーへ適用した結果で確かめる。そのためだけの合成状態の試験は足さない。

## Terminalのデーモンの互換性

`node scripts/terminal-daemon-compatibility.mjs` は配布物をbuildし、デーモンとioriコマンドの入口から変換後JSの実行時importをたどって、複写するJS・依存の資材を `apps/host/terminal-daemon-compatibility.json` のhashと照合する。先に `pnpm --filter @iori/host build:native` を行う。CIも同じ順で検査する。配布script自体・HostだけのCLI定義・チーム処理・irohは範囲に含めない。

nativeとNode本体のbytesはOS・build機械で変わるため、例外として入力で確認する。Windows権限用addonのソース・Cargoの該当する依存のlock・toolchain・workspaceの言語設定、node-ptyを含むデーモンの依存の固定版とpatch、Nodeの固定版を対象にする。OS別のbuild結果の記録は持たない。

デーモンに読み込まれる実装を変えたら `apps/host/src/terminal/daemon/protocol.ts` の `DAEMON_PROTOCOL` を上げ、`node scripts/terminal-daemon-compatibility.mjs --update` で記録を更新する。同じ版の記録の上書きはしない。デーモンの版を上げる更新は、動作中のTerminalとAgentを止めて既存の再開経路へ戻すため、変更をデーモンへ入れる必要があるか先に確かめる。検査は直前のcommit（`HEAD^`）の記録とも比べるので、別々のbranchで同じ版へ上げた変更を取り込む時は、各commitから `protocol.ts` と記録の変更を外し、mainの記録へ戻してから最後の1つのcommitで版を上げて `--update` する。 `DAEMON_PROTOCOL` を上げた版を公開する前に、Windows Hostで公開済みの前の版から作った版への更新を `verification/updates/host-windows.mjs` の `--previous-zip`・`--target-zip`（[verification](verification/README.md)）で1回通す。Linux Hostでも `verification/updates/host-linux.mjs` の `--previous-archive`・`--target-archive`・`--running-clis` で同じ更新を1回通す。更新の時に止めるのは前の版のデーモンのコードなので、新しいデーモンの修正だけでは更新時の停止は防げない。

## Provider CLIと試験データ

- Provider CLI（Claude Code、Codex、Piなど）は日常環境・検証環境とも公開されている最新バージョンを使い、実機検証も最新バージョンで行う。古いバージョンへの互換は作らない。例外として、OpenCodeは公式の既定の導入（`https://opencode.ai/install`・npm `opencode-ai`）が1.xの間、1.xと2（`@opencode/cli`）の両方に合わせ、起動時の版で連携を切り替える。既定の導入が2になったら1.xの連携を外す。
- バージョンを上げたら公式のリリースノートを読み、CLIとの通信、記録の形式、起動の指定、モデル・Effortの一覧に関わる変更をioriの該当コードと照合し、必要な対応をする。
- CLIの出力を扱う試験データは、現行バージョンの実CLIの出力を録って作る。秘密になりうる値だけを置き換え、手書きや最小化で項目の有無・型を変えない。録ったCLIのバージョンを残す。
- 試験は通るのに実機で落ちる時は、まず試験データが実物と同じ形かを確かめる。試験データとreviewの合格を、本物のCLIでの受入の代わりにしない。

## UI検証の優先順位と打ち切り

目的は利用者が必要な機能を使えるようにすることであり、スクリーンショットの取得・計測の成功や証拠の総消化ではない。検証の時間・token・課金は開発の費用として扱う。

1. **必須を先に絞る。** データ保護、認可・通信の正しさ、結果不明入力の非再送、大容量保存の安全性、UIの型・静的検査と変更部分の局所テストを優先する。設定画面のちらつきや送信不能など、普通の操作を妨げる報告は本質的な不具合として直す。未確認の細かな動的挙動と同列にしない。
2. **既存結果を再利用する。** 変更が影響する代表経路だけを追加確認し、同じ保存・切替・回収試験を毎回やり直さない。共通機能のnative境界はWindows/Androidを考慮するが、全状態・全障害の組合せを両方で消化する条件にはしない。
3. **追加検査の判断価値を明示する。** 開始前に「何を確認すると実装修正・安全判断が変わるか」「最小の操作」「成功/失敗/未確認での終了方法」を決める。単に画像や細かな座標記録を増やすだけなら実装・配布を止めない。
4. **スクリーンショットの取得・観測器の失敗を製品修正に混ぜない。** 一度取り逃した画面のために同じ実機操作・障害注入・有料入力を繰り返さない。まず短い無故障のlocal検査で観測器を切り分ける。未確認を合格と書かない。
5. **長時間化の前に止めて再判断する。** 同じ観測失敗、計測器の拡張、条件追加が続く場合、その検証を中断して必須性・残費用・代替手段を見直す。高コストな追加検証が本当に必要なら、理由・利用者への影響・見込みを説明して判断を求める。時間枠超過を理由に実行拒否する新ツールは導入しない。
6. **後続評価を開発の停止条件にしない。** 実機確認の完了を配布の条件にせず、日常利用で見つかった不具合を優先して直す。 機能が揃った後でしか意味のない試験は、その段階へ回す。既知不具合や採用仕様の実装漏れはAgentが先に直し、手動確認へ丸投げしない。単体テスト成功・細部の未確認だけを根拠に、完成や日常利用開始を宣言しない。画面は単独の部品のスクリーンショットだけで受け入れず、実際に置かれる画面の中でPCとMobileの代表的な幅を操作して、はみ出し・改行・崩れを親Agentが確かめる。

画面を手動で確認できる時は、buildと確認点の短い一覧を用意し、手動確認を第一候補にする。Agentの実機自動操作は確認する人が不在の時、または安全面で証拠を残す必要がある確認に使う。検証と配布は同じcommit・同じ成果物を使い、確認した成果物をそのまま配布する。

### UIの検証目印

試験が押す・読む要素にだけ `data-iori-*` を付け、すべてのボタンへ一律には付けない。属性名と固定値は英小文字と数字をハイフンでつなぐ（例 `data-iori-action="send"`）。目印は製品UIと検証の間の約束であり、変更・削除する時は同じ変更で参照する試験も直す。

## 依存のライセンス

依存のライセンス表示は [THIRD-PARTY-LICENSES.md](THIRD-PARTY-LICENSES.md) を参照する。依存を更新した時は、Nodeの本文を `node scripts/licenses/update-node.mjs`、Rustの本文と一覧を `node scripts/licenses/update-cargo.mjs`、Androidの本文と一覧を `node scripts/licenses/update-android.mjs` で更新し、取得元と変更を確認してcommitする。npm packageに本文が無い時は、表示される `node scripts/licenses/update-npm.mjs <package名> <版>` を使う。これらの保守コマンドは取得のためネットワークを使う。Releaseの表示生成は保存済みの原文を使う。
