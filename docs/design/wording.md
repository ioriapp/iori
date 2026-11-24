# 画面の文の語と言い回し

読むのは、画面の文（`apps/client/src/i18n.ts` など）を書く・直す時と、設計の文書に画面の文を書く時である。文の形（進行中・操作の求め方・説明の量）は [UIの定義](ui.md) の「文言」に従い、この文書は**どの語を使うか**を決める。

## 基準

- 語は、市場に流通するアプリの日本語の画面で使われている語にそろえる。基準にするのは、Visual Studio Code の日本語の言語パック、Apple（iOS・macOS）の用語集、Microsoft の用語集、Android（AOSP）の画面の文である。迷った時は、これらで多く使われている訳を採る。
- 設計の文書の説明と画面の文を引く所、Release の本文（日本語）も、この文書の語で書く。
- 画面は表示言語にそろえる。固有名詞（iori Host・Attention・Board・Files・Git・Terminal・Records・Automations・AI Agents・Teams・Team・Orchestrator・Plan・Agents・Agent・Task N など）と、CLI・Gitの専門用語（worktree・commit・push・PR・CI・sandbox・Effort など）はそのまま使う。
- この文書に無い語を新しく使う時は、上の基準で訳を引き、ここに足してから使う。
- Microsoft の用語集の訳はカタカナの語の間に半角スペースを入れる（ラウンド トリップ）が、iori の文では入れない（ラウンドトリップ）。製品の正式な名前（この PC・OpenSSH クライアントなど）は除く。

## 語

| 意味                                                  | 使う語                                               | 使わない語                                                                       | 基準                                                                                                            |
| ----------------------------------------------------- | ---------------------------------------------------- | -------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| 接続する・接続が切れる                                | 接続・切断・再接続                                   | つながる・つなぐ・つなぎ直す・切れる                                             | VS Code・Apple・Microsoft                                                                                       |
| 一覧などから取り除く                                  | 削除                                                 | 外す・消す                                                                       | 全て                                                                                                            |
| 登録・設定を取り消す                                  | 解除（登録の解除・自動起動の解除）                   | 外す                                                                             | Apple・Microsoft                                                                                                |
| 見せる                                                | 表示                                                 | 示す・出す                                                                       | 全て                                                                                                            |
| 区切りの記号「,」                                     | カンマ                                               | コンマ                                                                           | VS Code・Apple                                                                                                  |
| データを読む                                          | 読み込む                                             | 読む                                                                             | VS Code・Apple                                                                                                  |
| 割合で見せる残りと使った量（利用枠・電池など）        | 残量・使用量（英語は Remaining・Used）               | 残り・使用済み（数や時間の「あと何」には「残り」を使う）                         | Apple（`Charge % Remaining`→充電残量（%））・Android・VS Code（`data usage`→データ使用量）                      |
| 入れる（プログラム）                                  | インストール                                         | 入れる                                                                           | 全て                                                                                                            |
| 一覧に足す                                            | 追加                                                 | 足す・加える・入れる                                                             | 全て                                                                                                            |
| 確かめる                                              | 確認                                                 | 確かめる                                                                         | 全て                                                                                                            |
| 止める・始める                                        | 停止・開始・起動・再起動                             | 止める・始める（ボタン・状態の語として）                                         | 全て                                                                                                            |
| 取り消す操作                                          | キャンセル                                           | 取り消す・やめる                                                                 | Apple・Microsoft（Owner の決定）                                                                                |
| やり直す（ボタン）                                    | 再試行                                               | もう一度・やり直す                                                               | VS Code・Apple・Microsoft                                                                                       |
| やり直しを求める文                                    | もう一度お試しください。                             | 再試行してください。                                                             | VS Code・Android・macOS（Owner の決定）                                                                         |
| 登録した機器                                          | デバイス                                             | 端末                                                                             | Apple・Microsoft・VS Code（Owner の決定）                                                                       |
| Host・Terminal                                        | 英語のまま（iori Host・Host・Terminal）              | ホスト・ターミナル                                                               | iori の製品の名前（Owner の決定）                                                                               |
| 詳しく見る                                            | 詳細                                                 | くわしく                                                                         | 全て                                                                                                            |
| フォルダー                                            | フォルダー                                           | フォルダ                                                                         | VS Code・Microsoft                                                                                              |
| シェル・プロセスが動く場所                            | 作業ディレクトリ                                     | 作業フォルダー                                                                   | VS Code・Microsoft・macOS（Owner の決定）                                                                       |
| 技術の語                                              | シェル・トークン・ジョブ・リモート                   | shell・token・job・remote                                                        | VS Code・Microsoft（Owner の決定）。Git の操作の名前（commit・push・fetch など）は英語のまま                    |
| テーマの「System default」                            | システムの設定に合わせる                             | OSに合わせる                                                                     | Owner の決定                                                                                                    |
| 使う人                                                | ユーザー                                             | 利用者                                                                           | Apple・Microsoft                                                                                                |
| OSが秘密を預かる仕組み                                | キーリング（Linux）・資格情報マネージャー（Windows） | 鍵束・資格情報ストア・資格情報の保管所                                           | VS Code・Microsoft（Owner の決定）                                                                              |
| SSHのhost key                                         | ホストキー                                           | host鍵                                                                           | Microsoft                                                                                                       |
| authentication（SSHなど）                             | 認証                                                 | 承認・認可                                                                       | Microsoft・VS Code                                                                                              |
| Windowsの昇格の確認画面                               | 「ユーザー アカウント制御」                          | 管理者の確認・管理者の承認                                                       | Microsoft                                                                                                       |
| 今使っているアカウント（active）                      | アクティブなアカウント                               | 有効なアカウント                                                                 | VS Code                                                                                                         |
| 本文の表示位置                                        | スクロール位置                                       | 読み位置                                                                         | VS Code                                                                                                         |
| user-defined                                          | ユーザー定義                                         | ユーザーの定義                                                                   | VS Code・Microsoft                                                                                              |
| File history                                          | ファイル履歴                                         | ファイルの履歴                                                                   | Microsoft                                                                                                       |
| Invitation（貼り付ける・コピーするもの）              | 招待コード                                           | 招待の文字列                                                                     | Owner の決定                                                                                                    |
| 5時間・週などの個々の制限（rate limit）               | 利用枠（長さは 5h・7d）                              | 窓                                                                               | VS Code（`session rate limit`→セッション レート制限、`weekly rate limit`→週間レート制限）                       |
| Overwrite（保存の競合）                               | 上書き                                               | —                                                                                | VS Code の保存の競合（Overwrite → 上書き）                                                                      |
| 文字の位置（Line・Column）                            | 行 {n}、列 {n}                                       | {n}行目・{n}文字目                                                               | VS Code（`Ln {0}, Col {1}` → 行 {0}、列 {1}）                                                                   |
| モデルを指定せずに CLI 自身のモデルで使う（Default）  | 既定                                                 | デフォルト・標準                                                                 | VS Code（`Default`→既定、`Use the vendor's default model`→ベンダーの既定のモデルを使用する）                    |
| 一定の間隔で繰り返す（Every 15 minutes）              | 15分ごと・1時間ごと                                  | 15分おき・毎時                                                                   | macOS（`Every 15 minutes`→15分ごと、`Every hour`→1時間ごと）                                                    |
| 入力を送る（Send input）                              | 入力を送信                                           | 入力を送る・打ち込む                                                             | VS Code（`Send input to a shell session`→入力をシェル セッションに送信する）                                    |
| バックグラウンド（background）                        | バックグラウンド                                     | —                                                                                | VS Code・Microsoft（「コマンドはバックグラウンドで実行されています」）                                          |
| script（実行するファイル）                            | スクリプト                                           | —                                                                                | VS Code・Microsoft（`script`→スクリプト）                                                                       |
| plugin（CLI に読み込ませる部品）                      | プラグイン                                           | —                                                                                | VS Code・Microsoft（`plugin`→プラグイン）                                                                       |
| 自動（Auto）                                          | 自動                                                 | —                                                                                | VS Code・Apple・Microsoft                                                                                       |
| チームの統括役（Orchestrator）                        | Orchestrator（日英とも英語のまま）                   | 親・オーケストレーター（画面のチーム呼称として。Git の親コミットは「親」のまま） | Owner の決定（Roo Code・Anthropic の慣例）                                                                      |
| 利用枠の限度（limit）                                 | 上限                                                 | —                                                                                | Android（`Over your mobile data limit`→モバイルデータ上限の超過）・Apple（`Exceeded Limit`→制限を超過しました） |
| 経過時間に対する消費の基準値（Ideal）                 | 理想                                                 | —                                                                                | Owner の決定（モックアップ承認）                                                                                |
| 新しいファイル・フォルダーを作る（New File / Folder） | 新しいファイル…・新しいフォルダー…                   | 新規ファイル・新規フォルダー                                                     | VS Code 日本語言語パック（`New File...`→新しいファイル...、`New Folder...`→新しいフォルダー...）                |
| 名前を変える（Rename）                                | 名前の変更                                           | リネーム・名前変更（ボタン・メニューとして）                                     | VS Code 日本語言語パック・Microsoft・Apple                                                                      |
| 同じ内容をもう一つ作る（Duplicate）                   | 複製                                                 | —                                                                                | Apple・Microsoft・VS Code                                                                                       |
| 相対パスをコピー（Copy Relative Path）                | 相対パスをコピー                                     | —                                                                                | VS Code 日本語言語パック（`Copy Relative Path`→相対パスをコピー）                                               |
| ツリーで表示する（Reveal in Explorer View）           | 一覧で表示                                           | ツリーで開く                                                                     | VS Code（`Reveal in Explorer View`→エクスプローラーで表示。iori の一覧名に合わせる）                            |
| 展開中のフォルダーをすべて閉じる（Collapse All）      | すべて折りたたむ                                     | 全折りたたみ                                                                     | VS Code・Microsoft                                                                                              |
| フォルダーの中を検索する（Find in Folder）            | フォルダー内を検索                                   | —                                                                                | VS Code 日本語言語パック（`Find in Folder`→フォルダー内を検索）                                                 |
| クイックオープン（Go to File）                        | ファイルを開く                                       | クイックオープン                                                                 | VS Code 日本語言語パック                                                                                        |
| Terminal で開く・パスを送る                           | このフォルダーでTerminalを開く・Terminalへパスを送信 | —                                                                                | iori の用語（Terminal は英語のまま）                                                                            |
| Git の差分を開く（Open Changes）                      | 差分を表示                                           | —                                                                                | VS Code・Microsoft                                                                                              |
| 変更をステージする（Stage Changes / Unstage Changes） | 変更をステージ・変更のステージを解除                 | —                                                                                | VS Code 日本語言語パック（`Stage Changes`→変更をステージ、`Unstage Changes`→変更のステージを解除）              |
| 変更を破棄する（Discard Changes）                     | 変更を破棄                                           | —                                                                                | VS Code 日本語言語パック（`Discard Changes`→変更を破棄）                                                        |
| 差分の表示形式（Inline / Side by Side）               | 1列で表示・並べて表示                                | —                                                                                | VS Code 日本語言語パック（並べて表示）                                                                          |
| 変更箇所の移動（Previous / Next Change）              | 前の変更箇所・次の変更箇所                           | —                                                                                | VS Code 日本語言語パック（`Previous Change`→前の変更、`Next Change`→次の変更）                                  |
| 確認済みの状態（Viewed）                              | 確認済み                                             | 既読                                                                             | GitHub PR の Viewed（コードレビューの確認状態）                                                                 |
| Files タブで開く（Open in Files）                     | Filesで開く                                          | —                                                                                | iori の画面名に合わせる                                                                                         |
| ツリー／フラット表示の切替（View as Tree / List）     | ツリーで表示・一覧で表示                             | —                                                                                | VS Code 日本語言語パック（`View as Tree`→ツリーとして表示、`View as List`→リストとして表示）                    |
| CI を再実行する（Rerun failed jobs / Rerun all）      | 失敗したジョブを再実行・すべて再実行                 | —                                                                                | GitHub Actions の操作語（再実行）                                                                               |
| 失敗・コメントを Agent へ送る（Send to Agent）        | 失敗をAgentへ送信・Agentへ送信                       | —                                                                                | iori の用語（Agent・送信）                                                                                      |
| Pull request を作成する（Create pull request）        | PRを作成                                             | —                                                                                | iori の用語（PR）                                                                                               |

## 状態と件数

状態、件数、難易度、バージョンは表示言語に合わせる。ラベル、読み上げ名、行の補足、通知で同じ状態語を使う。

| 意味                           | 日本語        | 英語                            |
| ------------------------------ | ------------- | ------------------------------- |
| 内容を取得中                   | 読み込み中    | Loading                         |
| Agentが作業中                  | 実行中        | Running                         |
| CLIの許可を待っている          | 承認待ち      | Approval / Waiting for approval |
| Orchestratorの判定を待っている | 判定待ち      | Pending                         |
| 応答・作業が終わった           | 完了          | Done / Finished                 |
| 操作・作業が失敗した           | 失敗          | Failed                          |
| 作業が停止した                 | 停止          | Stopped                         |
| 作業の開始を待っている         | 待機中        | Waiting                         |
| 作業を待つ状態に戻った         | 待機中        | Idle                            |
| 開始したAgentが応答していない  | 応答なし      | Not responding                  |
| Hostに接続済み                 | 接続済み      | Connected                       |
| Hostに未接続                   | 未接続        | Disconnected                    |
| 保存が済んだ                   | 保存済み      | Saved                           |
| 作業の難しさ                   | 難易度        | Difficulty                      |
| 難易度の段階                   | 高・中・低    | High / Medium / Low             |
| 定義・製品のバージョン         | バージョン    | Version                         |
| 通知の件数                     | 通知 1件      | 1 notification                  |
| 完了の件数                     | 完了 3件      | 3 finished                      |
| 使用トークン量                 | トークン 412k | 412k tokens                     |

## 表記

- 否定は「ない」（「無い」と書かない）。
- 条件の「時」は「とき」（「このHostをまた使うとき」）。「起動時」「日時」「時間」など時刻・時点を表す語は漢字のまま。
- 「わかる」（「分かる」と書かない）。
- 文は句点で終える。ボタン・ラベル・短い状態には付けない。確認ダイアログの問いは疑問符で終える。

## 文書の用語

画面・文書（`AGENTS.md`・`CLAUDE.md`・設計と検証の文書）・Issue・報告・依頼書・試験の名前と注釈の、全ての日本語の文に適用する。左の語は使わない。`bash scripts/ci.sh` と親の Claude Code の hook が、この表の左の語を機械で止める（Codex の担当には hook を置かない。Codex は作業ツリーの `.codex/` を読み込まず、hook の信頼も作業ツリーのパスごとに要るため）（`（）` の中は人向けの文脈で、一致には使わない）。

| 使わない語                   | 使う語                                                                         |
| ---------------------------- | ------------------------------------------------------------------------------ |
| 係（Terminal の係）          | デーモン（Terminal デーモン）                                                  |
| 見本                         | モックアップ                                                                   |
| 撮影                         | スクリーンショット（撮る・取得する）                                           |
| 操作列                       | シナリオ（E2E のシナリオ）                                                     |
| 関門                         | 必須チェック（main へ載せる前の必須チェック）                                  |
| 吹き出し                     | クリックで開いて操作できるものはポップオーバー、ホバーで出る説明はツールチップ |
| 印                           | 状態を示すものはアイコン・インジケーター、件数はバッジ、差分の +/− は記号      |
| 効く                         | 適用される・反映される・有効になる（主語に合わせる）                           |
| 読み直し                     | 画面・一覧は再読み込み、Host からデータを得るのは再取得                        |
| 写す                         | コピー・複製・反映（対象に合わせる）                                           |
| 束ねる                       | まとめる                                                                       |
| 〜の口                       | API・インターフェース・接続先など実際の境界の名前                              |
| 往復（エージェント・人の間） | やりとり（通信の round trip はラウンドトリップ）                               |
| 窓（利用枠の5時間・週など）  | 利用枠（長さは 5h・7d）                                                        |
| 版                           | バージョン                                                                     |
| フォルダ                     | フォルダー                                                                     |
| 引継ぎ                       | 引き継ぎ                                                                       |
| 受入                         | 受け入れ                                                                       |
| 便法                         | 回避策                                                                         |
| 見張り                       | 監視                                                                           |
| 利用者                       | ユーザー                                                                       |

## 文書の言い回し

文脈で意味が変わるので、機械では検査しない。画面以外の文（文書・Issue・報告・依頼書）で次の意味を書く時は、右の言い方を使う。

| 意味                 | 使わない言い方 | 使う言い方            | 根拠                                                         |
| -------------------- | -------------- | --------------------- | ------------------------------------------------------------ |
| 試験が成功する       | 通る・通す・緑 | 成功する              | Apple: Test passed → テストに成功しました                    |
| 試験が失敗する       | 落ちる・赤     | 失敗する              | Android: Factory test failed → 出荷時試験が失敗              |
| 試験を実行する       | 流す           | 実行する              | VS Code: Run Test Task → テスト タスクの実行                 |
| 変更を main へ入れる | 載せる         | マージする・push する | VS Code: Merge Changes → 変更点のマージ                      |
| 処理・作業が止まる   | 止まる         | 停止する              | Android: %1$s has stopped → %1$s が停止しました              |
| 試験の段階           | 段             | 段階                  | Microsoft: phase → フェーズ                                  |
| ファイルを編集する   | 触る           | 編集する              | VS Code: Edit file → ファイルの編集                          |
| 機能が動作しない     | 効かない       | 動作しない            | Android: It might not work properly → 正しく動作しない可能性 |

## 言い回し

| 場面       | 書き方                      | 例                                 |
| ---------- | --------------------------- | ---------------------------------- |
| 失敗       | 「〜できませんでした。」    | Hostに接続できませんでした。       |
| 今できない | 「〜できません。」          | このHostには接続できません。       |
| 進行中     | 「〜中」（「…」を付けない） | 接続中・確認中・読み込み中・更新中 |
| 終わった   | 「〜しました」              | iori Hostを更新しました            |
| 状態       | 「〜済み」「未〜」          | 接続済み・未接続・保存済み         |
| 最新       | 「最新のバージョンです」    | —                                  |
