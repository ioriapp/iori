import * as v from "valibot";
import {
  schema,
  method,
  hostResult,
  chunkBase64,
  integer,
  type Params,
  type Results,
  hasMethod,
  paramsOf,
  type ResultSchemas,
} from "./primitives.ts";
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
/** Why a definition is not read, worded by the Client in its language. */
export type CliDefinitionReason =
  | { kind: "json"; line?: number; column?: number }
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

const singleLine = v.pipe(
  v.string(),
  v.trim(),
  v.check((text) => !/[\u0000-\u001f\u007f]/u.test(text)),
);
const cliId = v.pipe(singleLine, v.nonEmpty());
/** A definition made from the name and launch command fields. */
const simple = v.pipe(
  v.object({
    name: cliId,
    command: cliId,
    modelArgument: singleLine,
    modelCommand: v.optional(singleLine),
    models: v.optional(v.array(cliId)),
  }),
  v.transform(({ modelCommand, ...fields }) => ({
    ...fields,
    ...(modelCommand ? { modelCommand } : {}),
  })),
);
export type CliSimpleDefinition = v.InferOutput<typeof simple>;
export const parseCliSimpleDefinition = schema(simple).parse;
const uploadId = v.pipe(v.string(), v.regex(/^[a-f0-9-]{36}$/u));
const attachment = v.object({ name: cliId, uploadId });
export type CliDefinitionAttachment = v.InferOutput<typeof attachment>;
const saveDefinition = v.object({
  definition: v.string(),
  files: v.optional(v.array(attachment)),
  cliId: v.optional(cliId),
});

export const cliDefinitionMethods = {
  "cli.definition.file.read": method(
    v.object({ cliId, name: v.string() }),
    hostResult<{ text: string } | { unsupported: true }>(),
  ),
  "cli.definition.file.write": method(
    v.object({ uploadId, data: chunkBase64, first: v.boolean() }),
    hostResult<{ uploadId: string }>(),
  ),
  "cli.definition.files.discard": method(
    v.object({ uploadIds: v.array(uploadId) }),
    hostResult<Record<string, never>>(),
  ),
  "cli.icon.read": method(
    v.object({
      hash: v.pipe(v.string(), v.regex(/^[a-f0-9]{64}$/u)),
      offset: integer(0),
    }),
    hostResult<{
      bytesBase64: string;
      nextOffset: number;
      eof: boolean;
      mimeType: string;
    }>(),
  ),
  "cli.icon.set": method(
    v.object({ cliId, image: v.optional(attachment) }),
    hostResult<{ cliId: string } | { invalidImage: true }>(),
  ),
  "cli.definition.check": method(
    saveDefinition,
    hostResult<
      | { reason: CliDefinitionReason }
      | { missing: string[] }
      | { summary: CliDefinitionSummary }
    >(),
  ),
  "cli.definition.save": method(
    saveDefinition,
    hostResult<
      | { reason: CliDefinitionReason }
      | { missing: string[] }
      | { cliId: string }
    >(),
  ),
  "cli.definition.simple": method(
    v.object({ simple, cliId: v.optional(cliId) }),
    hostResult<{ replacement: string } | { cliId: string }>(),
  ),
  "cli.definition.remove": method(
    v.object({ cliId }),
    hostResult<{ cliId: string }>(),
  ),
};

export type CliDefinitionMethod = keyof typeof cliDefinitionMethods;
export type CliDefinitionParams = Params<typeof cliDefinitionMethods>;
export type CliDefinitionResults = Results<typeof cliDefinitionMethods>;
export function isCliDefinitionMethod(
  value: unknown,
): value is CliDefinitionMethod {
  return hasMethod(cliDefinitionMethods, value);
}
export function parseCliDefinitionParams<M extends CliDefinitionMethod>(
  key: M,
  value: unknown,
): CliDefinitionParams[M] {
  return paramsOf<CliDefinitionParams, M>(cliDefinitionMethods, key, value);
}
export const cliDefinitionResultSchemas: ResultSchemas<CliDefinitionResults> =
  cliDefinitionMethods;
