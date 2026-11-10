import { isAbsolute, join, posix, win32 } from "node:path";
import type { CliDefinitionReason } from "@iori/protocol";
import type { ManagedTeamArgument } from "./team-startup-arguments.ts";
import { hookSyntax, type HookSyntax } from "./hook-documents.ts";

/** `~`, an absolute path, or a variable that replaces a default directory,
 * with an optional path inside that directory (docs/design/cli-definitions.md). */
export type DefinitionPath =
  string | { env: string; default: string; path?: string };
export interface DefinitionModel {
  name: string;
  label?: string;
  efforts?: string[];
}
type Primitive = string | number | boolean | null;
/** The first rule matching an event decides the state it maps to. */
export interface DefinitionRule {
  event: string;
  when: Record<string, { value: Primitive; not: boolean }>;
  ignore?: boolean;
  state?: "active" | "waiting" | "done" | "stopped" | "idle";
  attention?: "approval" | "question";
  tool?: string;
  response?: string;
  outcome?: "failure";
  failure?: string[];
  toolFinished?: boolean;
}
/** The hooks that this Host writes into a CLI's settings
 * (cli-definitions.md「hooks」). */
export interface DefinitionFileHooks {
  /** `claude-settings` is `events` at `hooks` with Claude Code's item. */
  format: "events" | "list" | "claude-settings";
  file: DefinitionPath;
  /** Read from the extension of `file`. */
  syntax: HookSyntax;
  /** iori's own file: what it holds besides iori's items (`base`). */
  own?: Record<string, unknown>;
  link?: {
    file: DefinitionPath;
    base: Record<string, unknown>;
    set: Record<string, unknown>;
  };
  /** The keys from the top of the file to the table or array. */
  at: string[];
  /** The item of one event, with `{event}` and `{command}` to fill. */
  entry?: Record<string, unknown>;
  sessionId?: string;
  transcript?: string;
  toolId?: string;
  rules: DefinitionRule[];
}
/** What a plugin-file bridge sends besides the state
 * (cli-definitions.md「プラグインだけを持つ CLI」). */
export type PluginSend = "attention" | "tokens";
/** A CLI that only has a plugin: the bridge file this Host copies and loads
 * through a folder or arguments (cli-definitions.md「プラグインだけを持つ CLI」). */
export interface DefinitionPluginHooks {
  format: "plugin-file";
  install: { copy: string } & ({ to: DefinitionPath } | { args: string[] });
  /** The features that the bridge sends in the common shape. */
  sends: PluginSend[];
}
export type DefinitionHooks = DefinitionFileHooks | DefinitionPluginHooks;
/** A definition's own script or command that reads its tokens or usage
 * (cli-definitions.md「トークン量と利用枠のスクリプト」). */
export type DefinitionScript = { script: string } | { args: readonly string[] };
const launchItems = [
  "model",
  "effort",
  "permissions",
  "instructionFile",
  "directories",
  "initialPrompt",
] as const;
export type LaunchItem = (typeof launchItems)[number];
/** The arguments of `command` that list models, or a command line of its
 * own when `command` is one (`shell`). */
type ModelList = { list: string[] } | { shell: string };
/** Items that a definition marks as having no means in this CLI. */
export type UnavailableItem = "hooks" | "resume" | "tokens" | "usage";
export interface DefinitionFile {
  id: string;
  name: string;
  /** A command name found on the PATH or, with `shell`, a command line that
   * the shell reads, as one made from the name and command fields. */
  command: string;
  shell?: true;
  aliases: string[];
  icon?: { light: string; dark?: string };
  version?: string[];
  models?:
    | (ModelList & { format: "lines" })
    | (ModelList & {
        format: "json";
        items: string;
        name: string;
        label?: string;
        efforts?: string;
      })
    | { candidates: DefinitionModel[] };
  launch: {
    /** Arguments follow the order of the items written in `launch`. */
    order: LaunchItem[];
    model?: string[];
    effort?: string[];
    permissions: Record<string, string[]>;
    instructionFile?: string[];
    directories?: string[];
    initialPrompt?: { mode: "argument"; args: string[] } | { mode: "paste" };
    managedArguments: ManagedTeamArgument[];
  };
  resume?: string[];
  /** Hook formats this Host does not write leave the CLI unobserved. */
  hooks?: DefinitionHooks;
  tokens?: DefinitionScript;
  usage?: DefinitionScript;
  unavailable: UnavailableItem[];
}

const types = {
  object: "an object",
  string: "a non-empty string",
  strings: "an array of strings",
  array: "an array",
  boolean: "true or false",
  value: "a string, number, boolean or null",
};
/** The reason in English, as the Host's log keeps it. */
export function reasonText(reason: CliDefinitionReason): string {
  const values = (items: string[]) =>
    items.length > 2
      ? `one of ${items.join(", ")}`
      : items.map((item) => `"${item}"`).join(" or ");
  switch (reason.kind) {
    case "json":
      return "definition.json is not valid JSON";
    case "unreadable":
      return "definition.json cannot be read";
    case "missing":
      return `${reason.field} is required`;
    case "type":
      return `${reason.field} must be ${types[reason.type]}`;
    case "values":
      return `${reason.field} must be ${values(reason.values)}`;
    case "id":
      return "id must use only lowercase letters, digits and -";
    case "folder":
      return `id must match the folder name ${reason.folder}`;
    case "inside":
      return `${reason.field} must stay inside the definition folder`;
    case "path":
      return `${reason.field} must start with ~ or be an absolute path`;
  }
}
class DefinitionError extends Error {
  readonly reason: CliDefinitionReason;
  constructor(reason: CliDefinitionReason) {
    super(reasonText(reason));
    this.reason = reason;
  }
}
function fail(reason: CliDefinitionReason): never {
  throw new DefinitionError(reason);
}
function expect(
  value: unknown,
  field: string,
  type: keyof typeof types,
): never {
  fail(
    value === undefined
      ? { kind: "missing", field }
      : { kind: "type", field, type },
  );
}
function fields(value: unknown, field: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value))
    expect(value, field, "object");
  return value as Record<string, unknown>;
}
function name(value: unknown, field: string): string {
  if (typeof value !== "string") expect(value, field, "string");
  // A blank value is not written, as an empty field is not.
  if (!value.trim()) fail({ kind: "missing", field });
  return value;
}
function words(value: unknown, field: string): string[] {
  if (!Array.isArray(value) || !value.every((word) => typeof word === "string"))
    expect(value, field, "strings");
  return value as string[];
}
function flag(value: unknown, field: string): boolean {
  if (typeof value !== "boolean") expect(value, field, "boolean");
  return value;
}
/** A feature this CLI has no means for is read as absent. */
function available(value: unknown, field: string) {
  const input = fields(value, field);
  return input.unavailable === true ? undefined : input;
}
function argumentsOf(value: unknown, field: string): string[] {
  return words(fields(value, field).args, `${field}.args`);
}
function fixedPath(value: unknown, field: string): string {
  const path = name(value, field);
  if (path !== "~" && !/^~[\\/]/u.test(path) && !isAbsolute(path))
    fail({ kind: "path", field });
  return path;
}
function path(value: unknown, field: string): DefinitionPath {
  if (typeof value === "string") return fixedPath(value, field);
  const input = fields(value, field);
  return {
    env: name(input.env, `${field}.env`),
    default: fixedPath(input.default, `${field}.default`),
    ...(input.path === undefined
      ? {}
      : { path: name(input.path, `${field}.path`) }),
  };
}
/** Files that come with a definition stay inside its folder. */
export function attached(value: unknown, field: string): void {
  const file = name(value, field);
  if (
    posix.isAbsolute(file) ||
    win32.isAbsolute(file) ||
    /^[A-Za-z]:/u.test(file) ||
    file.split(/[\\/]/u).includes("..")
  )
    fail({ kind: "inside", field });
}
function managed(value: unknown, field: string): ManagedTeamArgument {
  const input = fields(value, field);
  const names = words(input.names, `${field}.names`);
  if (
    input.arity !== undefined &&
    input.arity !== "none" &&
    input.arity !== "many"
  )
    fail({ kind: "values", field: `${field}.arity`, values: ["none", "many"] });
  return {
    names,
    ...(input.arity === undefined
      ? {}
      : { arity: input.arity as "none" | "many" }),
    ...(input.keys === undefined
      ? {}
      : { keys: words(input.keys, `${field}.keys`) }),
    ...(input.alsoRemove === undefined
      ? {}
      : {
          alsoRemove: list(input.alsoRemove, `${field}.alsoRemove`).map(
            (item, index) => managed(item, `${field}.alsoRemove[${index}]`),
          ),
        }),
  };
}
function list(value: unknown, field: string): unknown[] {
  if (!Array.isArray(value)) expect(value, field, "array");
  return value;
}
function primitive(value: unknown, field: string): Primitive {
  if (value !== null && !["string", "number", "boolean"].includes(typeof value))
    expect(value, field, "value");
  return value as Primitive;
}
const states = ["active", "waiting", "done", "stopped", "idle"];
function rule(value: unknown, field: string): DefinitionRule {
  const input = fields(value, field);
  // Built as own entries: payload field names come from outside iori.
  const when: DefinitionRule["when"] = Object.fromEntries(
    Object.entries(
      input.when === undefined ? {} : fields(input.when, `${field}.when`),
    ).map(([key, expected]) => [
      key,
      expected && typeof expected === "object" && !Array.isArray(expected)
        ? {
            value: primitive(
              fields(expected, `${field}.when.${key}`).not,
              `${field}.when.${key}.not`,
            ),
            not: true,
          }
        : { value: primitive(expected, `${field}.when.${key}`), not: false },
    ]),
  );
  if (input.state !== undefined && !states.includes(input.state as string))
    fail({ kind: "values", field: `${field}.state`, values: states });
  if (
    input.attention !== undefined &&
    input.attention !== "approval" &&
    input.attention !== "question"
  )
    fail({
      kind: "values",
      field: `${field}.attention`,
      values: ["approval", "question"],
    });
  if (input.outcome !== undefined && input.outcome !== "failure")
    fail({ kind: "values", field: `${field}.outcome`, values: ["failure"] });
  const failure =
    input.failure === undefined
      ? undefined
      : typeof input.failure === "string"
        ? [input.failure]
        : words(input.failure, `${field}.failure`);
  return {
    event: name(input.event, `${field}.event`),
    when,
    ...(input.ignore === undefined
      ? {}
      : { ignore: flag(input.ignore, `${field}.ignore`) }),
    ...(input.state === undefined
      ? {}
      : { state: input.state as DefinitionRule["state"] }),
    ...(input.attention === undefined
      ? {}
      : { attention: input.attention as DefinitionRule["attention"] }),
    ...(input.tool === undefined
      ? {}
      : { tool: name(input.tool, `${field}.tool`) }),
    ...(input.response === undefined
      ? {}
      : { response: name(input.response, `${field}.response`) }),
    ...(input.outcome === undefined ? {} : { outcome: "failure" as const }),
    ...(failure ? { failure } : {}),
    ...(input.toolFinished === undefined
      ? {}
      : { toolFinished: flag(input.toolFinished, `${field}.toolFinished`) }),
  };
}
const hookFormats = ["events", "list", "claude-settings"] as const;
/** The keys of a dotted place, none of them empty. */
function keys(value: unknown, field: string): string[] {
  const parts = name(value, field).split(".");
  if (parts.some((part) => !part))
    fail({ kind: "type", field, type: "string" });
  return parts;
}
/** Whether `{command}` is in an item: iori finds its items by it. */
const holdsCommand = (value: unknown): boolean =>
  typeof value === "string"
    ? value.includes("{command}")
    : !!value &&
      typeof value === "object" &&
      Object.values(value).some(holdsCommand);
function hooks(value: unknown): DefinitionHooks | undefined {
  const input = available(value, "hooks");
  if (!input) return undefined;
  // A CLI without hooks commands gets a bridge that sends the common shape.
  if (input.format === "plugin-file") {
    const install = fields(input.install, "hooks.install");
    const copy = name(install.copy, "hooks.install.copy");
    attached(copy, "hooks.install.copy");
    if ((install.to === undefined) === (install.args === undefined))
      fail({
        kind: "values",
        field: "hooks.install",
        values: ["copy + to", "copy + args"],
      });
    const args =
      install.args === undefined
        ? undefined
        : words(install.args, "hooks.install.args");
    if (args && !args.some((arg) => arg.includes("{plugin}")))
      fail({
        kind: "values",
        field: "hooks.install.args",
        values: ["an argument containing {plugin}"],
      });
    const sends: PluginSend[] = [];
    for (const [index, item] of list(
      input.sends ?? [],
      "hooks.sends",
    ).entries()) {
      if (item !== "attention" && item !== "tokens")
        fail({
          kind: "values",
          field: `hooks.sends[${index}]`,
          values: ["attention", "tokens"],
        });
      sends.push(item);
    }
    return {
      format: "plugin-file",
      install: {
        copy,
        ...(args ? { args } : { to: path(install.to, "hooks.install.to") }),
      },
      sends,
    };
  }
  const format = hookFormats.find((known) => known === input.format);
  if (!format) return undefined;
  const file = path(input.file, "hooks.file");
  const own = input.own !== undefined && flag(input.own, "hooks.own");
  const base = input.base === undefined ? {} : fields(input.base, "hooks.base");
  let link: DefinitionFileHooks["link"];
  if (input.link !== undefined) {
    if (!own) fail({ kind: "values", field: "hooks.own", values: ["true"] });
    const value = fields(input.link, "hooks.link");
    const set = fields(value.set, "hooks.link.set");
    for (const key of Object.keys(set))
      if (!key || key.includes("."))
        fail({ kind: "type", field: "hooks.link.set", type: "object" });
    link = {
      file: path(value.file, "hooks.link.file"),
      base:
        value.base === undefined ? {} : fields(value.base, "hooks.link.base"),
      set,
    };
  }
  const entry =
    format === "claude-settings"
      ? undefined
      : fields(input.entry, "hooks.entry");
  const optionalName = (key: string) =>
    input[key] === undefined ? {} : { [key]: name(input[key], `hooks.${key}`) };
  const read = {
    format,
    file,
    ...(own ? { own: base } : {}),
    ...(link ? { link } : {}),
    at: format === "claude-settings" ? ["hooks"] : keys(input.at, "hooks.at"),
    ...(entry ? { entry } : {}),
    ...optionalName("sessionId"),
    ...optionalName("transcript"),
    ...optionalName("toolId"),
    rules: list(input.rules, "hooks.rules").map((item, index) =>
      rule(item, `hooks.rules[${index}]`),
    ),
  };
  // A file or an item that this Host cannot write leaves the CLI
  // unobserved, as a format that it does not know does.
  const syntax = hookSyntax(
    typeof file === "string" ? file : (file.path ?? file.default),
  );
  return syntax && (!entry || holdsCommand(entry))
    ? { ...read, syntax }
    : undefined;
}
/** `script` stays inside the definition folder; a command is the words that
 * the shell runs (cli-definitions.md「スクリプトの起動の約束」). */
function script(value: unknown, field: string): DefinitionScript | undefined {
  const input = available(value, field);
  if (!input) return undefined;
  if (input.script !== undefined) {
    attached(input.script, `${field}.script`);
    return { script: name(input.script, `${field}.script`) };
  }
  return input.command === undefined
    ? undefined
    : { args: argumentsOf(input.command, `${field}.command`) };
}
function model(value: unknown, field: string): DefinitionModel {
  if (typeof value === "string") return { name: name(value, field) };
  const input = fields(value, field);
  return {
    name: name(input.name, `${field}.name`),
    ...(input.label === undefined
      ? {}
      : { label: name(input.label, `${field}.label`) }),
    ...(input.efforts === undefined
      ? {}
      : { efforts: words(input.efforts, `${field}.efforts`) }),
  };
}
function models(value: unknown): DefinitionFile["models"] {
  const input = available(value, "models");
  if (!input) return undefined;
  if (input.candidates !== undefined)
    return {
      candidates: list(input.candidates, "models.candidates").map(
        (item, index) => model(item, `models.candidates[${index}]`),
      ),
    };
  const listed = fields(input.list, "models.list");
  const source: ModelList =
    listed.shell === undefined
      ? { list: words(listed.args, "models.list.args") }
      : { shell: name(listed.shell, "models.list.shell") };
  if (listed.format === "lines") return { ...source, format: "lines" };
  if (listed.format !== "json")
    fail({
      kind: "values",
      field: "models.list.format",
      values: ["lines", "json"],
    });
  const optional = (key: string) =>
    listed[key] === undefined
      ? {}
      : { [key]: name(listed[key], `models.list.${key}`) };
  return {
    ...source,
    format: "json",
    items: name(listed.items, "models.list.items"),
    name: name(listed.name, "models.list.name"),
    ...optional("label"),
    ...optional("efforts"),
  };
}
function launch(value: unknown): DefinitionFile["launch"] {
  const input = value === undefined ? {} : fields(value, "launch");
  const optional = (key: string) =>
    input[key] === undefined
      ? {}
      : { [key]: words(input[key], `launch.${key}`) };
  const permissions: Record<string, string[]> = Object.fromEntries(
    Object.entries(
      input.permissions === undefined
        ? {}
        : fields(input.permissions, "launch.permissions"),
    ).map(([mode, args]) => [mode, words(args, `launch.permissions.${mode}`)]),
  );
  let initialPrompt: DefinitionFile["launch"]["initialPrompt"];
  if (input.initialPrompt !== undefined) {
    const prompt = available(input.initialPrompt, "launch.initialPrompt");
    if (prompt?.mode === "argument")
      initialPrompt = {
        mode: "argument",
        args: words(prompt.args, "launch.initialPrompt.args"),
      };
    else if (prompt?.mode === "paste") initialPrompt = { mode: "paste" };
    else if (prompt)
      fail({
        kind: "values",
        field: "launch.initialPrompt.mode",
        values: ["argument", "paste"],
      });
  }
  return {
    order: Object.keys(input).filter((key): key is LaunchItem =>
      (launchItems as readonly string[]).includes(key),
    ),
    ...optional("model"),
    ...optional("effort"),
    permissions,
    ...optional("instructionFile"),
    ...optional("directories"),
    ...(initialPrompt ? { initialPrompt } : {}),
    managedArguments:
      input.managedArguments === undefined
        ? []
        : list(input.managedArguments, "launch.managedArguments").map(
            (item, index) => managed(item, `launch.managedArguments[${index}]`),
          ),
  };
}

/** Read a definition received from outside iori. Unknown items and unknown
 * schema versions are read for what this Host knows; a known item of the
 * wrong shape skips the whole definition, with the reason. */
export function readDefinition(
  value: unknown,
  folder: string,
): { definition: DefinitionFile } | { reason: CliDefinitionReason } {
  try {
    const input = fields(value, "definition");
    const id = name(input.id, "id");
    if (!/^[a-z0-9-]+$/u.test(id)) fail({ kind: "id" });
    if (id !== folder) fail({ kind: "folder", folder });
    const unavailable: UnavailableItem[] = [];
    for (const feature of ["tokens", "usage"] as const) {
      const item = input[feature];
      if (item === undefined) continue;
      const entry = fields(item, feature);
      if (entry.unavailable === true) unavailable.push(feature);
      if (entry.script !== undefined)
        attached(entry.script, `${feature}.script`);
    }
    for (const feature of ["hooks", "resume"] as const)
      if (fields(input[feature] ?? {}, feature).unavailable === true)
        unavailable.push(feature);
    // A command made from the name and command fields is a command line.
    const shell =
      !!input.command &&
      typeof input.command === "object" &&
      !Array.isArray(input.command);
    const command = shell
      ? name(fields(input.command, "command").shell, "command.shell")
      : name(input.command, "command");
    let icon: DefinitionFile["icon"];
    if (input.icon !== undefined) {
      const fieldsOfIcon = fields(input.icon, "icon");
      for (const theme of ["light", "dark"] as const) {
        if (theme === "dark" && fieldsOfIcon.dark === undefined) continue;
        attached(fieldsOfIcon[theme], `icon.${theme}`);
        if (!/\.(svg|png)$/iu.test(name(fieldsOfIcon[theme], `icon.${theme}`)))
          fail({
            kind: "values",
            field: `icon.${theme}`,
            values: ["SVG", "PNG"],
          });
      }
      icon = {
        light: name(fieldsOfIcon.light, "icon.light"),
        ...(fieldsOfIcon.dark === undefined
          ? {}
          : { dark: name(fieldsOfIcon.dark, "icon.dark") }),
      };
    }
    const resume =
      input.resume === undefined
        ? undefined
        : available(input.resume, "resume");
    const definitionHooks =
      input.hooks === undefined ? undefined : hooks(input.hooks);
    const definitionModels =
      input.models === undefined ? undefined : models(input.models);
    const definitionTokens =
      input.tokens === undefined ? undefined : script(input.tokens, "tokens");
    const definitionUsage =
      input.usage === undefined ? undefined : script(input.usage, "usage");
    return {
      definition: {
        id,
        name: name(input.name, "name"),
        command,
        ...(shell ? { shell: true as const } : {}),
        aliases:
          input.aliases === undefined ? [] : words(input.aliases, "aliases"),
        ...(icon ? { icon } : {}),
        ...(input.version === undefined
          ? {}
          : { version: argumentsOf(input.version, "version") }),
        ...(definitionModels ? { models: definitionModels } : {}),
        launch: launch(input.launch),
        ...(resume ? { resume: words(resume.args, "resume.args") } : {}),
        ...(definitionHooks ? { hooks: definitionHooks } : {}),
        ...(definitionTokens ? { tokens: definitionTokens } : {}),
        ...(definitionUsage ? { usage: definitionUsage } : {}),
        unavailable,
      },
    };
  } catch (error) {
    if (error instanceof DefinitionError) return { reason: error.reason };
    throw error;
  }
}

/** Placeholders are filled word by word; no word is read by a shell. */
export function fillArguments(
  args: readonly string[],
  values: Partial<
    Record<
      | "model"
      | "effort"
      | "prompt"
      | "sessionId"
      | "instructionFile"
      | "directory"
      | "plugin",
      string
    >
  >,
): string[] {
  return args.map((arg) =>
    arg.replace(
      /\{(model|effort|prompt|sessionId|instructionFile|directory|plugin)\}/gu,
      (_match, key: keyof typeof values) => values[key] ?? "",
    ),
  );
}

/** The OS path for a definition's path, on Windows as on Linux. */
export function definitionPath(value: DefinitionPath, home: string): string {
  if (typeof value !== "string") {
    const directory =
      process.env[value.env] || definitionPath(value.default, home);
    return value.path ? join(directory, value.path) : directory;
  }
  if (value === "~") return home;
  return /^~[\\/]/u.test(value) ? join(home, value.slice(2)) : value;
}

/** The files that a bundled definition brings with it: its bridge and its
 * scripts (cli-definitions.md「付属のファイル」). */
export function attachedFiles(file: DefinitionFile): string[] {
  return [
    ...new Set([
      ...(file.icon
        ? [file.icon.light, ...(file.icon.dark ? [file.icon.dark] : [])]
        : []),
      ...(file.hooks?.format === "plugin-file"
        ? [file.hooks.install.copy]
        : []),
      ...(file.tokens && "script" in file.tokens ? [file.tokens.script] : []),
      ...(file.usage && "script" in file.usage ? [file.usage.script] : []),
    ]),
  ];
}
