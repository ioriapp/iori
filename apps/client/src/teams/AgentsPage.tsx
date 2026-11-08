import { HiddenItems } from "./HiddenItems.tsx";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
} from "../components/ui/dropdown-menu.tsx";
import { Fragment, useEffect, useRef, useState } from "react";
import type { ReactNode } from "react";
import {
  ChevronDown,
  ChevronRight,
  CircleAlert,
  ExternalLink,
  Plus,
  MoreHorizontal,
  Upload,
  X,
} from "lucide-react";
import {
  CLI_FEATURES,
  type CliDefinitionFailure,
  type CliDefinitionReason,
  type CliDefinitionSummary,
  type CliDefinitionAttachment,
  type CliFeature,
  type CliSimpleDefinition,
  type CliSummary,
} from "@iori/protocol";
import source from "../../../../release-source.txt?raw";
import { connection } from "../connection.ts";
import { native } from "../native.ts";
import {
  uploadDefinitionFiles,
  definitionImageReadable,
  definitionImageReason,
} from "../cli-definition-files.ts";
import { CliIcon } from "../CliIcon.tsx";
import {
  FieldRow,
  PageBody,
  PageHeader,
  SettingsSection,
  saveOnEnter,
} from "../components/page-layout.tsx";
import { Button } from "../components/ui/button.tsx";
import { Input } from "../components/ui/input.tsx";
import { Textarea } from "../components/ui/textarea.tsx";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "../components/ui/select.tsx";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "../components/ui/table.tsx";
import {
  ToggleGroup,
  ToggleGroupItem,
} from "../components/ui/toggle-group.tsx";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "../components/ui/collapsible.tsx";
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "../components/ui/dialog.tsx";
import {
  useSettingsEditor,
  type RegisterSettingsEditor,
} from "../settings-save.ts";
import { useI18n } from "./context.tsx";
import { Usage } from "./Usage.tsx";
import "./cli-definitions.css";

const repositoryUrl = source.trim().replace(/\/releases\/?$/u, "");
const featureLabels: Record<CliFeature, string> = {
  state: "Response status",
  attention: "Attention",
  resume: "Resume conversation",
  team: "Team child",
  tokens: "Tokens",
  usage: "Usage limits",
};
const supportLabels = {
  available: "Available",
  unavailable: "Unavailable",
  undefined: "Not defined",
};
type AddMode = "simple" | "json" | "file";
type ModelSource = "command" | "list";
interface SimpleFieldsValue {
  name: string;
  command: string;
  modelArgument: string;
  modelSource: ModelSource;
  modelCommand: string;
  modelList: string;
}
const emptySimple: SimpleFieldsValue = {
  name: "",
  command: "",
  modelArgument: "",
  modelSource: "command",
  modelCommand: "",
  modelList: "",
};
function fieldsOf(simple: CliSimpleDefinition): SimpleFieldsValue {
  return {
    name: simple.name,
    command: simple.command,
    modelArgument: simple.modelArgument,
    modelSource: simple.models ? "list" : "command",
    modelCommand: simple.modelCommand ?? "",
    modelList: (simple.models ?? []).join("\n"),
  };
}
function simpleOf(value: SimpleFieldsValue): CliSimpleDefinition {
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
type Adding = {
  mode: AddMode;
  simple: SimpleFieldsValue;
  help?: string;
  json: string;
  file?: { name: string; text: string };
  files?: File[];
  message?: string;
  reason?: CliDefinitionReason;
};
type Editing = {
  id: string;
  simple?: SimpleFieldsValue;
  json?: string;
  initial: string;
  files?: File[];
  message?: string;
  reason?: CliDefinitionReason;
};
type Confirm = {
  kind: "add" | "replace" | "save";
  text: string;
  /** The definition being edited; an added one is saved by its own `id`. */
  cliId?: string;
  summary: CliDefinitionSummary;
  files?: CliDefinitionAttachment[];
};
type Removal = { kind: "delete" | "revert"; id: string; name: string };

/** Values in a translated sentence are code, as field names and commands. */
function Sentence({
  text,
  values,
}: {
  text: string;
  values: Record<string, ReactNode>;
}) {
  return (
    <>
      {text.split(/(\{[a-z]+\})/u).map((part, index) => {
        const key = /^\{([a-z]+)\}$/u.exec(part)?.[1];
        return (
          <Fragment key={index}>
            {key && key in values ? values[key] : part}
          </Fragment>
        );
      })}
    </>
  );
}
function ReasonText({ reason }: { reason: CliDefinitionReason }) {
  const { t, language } = useI18n();
  const code = (value: string) => <code>{value}</code>;
  const field = "field" in reason ? code(reason.field) : undefined;
  switch (reason.kind) {
    case "json":
      return t("The JSON format is not valid.");
    case "unreadable":
      return t("definition.json cannot be read");
    case "id":
      return t("id must use only lowercase letters, digits and -");
    case "folder":
      return (
        <Sentence
          text={t("id must match the folder name {folder}")}
          values={{ folder: code(reason.folder) }}
        />
      );
    case "missing":
      return <Sentence text={t("{field} is required")} values={{ field }} />;
    case "inside":
      return (
        <Sentence
          text={t("{field} must stay inside the definition folder")}
          values={{ field }}
        />
      );
    case "path":
      return (
        <Sentence
          text={t("{field} must start with ~ or be an absolute path")}
          values={{ field }}
        />
      );
    case "type":
      return (
        <Sentence
          text={t(
            {
              object: "{field} must be an object",
              string: "{field} must be a non-empty string",
              strings: "{field} must be an array of strings",
              array: "{field} must be an array",
              boolean: "{field} must be true or false",
              value: "{field} must be a string, number, boolean or null",
            }[reason.type],
          )}
          values={{ field }}
        />
      );
    case "values": {
      const [a = "", b = ""] = reason.values;
      const separator = language.toLowerCase().startsWith("ja") ? "・" : ", ";
      return reason.values.length === 1 ? (
        <Sentence
          text={t("{field} must be {value}")}
          values={{ field, value: code(a) }}
        />
      ) : reason.values.length === 2 ? (
        <Sentence
          text={t("{field} must be {a} or {b}")}
          values={{ field, a: code(a), b: code(b) }}
        />
      ) : (
        <Sentence
          text={t("{field} must be one of {values}")}
          values={{
            field,
            values: reason.values.map((value, index) => (
              <Fragment key={value}>
                {index > 0 && separator}
                {code(value)}
              </Fragment>
            )),
          }}
        />
      );
    }
  }
}
function Reason({ reason }: { reason: CliDefinitionReason }) {
  return (
    <span className="cli-def-error" role="alert">
      <CircleAlert size={14} aria-hidden="true" />
      <span>
        <ReasonText reason={reason} />
      </span>
    </span>
  );
}

/** The fields of a definition made from a name and a launch command, in
 * adding and in editing it. */
function SimpleFields({
  value,
  help,
  onChange,
  onCommandDone,
}: {
  value: SimpleFieldsValue;
  help?: string;
  onChange: (value: SimpleFieldsValue) => void;
  onCommandDone?: () => void;
}) {
  const { t } = useI18n();
  return (
    <>
      <FieldRow stacked label={t("Name")}>
        <Input
          aria-label={t("Name")}
          className="cli-def-name-input"
          data-iori-field="cli-name"
          value={value.name}
          onChange={(event) => onChange({ ...value, name: event.target.value })}
        />
      </FieldRow>
      <FieldRow stacked label={t("Launch command")} className="field-code">
        <Input
          aria-label={t("Launch command")}
          data-iori-field="cli-command"
          value={value.command}
          placeholder="my-cli"
          onChange={(event) =>
            onChange({ ...value, command: event.target.value })
          }
          onBlur={onCommandDone}
        />
      </FieldRow>
      <FieldRow stacked label={t("Model argument")} className="field-code">
        <Input
          aria-label={t("Model argument")}
          data-iori-field="cli-model-argument"
          value={value.modelArgument}
          placeholder="--model {model}"
          onChange={(event) =>
            onChange({ ...value, modelArgument: event.target.value })
          }
        />
        {help && (
          <p className="cli-def-help" data-iori-state="cli-help-filled">
            <Sentence
              text={t("Filled in from {command}")}
              values={{ command: <code>{help}</code> }}
            />
          </p>
        )}
      </FieldRow>
      <FieldRow stacked label={t("Model candidates")} className="field-code">
        <div className="cli-def-models">
          <Select
            value={value.modelSource}
            onValueChange={(modelSource) =>
              onChange({ ...value, modelSource: modelSource as ModelSource })
            }
          >
            <SelectTrigger
              aria-label={t("Model candidates")}
              className="cli-def-model-source"
              data-iori-field="cli-model-source"
            >
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="command">{t("Get with a command")}</SelectItem>
              <SelectItem value="list">{t("Enter manually")}</SelectItem>
            </SelectContent>
          </Select>
          {value.modelSource === "command" ? (
            <Input
              aria-label={t("Get with a command")}
              data-iori-field="cli-model-command"
              value={value.modelCommand}
              placeholder="my-cli models"
              onChange={(event) =>
                onChange({ ...value, modelCommand: event.target.value })
              }
            />
          ) : (
            <Textarea
              aria-label={t("Enter manually")}
              data-iori-field="cli-model-list"
              rows={3}
              value={value.modelList}
              placeholder={"model-a\nmodel-b"}
              onChange={(event) =>
                onChange({ ...value, modelList: event.target.value })
              }
            />
          )}
        </div>
      </FieldRow>
    </>
  );
}

function Foot({
  message,
  children,
}: {
  message?: ReactNode;
  children: ReactNode;
}) {
  // The reason on the left and the buttons side by side on the right, as the
  // product's other forms with Cancel and Save.
  return (
    <div className="section-save cli-def-foot">
      <div className="section-save-result cli-def-foot-message" role="alert">
        {message}
      </div>
      <div className="cli-def-foot-buttons">{children}</div>
    </div>
  );
}

function SupportTable({ cli }: { cli: CliSummary }) {
  const { t, language } = useI18n();
  const howTo = language.toLowerCase().startsWith("ja")
    ? `${repositoryUrl}/blob/main/README.ja.md#${encodeURIComponent("ほかの-cli-を追加する")}`
    : `${repositoryUrl}#add-other-clis`;
  const support = cli.support;
  if (!support) return null;
  return (
    <div
      className="cli-def-features"
      data-iori-cli-support={cli.id}
      role="group"
      aria-label={t("Support")}
    >
      <div className="cli-def-label">{t("Support")}</div>
      <div className="cli-def-feature-tables">
        {[CLI_FEATURES.slice(0, 3), CLI_FEATURES.slice(3)].map((group) => (
          <Table key={group[0]}>
            <TableHeader>
              <TableRow>
                {group.map((feature) => (
                  <TableHead key={feature}>
                    {t(featureLabels[feature])}
                  </TableHead>
                ))}
              </TableRow>
            </TableHeader>
            <TableBody>
              <TableRow>
                {group.map((feature) => (
                  <TableCell
                    key={feature}
                    data-iori-support={feature}
                    data-support={support[feature]}
                  >
                    {t(supportLabels[support[feature]])}
                  </TableCell>
                ))}
              </TableRow>
            </TableBody>
          </Table>
        ))}
      </div>
      {CLI_FEATURES.some((feature) => support[feature] === "undefined") && (
        <Button
          variant="ghost"
          size="sm"
          className="cli-def-howto"
          data-iori-action="cli-support-how-to"
          onClick={() => void native.openUrl(howTo)}
        >
          <ExternalLink size={14} />
          {t("How to make these available")}
        </Button>
      )}
    </div>
  );
}

/** A shared attachment list for uploads and JSON editors. */
function DefinitionFiles({
  files = [],
  missing,
  onChange,
  upload = false,
}: {
  files?: File[];
  missing: string[];
  onChange: (files: File[]) => void;
  upload?: boolean;
}) {
  const { t } = useI18n();
  const picker = useRef<HTMLInputElement>(null);
  if (!upload && !missing.length && !files.length) return null;
  return (
    <div className="cli-def-file-row">
      <div className="cli-def-file">
        <input
          ref={picker}
          type="file"
          multiple
          hidden
          data-iori-field="cli-definition-file"
          onChange={(event) => {
            const selected = Array.from(event.currentTarget.files ?? []);
            event.currentTarget.value = "";
            if (!selected.length) return;
            const combined = new Map(files.map((file) => [file.name, file]));
            for (const file of selected) combined.set(file.name, file);
            onChange([...combined.values()]);
          }}
        />
        <Button
          variant="outline"
          size="lg"
          data-iori-action="cli-definition-choose-file"
          onClick={() => picker.current?.click()}
        >
          <Upload />
          {t(upload ? "Upload file" : "Choose files")}
        </Button>
      </div>
      {!!files.length && (
        <ul className="cli-def-selected-files">
          {files.map((file) => (
            <li key={file.name}>
              <code className="cli-def-file-name">{file.name}</code>
              <Button
                variant="ghost"
                size="icon"
                aria-label={t("Remove {file}").replace("{file}", file.name)}
                data-iori-remove-file={file.name}
                onClick={() =>
                  onChange(
                    files.filter((selected) => selected.name !== file.name),
                  )
                }
              >
                <X size={16} />
              </Button>
            </li>
          ))}
        </ul>
      )}
      {!!missing.length && (
        <p
          className="cli-def-help"
          data-iori-state="cli-definition-missing-files"
        >
          {t("Also select these files: {files}").replace(
            "{files}",
            missing.join(", "),
          )}
        </p>
      )}
    </div>
  );
}
/** Existing and bundled attachments are resolved by the Host; selected files
 * need no transfer until the user adds or saves the definition. */
function useMissingDefinitionFiles(
  host: string,
  text: string,
  files?: File[],
  cliId?: string,
) {
  const [missing, setMissing] = useState<string[]>([]);
  useEffect(() => {
    let cancelled = false;
    setMissing([]);
    if (text.trim())
      void connection
        .requestHost(host, "cli.definition.check", {
          definition: text,
          ...(cliId ? { cliId } : {}),
        })
        .then((response) => {
          if (!cancelled && response?.ok && "summary" in response.result)
            setMissing(
              response.result.summary.missingFiles.filter(
                (name) => !files?.some((file) => file.name === name),
              ),
            );
        })
        .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [host, text, files, cliId]);
  return missing;
}

function IconField({
  cli,
  host,
  onChanged,
}: {
  cli: CliSummary;
  host: string;
  onChanged: () => Promise<void>;
}) {
  const { t } = useI18n();
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState<"image" | "reset">();
  const choose = async (file?: File) => {
    setBusy(file ? "image" : "reset");
    setMessage("");
    const uploaded: string[] = [];
    try {
      if (file && !(await definitionImageReadable(file))) {
        setMessage(t("Choose an SVG or PNG image."));
        return;
      }
      const image = file
        ? (
            await uploadDefinitionFiles(host, [file], (id) => uploaded.push(id))
          )[0]
        : undefined;
      const response = await connection.requestHost(host, "cli.icon.set", {
        cliId: cli.id,
        ...(image ? { image } : {}),
      });
      if (!response?.ok)
        setMessage(t(response?.error.code ?? "internal_error"));
      else if ("invalidImage" in response.result)
        setMessage(t("Choose an SVG or PNG image."));
      else await onChanged();
    } catch {
      setMessage(t("internal_error"));
    } finally {
      await connection
        .requestHost(host, "cli.definition.files.discard", {
          uploadIds: uploaded,
        })
        .catch(() => {});
      setBusy(undefined);
    }
  };
  return (
    <FieldRow label={t("Icon")} className="cli-def-icon-row">
      <CliIcon hostKey={host} cli={cli} size={24} />
      <div className="cli-def-image-picker">
        <Button
          variant="outline"
          disabled={!!busy}
          pending={busy === "image"}
          onClick={(event) =>
            event.currentTarget.parentElement?.querySelector("input")?.click()
          }
        >
          {t("Choose an image")}
        </Button>
        <input
          type="file"
          accept=".svg,.png,image/svg+xml,image/png"
          hidden
          data-iori-field="cli-icon-image"
          onChange={(event) => {
            const file = event.currentTarget.files?.[0];
            event.currentTarget.value = "";
            if (file) void choose(file);
          }}
        />
      </div>
      {cli.customIcon && (
        <Button
          variant="outline"
          disabled={!!busy}
          pending={busy === "reset"}
          data-iori-action="cli-icon-reset"
          onClick={() => void choose()}
        >
          {t(
            cli.source === "override"
              ? "Revert to the bundled icon"
              : "Revert to the common icon",
          )}
        </Button>
      )}
      {message && (
        <span className="cli-def-error" role="alert">
          {message}
        </span>
      )}
    </FieldRow>
  );
}

export function AgentsPage({
  host,
  clis,
  failed,
  listError,
  onRetryList,
  onChanged,
  expanded,
  onExpandedChange,
  registerEditor,
  renderSettings,
  renderModelError,
}: {
  host: string;
  /** The Host's CLIs with the user's definitions it does not find. */
  clis: CliSummary[];
  failed: CliDefinitionFailure[];
  listError: boolean;
  onRetryList: () => void;
  /** Read the CLIs again after a definition changed. */
  onChanged: () => Promise<void>;
  expanded: Record<string, boolean>;
  onExpandedChange: (id: string, open: boolean) => void;
  registerEditor?: RegisterSettingsEditor;
  renderSettings: (cli: CliSummary) => ReactNode;
  renderModelError: (cli: CliSummary) => ReactNode;
}) {
  const { t, catalogs } = useI18n();
  const [adding, setAdding] = useState<Adding | null>(null);
  const [editing, setEditing] = useState<Editing | null>(null);
  const [confirm, setConfirm] = useState<Confirm | null>(null);
  const [removal, setRemoval] = useState<Removal | null>(null);
  const [listMessage, setListMessage] = useState("");
  const [dialogMessage, setDialogMessage] = useState("");
  const [busy, setBusy] = useState<
    "add" | "save" | "confirm" | "remove" | undefined
  >();
  const helps = useRef(new Map<string, Promise<string | undefined>>());
  const uploads = useRef<string[]>([]);
  const discardUploads = () => {
    const ids = uploads.current.splice(0);
    if (ids.length)
      void connection
        .requestHost(host, "cli.definition.files.discard", { uploadIds: ids })
        .catch(() => {});
  };
  useEffect(
    () => () => {
      const ids = uploads.current.splice(0);
      if (ids.length)
        void connection
          .requestHost(host, "cli.definition.files.discard", { uploadIds: ids })
          .catch(() => {});
    },
    [host],
  );
  useEffect(() => {
    if (!adding && !editing && !confirm) discardUploads();
  }, [adding, editing, confirm]);
  // Read the definition JSON in the accumulated selection. A later selection
  // cancels this read, so it cannot replace the newer list.
  useEffect(() => {
    if (adding?.mode !== "file") return;
    const files = adding.files ?? [];
    if (!files.length) return;
    let cancelled = false;
    const json = files.filter((file) => /\.json$/iu.test(file.name));
    const file =
      json.length === 1
        ? json[0]
        : json.find((file) => file.name === "definition.json");
    if (!file) {
      setAdding(
        (current) =>
          current && {
            ...current,
            file: undefined,
            message: t("Choose one definition JSON file."),
          },
      );
      return;
    }
    void (async () => {
      try {
        const text = await file.text();
        if (cancelled) return;
        setAdding(
          (current) =>
            current && {
              ...current,
              file: { name: file.name, text },
              message: undefined,
              reason: undefined,
            },
        );
      } catch {
        if (!cancelled)
          setAdding(
            (current) =>
              current && { ...current, reason: { kind: "unreadable" } },
          );
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [adding?.mode, adding?.files, host, t]);
  const addingMissing = useMissingDefinitionFiles(
    host,
    adding?.mode === "json"
      ? adding.json
      : adding?.mode === "file"
        ? (adding.file?.text ?? "")
        : "",
    adding?.files,
  );
  const editingMissing = useMissingDefinitionFiles(
    host,
    editing?.json ?? "",
    editing?.files,
    editing?.id,
  );
  useSettingsEditor(
    () =>
      (!!adding &&
        (adding.mode === "simple"
          ? JSON.stringify(adding.simple) !== JSON.stringify(emptySimple)
          : adding.mode === "json"
            ? !!adding.json.trim()
            : !!adding.files?.length)) ||
      (!!editing &&
        (!!editing.files?.length ||
          (editing.simple
            ? JSON.stringify(editing.simple) !== editing.initial
            : editing.json !== editing.initial))),
    registerEditor,
    () => {
      setAdding(null);
      setEditing(null);
    },
  );
  const failure = (code?: string) => t(code ?? "internal_error");
  const request = async <T,>(
    send: () => Promise<
      | { ok: true; result: T }
      | { ok: false; error: { code: string } }
      | undefined
    >,
  ): Promise<{ result: T } | { error: string }> => {
    try {
      const response = await send();
      return response?.ok
        ? { result: response.result }
        : { error: failure(response?.error.code) };
    } catch {
      return { error: failure() };
    }
  };
  const opened = async (id: string) => {
    await onChanged();
    onExpandedChange(id, true);
    requestAnimationFrame(() =>
      document
        .getElementById(`team-agent-${id}`)
        ?.scrollIntoView({ block: "nearest" }),
    );
  };

  /** Ask before a definition received as JSON is saved. */
  const check = async (
    text: string,
    cliId: string | undefined,
    kind: Confirm["kind"],
    show: (changes: { reason?: CliDefinitionReason; message?: string }) => void,
    files?: CliDefinitionAttachment[],
  ) => {
    const checked = await request(() =>
      connection.requestHost(host, "cli.definition.check", {
        definition: text,
        ...(files ? { files } : {}),
        ...(cliId ? { cliId } : {}),
      }),
    );
    if ("error" in checked) return show({ message: checked.error });
    if ("reason" in checked.result)
      return show({ reason: checked.result.reason });
    if ("missing" in checked.result)
      return show({
        message: t("Also select these files: {files}").replace(
          "{files}",
          checked.result.missing.join(", "),
        ),
      });
    const summary = checked.result.summary;
    setDialogMessage("");
    const pending: Confirm = {
      kind: kind === "add" && summary.replaces ? "replace" : kind,
      text,
      ...(cliId ? { cliId } : {}),
      summary,
      ...(files ? { files } : {}),
    };
    if (summary.requiresConfirmation) setConfirm(pending);
    else await saveConfirmed(pending, show);
  };
  const saveConfirmed = async (
    pending = confirm,
    show?: (changes: {
      reason?: CliDefinitionReason;
      message?: string;
    }) => void,
  ) => {
    if (!pending) return;
    if (!show) setBusy("confirm");
    const saved = await request(() =>
      connection.requestHost(host, "cli.definition.save", {
        definition: pending.text,
        ...(pending.files ? { files: pending.files } : {}),
        ...(pending.cliId ? { cliId: pending.cliId } : {}),
      }),
    );
    setBusy(undefined);
    if ("error" in saved)
      return show
        ? show({ message: saved.error })
        : setDialogMessage(saved.error);
    if ("reason" in saved.result) {
      // The definition changed on the Host after it was checked.
      const reason = saved.result.reason;
      setConfirm(null);
      if (pending.cliId)
        setEditing((current) => current && { ...current, reason });
      else setAdding((current) => current && { ...current, reason });
      return;
    }
    if ("missing" in saved.result) {
      const message = t("Also select these files: {files}").replace(
        "{files}",
        saved.result.missing.join(", "),
      );
      return show ? show({ message }) : setDialogMessage(message);
    }
    setConfirm(null);
    setAdding(null);
    setEditing(null);
    await opened(saved.result.cliId);
  };

  const add = async () => {
    if (!adding || busy) return;
    if (adding.mode === "simple") {
      const simple = simpleOf(adding.simple);
      if (!simple.name || !simple.command)
        return setAdding({
          ...adding,
          message: t("Enter a name and a command."),
        });
      setBusy("add");
      const saved = await request(() =>
        connection.requestHost(host, "cli.definition.simple", { simple }),
      );
      setBusy(undefined);
      if ("error" in saved)
        return setAdding({ ...adding, message: saved.error });
      if ("replacement" in saved.result) {
        setBusy("add");
        await check(
          saved.result.replacement,
          undefined,
          "replace",
          (changes) => setAdding({ ...adding, ...changes }),
          [],
        );
        setBusy(undefined);
        return;
      }
      setAdding(null);
      await opened(saved.result.cliId);
      return;
    }
    const text =
      adding.mode === "json" ? adding.json : (adding.file?.text ?? "");
    if (!text.trim())
      return setAdding({
        ...adding,
        message: t(
          adding.mode === "json" ? "Enter the JSON." : "Upload a file.",
        ),
      });
    if (addingMissing.length) return;
    setBusy("add");
    discardUploads();
    try {
      const reason = await definitionImageReason(text, adding.files);
      if (reason) {
        setAdding({ ...adding, reason });
        setBusy(undefined);
        return;
      }
      const files = await uploadDefinitionFiles(
        host,
        adding.files?.filter(
          (file) => adding.mode !== "file" || file.name !== adding.file?.name,
        ) ?? [],
        (id) => uploads.current.push(id),
      );
      await check(
        text,
        undefined,
        "add",
        (changes) => setAdding({ ...adding, ...changes }),
        files,
      );
    } catch {
      setAdding({ ...adding, message: failure() });
    }
    setBusy(undefined);
  };
  /** Draft the model argument once per launch command, from its `--help`. */
  const draftModelArgument = async () => {
    if (!adding || adding.mode !== "simple") return;
    const command = adding.simple.command.trim();
    if (!command || helps.current.has(command)) return;
    const probe = connection
      .requestHost(host, "cli.help", { command })
      .then((response) =>
        response?.ok && response.result.modelArgument
          ? `${response.result.helpCommand ?? ""}\u0000${response.result.modelArgument}`
          : undefined,
      )
      .catch(() => undefined);
    helps.current.set(command, probe);
    const found = await probe;
    if (!found) return;
    const [helpCommand, modelArgument] = found.split("\u0000");
    setAdding((current) =>
      current &&
      current.simple.command.trim() === command &&
      !current.simple.modelArgument.trim()
        ? {
            ...current,
            help: helpCommand,
            simple: { ...current.simple, modelArgument: modelArgument! },
          }
        : current,
    );
  };

  const startEdit = (id: string, simple?: CliSimpleDefinition, json = "") => {
    const value = simple && fieldsOf(simple);
    setEditing(
      value
        ? { id, simple: value, initial: JSON.stringify(value) }
        : { id, json, initial: json },
    );
  };
  const saveEdit = async (kind: Confirm["kind"]) => {
    if (!editing || busy) return;
    if (editing.simple) {
      const simple = simpleOf(editing.simple);
      if (!simple.name || !simple.command)
        return setEditing({
          ...editing,
          message: t("Enter a name and a command."),
        });
      setBusy("save");
      const saved = await request(() =>
        connection.requestHost(host, "cli.definition.simple", {
          simple,
          cliId: editing.id,
        }),
      );
      setBusy(undefined);
      if ("error" in saved)
        return setEditing({ ...editing, message: saved.error });
      if ("replacement" in saved.result) return;
      setEditing(null);
      await onChanged();
      return;
    }
    const text = editing.json ?? "";
    // Saving the definition as it was changes nothing.
    if (text === editing.initial && !editing.files?.length)
      return setEditing(null);
    if (!text.trim())
      return setEditing({ ...editing, message: t("Enter the JSON.") });
    if (editingMissing.length) return;
    setBusy("save");
    discardUploads();
    try {
      const reason = await definitionImageReason(text, editing.files);
      if (reason) {
        setEditing({ ...editing, reason });
        setBusy(undefined);
        return;
      }
      const files = await uploadDefinitionFiles(
        host,
        editing.files ?? [],
        (id) => uploads.current.push(id),
      );
      await check(
        text,
        editing.id,
        kind,
        (changes) => setEditing({ ...editing, ...changes }),
        files,
      );
    } catch {
      setEditing({ ...editing, message: failure() });
    }
    setBusy(undefined);
  };
  const remove = async () => {
    if (!removal) return;
    setBusy("remove");
    const removed = await request(() =>
      connection.requestHost(host, "cli.definition.remove", {
        cliId: removal.id,
      }),
    );
    setBusy(undefined);
    if ("error" in removed) return setDialogMessage(removed.error);
    if (editing?.id === removal.id) setEditing(null);
    setRemoval(null);
    await onChanged();
  };

  const jsonEditor = (kind: Confirm["kind"]) => (
    <div
      className="cli-def-editor"
      data-iori-view="cli-definition-editor"
      onKeyDown={(event) => saveOnEnter(event, () => void saveEdit(kind))}
    >
      <FieldRow stacked label={t("Definition JSON")} className="field-code">
        <Textarea
          className="cli-def-json"
          aria-label={t("Definition JSON")}
          aria-invalid={!!editing?.reason}
          data-iori-field="cli-definition-json"
          spellCheck={false}
          rows={14}
          value={editing?.json ?? ""}
          onChange={(event) =>
            setEditing(
              (current) =>
                current && {
                  ...current,
                  json: event.target.value,
                  message: undefined,
                  reason: undefined,
                },
            )
          }
        />
        {editing?.reason && <Reason reason={editing.reason} />}
        <DefinitionFiles
          files={editing?.files}
          missing={editingMissing}
          onChange={(files) =>
            setEditing(
              (current) =>
                current && {
                  ...current,
                  files,
                  message: undefined,
                  reason: undefined,
                },
            )
          }
        />
      </FieldRow>
      <Foot message={editing?.message}>
        <Button
          variant="outline"
          size="lg"
          data-iori-action="cli-definition-cancel"
          onClick={() => setEditing(null)}
        >
          {t("Cancel")}
        </Button>
        <Button
          size="lg"
          pending={busy === "save"}
          data-iori-action="cli-definition-save"
          onClick={() => void saveEdit(kind)}
        >
          {t("Save")}
        </Button>
      </Foot>
    </div>
  );

  const setHidden = async (cli: CliSummary) => {
    const response = await request(() =>
      connection.requestHost(host, "cli.hidden.set", {
        cliId: cli.id,
        hidden: !cli.hidden,
      }),
    );
    if ("error" in response) {
      setListMessage(t("Could not change picker visibility. Retry."));
      return;
    }
    setListMessage("");
    await onChanged();
  };
  const cliRow = (cli: CliSummary) => {
    const open = !!expanded[cli.id];
    const edit = editing?.id === cli.id ? editing : null;
    const user = cli.source === "user" || cli.source === "override";
    return (
      <Collapsible
        data-iori-cli-row={cli.id}
        data-iori-cli-source={cli.source}
        id={`team-agent-${cli.id}`}
        key={cli.id}
        open={open}
        onOpenChange={(yes) => onExpandedChange(cli.id, yes)}
      >
        <div className="team-agent-top">
          <CollapsibleTrigger asChild>
            <Button variant="ghost" className="team-agent-toggle">
              {open ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
              <span className="cli-def-icon">
                <CliIcon hostKey={host} cli={cli} size={18} />
              </span>
              <div className="team-agent-copy">
                <span className="team-agent-name cli-def-title">
                  <span title={cli.name}>{cli.name}</span>
                </span>
                {user && (
                  <span
                    className="cli-def-mark"
                    data-iori-state="cli-user-definition"
                  >
                    {t("User definition")}
                  </span>
                )}
                {cli.missing ? (
                  <div
                    className="team-usage cli-def-missing"
                    data-iori-state="cli-missing"
                  >
                    {t("Not found on this Host")}
                  </div>
                ) : cli.usage ||
                  !cli.supportsUsage ||
                  catalogs[cli.id]?.error ? (
                  <Usage cliId={cli.id} usage={cli.usage} />
                ) : (
                  <div className="team-usage" aria-hidden="true">
                    {" "}
                  </div>
                )}
              </div>
            </Button>
          </CollapsibleTrigger>
          <div className="team-agent-right">
            <small
              className="team-agent-version"
              data-iori-cli-version={cli.id}
              title={cli.version}
            >
              {cli.version}
            </small>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon-sm"
                  aria-label={t("CLI actions")}
                  data-iori-action="cli-actions"
                >
                  <MoreHorizontal size={16} />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="team-menu">
                <DropdownMenuItem
                  data-iori-action="cli-hidden-set"
                  onSelect={() => void setHidden(cli)}
                >
                  {t(cli.hidden ? "Show in pickers" : "Hide from pickers")}
                </DropdownMenuItem>
                {user && <DropdownMenuSeparator />}
                {cli.source === "user" && (
                  <DropdownMenuItem
                    variant="destructive"
                    data-iori-action="cli-definition-delete"
                    onSelect={() => {
                      setDialogMessage("");
                      setRemoval({
                        kind: "delete",
                        id: cli.id,
                        name: cli.name,
                      });
                    }}
                  >
                    {t("Delete")}
                  </DropdownMenuItem>
                )}
                {cli.source === "override" && (
                  <DropdownMenuItem
                    data-iori-action="cli-definition-revert"
                    onSelect={() => {
                      setDialogMessage("");
                      setRemoval({
                        kind: "revert",
                        id: cli.id,
                        name: cli.name,
                      });
                    }}
                  >
                    {t("Revert to the bundled definition")}
                  </DropdownMenuItem>
                )}
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </div>
        {!cli.missing && renderModelError(cli)}
        <CollapsibleContent forceMount hidden={!open}>
          {renderSettings(cli)}
          <div className="cli-def-detail">
            <SupportTable cli={cli} />
            <IconField cli={cli} host={host} onChanged={onChanged} />
            {!edit && (
              <FieldRow label={t("Definition")} className="cli-def-actions">
                <Button
                  variant="outline"
                  data-iori-action="cli-definition-edit"
                  onClick={() =>
                    startEdit(cli.id, cli.simple, cli.definition ?? "")
                  }
                >
                  {t("Edit definition")}
                </Button>
              </FieldRow>
            )}
            {edit?.simple ? (
              <div
                className="cli-def-editor"
                data-iori-view="cli-definition-editor"
                onKeyDown={(event) =>
                  saveOnEnter(event, () => void saveEdit("save"))
                }
              >
                <SimpleFields
                  value={edit.simple}
                  onChange={(simple) =>
                    setEditing({ ...edit, simple, message: undefined })
                  }
                />
                <Foot message={edit.message}>
                  <Button
                    variant="outline"
                    size="lg"
                    data-iori-action="cli-definition-cancel"
                    onClick={() => setEditing(null)}
                  >
                    {t("Cancel")}
                  </Button>
                  <Button
                    size="lg"
                    pending={busy === "save"}
                    data-iori-action="cli-definition-save"
                    onClick={() => void saveEdit("save")}
                  >
                    {t("Save")}
                  </Button>
                </Foot>
              </div>
            ) : (
              edit && jsonEditor(user ? "save" : "replace")
            )}
          </div>
        </CollapsibleContent>
      </Collapsible>
    );
  };

  const failedRow = (item: CliDefinitionFailure) => (
    <div
      key={item.folder}
      id={`team-agent-${item.folder}`}
      className="cli-def-failed"
      data-iori-cli-failed={item.folder}
    >
      <div className="cli-def-failed-head">
        <span className="cli-def-icon cli-def-failed-icon">
          <CircleAlert size={18} />
        </span>
        <div className="cli-def-failed-copy">
          <span className="team-agent-name">{item.folder}</span>
          <span className="cli-def-reason">
            {t("Failed to load the definition")}
          </span>
          <span className="cli-def-reason" data-iori-state="cli-failed-reason">
            <ReasonText reason={item.reason} />
          </span>
        </div>
        {editing?.id !== item.folder && (
          <div className="cli-def-failed-actions">
            <Button
              variant="outline"
              data-iori-action="cli-definition-edit"
              onClick={() => startEdit(item.folder, undefined, item.definition)}
            >
              {t("Edit definition")}
            </Button>
            <Button
              variant="destructive"
              data-iori-action="cli-definition-delete"
              onClick={() => {
                setDialogMessage("");
                setRemoval({
                  kind: "delete",
                  id: item.folder,
                  name: item.folder,
                });
              }}
            >
              {t("Delete")}
            </Button>
          </div>
        )}
      </div>
      {editing?.id === item.folder && (
        <div className="cli-def-detail">{jsonEditor("save")}</div>
      )}
    </div>
  );

  const addForm = (state: Adding) => {
    const update = (changes: Partial<Adding>) =>
      setAdding({
        ...state,
        ...changes,
        message: undefined,
        reason: undefined,
      });
    return (
      <div
        className="cli-def-add"
        data-iori-view="cli-definition-add"
        onKeyDown={(event) => saveOnEnter(event, () => void add())}
      >
        <FieldRow label={t("Add method")} className="cli-def-mode-row">
          <ToggleGroup
            type="single"
            variant="outline"
            className="cli-def-modes"
            value={state.mode}
            aria-label={t("Add method")}
            onValueChange={(mode) => mode && update({ mode: mode as AddMode })}
          >
            <ToggleGroupItem value="simple" data-iori-action="cli-add-simple">
              {t("Name and command")}
            </ToggleGroupItem>
            <ToggleGroupItem value="json" data-iori-action="cli-add-json">
              {t("JSON")}
            </ToggleGroupItem>
            <ToggleGroupItem value="file" data-iori-action="cli-add-file">
              {t("Upload file")}
            </ToggleGroupItem>
          </ToggleGroup>
        </FieldRow>
        {state.mode === "simple" && (
          <SimpleFields
            value={state.simple}
            help={state.help}
            onChange={(simple) =>
              update({
                simple,
                // The note belongs to the argument filled in from `--help`.
                ...(simple.modelArgument !== state.simple.modelArgument
                  ? { help: undefined }
                  : {}),
              })
            }
            onCommandDone={() => void draftModelArgument()}
          />
        )}
        {state.mode === "json" && (
          <FieldRow stacked label={t("Definition JSON")} className="field-code">
            <Textarea
              className="cli-def-json"
              aria-label={t("Definition JSON")}
              aria-invalid={!!state.reason}
              data-iori-field="cli-definition-json"
              spellCheck={false}
              rows={8}
              value={state.json}
              placeholder={
                '{ "schema": 1, "id": "…", "name": "…", "command": "…" }'
              }
              onChange={(event) => update({ json: event.target.value })}
            />
            {state.reason && <Reason reason={state.reason} />}
            <DefinitionFiles
              files={state.files}
              missing={addingMissing}
              onChange={(files) => update({ files })}
            />
          </FieldRow>
        )}
        {state.mode === "file" && (
          <FieldRow className="cli-def-file-row">
            <DefinitionFiles
              upload
              files={state.files}
              missing={addingMissing}
              onChange={(files) => update({ files, file: undefined })}
            />
            {state.reason && <Reason reason={state.reason} />}
          </FieldRow>
        )}
        <Foot message={state.message}>
          <Button
            variant="outline"
            size="lg"
            data-iori-action="cli-add-cancel"
            onClick={() => setAdding(null)}
          >
            {t("Cancel")}
          </Button>
          <Button
            size="lg"
            pending={busy === "add"}
            data-iori-action="cli-add-submit"
            onClick={() => void add()}
          >
            {t("Add")}
          </Button>
        </Foot>
      </div>
    );
  };

  const commandLabels = {
    launch: "Launch",
    models: "Model list",
    tokens: "Tokens",
    usage: "Usage limits",
  };
  const summary = confirm?.summary;
  const hasEffects = !!(
    summary?.commands.length ||
    summary?.settings.length ||
    summary?.files.length
  );
  return (
    <PageBody width="editor" className="team-content team-agents-page">
      <PageHeader
        title={t("AI Agents")}
        description={t("CLIs available on this Host")}
      />
      {listError && (
        <div className="team-model-error" role="alert">
          <p>{t("Could not load CLIs. Retry.")}</p>
          <Button variant="outline" size="sm" onClick={onRetryList}>
            {t("Retry")}
          </Button>
        </div>
      )}
      {listMessage && <p role="alert">{listMessage}</p>}
      <SettingsSection className="team-agent-list" title="CLI">
        {clis.filter((cli) => !cli.hidden).map(cliRow)}
        {failed.map(failedRow)}
        {clis.some((cli) => cli.hidden) && (
          <HiddenItems>
            {clis.filter((cli) => cli.hidden).map(cliRow)}
          </HiddenItems>
        )}
      </SettingsSection>
      <SettingsSection
        className="cli-def-add-section"
        title={t("Add CLI")}
        id="team-cli-form"
      >
        {adding ? (
          addForm(adding)
        ) : (
          <div className="cli-def-add-open">
            <Button
              variant="outline"
              size="lg"
              data-iori-action="cli-add-open"
              onClick={() =>
                setAdding({ mode: "simple", simple: emptySimple, json: "" })
              }
            >
              <Plus />
              {t("Add CLI")}
            </Button>
          </div>
        )}
      </SettingsSection>

      <Dialog
        open={!!confirm}
        onOpenChange={(yes) => {
          if (!yes) setConfirm(null);
        }}
      >
        <DialogContent
          className="team-dialog cli-def-confirm"
          data-iori-view="cli-definition-confirmation"
          {...(!hasEffects ? { "aria-describedby": undefined } : {})}
          showCloseButton={false}
        >
          {confirm && summary && (
            <>
              <DialogHeader>
                <DialogTitle>
                  {t(
                    confirm.kind === "add"
                      ? "Add the definition of {name}?"
                      : confirm.kind === "replace"
                        ? "Overwrite the definition of {name}?"
                        : "Save the definition of {name}?",
                  ).replace("{name}", summary.name)}
                </DialogTitle>
                {hasEffects && (
                  <DialogDescription>
                    {t("Using this definition does the following on the Host.")}
                  </DialogDescription>
                )}
              </DialogHeader>
              {(hasEffects || dialogMessage) && (
                <DialogBody>
                  {hasEffects && (
                    <dl className="cli-def-confirm-list">
                      {!!summary.commands.length && (
                        <div>
                          <dt>{t("Commands to run")}</dt>
                          <dd>
                            {summary.commands.map((command) => (
                              <div
                                key={command.kind}
                                className="cli-def-command"
                                data-iori-command={command.kind}
                              >
                                <span>{t(commandLabels[command.kind])}</span>
                                <code>{command.line}</code>
                              </div>
                            ))}
                          </dd>
                        </div>
                      )}
                      {!!summary.settings.length && (
                        <div data-iori-state="cli-confirm-settings">
                          <dt>{t("Settings files to change")}</dt>
                          <dd>
                            {summary.settings.map((path) => (
                              <code key={path}>{path}</code>
                            ))}
                          </dd>
                        </div>
                      )}
                      {!!summary.files.length && (
                        <div data-iori-state="cli-confirm-files">
                          <dt>{t("CLI plugins")}</dt>
                          <dd>
                            {summary.files.map((file) => (
                              <code key={file}>{file}</code>
                            ))}
                          </dd>
                        </div>
                      )}
                    </dl>
                  )}
                  {dialogMessage && (
                    <p className="team-error" role="alert">
                      {dialogMessage}
                    </p>
                  )}
                </DialogBody>
              )}
              <DialogFooter>
                <Button variant="outline" onClick={() => setConfirm(null)}>
                  {t("Cancel")}
                </Button>
                <Button
                  pending={busy === "confirm"}
                  data-iori-action="cli-definition-confirm"
                  onClick={() => void saveConfirmed()}
                >
                  {t(
                    confirm.kind === "add"
                      ? "Add"
                      : confirm.kind === "replace"
                        ? "Overwrite"
                        : "Save",
                  )}
                </Button>
              </DialogFooter>
            </>
          )}
        </DialogContent>
      </Dialog>

      <Dialog
        open={!!removal}
        onOpenChange={(yes) => {
          if (!yes) setRemoval(null);
        }}
      >
        <DialogContent
          className="team-dialog"
          data-iori-view="cli-definition-removal"
          showCloseButton={false}
        >
          {removal && (
            <>
              <DialogHeader>
                <DialogTitle>
                  {removal.kind === "delete"
                    ? t("Delete the definition of {name}?").replace(
                        "{name}",
                        removal.name,
                      )
                    : t("Revert to the bundled definition?")}
                </DialogTitle>
                <DialogDescription>
                  {t(
                    removal.kind === "delete"
                      ? "Hooks that iori added to settings files are also deleted. The CLI's own settings and conversations, and running Terminals, are not affected."
                      : "The user definition is deleted.",
                  )}
                </DialogDescription>
              </DialogHeader>
              {dialogMessage && (
                <p className="team-error" role="alert">
                  {dialogMessage}
                </p>
              )}
              <DialogFooter>
                <Button variant="outline" onClick={() => setRemoval(null)}>
                  {t("Cancel")}
                </Button>
                <Button
                  variant="destructive"
                  pending={busy === "remove"}
                  data-iori-action="cli-definition-remove"
                  onClick={() => void remove()}
                >
                  {t(
                    removal.kind === "delete"
                      ? "Delete"
                      : "Revert to the bundled definition",
                  )}
                </Button>
              </DialogFooter>
            </>
          )}
        </DialogContent>
      </Dialog>
    </PageBody>
  );
}
