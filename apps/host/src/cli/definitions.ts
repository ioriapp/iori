import { constants, readFileSync } from "node:fs";
import { copyFile, mkdir, readdir, readFile, rm, stat } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import type {
  CliDefinitionFailure,
  CliDefinitionReason,
  CliDefinitionSource,
  CliFeature,
  CliModel,
  CliSummary,
  CliSupport,
} from "@iori/protocol";
import { writeFileAtomic } from "../fs/atomic-write.ts";
import type { CliHooks } from "./hooks.ts";
import { code as claude } from "./claude/definition.ts";
import { code as codex } from "./codex/definition.ts";
import { code as pi } from "./pi/definition.ts";
import { code as opencode } from "./opencode/definition.ts";
import { code as cursor } from "./cursor/definition.ts";
import { code as antigravity } from "./antigravity/definition.ts";
import {
  attachedFiles,
  fillArguments,
  readDefinition,
  reasonText,
  type DefinitionHooks,
  type DefinitionFile,
} from "./definition-file.ts";
import {
  definitionHooks,
  hookSession,
  hooksTarget,
  hooksLink,
  pluginArguments,
  removeWrittenHooks,
  writtenPath,
} from "./definition-hooks.ts";
import {
  definitionImages,
  imageHash,
  type DefinitionImage,
  definitionFilePath,
} from "./definition-images.ts";
import { scriptSessionTokens, scriptUsage } from "./definition-script.ts";
import { modelCommand, plainModels, type ModelAdapter } from "./models.ts";
import { shellCommand } from "./shell-command.ts";

export interface TeamLaunch {
  cwd?: string;
  candidate: import("@iori/protocol").Candidate;
  version?: string;
  instructionFile: string;
  commandDirectory: string;
  commandMailboxDirectory?: string;
  teamFilesDirectory: string;
  instructions: string;
  initial?: string;
  startupArguments?: string;
  startupShell?: import("../terminal/platform.ts").ShellDefinition;
}
export interface CliDefinition extends CliSummary {
  /** Other command names that find this CLI when `command` is not found. */
  aliases?: readonly string[];
  /** Arguments that print the version. Without them no version is read. */
  versionArguments?: readonly string[];
  sessionTokens?: import("./session-tokens.ts").SessionTokenReader;
  observedModel?: (
    payload: import("./hooks.ts").HookPayload,
  ) => string | undefined;
  /** The first instruction that is pasted after launch, not an argument. */
  teamInput?: (launch: TeamLaunch) => string | undefined;
  /** This CLI signals its input UI readiness by enabling bracketed paste. */
  waitForBracketedPaste?: boolean;
  /** The CLI shows its input cursor only after mounting the prompt. */
  waitForInputCursor?: boolean;
  teamEnvironment?: (launch: TeamLaunch) => Record<string, string>;
  /** Per-process configuration for CLIs whose launch options depend on version. */
  launchEnvironment?: (
    version?: string,
    model?: string,
  ) => Record<string, string>;
  managedTeamArguments?: readonly import("./team-startup-arguments.ts").ManagedTeamArgument[];
  teamArguments?: (launch: TeamLaunch) => readonly string[];
  command: string;
  teamCommandDirectory?: () => string;
  usageMonitor?: import("./usage.ts").UsageMonitor;
  modelCatalog?: import("./models.ts").ModelAdapter;
  session?: (
    payload: import("./hooks.ts").HookPayload,
  ) => import("@iori/protocol").CliSession | undefined;
  resumeWithInputArguments?: (
    session: import("@iori/protocol").CliSession,
    initial: string,
  ) => readonly string[] | undefined;
  resumeArguments?: (
    session: import("@iori/protocol").CliSession,
  ) => readonly string[] | undefined;
  hooks?: CliHooks;
  launchArguments?: (version?: string, team?: boolean) => readonly string[];
  /** Outside a team, keeps the `iori` command on the PATH of this CLI's own
   * tool shells, unless the user's startup arguments set the option. */
  commandPathArguments?: {
    arguments: readonly string[];
    option: import("./team-startup-arguments.ts").ManagedTeamArgument;
  };
  /** Outside a team, lets this CLI's own sandbox write `iori` requests to the
   * session's command directory, as its team launch does. */
  commandDirectoryArguments?: (
    directory: string,
    startupArguments: string,
    startupShell: import("../terminal/platform.ts").ShellDefinition,
    cwd?: string,
  ) => readonly string[];
  supportsHooks?: (version?: string) => boolean;
  /** `command` is a command line that the shell reads: a definition made
   * from the name and command fields (cli-definitions.md「shell に解釈させない」). */
  commandLine?: true;
}
/** The arguments that a definition file gives one launch, item by item. */
export interface DefinitionArguments {
  model: readonly string[];
  effort: readonly string[];
  permission: readonly string[];
  instructionFile: readonly string[];
  directories: readonly string[];
  prompt: readonly string[];
}
/** What only an official CLI's code does, layered over its definition file
 * (docs/design/cli-definitions.md#正式対応との関係). A code `teamArguments`
 * places the file's arguments among its own, in this CLI's order. */
export type CliCode = Omit<Partial<CliDefinition>, "teamArguments"> & {
  id: string;
  teamArguments?: (
    launch: TeamLaunch,
    file: DefinitionArguments,
  ) => readonly string[];
  /** Features this CLI has no means for, which no definition can add. */
  unavailable?: readonly CliFeature[];
};

/** Without an instruction file argument, the first instruction reads it. */
function firstInstruction(
  { launch: items }: DefinitionFile,
  { initial, instructionFile }: TeamLaunch,
): string | undefined {
  return items.instructionFile
    ? initial || undefined
    : initial || instructionFile
      ? (initial ?? `Read ${instructionFile} and follow its instructions.`)
      : undefined;
}
function definitionArguments(
  file: DefinitionFile,
  launch: TeamLaunch,
): DefinitionArguments {
  const { launch: items } = file;
  const { candidate: c, instructionFile, teamFilesDirectory } = launch;
  const prompt = firstInstruction(file, launch);
  // A single {directory} keeps referring to the writable command mailbox.
  const directory = launch.commandMailboxDirectory || teamFilesDirectory;
  const values = {
    model: c.model,
    effort: c.effort,
    instructionFile,
    directory,
    prompt,
  };
  const fill = (args: readonly string[] | undefined, present: unknown) =>
    args && present ? fillArguments(args, values) : [];
  return {
    model: fill(items.model, c.model),
    effort: fill(items.effort, c.effort),
    permission:
      c.permission && Object.hasOwn(items.permissions, c.permission)
        ? fillArguments(items.permissions[c.permission]!, values)
        : [],
    instructionFile: fill(items.instructionFile, instructionFile),
    // Some CLIs need explicit access to both the mailbox and the copies.
    // Windows keeps both in the same folder, so only one set is added there.
    directories: [...new Set([directory, teamFilesDirectory])].flatMap(
      (directory) =>
        items.directories && directory
          ? fillArguments(items.directories, { ...values, directory })
          : [],
    ),
    prompt:
      items.initialPrompt?.mode === "argument" && prompt !== undefined
        ? fillArguments(items.initialPrompt.args, values)
        : [],
  };
}
/** Arguments follow the order in which the definition writes its items. */
function inDefinitionOrder(
  file: DefinitionFile,
  args: DefinitionArguments,
): string[] {
  return file.launch.order.flatMap((item) =>
    item === "permissions"
      ? args.permission
      : item === "initialPrompt"
        ? args.prompt
        : args[item],
  );
}
function select(value: unknown, path: string): unknown[] {
  let found = [value];
  for (const [, key, all] of path
    .replace(/^\$/u, "")
    .matchAll(/\.([^.[\]]+)|(\[\*\])/gu))
    found = found.flatMap((item) =>
      all
        ? Array.isArray(item)
          ? item
          : []
        : item && typeof item === "object" && !Array.isArray(item)
          ? [(item as Record<string, unknown>)[key!]]
          : [],
    );
  return found;
}
function definitionModels({ models, launch }: DefinitionFile): ModelAdapter {
  const options = Object.keys(launch.permissions);
  const permissions = options.length
    ? [{ key: "permission" as const, label: "Permissions", options }]
    : [];
  return async (shell, command, signal) => {
    // A definition without a model list has no models, as a CLI added by
    // its name and command without candidates.
    if (!models) return { models: [], permissions };
    if ("candidates" in models)
      return {
        models: models.candidates.map((model) => ({
          name: model.name,
          ...(model.label ? { label: model.label } : {}),
          efforts: model.efforts ?? [],
        })),
        permissions,
      };
    const output = await modelCommand(
      shell,
      "shell" in models
        ? models.shell
        : await shellCommand(command, models.list, shell, {
            commandLine: true,
          }),
      signal,
    );
    if (models.format === "lines")
      return {
        models: plainModels(output).map((name) => ({ name, efforts: [] })),
        permissions,
      };
    let parsed: unknown;
    try {
      parsed = JSON.parse(output);
    } catch {
      return { models: [], permissions };
    }
    return {
      models: select(parsed, models.items).flatMap((item): CliModel[] => {
        const entry =
          item && typeof item === "object"
            ? (item as Record<string, unknown>)
            : {};
        const name = entry[models.name];
        const label = models.label ? entry[models.label] : undefined;
        const efforts = models.efforts ? entry[models.efforts] : undefined;
        return typeof name === "string" && name
          ? [
              {
                name,
                ...(typeof label === "string" ? { label } : {}),
                efforts: Array.isArray(efforts)
                  ? efforts.filter((effort) => typeof effort === "string")
                  : [],
              },
            ]
          : [];
      }),
      permissions,
    };
  };
}

/** Hooks that this Host writes from a definition, for removing them later. */
const writtenHooks = new WeakMap<CliDefinition, DefinitionHooks>();
/** What the AI agents screen shows of a definition in use. */
export interface DefinitionInfo {
  file: DefinitionFile;
  source: CliDefinitionSource;
  /** The JSON of the definition in use, for editing it. */
  text: string;
  /** The folder that holds its definition.json and the files that came with
   * it: `cli-definitions/<id>/` or a bundled CLI's folder. */
  folder: string;
  /** Features that this CLI's code has no means for. */
  unavailable: readonly CliFeature[];
}
const infos = new WeakMap<CliDefinition, DefinitionInfo>();
export const definitionInfo = (definition: CliDefinition) =>
  infos.get(definition);
function cliDefinition(
  file: DefinitionFile,
  text: string,
  source: CliDefinitionSource,
  folder: string,
  code?: CliCode,
): CliDefinition {
  const definition = codedDefinition(file, code, folder);
  infos.set(definition, {
    file,
    source,
    text,
    folder,
    unavailable: code?.unavailable ?? [],
  });
  return definition;
}
function codedDefinition(
  file: DefinitionFile,
  code: CliCode | undefined,
  folder: string,
): CliDefinition {
  const mode = file.launch.initialPrompt?.mode;
  const built: CliDefinition = {
    id: file.id,
    name: file.name,
    command: file.command,
    ...(file.shell ? { commandLine: true as const } : {}),
    ...(file.aliases.length ? { aliases: file.aliases } : {}),
    ...(file.icon ? { icon: file.icon } : {}),
    ...(file.version ? { versionArguments: file.version } : {}),
    // Without `initialPrompt`, the instruction is pasted once the input
    // enables bracketed paste, as for a CLI added by name and command.
    ...(mode === "argument"
      ? {}
      : { teamInput: (launch) => firstInstruction(file, launch) }),
    ...(mode === "paste" ? { waitForBracketedPaste: true } : {}),
    managedTeamArguments: file.launch.managedArguments,
    ...(!code?.hooks &&
    file.hooks?.format === "plugin-file" &&
    "args" in file.hooks.install
      ? {
          launchArguments: () =>
            pluginArguments(file.id, file.hooks, homedir()),
        }
      : {}),
    teamArguments: (launch) =>
      inDefinitionOrder(file, definitionArguments(file, launch)),
    modelCatalog: definitionModels(file),
    ...(file.resume
      ? {
          resumeArguments: (session) =>
            fillArguments(file.resume!, { sessionId: session.id }),
        }
      : {}),
    ...(file.hooks
      ? {
          hooks: definitionHooks(file.id, file.hooks, folder),
          session: hookSession(file.hooks),
        }
      : {}),
    // An official CLI's code keeps its own token and usage readers; only a
    // definition without them uses its scripts.
    ...(file.tokens
      ? { sessionTokens: scriptSessionTokens(file.id, folder, file.tokens) }
      : {}),
    ...(file.usage
      ? {
          supportsUsage: true,
          usageMonitor: scriptUsage(file.id, folder, file.usage),
        }
      : {}),
  };
  if (!code) {
    if (file.hooks) writtenHooks.set(built, file.hooks);
    return built;
  }
  // The code of an official CLI stays in use when a user's file replaces
  // its bundled one; only the file's part is replaced.
  const { teamArguments, unavailable: _unavailable, ...rest } = code;
  const definition: CliDefinition = {
    ...built,
    ...rest,
    ...(teamArguments
      ? {
          teamArguments: (launch) =>
            teamArguments(launch, definitionArguments(file, launch)),
        }
      : {}),
  };
  if (file.hooks && !code.hooks) writtenHooks.set(definition, file.hooks);
  return definition;
}

const codes: CliCode[] = [claude, codex, pi, opencode, cursor, antigravity];
// Bundled definitions in the order of the CLI list. Each folder holds its
// definition.json and, for an official CLI, the code layered over it.
const bundledIds = [
  "claude",
  "codex",
  "pi",
  "opencode",
  "cursor",
  "antigravity",
  "qoder",
  "codebuddy",
  "kiro",
  "grok",
  "vibe",
  "kimi-code",
  "vtcode",
  "hermes",
  "amp",
  "omp",
  "muse-code",
];
const bundled = bundledIds.map((id) => {
  const url = new URL(`./${id}/definition.json`, import.meta.url);
  const text = readFileSync(url, "utf8");
  const read = readDefinition(JSON.parse(text), id);
  if ("reason" in read)
    throw new Error(`Bundled CLI definition ${id}: ${reasonText(read.reason)}`);
  const code = codes.find((entry) => entry.id === id);
  return cliDefinition(
    read.definition,
    text,
    code ? "official" : "bundled",
    fileURLToPath(new URL(`./${id}/`, import.meta.url)),
    code,
  );
});
const bundledIconHashes = new Map(
  bundled.map((definition) => {
    const info = infos.get(definition)!;
    return [
      definition.id,
      definition.icon
        ? {
            light: imageHash(
              readFileSync(join(info.folder, definition.icon.light)),
            ),
            ...(definition.icon.dark
              ? {
                  dark: imageHash(
                    readFileSync(join(info.folder, definition.icon.dark)),
                  ),
                }
              : {}),
          }
        : undefined,
    ];
  }),
);
export const cliDefinitions: CliDefinition[] = [...bundled];
export const isBundledDefinition = (id: string) => bundledIds.includes(id);
/** Whether this Host writes the hooks of `file` itself; an official CLI's
 * code writes its own hooks instead. */
export const writesDefinitionHooks = (file: DefinitionFile) =>
  !!file.hooks && !codes.find((code) => code.id === file.id)?.hooks;

/** Whether the CLI has a model list to read: its definition's `models` or
 * an official CLI's code. */
export function listsModels(definition: CliDefinition): boolean {
  const info = infos.get(definition);
  return (
    !info ||
    !!info.file.models ||
    !!codes.find((code) => code.id === info.file.id)?.modelCatalog
  );
}

/** The support table of a CLI (cli-definitions.md「行を開いた詳細」).
 * A version not yet read does not make a feature unavailable. */
export function cliSupport(
  definition: CliDefinition,
  version: string | undefined,
): Record<CliFeature, CliSupport> {
  const info = infos.get(definition);
  const marked = new Set<string>([
    ...(info?.unavailable ?? []),
    ...(info?.file.unavailable.includes("hooks") ? ["state", "attention"] : []),
    ...(info?.file.unavailable.filter((item) => item !== "hooks") ?? []),
  ]);
  const of = (feature: CliFeature, has: boolean): CliSupport =>
    marked.has(feature) ? "unavailable" : has ? "available" : "undefined";
  const hooks =
    version !== undefined && definition.supportsHooks?.(version) === false
      ? "unavailable"
      : undefined;
  const fileHooks = info && writtenHooks.get(definition);
  // A plugin-file bridge sends the state; what else it sends is in `sends`.
  const sends =
    fileHooks && fileHooks.format === "plugin-file" ? fileHooks.sends : [];
  return {
    state: hooks ?? of("state", !!definition.hooks),
    attention:
      hooks ??
      of(
        "attention",
        fileHooks
          ? fileHooks.format === "plugin-file"
            ? sends.includes("attention")
            : fileHooks.rules.some((rule) => rule.attention)
          : !!definition.hooks,
      ),
    resume: of(
      "resume",
      !!(
        (definition.resumeArguments || definition.resumeWithInputArguments) &&
        definition.session
      ),
    ),
    team: of("team", true),
    tokens: of(
      "tokens",
      !!definition.sessionTokens || sends.includes("tokens"),
    ),
    usage: of("usage", !!definition.supportsUsage),
  };
}

/** Read a definition received as text, for the folder `id`. */
export function readDefinitionText(
  text: string,
  id: string,
): ReturnType<typeof readDefinition> {
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    return { reason: { kind: "json" } };
  }
  return readDefinition(value, id);
}

/** User definitions by folder, in the order they were added: the text last
 * read and what it gave. */
const users = new Map<
  string,
  {
    text?: string;
    reason?: CliDefinitionReason;
    definition?: CliDefinition;
    images?: Map<string, DefinitionImage>;
  }
>();
/** Whether the folder was read; one that cannot be read now keeps the
 * definitions read before, and the hooks written for them. */
async function readUserDefinitions(directory: string): Promise<boolean> {
  let folders: string[] = [];
  try {
    const entries = (await readdir(directory, { withFileTypes: true }))
      // A linked folder is read too (definitions kept with dotfiles).
      .filter((entry) => entry.isDirectory() || entry.isSymbolicLink());
    // The list shows user definitions in the order they were added.
    const added = await Promise.all(
      entries.map(async (entry) => ({
        name: entry.name,
        birth: await stat(join(directory, entry.name)).then(
          (info) => info.birthtimeMs,
          () => 0,
        ),
      })),
    );
    folders = added
      .sort(
        (a, b) =>
          a.birth - b.birth || (a.name < b.name ? -1 : a.name > b.name ? 1 : 0),
      )
      .map((entry) => entry.name);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
      console.error("iori-host cli-definitions-unreadable");
      return false;
    }
  }
  let changed =
    folders.length !== users.size ||
    folders.some((folder, index) => [...users.keys()][index] !== folder);
  const read = new Map<string, NonNullable<ReturnType<typeof users.get>>>();
  for (const folder of folders) {
    const previous = users.get(folder);
    let text: string;
    try {
      text = await readFile(join(directory, folder, "definition.json"), "utf8");
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (previous && code !== "ENOENT" && code !== "ENOTDIR") {
        read.set(folder, previous);
        continue;
      }
      text = "";
    }
    const result: ReturnType<typeof readDefinition> = text
      ? readDefinitionText(text, folder)
      : { reason: { kind: "unreadable" } };
    if ("reason" in result) {
      changed = true;
      // The Host's log keeps why this CLI is missing; others still load.
      console.error(
        `iori-host cli-definition-skipped: ${folder}: ${reasonText(result.reason)}`,
      );
      read.set(folder, { text, reason: result.reason });
      continue;
    }
    const folderPath = join(directory, folder);
    const image = await definitionImages(result.definition, folderPath);
    if ("reason" in image) {
      changed = true;
      read.set(folder, { text, reason: image.reason });
      continue;
    }
    if (
      previous?.text === text &&
      previous.definition &&
      JSON.stringify([...(previous.images?.keys() ?? [])]) ===
        JSON.stringify([...image.images.keys()])
    ) {
      read.set(folder, previous);
      continue;
    }
    changed = true;
    const definition = cliDefinition(
      result.definition,
      text,
      isBundledDefinition(folder) ? "override" : "user",
      folderPath,
      codes.find((code) => code.id === folder),
    );
    const builtin = bundled.find((entry) => entry.id === folder);
    const original = bundledIconHashes.get(folder);
    const sameBundledIcon =
      !!original &&
      !!image.icon &&
      original.light === image.icon.light &&
      original.dark === image.icon.dark;
    definition.icon = sameBundledIcon ? builtin!.icon : image.icon;
    definition.customIcon = !!result.definition.icon && !sameBundledIcon;
    read.set(folder, { text, definition, images: image.images });
  }
  if (!changed && [...users.keys()].every((folder) => read.has(folder)))
    return true;
  users.clear();
  for (const [folder, entry] of read) users.set(folder, entry);
  const definitions = [...users.values()].flatMap(
    (entry) => entry.definition ?? [],
  );
  cliDefinitions.splice(
    0,
    cliDefinitions.length,
    ...bundled.map(
      (definition) =>
        definitions.find((user) => user.id === definition.id) ?? definition,
    ),
    ...definitions.filter(
      (user) => !bundled.some((definition) => definition.id === user.id),
    ),
  );
  return true;
}
/** The user's definitions that are not read, in the order they were added. */
export function failedDefinitions(): CliDefinitionFailure[] {
  return [...users].flatMap(([folder, entry]) =>
    entry.reason
      ? [{ folder, reason: entry.reason, definition: entry.text ?? "" }]
      : [],
  );
}
/** Folders of the user's definitions, read or not. */
export const userDefinitionFolders = () => [...users.keys()];

/** A user's definition that overrides a bundled one refers to the files that
 * the bundled definition brought. A missing bridge or script would leave the
 * override unable to place or read anything, so a missing file is copied from
 * the bundled folder. A file of the same name that the user has stays. */
async function copyBundledFiles(id: string, folder: string): Promise<void> {
  const source = bundled.find((definition) => definition.id === id);
  const info = source && infos.get(source);
  if (!info) return;
  for (const file of attachedFiles(info.file)) {
    try {
      const destination = await definitionFilePath(folder, file, true);
      await copyFile(
        join(info.folder, file),
        destination,
        constants.COPYFILE_EXCL,
      );
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      // The user's file stays; a bundled definition without the file copies
      // nothing.
      if (code !== "EEXIST" && code !== "ENOENT") throw error;
    }
  }
}
let loading = Promise.resolve();
/** Write the user's definition of `id` and read the definitions again. */
export async function saveUserDefinition(
  root: string,
  id: string,
  text: string,
  files: { name: string; bytes: Buffer }[] = [],
  retainedFiles?: string[],
): Promise<void> {
  const folder = join(root, "cli-definitions", id);
  await mkdir(folder, { recursive: true });
  await copyBundledFiles(id, folder);
  for (const file of files)
    await writeFileAtomic(
      await definitionFilePath(folder, file.name, true),
      file.bytes,
    );
  await writeFileAtomic(join(folder, "definition.json"), text);
  if (retainedFiles) {
    const keep = new Set(
      [
        "definition.json",
        ...retainedFiles,
        ...files.map((file) => file.name),
      ].map((name) => name.replaceAll("\\", "/")),
    );
    const prune = async (directory: string, prefix = "") => {
      for (const entry of await readdir(directory, { withFileTypes: true })) {
        const name = prefix + entry.name;
        if (keep.has(name)) continue;
        if (
          entry.isDirectory() &&
          [...keep].some((file) => file.startsWith(name + "/"))
        )
          await prune(join(directory, entry.name), name + "/");
        else
          await rm(join(directory, entry.name), {
            recursive: true,
            force: true,
          });
      }
    };
    await prune(folder);
  }
  await loadCliDefinitions(root);
}
/** Delete the user's definition of `id` with the files that came with it.
 * Reading the definitions again removes the hooks recorded for it. */
export async function removeUserDefinition(
  root: string,
  id: string,
): Promise<void> {
  await rm(join(root, "cli-definitions", id), { recursive: true, force: true });
  await loadCliDefinitions(root);
}
/** Read the user's definitions in `<root>/cli-definitions/<id>/`. A user's
 * definition replaces the bundled one with the same `id`. Hooks that this
 * Host recorded for a definition that is gone, or now writes elsewhere, are
 * removed. */
export function loadCliDefinitions(root: string): Promise<void> {
  const next = loading.then(async () => {
    if (!(await readUserDefinitions(join(root, "cli-definitions")))) return;
    const home = homedir();
    await removeWrittenHooks(writtenPath(root), (id, written) => {
      const definition = cliDefinitions.find((entry) => entry.id === id);
      const hooks = definition && writtenHooks.get(definition);
      return (
        !hooks ||
        hooksTarget(hooks, home, id) !== written.file ||
        JSON.stringify(
          hooks.format === "plugin-file" ? undefined : hooks.own,
        ) !== JSON.stringify(written.own) ||
        JSON.stringify(hooksLink(hooks, home)) !==
          JSON.stringify(
            written.link && {
              file: written.link.file,
              base: written.link.base,
              set: written.link.set,
            },
          )
      );
    }).catch(() => {
      console.error("iori-host cli-definition-hooks-not-removed");
    });
  });
  loading = next.catch(() => {});
  return next;
}

/** Branding follows the installed Host, including conversations saved earlier. */
export function withCurrentCliIcon(cli: CliSummary): CliSummary {
  return {
    ...cli,
    icon: cliDefinitions.find((definition) => definition.id === cli.id)?.icon,
  };
}

/** A hash names the exact bytes from a currently loaded user definition. */
export function cliDefinitionImage(hash: string): DefinitionImage | undefined {
  for (const entry of users.values()) {
    const image = entry.images?.get(hash);
    if (image) return image;
  }
  return undefined;
}
export function bundledDefinition(id: string) {
  return bundled.find((entry) => entry.id === id);
}
