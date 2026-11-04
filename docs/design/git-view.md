# Git View

読むのは、現在の変更、差分、file履歴、commit詳細、Agentへの変更参照を変える時である。
製品全体の価値は[製品仕様](../product.md)、通常fileの閲覧は[Files View](files-view.md)、会話の入力は[CLIの画面](cli-screen.md)、Gitの安全境界は[技術設計](../architecture.md)が持つ。

## ユーザーの目的

Agentや外部toolが何を変えたか、その変更が妥当か、過去に何が行われたかを、Gitに詳しくなくても確認する。気になるfileのパスを、Agentへの質問・修正指示に使う。

Git Viewは閲覧専用である。stage、unstage、commit、push、merge、rebase、branch変更、discard、部分revertを実行しない。変更箇所を参照してAgentへ元に戻すよう依頼することはできるが、Git作用を閲覧操作に見せかけない。

## 画面の構成

ファイルのタブと同じ行の変更一覧上端にworktreeの切替を置く。候補は表示中の親とその子のworktreeだけとし、ブランチ名で選べる。別のリポジトリの子のworktreeは「〈リポジトリ名〉 › 〈ブランチ名〉」と示す。切替はそのタブの表示対象だけを替え、サイドバーで選択中のワークスペース、ほかのタブ、本体の配置は変えない。表示対象もタブの配置とともに保存・復元する。全幅の帯は使わず、切替と一覧の間に罫線を引かず余白で分ける。ボードの変更の数字を押すと、Gitタブをその子のworktreeへ切り替える。会話のファイル変更の行からも差分へ移れる。

サイドバーのworktreeの行の右端に、そのブランチの最新のpushについてPRの印とCIの印を並べる（行の名前と省略は[画面の構成と移動](workspace-layout.md)）。GitビューにはPR・CIの状態を出さない。CIの詳細とIssueは[Forgeとの連携](forge.md)の画面で読む。

- **PRの印**: push先のリポジトリに、そのブランチをheadとするPRがあれば、番号と状態（open・draft・merged・closed）を示す。押すとブラウザーでPRを開く。PRがmergedなら[Merged](worktrees.md)の印はPRの印にまとめて二重に出さない。
- **CIの印**: push先のブランチの最新commitのCIの結果（GitHubはcheck runとcommit status、Forgejo・Giteaはcommit status。外部サービスの結果も含む）をまとめて、通過・失敗・実行中を示す。印のアイコンは通過が `CircleCheck`、失敗が `CircleX`、実行中が `CircleDashed` で、実行中をリポジトリの行の[Issuesのボタン](forge.md#issues)（`CircleDot`）と取り違えないようにする。画面の言葉は「CI」とし、GitHubのchecksを「チェック」と訳さない。押すとアプリの中で[CIの詳細](forge.md#ciの詳細)を開く。
- **対象**: 表示中のブランチのGitのpush先（`@{push}`）から特定したForgeのリポジトリとremote側のブランチ。`origin` を決め打ちせず、上流とpush先を同一視しない。上流が無くてもpush先を特定できれば示す。push先を特定できない、pushしていない、PR・CIが無い、Forgeの情報が取れない時はその印を出さず、状態を推測しない。
- **Forgeの判定**: remoteのURLに書かれたホスト（SSHの別名を含む）が[ワークスペースの設定の「Git」](settings.md#ワークスペースのgit)に登録してあれば、登録したWebのURLを問い合わせ先と開くURLのoriginに使う。登録が無ければremoteのホストをそのまま使う。そのうえで `github.com` はGitHub、それ以外はForgejoとGiteaのAPI（`/api/v1/version`）に応じればForgejo・Giteaとして扱い、応じなければ印を出さない。URLの見た目だけでForgeを決めず、ホスト名を推測で読み替えない。
- **認証**: GitHubはHostの `gh` CLIのログインを使い、ioriはtokenを保存しない。使うアカウントは[ワークスペースの設定の「Git」](settings.md#ワークスペースのgit)の「GitHubのアカウント」に従う（既定は自動）。`gh` が無い・未ログインのHostではGitHubの印を出さない。Forgejo・Giteaは、設定の[連携](forge.md#連携の設定)にtokenを登録したサイトではそのtokenで読み、登録していないサイトは公開リポジトリだけをtoken無しで読む。読めないリポジトリには印を出さない。
- **更新**: push先のremote側の参照が変わったら（pushした時を含む）すぐ読み直す。ほかは選択中のworktreeを60秒、それ以外を120秒ごとに読み直し（Orcaの既定に倣う）、どのClientもサイドバーを表示していない間は読まない。読み直しに失敗した時は最後に取れた印を保つ。
- **表示の設定**: 「表示」に印を出すかの切替を置き、既定は出す。幅が足りない時に消せる。

上部で**変更**と**履歴**を切り替える。最初は変更を開く。十分な幅では左に一覧、右に選択したdiffまたはcommit詳細を並べ、左は初期値としてViewのおよそ4分の1を使う。仕切りの比率と一覧の開閉はViewごとに保存する。

幅が不足した時とMobileでは、一覧と詳細を一画面ずつ表示する。詳細から戻ると、同じ一覧、section、選択、scroll位置へ戻る。Unified DiffはMobileでは一列で表示し、長い行の折返しを切り替えられる。Unified Diffの横幅を守るために、一覧とdiffを同時に押し潰さない。

## 現在の変更

branch名、上流の有無、ahead / behind、Git repositoryが無い状態を、取得できた事実だけから示す。開いたフォルダーがリポジトリの中の一部でも、変更はリポジトリ全体を示す（VS Codeと同じ）。FilesのRootやAgentの作用範囲は広げない。

変更fileは次のsectionへ分ける。

- **ステージ済み:** 次のcommitに含まれる状態。
- **変更:** tracked fileの未ステージ変更。
- **未追跡:** Gitがまだ追跡していないfile。

Gitの一文字状態だけを説明なしに使わない。追加、変更、削除、rename、copy、競合、未追跡を名称・icon・色の組合せで示し、追加行・削除行の件数を取得できた時だけ表示する。同じpathにstagedとunstagedの両方がある場合は、一つに潰さず別の変更として選べる。

Gitのリンクはリンク文字列の変更として読む。リンク先がrepository外や不存在でも、リンク先の本文を辿らず一覧と差分に表示する。FilesのRoot外リンクの読取範囲は広げない。

Gitが列挙できた変更の一部だけ版を確認できない場合も、他の確認できる変更を読める。一覧ではその行に権限不足や読み取り失敗などの理由を日本語で示し、titleにも同じ理由を使う。選択した時に対象の失敗を知らせる。検査失敗を削除や変更なしへ置き換えず、回復後は新しい一覧で版を確認する。

一覧は表示中に外部変更へ自動追従する。通常操作として再読込やViewの開き直しを要求しない。Viewが隠れている間は不要な観測を止め、再表示時にすぐ現在状態を確認する。

項目数が多くても内部上限で一覧を完全取得済みに見せない。scrollに合わせて続きが自動で届き、手動の「さらに読み込む」を置かない。変更の通知を受けたら一覧を取り直し、取り直す前後の別の状態を1つの一覧に混ぜない。iori自身が返した状態を照合して読取を拒否しない。

## Diffを読む

既定は一列のUnified Diffとする。差分の頭にはGitの生の見出し（`diff --git`・`index`・`---`/`+++`）を出さず、ファイルのパスと変更の種類を示す。旧行番号、新行番号、追加、削除、変更なしのcontext、hunk境界を区別する。長い行はdiff内部で横に読め、View全体を横scrollさせない。広いDesktopでのSplit Diffは後続候補であり、初期仕様には含めない。差分の一つの論理行を内部の転送や保存で分割しても、その境界を画面やAgent参照の余分な改行にしない。

hunk間の省略された未変更行は省略と分かるようにし、必要な範囲を展開できる。展開は同じfile revisionとGit refに対して行い、別の変更を黙って足さない。diff本文内を検索し、展開したcontextと長い一行の続きも含め、前後の一致へ移動できる。

renameは旧pathと新pathを示し、内容変更あり・なしを区別する。binaryは行diffが無いこと、種類と変更状態を示す。対応する画像diffは後続候補であり、初期範囲では変更前後を推測して描画しない。untracked fileは全体が追加であると明示し、通常のtracked diffと同じものに見せない。競合は通常の変更と区別し、取得できたstageだけを示す。

差分の追加側または削除側の連続行を選べる。

## 履歴

履歴は新しいcommitから一覧し、scrollに合わせて過去を自動取得する。各行には短いhash、件名、作者、日時を、取得できた範囲で示す。内部のページ単位を操作させず、branch graphやrebase等の操作は持ち込まない。

commitを選ぶと、完全なmessage、作者、日時、親、変更file一覧を示す。変更fileを選ぶと、そのcommitのdiffを現在の変更と同じ読取面で開く。merge commit等で比較対象の親が複数ある時は、どの親との差かを示し、暗黙に一つを正解としない。

現在の変更またはFiles Viewで選んだfileから、そのfileのcommit履歴へ絞り込める。絞り込み中であることと解除操作を常に見える位置に置く。renameを跨ぐ追跡はGitから確実に得られる範囲に限り、同名fileを同一と推測しない。

履歴を見るだけでbranchをcheckoutしたり、worktreeを切り替えたりしない。

## 大きい対象と資源

変更一覧、diff、履歴にiori独自の製品上の総量上限を設けない。取得できる末尾へscroll、検索、行移動で到達できる。一度に送るframe、受信window、Git process出力、一時保管、描画行、cacheは有限にし、画面外の一時dataを解放できるようにする。

一覧とdiffは見える行と周辺だけを描画する。選択変更、View close、Workspace切替では不要な生成・取得を止める。大きいdiffでも転送単位ごとのbuttonを置かず、必要な範囲を自動取得する。外部diff、textconv、pagerを起動して見た目や作用をユーザー環境へ委ねない。

正常な内容を大きさだけで「部分表示」として終了しない。Git自身の結果、権限、変更中、切断等で読取が失敗し、回復操作がある時は、対象のそば一か所に失敗と再読込を示す。読めない範囲を未取得の表示で埋めない。

## Agentへの参照

CLI自身の画面とTerminalへの渡し方（ドラッグとパスのコピー）も[Files View](files-view.md#agentへの参照)と同じである。

## 状態、更新、復帰

変更なし、Git repositoryなし、読取中、取得済み、認可外、Git ref変更、binary、競合、上流なしを区別する。更新中または一時失敗では最後に確認した一覧とdiffを保ち、回復操作がある失敗だけを対象のそばへ示す。

選択中の変更が更新後も同じGit ref上の同じ対象なら選択を保つ。削除、stage移動、別refになった場合は別対象として扱い、古いdiffと新しい一覧を組み合わせない。別Host、別Workspace、別worktree、同じpathの別repositoryを混ぜない。

変更／履歴、sectionの開閉、選択、scroll位置、検索をViewごとに保持し、View切替、tab移動、再接続、Client再起動から戻れるようにする。Git原本の永続offline cacheは今は持たない（持つかは未定）。最後に表示した内容を現在内容と誤認させない。

## キーボードとタッチ

diffは旧・新の行番号、追加・削除、hunkを色以外でも判別できる。focusは一覧、diffを順に移動できる。keyboardで項目移動、section開閉、diff内検索、行範囲選択へ到達できる。

## 受入条件

- Gitに詳しくないユーザーも、ステージ済み、変更、未追跡、競合、rename、binaryを説明なしに取り違えない。
- 表示中の変更が外部で変わると一覧と選択中diffが更新され、更新中・失敗時は最後の内容と現在状態を区別する。
- 大きいtracked / untracked diffでも、内部byte値や「さらに読み込む」を見ずに末尾を読み、検索・行選択できる。
- 大きいdiffと履歴でDOM node数が総行数・総commit数に比例せず、WindowsとAndroidでscroll中に通常操作を妨げる停止がない。
- file履歴、commit詳細、commit内diffを読めるが、閲覧だけでcheckout、stage、commit、discardを行わない。
