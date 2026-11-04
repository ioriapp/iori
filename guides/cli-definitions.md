# Adding CLI definitions

[日本語](cli-definitions.ja.md)

A CLI definition is a JSON file of settings that tells iori how to find and start a CLI, list its models, and recognize states such as responding, waiting for a question or approval, and finished. iori officially supports Claude Code, Codex, Pi, OpenCode, Cursor CLI, and Antigravity CLI. It also bundles definitions for other CLIs; being bundled does not mean a CLI is officially supported or that every feature has been tested with the real CLI. You can add your own definitions or replace a bundled definition. The CLI itself must be installed on the Host.

## Add a CLI from the app

Open **AI Agents/Teams** under the Host in the sidebar, then **AI Agents**. Open **Add CLI** and choose an **Add method**:

- **Name and command**: enter **Name** and **Launch command**, as you would run the CLI in a Terminal on that Host. Check **Model argument** if iori fills it in from the command's `--help`. Under **Model candidates**, choose **Get with a command** for a command that prints one model per line, or **Enter manually** for a fixed list. These model fields can be left empty.
- **JSON**: paste a complete definition into **Definition JSON**.
- **Upload file**: select the definition JSON and any scripts, plugins, or icons it refers to. You can select files in several batches; each selection adds to the list. Selecting the same filename replaces the earlier selection. Use × to remove a file from the selection. If there is more than one JSON file, name the definition `definition.json` so iori can identify it.

Choose **Add**. For JSON or uploaded definitions, iori asks for confirmation when the definition runs a shell launch command or other extra commands, changes settings, or loads a plugin. Adding a definition with an existing `id` replaces that definition after you confirm **Overwrite**. You can save a definition before installing its CLI; the list will show that the CLI was not found on this Host.

If a definition pasted as JSON needs files, use **Choose files** below the field. Files already saved with the definition do not need to be selected again. When overriding a bundled definition, iori copies any referenced bundled files you have not replaced.

To change a definition, open its row, then **Definition** → **Edit definition**, edit the fields or JSON, and choose **Save**. Editing a bundled definition saves a user override. Use **Delete** for a definition you added, or **Revert to the bundled definition** for an override. Deleting a definition does not stop running Terminals or remove the CLI's conversations.

Under **Icon**, **Choose an image** accepts SVG or PNG. This image is used in both themes. To use a separate dark image, set `icon.dark` in the JSON. **Revert to the common icon** removes a custom icon; for an overridden bundled definition the button is **Revert to the bundled icon**.

The row's **Support** section shows **Available**, **Unavailable**, or **Not defined** for response status, Attention, resuming conversations, **Team child**, **Tokens**, and **Usage limits**. **Not defined** means neither the definition nor built-in support provides that feature; **Unavailable** means it is explicitly marked unavailable or cannot be used with the installed CLI version.

## Put a definition on the Host

You can also put files directly in the Host's data folder. These are Host paths, even when you use a Client on another device:

| Host                           | Definition path                                                 |
| ------------------------------ | --------------------------------------------------------------- |
| Linux                          | `~/.local/share/iori-host/cli-definitions/<id>/definition.json` |
| Linux with `XDG_DATA_HOME` set | `$XDG_DATA_HOME/iori-host/cli-definitions/<id>/definition.json` |
| Windows                        | `%LOCALAPPDATA%\iori-host\cli-definitions\<id>\definition.json` |

Put attached files in the same definition folder, keeping the relative filenames used in the JSON. The definition appears in **AI Agents** when iori reads the CLI list. Its `id` must match the folder name and use only lowercase letters, digits, and `-`.

A user definition with the same `id` takes precedence over a bundled one and is marked **User definition**. It continues to take precedence after iori updates. Choose **Revert to the bundled definition** to use the bundled version again. For officially supported CLIs, an override replaces the definition settings; their built-in CLI-specific behavior still applies.

## Main fields

This example describes an imaginary `example` CLI. Replace the command and arguments with ones your CLI actually accepts. Save it as `cli-definitions/example/definition.json`:

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

| Field                          | What to write                                                                                                                                                                                                                                                                                                                                        | When omitted                                                                                                         |
| ------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| `schema`                       | Definition format version; use `1`. Unknown versions are read for the fields iori knows.                                                                                                                                                                                                                                                             | Known fields are still read.                                                                                         |
| `id`                           | Unique name using lowercase letters, digits, and `-`; match the folder name.                                                                                                                                                                                                                                                                         | Required.                                                                                                            |
| `name`                         | Display name in the CLI list.                                                                                                                                                                                                                                                                                                                        | Required.                                                                                                            |
| `command`                      | Command name, or `{ "shell": "example chat" }` for a complete shell command line. iori looks for the command in your login shell's PATH.                                                                                                                                                                                                             | Required.                                                                                                            |
| `aliases`                      | Other command names to try if `command` is not found.                                                                                                                                                                                                                                                                                                | No alternate names.                                                                                                  |
| `icon`                         | `{ "light": "icon.svg", "dark": "icon-dark.svg" }`; SVG or PNG inside the definition folder. `dark` is optional.                                                                                                                                                                                                                                     | Common CLI icon; without `dark`, use `light` for both themes. Missing or unreadable images also use the common icon. |
| `version`                      | `{ "args": ["--version"] }` to read the CLI version.                                                                                                                                                                                                                                                                                                 | No version is read.                                                                                                  |
| `models`                       | `list` with `args` or a `shell` command and `format: "lines"` or `"json"`; alternatively, `candidates` with fixed model names or objects. For JSON, set `items` (such as `$.models[*]`) and the field names `name`, optionally `label` and `efforts`. Candidate objects use `name`, optional `label`, and optional `efforts` as an array of strings. | No model candidates from the definition.                                                                             |
| `launch.model`                 | Arguments such as `["--model", "{model}"]` for a Team role's selected model.                                                                                                                                                                                                                                                                         | No model arguments added.                                                                                            |
| `launch.effort`                | Arguments such as `["--effort", "{effort}"]` for its selected Effort.                                                                                                                                                                                                                                                                                | No Effort arguments added.                                                                                           |
| `launch.permissions`           | Map CLI permission mode names to argument arrays, such as `{ "plan": ["--permission-mode", "plan"] }`.                                                                                                                                                                                                                                               | No permission choices from the definition.                                                                           |
| `launch.initialPrompt`         | `{ "mode": "argument", "args": ["-i", "{prompt}"] }` to pass the first instruction while keeping the CLI interactive, or `{ "mode": "paste" }` to paste after startup. Only choose `paste` for a CLI confirmed to enable bracketed paste in its input field.                                                                                         | Paste the first instruction when the CLI enables bracketed paste.                                                    |
| `launch.instructionFile`       | Arguments to pass a Team instruction file, such as `["--append-system-prompt-file", "{instructionFile}"]`.                                                                                                                                                                                                                                           | Send an instruction to read the file as the first prompt.                                                            |
| `launch.directories`           | Arguments such as `["--add-dir", "{directory}"]` to allow the folders used by Team communication and delivery; repeated for separate folders.                                                                                                                                                                                                        | Leave folder access to the CLI's own permissions.                                                                    |
| `launch.managedArguments`      | Arguments to remove from user startup arguments when a Team role supplies the same setting. Each entry has `names`; default is one following value, `arity: "none"` takes none, `"many"` takes all following values. `keys` selects settings for options such as `-c` (`.*` matches a prefix); `alsoRemove` lists related arguments to remove too.   | No overlapping arguments removed by the definition.                                                                  |
| `resume`                       | `{ "args": ["--resume", "{sessionId}"] }`; the conversation ID comes from a hook or plugin message.                                                                                                                                                                                                                                                  | No resume arguments from the definition.                                                                             |
| `hooks`                        | One of the four formats below to report response states and, where available, Attention.                                                                                                                                                                                                                                                             | No state reporting from the definition.                                                                              |
| `tokens`                       | `{ "script": "tokens.mjs" }`, or `{ "command": { "args": ["example", "tokens", "--json"] } }`, with the input/output described below.                                                                                                                                                                                                                | No Tokens reader from the definition. A plugin can still send Tokens.                                                |
| `usage`                        | `{ "script": "usage.mjs" }`, or a `command` with the same form as `tokens`.                                                                                                                                                                                                                                                                          | No Usage reader from the definition.                                                                                 |
| `unavailable` within a feature | `true` inside `hooks`, `resume`, `tokens`, or `usage`, for example `"usage": { "unavailable": true }`, to mark it **Unavailable**.                                                                                                                                                                                                                   | An absent feature is **Not defined**, unless built-in support or a plugin provides it.                               |

iori fills `{model}`, `{effort}`, `{prompt}`, `{sessionId}`, `{instructionFile}`, and `{directory}` when starting the CLI. Arguments for an unselected value are not added. Team launch arguments follow the order of fields in `launch`. Write each argument as a separate array element: these elements are quoted individually, without shell expansion. A `shell` command line and user-entered startup arguments follow the shell's rules instead.

For settings paths and plugin destinations, use `~`, an absolute path, or an environment-based path such as `{ "env": "EXAMPLE_HOME", "default": "~/.example", "path": "settings.json" }`. The environment variable overrides the default folder. This notation works on Windows too. Attached script, plugin, and icon filenames must stay inside the definition folder; absolute paths and `..` are not allowed for those files.

## Report response states with hooks

A hook is a command the CLI calls when an event occurs, such as submitting a prompt or finishing a response. Use the CLI's own event and payload field names. The following are small, complete definitions illustrating the four formats, based on bundled definitions. They only describe the features shown; use the full bundled definitions for their other settings.

### `claude-settings`: Claude-style hook settings

Use this when the CLI stores hooks under `hooks`, with an array of command hooks for each event, as Qoder does. iori supplies the command entry, including `matcher: "*"` for tool events and `PermissionRequest`.

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

### `events`: arrays grouped by event name

Use this when each event has its own array but its location or command entry differs from the Claude-style form. This VT Code example adds entries under `hooks.lifecycle.<event>` in TOML:

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

### `list`: one array with an event field in each entry

Use this when all hooks share an array and each entry names its event. Kiro supports a separate file for iori's hooks. `own: true` marks that file, and `base` supplies its other required fields:

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

For these three formats, `file` points to user-wide settings, not project settings. The extension selects JSON, TOML, or YAML (`.json`, `.toml`, `.yaml`, `.yml`). `at` is a dot-separated location; `entry` contains `{command}` and, where needed, `{event}`. iori replaces these with its hook command and the event name. An unknown format, unsupported file extension, or entry without `{command}` leaves state reporting unavailable from that definition.

`rules` are checked in order; the first matching rule wins. `when` matches payload fields, including negation such as `"when": { "source": { "not": "compact" } }`; `ignore: true` discards the event. Unmatched events are ignored. Available states are `active` (working), `waiting` (waiting for input), `done` (response finished), `stopped` (CLI exited), and `idle` (ready). Add `attention: "approval"` or `"question"` to identify what is waiting. If the CLI does not report approvals, iori cannot infer them.

Use `sessionId`, `transcript`, and `toolId` in `hooks` for the payload fields holding a conversation ID, transcript path, and tool call ID. In a rule, `tool` and `response` name payload fields for a tool name and response text; `toolFinished: true` marks a tool call as finished. For failure, set `outcome: "failure"` and `failure` to a field name or an ordered array of field names; iori uses the first with a value.

### `plugin-file`: a plugin inside the CLI

Use this when the CLI provides a plugin API instead of command hooks. A small bridge plugin must translate the CLI's events into iori messages. This omp example uses the bundled [iori-bridge.js](../apps/host/src/cli/omp/iori-bridge.js), which must accompany the definition:

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

`copy` names a file inside the definition folder. Use `install.args` if the CLI can load a plugin with launch arguments; it must contain `{plugin}`, which iori replaces with the copied plugin's path in `~/.iori/hooks/<id>/`. Otherwise, use `install.to` instead of `install.args`, for example `"to": "~/.config/amp/plugins/"` for Amp. iori copies the file into that directory. Choose exactly one loading method, and write the plugin for that CLI’s plugin API; an omp plugin will not work in Amp.

The plugin reports response states. `sends` lists any additional features it provides: `attention` for questions and approvals, and `tokens` for cumulative conversation Tokens. Omit these names if the plugin does not send them.

### The common message format

A bridge plugin sends JSON by HTTP POST to the URL in `IORI_CLI_HOOK_URL`. Do nothing when this variable is absent, so the plugin also works when the CLI is started outside iori. For example, a completed omp response can send:

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

Use the definition's `id` for `iori_cli`; messages naming a different CLI are ignored. The states have the same meanings as in `rules`. Optional fields are `sessionId`, `transcript` (transcript path), `response`, `model`, `attention` (such as `{ "kind": "approval", "tool": "shell" }`), `outcome: "failure"` with `failure` text, and `tokens`. Use only fields the CLI actually supplies. Unknown fields are ignored. Tokens are cumulative for the conversation, not just the last response; a `tokens` script takes precedence over plugin counts.

## Read Tokens and Usage with scripts

Tokens scripts read a conversation's recorded token counts. Usage scripts read the remaining account or model allowance. **Values from CLIs that are not officially supported are reference values; iori does not guarantee their accuracy.**

Write JavaScript `.mjs` files, preferably using only Node.js built-in modules. iori runs them with the Host's bundled Node.js. Read one JSON object from standard input and write one JSON object to standard output. If a value cannot be read, write nothing; iori leaves the value absent. Keep diagnostic text off standard output.

Place the scripts alongside `definition.json`. For example, this definition requires `tokens.mjs` and `usage.mjs`:

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

### Tokens script

Input contains any available conversation ID, transcript path, and working folder; missing values are omitted:

```json
{
  "sessionId": "example-session",
  "transcript": "/path/to/conversation.json",
  "cwd": "/path/to/project"
}
```

Read the CLI's recorded counts, or call its own usage command. Return conversation totals, with `input` and `output` required:

```json
{
  "input": 1200,
  "output": 300,
  "cacheRead": 800,
  "cacheWrite": 100,
  "reasoning": 40
}
```

Only include optional counts that the CLI records. Do not replace missing counts with zero or estimate Tokens from character counts. If no transcript path is supplied, the script can locate the conversation using `sessionId`.

For a CLI whose transcript is a JSON object with cumulative counts in `usage`, a `tokens.mjs` can look like this. Adapt the reading step to the CLI's real transcript format:

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

iori reads Tokens at Team delegation milestones and when collecting Board totals.

### Usage script

Input is an empty JSON object, `{}`. Call the CLI's allowance command, parse its response, and return the windows it reports:

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

`remaining` is a percentage from 0 to 100; `minutes` is the window length. `resetsAt` is the reset time in milliseconds since the Unix epoch and can be omitted. `name` and `modelPatterns` can be omitted; use them to distinguish named allowances or model groups. Return only windows actually read. A command used here must not start login or make a model request. iori refreshes Usage after responses, at reset times, and when opening the relevant screen.

Instead of `script`, either feature can use `command` with `args`, whose first element is the executable, followed by separate arguments. It uses the same JSON input and output; shell expansion is not performed. Ensure any extra tools are installed on the Host. Scripts and commands use the user's login environment; Windows uses the system and user environment variables. They run as separate processes and do not receive iori's stored device keys, Forge tokens, or Team secrets.

## Remove what the definition added

When you delete a definition through **AI Agents**, iori removes the hooks and plugin files it recorded as having installed for that definition. Editing a definition or reverting to a bundled one also removes its old entries if their destination changes. Removing the Host removes its recorded additions too.

Other hooks, CLI settings, conversations, and running Terminals are preserved. For an iori-only settings file, iori removes the whole file only if it still contains just iori's content; otherwise it removes its own entries. It does not overwrite an existing plugin file of the same name that it did not install. Use the app's delete or revert action to clean up the settings as well as the definition folder.

## Before adding someone else's definition

Read both the JSON and its attached scripts or plugins. Launch commands, model-list commands, Tokens and Usage scripts or commands, hook commands, and plugins can run with the Host user's permissions. They can access that user's files and network. A definition can also direct iori to change CLI settings or copy a plugin. Review the actions shown before saving; use definitions and attached files you trust.
