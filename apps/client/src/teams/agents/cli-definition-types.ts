import type {
  CliDefinitionAttachment,
  CliDefinitionReason,
  CliDefinitionSummary,
  CliSimpleDefinition,
} from "@iori/protocol";

export type AddMode = "simple" | "json" | "file";
export type ModelSource = "command" | "list";

export interface SimpleFieldsValue {
  name: string;
  command: string;
  modelArgument: string;
  modelSource: ModelSource;
  modelCommand: string;
  modelList: string;
}

export const emptySimple: SimpleFieldsValue = {
  name: "",
  command: "",
  modelArgument: "",
  modelSource: "command",
  modelCommand: "",
  modelList: "",
};

export function fieldsOf(simple: CliSimpleDefinition): SimpleFieldsValue {
  return {
    name: simple.name,
    command: simple.command,
    modelArgument: simple.modelArgument,
    modelSource: simple.models ? "list" : "command",
    modelCommand: simple.modelCommand ?? "",
    modelList: (simple.models ?? []).join("\n"),
  };
}

export function simpleOf(value: SimpleFieldsValue): CliSimpleDefinition {
  const models = value.modelList
    .split("\n")
    .map((model) => model.trim())
    .filter(Boolean);
  return {
    name: value.name.trim(),
    command: value.command.trim(),
    modelArgument: value.modelArgument.trim(),
    ...(value.modelSource === "command" && value.modelCommand.trim()
      ? { modelCommand: value.modelCommand.trim() }
      : {}),
    ...(value.modelSource === "list" && models.length ? { models } : {}),
  };
}

export type Adding = {
  mode: AddMode;
  simple: SimpleFieldsValue;
  json: string;
  file?: { name: string; text: string };
  files?: File[];
  message?: string;
  reason?: CliDefinitionReason;
};

export type Editing = {
  id: string;
  simple?: SimpleFieldsValue;
  json?: string;
  initial: string;
  selectedFile?: string;
  drafts?: ReadonlyMap<string, string>;
  files?: File[];
  message?: string;
  reason?: CliDefinitionReason;
};

export type FileDisclosures = { open: string[]; lastOpened?: string };

export type Confirm = {
  kind: "add" | "replace" | "save";
  text: string;
  /** The definition being edited; an added one is saved by its own `id`. */
  cliId?: string;
  summary: CliDefinitionSummary;
  files?: CliDefinitionAttachment[];
};

export type Removal = { kind: "delete" | "revert"; id: string; name: string };
