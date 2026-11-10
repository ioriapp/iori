import { createHash } from "node:crypto";
import type { CliDefinitionSummary, CliSimpleDefinition } from "@iori/protocol";
import type { ShellDefinition } from "../terminal/platform.ts";
import {
  attachedFiles,
  definitionPath,
  type DefinitionFile,
  type DefinitionScript,
} from "./definition-file.ts";
import { hooksTarget } from "./definition-hooks.ts";
import { quoteShell } from "./shell-command.ts";

/** The folder name of a definition made from a name: lowercase letters,
 * digits and `-`. A name without them keeps a name of its own. */
export function idFromName(name: string): string {
  const id = name
    .normalize("NFKD")
    .toLowerCase()
    .replace(/[^a-z0-9]+/gu, "-")
    .replace(/^-+|-+$/gu, "");
  return (
    id || `cli-${createHash("sha256").update(name).digest("hex").slice(0, 8)}`
  );
}

/** The minimal definition of the name and command fields
 * (cli-definitions.md「CLIを追加」). The command lines are read by the
 * shell; the model argument is filled word by word. Items written by hand
 * in `previous` are kept. */
export function simpleDefinition(
  simple: CliSimpleDefinition,
  id: string,
  previous: Record<string, unknown> = {},
): Record<string, unknown> {
  const { launch, models: _models, ...rest } = previous;
  const items =
    launch && typeof launch === "object" && !Array.isArray(launch)
      ? { ...(launch as Record<string, unknown>) }
      : {};
  const model = simple.modelArgument.split(/\s+/u).filter(Boolean);
  if (model.length) items.model = model;
  else delete items.model;
  const models = simple.modelCommand
    ? { list: { shell: simple.modelCommand, format: "lines" } }
    : simple.models?.length
      ? { candidates: simple.models }
      : undefined;
  return {
    schema: 1,
    ...rest,
    id,
    name: simple.name,
    command: { shell: simple.command },
    ...(Object.keys(items).length ? { launch: items } : {}),
    ...(models ? { models } : {}),
  };
}

/** The name and command fields of a definition made from them. */
export function simpleFields(
  file: DefinitionFile,
): CliSimpleDefinition | undefined {
  if (!file.shell) return undefined;
  const models = file.models;
  return {
    name: file.name,
    command: file.command,
    modelArgument: (file.launch.model ?? []).join(" "),
    ...(models && "shell" in models ? { modelCommand: models.shell } : {}),
    ...(models && "candidates" in models
      ? { models: models.candidates.map((model) => model.name) }
      : {}),
  };
}

const plain = /^[\w@%+=:,./{}-]+$/u;
function commandLine(
  file: DefinitionFile,
  shell: ShellDefinition,
  args: readonly string[] = [],
): string {
  return [
    file.shell ? file.command : quote(file.command, shell),
    ...args.map((arg) => quote(arg, shell)),
  ].join(" ");
}
const quote = (word: string, shell: ShellDefinition) =>
  plain.test(word) ? word : quoteShell(word, shell);
/** How a token or usage script runs on this Host: the Host's own Node, or the
 * words of a command (cli-definitions.md「確認」). */
function scriptLine(script: DefinitionScript, shell: ShellDefinition): string {
  return "script" in script
    ? `node ${quote(script.script, shell)}`
    : script.args.map((word) => quote(word, shell)).join(" ");
}

/** What this Host runs and changes for a definition, shown before it is
 * saved. `hooksFile`: whether this Host writes the definition's hooks. */
export function definitionEffects(
  file: DefinitionFile,
  shell: ShellDefinition,
  home: string,
  hooksFile: boolean,
  available: string[] = [],
): Pick<
  CliDefinitionSummary,
  "commands" | "settings" | "files" | "missingFiles"
> {
  const models = file.models;
  const hooks = file.hooks && hooksFile ? file.hooks : undefined;
  const hooksPath = hooks && hooksTarget(hooks, home, file.id);
  const missingFiles = attachedFiles(file).filter(
    (name) => !available.includes(name),
  );
  return {
    commands: [
      ...(file.shell
        ? [{ kind: "launch" as const, line: commandLine(file, shell) }]
        : []),
      ...(models && "shell" in models
        ? [{ kind: "models" as const, line: models.shell }]
        : []),
      ...(file.tokens
        ? [{ kind: "tokens" as const, line: scriptLine(file.tokens, shell) }]
        : []),
      ...(file.usage
        ? [{ kind: "usage" as const, line: scriptLine(file.usage, shell) }]
        : []),
    ],
    settings:
      hooksPath && hooks && hooks.format !== "plugin-file"
        ? [
            hooksPath,
            ...(hooks.link ? [definitionPath(hooks.link.file, home)] : []),
          ]
        : [],
    files: hooksPath && hooks?.format === "plugin-file" ? [hooksPath] : [],
    missingFiles,
  };
}
