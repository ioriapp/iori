# CLI 定義追加手順

[English](cli-definitions.md)

CLI の定義とは、iori が CLI を見つけて起動し、モデルの一覧を読み、応答中・質問待ち・承認待ち・完了といった状態を知るために必要な設定を、JSON 形式で書いたファイルです。iori は Claude Code・Codex・Pi・OpenCode・Cursor CLI・Antigravity CLI に正式対応しています。それ以外の CLI の定義も同梱していますが、同梱されているからといって正式対応というわけではなく、すべての機能を実際の CLI で確認済みとも限りません。自分の定義を足したり、同梱の定義を置き換えたりできます。CLI 本体は Host にインストールしてください。

## 画面から CLI を追加する

サイドバーの Host の下にある「AI Agents/Teams」から「AI Agents」を開きます。「CLIを追加」を開き、「追加方法」を選びます。

- 「名前とコマンド」: 「名前」と「起動コマンド」を入力します。コマンドは、その Host の Terminal で起動する時と同じように書きます。`--help` から「モデルの引数」が自動入力された時は内容を確認します。「モデルの候補」は、1行に1つのモデルを出力するコマンドなら「コマンドで取得」、固定の一覧なら「手動で入力」を選びます。モデルの項目は空のままでも保存できます。
- 「JSON」: 「定義のJSON」に定義の全文を貼り付けます。
- 「ファイルをアップロード」: 定義の JSON と、定義が参照するスクリプト・プラグイン・アイコンを選びます。何回かに分けて選ぶこともでき、選んだファイルはその都度の一覧に追加されます。同じファイル名を選ぶと後のファイルに替わります。選択から削除する時は × を押します。JSON ファイルが複数ある時は、定義のファイル名を `definition.json` にすると見分けられます。

「追加」を押します。JSON やファイルで追加した定義に、シェルで書いた起動コマンド、CLI 本体の起動以外のコマンドの実行・設定の変更・プラグインの読み込みが含まれている場合は、その内容を確認する画面が出ます。同じ `id` が既にある時は、「上書き」を確認して既存の定義を置き換えます。CLI をインストールする前でも定義を保存でき、その Host で CLI が見つからない場合は一覧にその旨が出ます。

JSON を貼り付けた定義に付属ファイルが必要なら、欄の下の「ファイルを選ぶ」で選びます。既にその定義と一緒に保存されているファイルは、選び直す必要はありません。同梱の定義を上書きする時は、差し替えなかった付属ファイルが同梱の定義からコピーされます。

変更する時は CLI の行を開き、「定義」の「定義を編集」から欄や JSON を直して「保存」を押します。同梱の定義を編集すると、ユーザーの定義として上書きします。自分で追加した定義は「削除」、上書きした定義は「同梱の定義に戻す」で削除できます。定義を削除しても、実行中の Terminal は止まらず、CLI の会話も消えません。

「アイコン」の「画像を選ぶ」では SVG か PNG を選べます。この画像はライト・ダークの両方で使われます。ダークで別の画像を使う時は、JSON の `icon.dark` に書きます。「共通のアイコンに戻す」で自分のアイコンを削除できます。同梱の定義を上書きしている時は「同梱のアイコンに戻す」と表示されます。

行の「対応状況」には、応答の状態・Attention・会話の再開・Teamの子・Tokens・Usage のそれぞれが「利用可能」「利用不可」「未定義」のどれかで表示されます。「未定義」は、定義にも iori の組み込みの対応にも、その機能の書き方が無いことを意味します。「利用不可」は、使えない機能として指定されているか、入っている CLI のバージョンでは使えないことを意味します。

## Host へ直接ファイルを置く

Host の保存先にファイルを直接置く方法でも追加できます。別のデバイスの Client を使っている場合も、次の場所は Host 側のパスです。

| Host                                        | 定義のパス                                                      |
| ------------------------------------------- | --------------------------------------------------------------- |
| Linux                                       | `~/.local/share/iori-host/cli-definitions/<id>/definition.json` |
| Linux で `XDG_DATA_HOME` を設定している場合 | `$XDG_DATA_HOME/iori-host/cli-definitions/<id>/definition.json` |
| Windows                                     | `%LOCALAPPDATA%\iori-host\cli-definitions\<id>\definition.json` |

付属のファイルは同じ定義のフォルダーに置き、JSON に書いた相対的なファイル名と揃えます。iori が CLI の一覧を読み込むと「AI Agents」に表示されます。`id` はフォルダー名と同じにし、英小文字・数字・`-` だけを使います。

同じ `id` のユーザーの定義があると、同梱の定義より優先され、一覧に「ユーザー定義」と表示されます。iori を更新しても上書きは残ります。更新された同梱の定義を使う時は「同梱の定義に戻す」を選びます。正式対応の CLI では定義の設定だけが置き換わり、CLI 固有の組み込みの動作は引き続き使われます。

## 主な項目

次は架空の `example` という CLI の例です。コマンドと引数は、使う CLI が実際に受け付けるものへ替えてください。`cli-definitions/example/definition.json` として保存します。

```json
{
  "schema": 1,
  "id": "example",
  "name": "Example CLI",
  "command": "example",
  "version": { "args": ["--version"] },
  "models": {
    "list": { "args": ["--list-models"], "format": "lines" }
  },
  "launch": {
    "model": ["--model", "{model}"],
    "initialPrompt": { "mode": "argument", "args": ["-i", "{prompt}"] }
  },
  "resume": { "args": ["--resume", "{sessionId}"] }
}
```

| 項目                      | 書く内容                                                                                                                                                                                                                                                                                                                                               | 書かない時                                                                                                                  |
| ------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------- |
| `schema`                  | 定義の形式のバージョン。`1` を書きます。知らないバージョンでも iori が分かる項目だけを読みます。                                                                                                                                                                                                                                                       | 分かる項目を読みます。                                                                                                      |
| `id`                      | 英小文字・数字・`-` で書く固有の名前。フォルダー名と揃えます。                                                                                                                                                                                                                                                                                         | 必須です。                                                                                                                  |
| `name`                    | CLI の一覧に出す名前。                                                                                                                                                                                                                                                                                                                                 | 必須です。                                                                                                                  |
| `command`                 | コマンド名、または `{ "shell": "example chat" }` のようなシェルのコマンドの行。そのユーザーのログインシェルの PATH で探します。                                                                                                                                                                                                                        | 必須です。                                                                                                                  |
| `aliases`                 | `command` が見つからない時に探す別のコマンド名の一覧。                                                                                                                                                                                                                                                                                                 | 別名では探しません。                                                                                                        |
| `icon`                    | `{ "light": "icon.svg", "dark": "icon-dark.svg" }`。定義のフォルダー内の SVG か PNG を指定し、`dark` は省略できます。                                                                                                                                                                                                                                  | 共通の CLI アイコン。`dark` が無ければ両テーマで `light` を使います。画像が無い・読み込めない時も共通のアイコンになります。 |
| `version`                 | バージョンを取得する引数。例: `{ "args": ["--version"] }`。                                                                                                                                                                                                                                                                                            | バージョンを読み込みません。                                                                                                |
| `models`                  | `list` に `args` か `shell` のコマンドと、`format: "lines"`（1行1つ）か `"json"` を書きます。固定の候補は `candidates` にモデル名かオブジェクトを並べます。JSON の一覧では `items`（例: `$.models[*]`）と項目名の `name`、必要なら `label`・`efforts` を指定します。固定の候補のオブジェクトは `name`、任意の `label`、文字列の配列の `efforts` です。 | 定義からモデルの候補を出しません。                                                                                          |
| `launch.model`            | Team の役割で選んだモデルを渡す引数。例: `["--model", "{model}"]`。                                                                                                                                                                                                                                                                                    | モデルの引数を足しません。                                                                                                  |
| `launch.effort`           | 選んだ Effort を渡す引数。例: `["--effort", "{effort}"]`。                                                                                                                                                                                                                                                                                             | Effort の引数を足しません。                                                                                                 |
| `launch.permissions`      | CLI 自身の許可モードの名前と引数の対応。例: `{ "plan": ["--permission-mode", "plan"] }`。                                                                                                                                                                                                                                                              | 定義から許可の選択肢を出しません。                                                                                          |
| `launch.initialPrompt`    | 最初の指示を渡す方法。CLI の対話画面を開いたまま引数で渡す `{ "mode": "argument", "args": ["-i", "{prompt}"] }` か、起動後に貼る `{ "mode": "paste" }`。`paste` は入力欄で bracketed paste を有効にする CLI だと確認できた時だけ使います。                                                                                                             | CLI が bracketed paste を有効にした時に最初の指示を貼ります。                                                               |
| `launch.instructionFile`  | Team の指示のファイルを渡す引数。例: `["--append-system-prompt-file", "{instructionFile}"]`。                                                                                                                                                                                                                                                          | ファイルを読み込んで従う指示を最初の入力として渡します。                                                                    |
| `launch.directories`      | Team の通信や配送に使うフォルダーを CLI に許す引数。例: `["--add-dir", "{directory}"]`。別々のフォルダーには繰り返し付けます。                                                                                                                                                                                                                         | CLI 自身のフォルダーの許可に任せます。                                                                                      |
| `launch.managedArguments` | Team の役割から指定する設定と重なる、ユーザーの起動引数を削除する指定。各項目の `names` に引数名を書きます。既定では後ろの値を1つ取り、`arity: "none"` なら値なし、`"many"` なら続く値をすべて取ります。`keys` は `-c` などの設定名（`.*` はその名前で始まる設定）、`alsoRemove` は一緒に削除する関連引数です。                                        | 定義による重複引数の除去をしません。                                                                                        |
| `resume`                  | 再開の引数。例: `{ "args": ["--resume", "{sessionId}"] }`。会話 ID は hook かプラグインの知らせから受け取ります。                                                                                                                                                                                                                                      | 定義から再開の引数を出しません。                                                                                            |
| `hooks`                   | 下の4つの形のいずれかで、応答の状態や、取得できる場合は Attention を知らせます。                                                                                                                                                                                                                                                                       | 定義から応答の状態を知らせません。                                                                                          |
| `tokens`                  | `{ "script": "tokens.mjs" }`、または `{ "command": { "args": ["example", "tokens", "--json"] } }`。入出力は下で説明します。                                                                                                                                                                                                                            | 定義から Tokens を読みません。プラグインから送る方法も使えます。                                                            |
| `usage`                   | `{ "script": "usage.mjs" }`、または `tokens` と同じ形の `command`。                                                                                                                                                                                                                                                                                    | 定義から Usage を読みません。                                                                                               |
| 各機能の `unavailable`    | `hooks`・`resume`・`tokens`・`usage` の中に `true` を書き、「利用不可」にします。例: `"usage": { "unavailable": true }`。                                                                                                                                                                                                                              | 機能が無ければ「未定義」。組み込みの対応やプラグインがその機能を持つ時は使われます。                                        |

`{model}`・`{effort}`・`{prompt}`・`{sessionId}`・`{instructionFile}`・`{directory}` は、iori が起動時に埋めます。値を選んでいない項目の引数は足しません。Team の起動の引数は `launch` に書いた項目の順に付けます。引数の配列は1語ずつ書きます。各要素は個別に引用して渡され、シェルの展開は動きません。`shell` のコマンドの行と、ユーザーが入力する起動時の引数は、シェルの規則で扱います。

設定ファイルのパスやプラグインの配置先は、`~`・絶対パス、または `{ "env": "EXAMPLE_HOME", "default": "~/.example", "path": "settings.json" }` のように書けます。環境変数があれば既定のフォルダーより優先します。Windows でも同じ書き方です。付属するスクリプト・プラグイン・アイコンの参照元は定義のフォルダー内に限り、絶対パスや `..` は使えません。

## hooks で応答の状態を知らせる

hook は、入力の送信や応答の終了などの出来事が起きた時に、CLI が呼ぶコマンドです。出来事の名前と、CLI が渡すデータの項目名は、その CLI が決めたものを使います。次は同梱の定義を元に、4つの形を紹介した小さい定義です。それぞれ全文を読めますが、ここに書いた機能だけを持ちます。ほかの設定も使う時は同梱の定義の全文を使ってください。

### `claude-settings`: Claude 形式の hooks

Qoder のように、`hooks` の下で出来事ごとにコマンドの hooks を配列で持つ CLI に使います。コマンドの項目は iori が作り、道具の出来事と `PermissionRequest` には `matcher: "*"` を付けます。

```json
{
  "schema": 1,
  "id": "qoder",
  "name": "Qoder CLI",
  "command": "qoder",
  "hooks": {
    "format": "claude-settings",
    "file": {
      "env": "QODER_CONFIG_DIR",
      "default": "~/.qoder",
      "path": "settings.json"
    },
    "sessionId": "session_id",
    "rules": [
      { "event": "UserPromptSubmit", "state": "active" },
      {
        "event": "PermissionRequest",
        "state": "waiting",
        "attention": "approval"
      },
      { "event": "Stop", "state": "done" }
    ]
  }
}
```

### 設定から iori 専用の hooks ファイルを参照する

`own: true` の時、別の JSON 設定ファイルの項目から専用の hooks ファイルを読み込む CLI には `link` を使います。`file` は `hooks.file` と同じパスの書き方です。設定ファイルが無い時は `base`（省略時は空のオブジェクト）で作ります。`set` には最上位の鍵と JSON の値を書き、鍵に点は使えません。値の中の `{file}` は、`hooks.file` の OS の絶対パスになります。同じ値は保ち、無い鍵だけを足します。既存の値が1つでも異なる時はどちらのファイルも変えず、応答の状態を出しません。確認の「変更する設定ファイル」には両方のパスが出ます。Muse Code では、`own: true` と専用の `file` と並べて、`hooks` の中に次を足します。

```json
"link": {
  "file": { "env": "XDG_CONFIG_HOME", "default": "~/.config", "path": "muse/settings.json" },
  "base": { "schema_version": 1 },
  "set": {
    "managed_hooks_path": "{file}",
    "managed_hooks_env_vars": ["IORI_CLI_HOOK_URL"]
  }
}
```

### `events`: 出来事ごとの配列

出来事ごとに配列があり、置き場所やコマンドの項目の形が Claude 形式と違う CLI に使います。この VT Code の例では、TOML の `hooks.lifecycle.<出来事名>` の下に項目を足します。

```json
{
  "schema": 1,
  "id": "vtcode",
  "name": "VT Code",
  "command": "vtcode",
  "hooks": {
    "format": "events",
    "file": {
      "env": "VTCODE_HOME",
      "default": "~/.vtcode",
      "path": "vtcode.toml"
    },
    "at": "hooks.lifecycle",
    "entry": { "hooks": [{ "command": "{command}" }] },
    "sessionId": "session_id",
    "rules": [
      { "event": "user_prompt_submit", "state": "active" },
      { "event": "stop", "state": "done" }
    ]
  }
}
```

### `list`: 出来事名を持つ項目を1つの配列へ

すべての hooks を同じ配列に並べ、各項目に出来事名を書く CLI に使います。Kiro では iori の hooks だけのファイルを作れます。`own: true` で専用のファイルだと指定し、ほかに必要な項目を `base` に書きます。

```json
{
  "schema": 1,
  "id": "kiro",
  "name": "Kiro CLI",
  "command": { "shell": "kiro-cli chat" },
  "hooks": {
    "format": "list",
    "file": "~/.kiro/hooks/iori.json",
    "own": true,
    "base": { "version": "v1" },
    "at": "hooks",
    "entry": {
      "name": "iori {event}",
      "trigger": "{event}",
      "action": { "type": "command", "command": "{command}" }
    },
    "sessionId": "session_id",
    "rules": [
      { "event": "UserPromptSubmit", "state": "active" },
      { "event": "Stop", "state": "done" }
    ]
  }
}
```

この3つの形では、`file` にプロジェクトの設定ではなくユーザー全体の設定を指定します。拡張子で JSON・TOML・YAML（`.json`・`.toml`・`.yaml`・`.yml`）を選びます。`at` は点で区切った置き場所です。`entry` には `{command}` と、必要なら `{event}` を書きます。iori が hook のコマンドと出来事名で埋めます。知らない形式・対応していない拡張子・`{command}` の無い項目では、その定義から応答の状態を知らせられません。

`rules` は上から順に読み、最初に合った規則を使います。`when` は受け取ったデータの項目の値との一致で、`"when": { "source": { "not": "compact" } }` のような否定も書けます。`ignore: true` はその出来事を無視します。合う規則の無い出来事も無視します。状態は `active`（応答中）・`waiting`（入力待ち）・`done`（応答の完了）・`stopped`（CLI の終了）・`idle`（待機中）です。`attention: "approval"` なら承認待ち、`"question"` なら質問待ちを意味します。CLI が承認を知らせない場合、iori は推測しません。

会話 ID・会話ファイルのパス・道具の呼び出し ID が入る項目名は、`hooks` の `sessionId`・`transcript`・`toolId` に書きます。規則の `tool`・`response` には道具の名前・応答の本文が入る項目名を書きます。`toolFinished: true` は道具の実行の終了です。失敗を知らせる時は `outcome: "failure"` と、理由が入る項目名か項目名の配列の `failure` を書きます。配列では、先に値がある項目を使います。

### `plugin-file`: CLI の中で動くプラグイン

コマンドを呼ぶ hooks の代わりに、プラグイン API を持つ CLI に使います。CLI の出来事を iori への知らせへ変える、小さい橋渡しのプラグインが必要です。この omp の例は、同梱の [iori-bridge.js](../apps/host/src/cli/omp/iori-bridge.js) を定義と一緒に置いて使います。

```json
{
  "schema": 1,
  "id": "omp",
  "name": "omp",
  "command": "omp",
  "hooks": {
    "format": "plugin-file",
    "install": { "copy": "iori-bridge.js", "args": ["--hook", "{plugin}"] },
    "sends": ["attention", "tokens"]
  }
}
```

`copy` は定義のフォルダー内のファイル名です。CLI が起動引数でプラグインを読み込める場合は `install.args` を使います。`{plugin}` を必ず含め、iori が `~/.iori/hooks/<id>/` へコピーしたプラグインの場所で埋めます。それ以外では `install.args` の代わりに `install.to` を使います。たとえば Amp なら `"to": "~/.config/amp/plugins/"` とすると、そのフォルダーへコピーします。読み込み方はどちらか1つだけ選び、プラグインは各 CLI のプラグイン API に合わせて書きます。omp のプラグインを Amp でそのまま使うことはできません。

プラグインは応答の状態を送ります。`sends` には、さらに送る機能だけを書きます。`attention` は質問待ち・承認待ち、`tokens` は会話の累計の Tokens です。プラグインが送らない機能の名前は書きません。

### iori に知らせる共通の形

橋渡しのプラグインは、環境変数 `IORI_CLI_HOOK_URL` の URL へ、HTTP の POST で JSON を送ります。この環境変数が無い時は何もしないようにすると、iori の外で CLI を起動した時も使えます。たとえば omp の応答が完了した時は、次の形で送れます。

```json
{
  "iori": 1,
  "iori_cli": "omp",
  "state": "done",
  "sessionId": "example-session",
  "response": "Finished the requested work.",
  "tokens": { "input": 1200, "output": 300 },
  "model": "example-model"
}
```

`iori_cli` には定義の `id` を書きます。別の CLI を指す知らせは無視されます。状態の意味は `rules` と同じです。任意の項目は `sessionId`・`transcript`（会話ファイルのパス）・`response`・`model`・`attention`（例: `{ "kind": "approval", "tool": "shell" }`）、`outcome: "failure"` と理由の `failure`、`tokens` です。CLI から得られたものだけを書き、知らない項目は無視されます。Tokens は直前の応答だけでなく会話の累計にします。`tokens` のスクリプトがある時は、その値を優先します。

## スクリプトで Tokens と Usage を取得する

Tokens のスクリプトは会話に記録されたトークン数、Usage のスクリプトはアカウントやモデルの利用枠の残量を読みます。**正式対応でない CLI の値は参考値で、iori は正確さを保証しません。**

JavaScript の `.mjs` で書き、できれば Node.js の標準機能だけを使います。Host に同梱の Node.js で動きます。標準入力から JSON を1つ読み、標準出力へ JSON を1つ返します。値を読めなかった時は何も出力せず、iori にも値を出しません。診断用の文を標準出力へ混ぜないでください。

スクリプトは `definition.json` と一緒に置きます。たとえば次の定義には、`tokens.mjs` と `usage.mjs` が必要です。

```json
{
  "schema": 1,
  "id": "example",
  "name": "Example CLI",
  "command": "example",
  "tokens": { "script": "tokens.mjs" },
  "usage": { "script": "usage.mjs" }
}
```

### Tokens のスクリプト

入力には、取得できた会話 ID・会話ファイルのパス・作業ディレクトリが入ります。無い値は省略されます。

```json
{
  "sessionId": "example-session",
  "transcript": "/path/to/conversation.json",
  "cwd": "/path/to/project"
}
```

CLI が記録した数値を読み込むか、CLI 自身が持つ使用量のコマンドを呼びます。出力は会話の累計で、`input`・`output` は必須です。

```json
{
  "input": 1200,
  "output": 300,
  "cacheRead": 800,
  "cacheWrite": 100,
  "reasoning": 40
}
```

任意の項目は CLI が記録している時だけ返します。無い値を0で埋めたり、文字数から Tokens を推定したりしません。会話ファイルのパスが無ければ、`sessionId` から会話を探せます。

会話ファイルが JSON で、`usage` に累計を記録する CLI なら、`tokens.mjs` を次のように書けます。読み取る部分は、使う CLI の実際の記録形式へ合わせてください。

```js
import { readFile } from "node:fs/promises";

let text = "";
for await (const chunk of process.stdin) text += chunk;
const { transcript } = JSON.parse(text);
if (transcript) {
  const { usage } = JSON.parse(await readFile(transcript, "utf8"));
  if (typeof usage?.input === "number" && typeof usage?.output === "number") {
    const counts = { input: usage.input, output: usage.output };
    for (const key of ["cacheRead", "cacheWrite", "reasoning"]) {
      if (typeof usage[key] === "number") counts[key] = usage[key];
    }
    process.stdout.write(JSON.stringify(counts));
  }
}
```

iori は Team の子の委譲の節目や、Board の集計時に Tokens を読みます。

### Usage のスクリプト

入力は空の JSON オブジェクト `{}` です。CLI の利用枠を読み込むコマンドを呼び、その結果を読み取って、取得できた期間ごとの枠を返します。

```json
{
  "windows": [
    {
      "remaining": 75,
      "minutes": 300,
      "resetsAt": 1893456000000,
      "name": "5 hours",
      "modelPatterns": ["example-provider/*"]
    }
  ]
}
```

`remaining` は残量の割合（0〜100）、`minutes` は枠の長さ（分）です。`resetsAt` は Unix epoch からのミリ秒で書く回復時刻で、省略できます。`name`・`modelPatterns` は名前付きの枠やモデルのグループを分ける時に使い、省略できます。読み込めた枠だけを返します。ここで呼ぶコマンドは、ログインを始めたり、モデルへ要求を送ったりしないものにします。iori は応答の終了・回復時刻・該当の画面を開いた時に Usage を再読み込みします。

どちらの機能も、`script` の代わりに `command` の `args` を使えます。配列の先頭に実行するコマンド、その後に引数を1つずつ書きます。JSON の入出力は同じで、シェルの展開は動かしません。追加の道具が必要なら Host にインストールしてください。スクリプトとコマンドはそのユーザーのログイン環境で動きます。Windows ではシステムとユーザーの環境変数を使います。別のプロセスとして動き、iori が保存しているデバイスの鍵・Forge のトークン・Team の秘密値は渡されません。

## 追加した物を片付ける

「AI Agents」から定義を削除すると、その定義のために iori が置いたと記録している hooks とプラグインを削除します。編集や「同梱の定義に戻す」で配置先が変わる時も、前の場所の項目を削除します。Host の撤去時も、記録した分を片付けます。

ほかの hooks・CLI 本体の設定・会話・実行中の Terminal は保たれます。iori 専用の設定ファイルは、iori の内容だけが残っている時にファイルごと削除し、それ以外は自分の項目だけを削除します。iori が置いたものではない同名のプラグインファイルは上書きしません。定義のフォルダーと設定の両方を片付ける時は、画面の削除や同梱の定義に戻す操作を使ってください。

`link` の鍵は、記録した値と同じ時だけ削除します。設定ファイルごと削除するのは、iori が作ったファイルに `base` だけが残る時です。ユーザーが足した設定は残ります。

## ほかの人が作った定義を追加する前に

JSON だけでなく、付属のスクリプトやプラグインの中身も読んでください。起動コマンド・モデル一覧のコマンド・Tokens と Usage のスクリプトやコマンド・hook のコマンド・プラグインは、Host のユーザーの権限で動き、そのユーザーのファイルやネットワークへアクセスできます。定義は CLI の設定を書き換えたり、プラグインを配置したりすることもできます。保存前に表示される内容を確認し、信頼できる定義と付属ファイルを使ってください。
