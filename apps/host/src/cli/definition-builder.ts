import { homedir } from "node:os";
import { join } from "node:path";
import type {
  CliDefinitionSource,
  CliFeature,
  CliModel,
  CliSummary,
  CliSupport,
} from "@iori/protocol";
import type { CliHooks } from "./hooks.ts";
import {
  fillArguments,
  type DefinitionHooks,
  type DefinitionFile,
  type InterruptMode,
} from "./definition-file.ts";
import {
  definitionHooks,
  hookSession,
  pluginArguments,
} from "./definition-hooks.ts";
import { scriptSessionTokens, scriptUsage } from "./definition-script.ts";
import { modelCommand, plainModels, type ModelAdapter } from "./models.ts";
import { shellCommand } from "./shell-command.ts";

export interface TeamLaunch {
  cwd?: string;
  candidate: import("@iori/protocol").Candidate;
  version?: string;
  instructionFile: string;
  trustWorkspace: boolean;
  commandDirectory: string;
  commandMailboxDirectory?: string;
  teamFilesDirectory: string;
  instructions: string;
  initial?: string;
  startupArguments?: string;
  startupShell?: import("../terminal/platform.ts").ShellDefinition;
  /** The launch resumes a saved conversation, which already read its
   * instructions; only an `initial` given for it is sent. */
  resume?: boolean;
}
export interface CliDefinition extends CliSummary {
  interrupt: InterruptMode;
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
  /** Configuration for this launch, including its version and resume state.
   * teamEnvironment is also applied when spawning a shell outside this launch. */
  launchEnvironment?: (launch?: TeamLaunch) => Record<string, string>;
  launchEffortForVersion?: (version?: string) => boolean;
  managedTeamArguments?: readonly import("./team-startup-arguments.ts").ManagedTeamArgument[];
  teamArguments?: (launch: TeamLaunch) => readonly string[];
  command: string;
  teamCommandDirectory?: () => string;
  usageMonitor?: import("./usage.ts").UsageMonitor;
  modelCatalog?: import("./models.ts").ModelAdapter;
  session?: (
    payload: import("./hooks.ts").HookPayload,
  ) => import("@iori/protocol").CliSession | undefined;
  /** Resume a team with its instructions and pending input in the launch prompt. */
  resumeWithTeamPrompt?: (version?: string) => boolean;
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
export type CliCode = Omit<
  Partial<CliDefinition>,
  "teamArguments" | "interrupt"
> & {
  id: string;
  /** The code passes team instructions through its own launch options. */
  deliversInstructions?: boolean;
  teamArguments?: (
    launch: TeamLaunch,
    file: DefinitionArguments,
  ) => readonly string[];
  /** Features this CLI has no means for, which no definition can add. */
  unavailable?: readonly CliFeature[];
};

/** When the CLI has no separate instruction channel, the first prompt reads the file. */
function firstInstruction(
  { launch: items }: DefinitionFile,
  { initial, instructionFile, resume }: TeamLaunch,
  deliversInstructions = false,
): string | undefined {
  if (items.instructionFile || deliversInstructions || resume)
    return initial || undefined;
  if (!instructionFile) return initial || undefined;
  const instruction = `Read ${instructionFile} and follow its instructions.`;
  return initial
    ? initial.startsWith(instruction)
      ? initial
      : `${instruction} Then ${initial[0]!.toLowerCase()}${initial.slice(1)}`
    : instruction;
}
function definitionArguments(
  file: DefinitionFile,
  launch: TeamLaunch,
  deliversInstructions = false,
): DefinitionArguments {
  const { launch: items } = file;
  const { candidate: c, instructionFile, teamFilesDirectory } = launch;
  const prompt = firstInstruction(file, launch, deliversInstructions);
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

/** What the AI agents screen shows of a definition in use. */
export interface DefinitionInfo {
  file: DefinitionFile;
  writtenHooks?: DefinitionHooks;
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
export function cliDefinition(
  file: DefinitionFile,
  text: string,
  source: CliDefinitionSource,
  folder: string,
  code?: CliCode,
): CliDefinition {
  const instruction = code?.hooks ? undefined : file.hooks?.instruction;
  const definition = codedDefinition(
    file,
    code,
    folder,
    !!(instruction || code?.deliversInstructions),
  );
  if (instruction) {
    const environment = definition.launchEnvironment;
    definition.launchEnvironment = (launch) => {
      const env = { ...environment?.(launch) };
      if (!launch?.instructionFile || launch.resume) return env;
      env.IORI_CLI_HOOK_INSTRUCTION_FILE = launch.instructionFile;
      if (instruction !== true) {
        env.IORI_CLI_HOOK_INSTRUCTION_CLI = file.id;
        env.IORI_CLI_HOOK_INSTRUCTION_EVENT = instruction.event;
        env.IORI_CLI_HOOK_INSTRUCTION_FORMAT = instruction.format;
        if (instruction.once)
          env.IORI_CLI_HOOK_INSTRUCTION_ONCE = join(
            launch.teamFilesDirectory,
            "instruction-delivered.flag",
          );
      }
      return env;
    };
  }
  infos.set(definition, {
    file,
    source,
    text,
    folder,
    writtenHooks: code?.hooks ? undefined : file.hooks,
    unavailable: code?.unavailable ?? [],
  });
  return definition;
}
function codedDefinition(
  file: DefinitionFile,
  code: CliCode | undefined,
  folder: string,
  deliversInstructions: boolean,
): CliDefinition {
  const mode = file.launch.initialPrompt?.mode;
  const built: CliDefinition = {
    id: file.id,
    name: file.name,
    command: file.command,
    interrupt: file.launch.interrupt ?? "esc",
    launchEffort: !!file.launch.effort,
    ...(file.shell ? { commandLine: true as const } : {}),
    ...(file.aliases.length ? { aliases: file.aliases } : {}),
    ...(file.icon ? { icon: file.icon } : {}),
    ...(file.version ? { versionArguments: file.version } : {}),
    // Without `initialPrompt`, the instruction is pasted once the input
    // enables bracketed paste, as for a CLI added by name and command.
    ...(mode === "argument"
      ? {}
      : {
          teamInput: (launch) =>
            firstInstruction(file, launch, deliversInstructions),
        }),
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
      inDefinitionOrder(
        file,
        definitionArguments(file, launch, deliversInstructions),
      ),
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
  if (!code) return built;
  // The code of an official CLI stays in use when a user's file replaces
  // its bundled one; only the file's part is replaced.
  const {
    teamArguments,
    unavailable: _unavailable,
    deliversInstructions: _deliversInstructions,
    ...rest
  } = code;
  const definition: CliDefinition = {
    ...built,
    ...rest,
    ...(code.modelCatalog
      ? {
          modelCatalog: async (shell, command, signal) => {
            const result = await code.modelCatalog!(shell, command, signal);
            const options = Object.keys(file.launch.permissions);
            return result.permissions.length || !options.length
              ? result
              : {
                  ...result,
                  permissions: [
                    { key: "permission", label: "Permissions", options },
                  ],
                };
          },
        }
      : {}),
    ...(teamArguments
      ? {
          teamArguments: (launch) =>
            teamArguments(
              launch,
              definitionArguments(file, launch, deliversInstructions),
            ),
        }
      : {}),
  };
  return definition;
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
  const fileHooks = info?.writtenHooks;
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
