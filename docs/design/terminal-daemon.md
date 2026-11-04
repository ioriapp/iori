# Hostの再起動・更新をまたいでTerminalを続ける

> Status: 採用済みの製品仕様。

読むのは、TerminalとCLIの画面（PTY）を持つプロセス、Hostの再起動・更新でのTerminalの扱い、CLIのhooks・`iori` コマンドの受け口を変える時である。

## ユーザーの目的

Hostを再起動・更新しても、作業中のエージェントとTerminalで動いているbuild・テストを止めない。応答の途中でも続け、つなぎ直した画面はそのまま同じTerminalに戻る。

## 作り

- PTYとその画面の保持（headlessのemulator）を、Host本体と別の長く動くプロセス（以下、係）が持つ。Host本体は係へ同じマシンの中の口（LinuxはUnix socket、Windowsはnamed pipe。同じユーザーだけが開ける）でつなぎ、Clientとの通信・保存・Files・Git・チームなどを受け持つ。手本はOrcaのterminal daemon（[stablyai/orca](https://github.com/stablyai/orca) の `src/main/daemon/`）。
- Host本体が起動した時、動いている係があればつなぎ直し、無ければ起動する。係はHost本体の終了・再起動・入れ替えで止まらない場所で動かす（Linuxはsystemdのuserの別unit、Windowsは版ごとの場所へ写した実行ファイルを、Host本体と親子にせず起動する）。
- PTYの中のCLIが使う口（hooksの知らせ、チームの `iori` コマンド）は係が受ける。Host本体が止まっている間に届いたものは係が保持し、Host本体がつなぎ直した時に渡す。Host本体の再起動で口の場所が変わり、生きているCLIから届かなくなる作りにしない。
- 係と本体の間のやり取りには版を付ける。本体の更新で係の版が変わらない時は係を続ける。係の版が変わる更新は、係を入れ替えるのでTerminalとエージェントを止める（Orcaのように古い係を残して複数の版へつなぐ作りは採らない。保守が大きく、Orcaでもつなぎ直せなくなる不具合が出ているため）。係の版はなるべく変えない。

## 利用者から見えること

- 再起動・更新の確認画面は、係を続けられる時、「実行中のTerminalとエージェントは止まりません。全端末の接続が一度切れ、iori Hostが起動し直すと自動で戻ります。」を示し、止める作業の一覧と危険色の文言を出さない。
- 係の版が変わる更新と、係が動いていない時（マシンの再起動の後など）は、[Hostの再起動](host-restart.md)・[更新](host-install-update.md#更新)のとおり、止める作業を示して止める。止まったTerminalとCLIの画面の履歴を残し、CLIは会話の再開で起動し直す。
- マシンそのものの再起動、係の異常終了では、Terminalは止まる。扱いは上と同じ。

## 確かめること

- 自動の受入に、Linux Host・Windows Hostそれぞれで、PTYで動くCLIとTerminalの処理を続けたままHostを再起動し、Clientが同じTerminalにつなぎ直して出力の続きを受け、hooksの知らせと `iori` コマンドが届くことを通す操作列を入れる。
