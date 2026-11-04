import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import * as TOML from "@decimalturn/toml-patch";
import { parse as parseYaml } from "yaml";
import { readDefinitionText } from "./definitions.ts";
import {
  claudeSettingsTarget,
  definitionTarget,
  type HookTarget,
} from "./definition-hooks.ts";
import {
  editHookDocument,
  emptyHookDocument,
  ownHookDocument,
  ownHookFile,
  type HookSyntax,
} from "./hook-documents.ts";

/** A bundled definition's hooks file and the place of its items. */
function bundled(id: string): HookTarget {
  const read = readDefinitionText(
    readFileSync(new URL(`./${id}/definition.json`, import.meta.url), "utf8"),
    id,
  );
  assert.ok("definition" in read && read.definition.hooks);
  const hooks = read.definition.hooks;
  assert.ok(hooks.format !== "plugin-file");
  return definitionTarget(hooks, "/home/user");
}
const command = (owner: string, event: string, node = "/usr/bin/node") =>
  `'${node}' '/home/user/.iori/hooks/iori-cli-hook.mjs' '${event}' '' '${owner}'`;
const items = (owner: string, events: readonly string[], node?: string) =>
  events.map((event) => ({ event, command: command(owner, event, node) }));
const parsed = (text: string, syntax: HookSyntax): unknown =>
  syntax === "json"
    ? JSON.parse(text || "{}")
    : syntax === "toml"
      ? TOML.parse(text)
      : (parseYaml(text) ?? {});
/** Every string in a parsed file, to find the commands in it. */
const strings = (value: unknown): string[] =>
  typeof value === "string"
    ? [value]
    : value && typeof value === "object"
      ? Object.values(value).flatMap(strings)
      : [];
/** Whether `text` holds every character of `original` in order: nothing
 * of the original was removed or changed, only added to. */
function onlyAdded(original: string, text: string): boolean {
  let index = 0;
  for (const char of text) if (char === original[index]) index++;
  return index === original.length;
}

/** The original bytes again. A file that iori made from nothing is empty
 * again, and iori removes the file it made (hook-config.ts). */
function restored(text: string, original: string, syntax: HookSyntax) {
  if (original) assert.equal(text, original);
  else assert.ok(emptyHookDocument(text, syntax), text);
}
/** (a) Adding changes only iori's part, (b) removing gives the original
 * bytes back, (c) the user's hooks and another definition's items in the
 * same file stay when one definition's items go, and (d) what the user
 * writes after iori's items stays when iori's items go or change. */
function check(
  original: string,
  { syntax, place }: HookTarget,
  events: readonly string[],
  later?: string,
) {
  const userCommands = strings(parsed(original, syntax));
  const added = editHookDocument(
    original,
    syntax,
    "first-cli",
    place,
    items("first-cli", events),
  );
  assert.ok(onlyAdded(original, added), added);
  assert.deepEqual(
    strings(parsed(added, syntax)).filter((value) =>
      value.includes("'first-cli'"),
    ),
    events.map((event) => command("first-cli", event)),
  );
  // Adding again changes nothing.
  assert.equal(
    editHookDocument(
      added,
      syntax,
      "first-cli",
      place,
      items("first-cli", events),
    ),
    added,
  );
  restored(editHookDocument(added, syntax, "first-cli"), original, syntax);

  const both = editHookDocument(
    added,
    syntax,
    "other-cli",
    place,
    items("other-cli", events),
  );
  const other = editHookDocument(both, syntax, "first-cli");
  const left = strings(parsed(other, syntax));
  for (const value of userCommands) assert.ok(left.includes(value), value);
  for (const event of events)
    assert.ok(left.includes(command("other-cli", event)), event);
  assert.ok(!left.some((value) => value.includes("'first-cli'")));
  restored(editHookDocument(other, syntax, "other-cli"), original, syntax);

  if (later === undefined) return;
  const newline = original.includes("\r\n") ? "\r\n" : "\n";
  const extended =
    added +
    (added && !added.endsWith("\n") ? newline : "") +
    later.replaceAll("\n", newline);
  // A Host update changes the node in iori's command.
  const changed = editHookDocument(
    extended,
    syntax,
    "first-cli",
    place,
    items("first-cli", events, "/opt/iori-host/node"),
  );
  for (const text of [
    editHookDocument(extended, syntax, "first-cli"),
    changed,
    editHookDocument(changed, syntax, "first-cli"),
  ]) {
    const lines = text.split(/\r?\n/u);
    for (const line of later.split("\n").filter(Boolean))
      assert.ok(lines.includes(line), text);
  }
}

// https://www.kimi.com/code/docs/en/kimi-code-cli/customization/hooks.html
const kimiConfig = `# Written in ~/.kimi-code/config.toml
default_model = "kimi-k2"

[[hooks]]
event = "Notification"           # Trigger: when a background task status changes
matcher = "task\\\\.completed"     # Only care about "completed" notifications
command = "terminal-notifier -title Kimi -message 'Task done'"

[[hooks]]
event = "PreToolUse"
matcher = "Bash"
command = "node ~/.kimi-code/hooks/block-dangerous-bash.mjs"
timeout = 5
`;
// https://docs.mistral.ai/vibe/code/cli/hooks
const vibeHooks = `[[hooks]]
name = "deny-rm-rf"
type = "pre_tool"
match = "re:bash|process_start"
command = "python ./.vibe/hooks/guard-bash.py"
strict = true
description = "Reject rm -rf and other destructive shell commands."
`;
// https://github.com/vinhnx/VTCode/blob/main/docs/guides/lifecycle-hooks.md
const vtCodeHooks = `[agent]
provider = "openai" # the provider

[hooks.lifecycle]
# Session start hook that applies to all triggers (startup, resume, clear, compact)
session_start = [
  { hooks = [ { command = "./scripts/setup.sh" } ] }
]

# Pre-tool hook scoped to all Bash commands
pre_tool_use = [
  {
    matcher = "Bash",
    hooks = [
      { command = "./scripts/check-bash-syntax.sh", timeout_seconds = 10 }
    ]
  }
]
`;
// https://github.com/vinhnx/VTCode/blob/main/docs/guides/hooks-guide.md
const vtCodeGuide = `[hooks.lifecycle]
# Pre-tool use hooks - Run before tools execute
[[hooks.lifecycle.pre_tool_use]]
matcher = "Bash"  # Match specific tools using regex
hooks = [
  { command = "$VT_PROJECT_DIR/.vtcode/hooks/bash-validator.sh", timeout_seconds = 30 }
]

# Session start hooks - Run when a session begins
[[hooks.lifecycle.session_start]]
hooks = [
  { command = "$VT_PROJECT_DIR/.vtcode/hooks/session-setup.sh" }
]

# Stop hooks - Run when the agent is about to finish a turn
[[hooks.lifecycle.stop]]
hooks = [
  { command = "$VT_PROJECT_DIR/.vtcode/hooks/keep-going.sh" }
]
`;

// The user's comment and table right after iori's last key.
const tomlLater = '# my MCP servers\n[mcp]\nurl = "http://localhost:8080"\n';

test("TOMLの公式の設定例に足すと元の文字を変えずにioriの項目だけが加わり、消すと元のバイト列に戻り、利用者のhookと他の定義の項目と、ioriの項目の後に書き足した利用者のコメントと区画が残る", () => {
  const kimi = bundled("kimi-code");
  const kimiWithoutHooks = kimiConfig.slice(0, kimiConfig.indexOf("\n\n") + 1);
  for (const original of [
    kimiConfig,
    // A file that has no newline at its end, and one with CRLF.
    kimiConfig.trimEnd(),
    kimiConfig.replaceAll("\n", "\r\n"),
    `${kimiConfig}\n\n`,
    // The same without \`[[hooks]]\`: iori's table goes after the last line.
    kimiWithoutHooks,
    kimiWithoutHooks.trimEnd(),
    kimiWithoutHooks.replaceAll("\n", "\r\n"),
    // An empty file, and a missing file, which is read as one.
    "",
  ])
    check(original, kimi, ["SessionStart", "Stop"], tomlLater);
  check(vibeHooks, bundled("vibe"), ["pre_tool", "post_agent"], tomlLater);
  const vtCode = bundled("vtcode");
  for (const original of [
    vtCodeHooks,
    // Arrays of tables: iori's item is a block with a block in it.
    vtCodeGuide,
    // The guide's section that holds only a comment.
    '[agent]\nprovider = "openai"\n\n[hooks.lifecycle]\n# Add your hooks here\n',
    '[agent]\nprovider = "openai"\n',
  ])
    check(original, vtCode, ["session_start", "stop"], tomlLater);
});

// https://github.com/NousResearch/hermes-agent/blob/main/cli-config.yaml.example
const hermesConfig = `# Hermes Agent CLI Configuration
# Copy settings from this example into ~/.hermes/config.yaml, or use
# \`hermes config set <section.key> <value>\` to update the active profile.

_config_version: 51

database:
  journal_mode: "wal"  # Supported values: "wal", "delete"
  # Optional WAL sizing pragmas (integers). Unset = SQLite defaults.
  # wal_autocheckpoint: 1000     # pages between automatic checkpoints

# =============================================================================
# Runtime Limits
# =============================================================================
runtime:
  nofile_soft_limit: 4096

# =============================================================================
# Shell-script hooks
# =============================================================================
# hooks:
#   pre_tool_call:
#     - matcher: "terminal"
#       command: "~/.hermes/agent-hooks/block-rm-rf.sh"
#       timeout: 10
#
# hooks_auto_accept: false
`;
const hermesHooks = `${hermesConfig}
hooks:
  pre_tool_call:
    - matcher: "terminal"
      command: "~/.hermes/agent-hooks/block-rm-rf.sh"
      timeout: 10
  # Format what the agent writes.
  post_tool_call:
    - matcher: "write_file|patch"
      command: "~/.hermes/agent-hooks/auto-format.sh"
  subagent_stop:
    - command: "~/.hermes/agent-hooks/log-orchestration.sh"
`;

test("YAMLの公式の設定例に足すと元の文字を変えずにioriの項目だけが加わり、消すと元のバイト列に戻り、利用者のhookと他の定義の項目と、ioriの項目の後に書き足した利用者のコメントと区画が残る", () => {
  const hermes = bundled("hermes");
  for (const original of [
    hermesConfig,
    hermesHooks,
    hermesHooks.trimEnd(),
    hermesHooks.replaceAll("\n", "\r\n"),
    "",
  ])
    check(
      original,
      hermes,
      ["pre_tool_call", "on_session_end"],
      "# my display settings\ndisplay:\n  interface: tui\n",
    );
});

// https://code.claude.com/docs/en/hooks
const claudeSettings = `{
  "permissions": {
    "allow": [
      "Bash(npm run lint)"
    ]
  },
  "hooks": {
    "PreToolUse": [
      {
        "matcher": "Bash",
        "hooks": [
          {
            "type": "command",
            "command": "/path/to/script.sh"
          }
        ]
      }
    ]
  }
}
`;

test("2スペースのJSONの公式の設定例に足すと元の文字を変えずにioriの項目だけが加わり、消すと元のバイト列に戻り、利用者のhookと他の定義の項目が残り、ioriのファイルとするのはbaseとioriの項目だけのファイルに限る", () => {
  const claude = claudeSettingsTarget("/home/user/.qoder/settings.json");
  for (const original of [claudeSettings, ""])
    check(original, claude, ["PreToolUse", "Stop"]);
  // iori's own file is written and removed only when it holds nothing but
  // \`base\` and iori's items (cli-definitions.md「上書きしない」).
  const kiro = bundled("kiro");
  const base = kiro.own!;
  const own = ownHookDocument(
    "json",
    base,
    kiro.place,
    items("kiro", ["Stop"]),
  );
  assert.equal(ownHookFile(own, "json", "kiro", base), true);
  assert.equal(ownHookFile("", "json", "kiro", base), true);
  for (const user of [
    '{\n  "theme": "dark"\n}\n',
    '{\n  "version": "v1",\n  "theme": "dark"\n}\n',
    own.replace('"version": "v1"', '"version": "v1",\n  "theme": "dark"'),
  ])
    assert.equal(ownHookFile(user, "json", "kiro", base), false, user);
});
