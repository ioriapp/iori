/** The features in a CLI's support table (cli-definitions.md「行を開いた詳細」). */
export const CLI_FEATURES = [
  "state",
  "attention",
  "resume",
  "team",
  "tokens",
  "usage",
] as const;
export type CliFeature = (typeof CLI_FEATURES)[number];
export type CliSupport = "available" | "unavailable" | "undefined";
/** Where the definition in use comes from. `override` is a user's
 * definition that replaces a bundled one with the same `id`. */
export type CliDefinitionSource = "official" | "bundled" | "user" | "override";
/** A definition made from the name and launch command fields. */
export interface CliSimpleDefinition {
  name: string;
  /** Read by the shell, as a command the user writes. */
  command: string;
  /** Words with `{model}`, such as `--model {model}`. */
  modelArgument: string;
  /** A command whose output lists one model per line. */
  modelCommand?: string;
  /** Models entered by hand, without a command. */
  models?: string[];
}
/** Why a definition is not read, worded by the Client in its language. */
export type CliDefinitionReason =
  | { kind: "json" }
  | { kind: "unreadable" }
  | { kind: "missing"; field: string }
  | {
      kind: "type";
      field: string;
      type: "object" | "string" | "strings" | "array" | "boolean" | "value";
    }
  | { kind: "values"; field: string; values: string[] }
  | { kind: "id" }
  | { kind: "folder"; folder: string }
  | { kind: "inside"; field: string }
  | { kind: "path"; field: string };
/** A folder of `cli-definitions/` whose definition is not read. */
export interface CliDefinitionFailure {
  folder: string;
  reason: CliDefinitionReason;
  /** The text of its definition.json, for editing. */
  definition: string;
}
/** What adding or saving a definition does on this Host, for the
 * confirmation before it is saved. */
export interface CliDefinitionSummary {
  id: string;
  name: string;
  /** A definition with this `id` is already on the Host. */
  replaces: boolean;
  /** `override`: the saved definition replaces a bundled one. */
  overrides: boolean;
  commands: {
    kind: "launch" | "models" | "tokens" | "usage";
    line: string;
  }[];
  settings: string[];
  files: string[];
  missingFiles: string[];
  requiresConfirmation: boolean;
}

export interface CliDefinitionAttachment {
  name: string;
  uploadId: string;
}
export interface CliDefinitionParams {
  "cli.definition.file.write": {
    uploadId: string;
    data: string;
    first: boolean;
  };
  "cli.definition.files.discard": { uploadIds: string[] };
  "cli.icon.read": { hash: string; offset: number };
  "cli.icon.set": {
    cliId: string;
    image?: CliDefinitionAttachment;
  };
  /** `cliId` is the definition being edited; without it the definition's
   * own `id` is added. */
  "cli.definition.check": {
    definition: string;
    cliId?: string;
    files?: CliDefinitionAttachment[];
  };
  "cli.definition.save": {
    definition: string;
    cliId?: string;
    files?: CliDefinitionAttachment[];
  };
  "cli.definition.simple": { simple: CliSimpleDefinition; cliId?: string };
  "cli.definition.remove": { cliId: string };
}
export interface CliDefinitionResults {
  "cli.definition.file.write": { uploadId: string };
  "cli.definition.files.discard": Record<string, never>;
  "cli.icon.read": {
    bytesBase64: string;
    nextOffset: number;
    eof: boolean;
    mimeType: string;
  };
  "cli.icon.set": { cliId: string } | { invalidImage: true };
  "cli.definition.check":
    | { reason: CliDefinitionReason }
    | { missing: string[] }
    | { summary: CliDefinitionSummary };
  "cli.definition.save":
    { reason: CliDefinitionReason } | { missing: string[] } | { cliId: string };
  /** An existing id needs confirmation before saving this JSON. */
  "cli.definition.simple": { replacement: string } | { cliId: string };
  "cli.definition.remove": { cliId: string };
}
export type CliDefinitionMethod = keyof CliDefinitionParams;
const methods: CliDefinitionMethod[] = [
  "cli.definition.file.write",
  "cli.definition.files.discard",
  "cli.icon.read",
  "cli.icon.set",
  "cli.definition.check",
  "cli.definition.save",
  "cli.definition.simple",
  "cli.definition.remove",
];
export function isCliDefinitionMethod(
  value: unknown,
): value is CliDefinitionMethod {
  return methods.includes(value as CliDefinitionMethod);
}
function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error("Expected an object");
  return value as Record<string, unknown>;
}
function text(value: unknown): string {
  if (typeof value !== "string") throw new Error("Expected text");
  return value;
}
/** One line without control characters, as names and commands are typed. */
function line(value: unknown): string {
  const result = text(value).trim();
  if (!result || /[\u0000-\u001f\u007f]/u.test(result))
    throw new Error("Expected one line");
  return result;
}
function cliId(value: unknown): string | undefined {
  return value === undefined ? undefined : line(value);
}
export function parseCliSimpleDefinition(value: unknown): CliSimpleDefinition {
  const input = object(value);
  if (input.models !== undefined && !Array.isArray(input.models))
    throw new Error("Expected models");
  return {
    name: line(input.name),
    command: line(input.command),
    modelArgument: text(input.modelArgument).trim()
      ? line(input.modelArgument)
      : "",
    ...(input.modelCommand === undefined || !text(input.modelCommand).trim()
      ? {}
      : { modelCommand: line(input.modelCommand) }),
    ...(Array.isArray(input.models) ? { models: input.models.map(line) } : {}),
  };
}
function uploadId(value: unknown): string {
  const id = text(value);
  if (!/^[a-f0-9-]{36}$/u.test(id)) throw new Error("Invalid upload id");
  return id;
}
export function parseCliDefinitionParams<M extends CliDefinitionMethod>(
  method: M,
  value: unknown,
): CliDefinitionParams[M] {
  const v = object(value);
  const attachment = (input: unknown): CliDefinitionAttachment => {
    const item = object(input);
    return { name: line(item.name), uploadId: uploadId(item.uploadId) };
  };
  if (method === "cli.definition.file.write") {
    if (
      typeof v.first !== "boolean" ||
      !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/u.test(
        text(v.data),
      )
    )
      throw new Error("Invalid file chunk");
    return {
      uploadId: uploadId(v.uploadId),
      data: v.data,
      first: v.first,
    } as CliDefinitionParams[M];
  }
  if (method === "cli.definition.files.discard") {
    if (!Array.isArray(v.uploadIds)) throw new Error("Expected uploads");
    return { uploadIds: v.uploadIds.map(uploadId) } as CliDefinitionParams[M];
  }
  if (method === "cli.icon.read") {
    if (
      !/^[a-f0-9]{64}$/u.test(text(v.hash)) ||
      !Number.isSafeInteger(v.offset) ||
      (v.offset as number) < 0
    )
      throw new Error("Invalid image read");
    return { hash: v.hash, offset: v.offset } as CliDefinitionParams[M];
  }
  const id = cliId(v.cliId);
  if (method === "cli.icon.set") {
    return {
      cliId: line(v.cliId),
      ...(v.image === undefined ? {} : { image: attachment(v.image) }),
    } as CliDefinitionParams[M];
  }
  if (method === "cli.definition.remove")
    return { cliId: line(v.cliId) } as CliDefinitionParams[M];
  if (method === "cli.definition.simple")
    return {
      simple: parseCliSimpleDefinition(v.simple),
      ...(id ? { cliId: id } : {}),
    } as CliDefinitionParams[M];
  return {
    definition: text(v.definition),
    ...(v.files === undefined
      ? {}
      : {
          files: Array.isArray(v.files)
            ? v.files.map(attachment)
            : (() => {
                throw new Error("Expected files");
              })(),
        }),
    ...(id ? { cliId: id } : {}),
  } as CliDefinitionParams[M];
}
export const cliDefinitionResultSchemas = Object.fromEntries(
  methods.map((method) => [method, { parse: (value: unknown) => value }]),
) as {
  [M in CliDefinitionMethod]: {
    parse: (value: unknown) => CliDefinitionResults[M];
  };
};
