import { Fragment, useEffect, useRef, useState } from "react";
import type { ReactNode } from "react";
import { CircleAlert, ExternalLink, Upload, X } from "lucide-react";
import {
  CLI_FEATURES,
  type CliDefinitionReason,
  type CliFeature,
  type CliSummary,
} from "@iori/protocol";
import { cn } from "cn";
import source from "../../../../../release-source.txt?raw";
import { connection } from "../../connection.ts";
import { native } from "../../native.ts";
import {
  definitionImageReadable,
  uploadDefinitionFiles,
} from "../../cli-definition-files.ts";
import { CliIcon } from "../../CliIcon.tsx";
import { FlatSettingRow } from "../../components/SectionLayout.tsx";
import { Button } from "../../components/ui/button.tsx";
import { Input } from "../../components/ui/input.tsx";
import { Textarea } from "../../components/ui/textarea.tsx";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "../../components/ui/select.tsx";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "../../components/ui/table.tsx";
import { useI18n } from "../context.tsx";
import type { ModelSource, SimpleFieldsValue } from "./cli-definition-types.ts";

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

export function ReasonText({ reason }: { reason: CliDefinitionReason }) {
  const { t, language } = useI18n();
  const code = (value: string) => (
    <code className="rounded-xs bg-muted px-1 py-0.5 font-mono text-2xs text-foreground">
      {value}
    </code>
  );
  const field = "field" in reason ? code(reason.field) : undefined;
  switch (reason.kind) {
    case "json":
      return reason.line !== undefined && reason.column !== undefined
        ? t("The JSON format is not valid (line {line}, column {column}).")
            .replace("{line}", String(reason.line))
            .replace("{column}", String(reason.column))
        : t("The JSON format is not valid.");
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

export function Reason({ reason }: { reason: CliDefinitionReason }) {
  return (
    <span
      className="inline-flex items-start gap-1.5 text-xs text-status-failed-text [overflow-wrap:anywhere]"
      role="alert"
      data-iori-state="cli-definition-error"
    >
      <CircleAlert
        className="mt-0.5 size-3.5 shrink-0 text-status-failed"
        aria-hidden="true"
      />
      <span>
        <ReasonText reason={reason} />
      </span>
    </span>
  );
}

/** The fields of a definition made from a name and a launch command, in
 * adding and in editing it. */
export function SimpleFields({
  value,
  onChange,
  rowClassName,
}: {
  value: SimpleFieldsValue;
  onChange: (value: SimpleFieldsValue) => void;
  rowClassName?: string;
}) {
  const { t } = useI18n();
  return (
    <>
      <FlatSettingRow stacked label={t("Name")} className={rowClassName}>
        <Input
          aria-label={t("Name")}
          className="w-full sm:max-w-80"
          data-iori-field="cli-name"
          value={value.name}
          onChange={(event) => onChange({ ...value, name: event.target.value })}
        />
      </FlatSettingRow>
      <FlatSettingRow
        stacked
        label={t("Launch command")}
        className={rowClassName}
      >
        <Input
          aria-label={t("Launch command")}
          className="font-mono text-xs"
          data-iori-field="cli-command"
          value={value.command}
          placeholder="my-cli"
          onChange={(event) =>
            onChange({ ...value, command: event.target.value })
          }
        />
      </FlatSettingRow>
      <FlatSettingRow
        stacked
        label={t("Model argument")}
        className={rowClassName}
      >
        <Input
          aria-label={t("Model argument")}
          className="font-mono text-xs"
          data-iori-field="cli-model-argument"
          value={value.modelArgument}
          placeholder="--model {model}"
          onChange={(event) =>
            onChange({ ...value, modelArgument: event.target.value })
          }
        />
      </FlatSettingRow>
      <FlatSettingRow
        stacked
        label={t("Model candidates")}
        className={rowClassName}
      >
        <div className="flex flex-col gap-2">
          <Select
            value={value.modelSource}
            onValueChange={(modelSource) =>
              onChange({ ...value, modelSource: modelSource as ModelSource })
            }
          >
            <SelectTrigger
              aria-label={t("Model candidates")}
              className="w-52 max-w-full"
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
              className="font-mono text-xs"
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
              className="font-mono text-xs"
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
      </FlatSettingRow>
    </>
  );
}

export function Foot({
  message,
  className,
  children,
}: {
  message?: ReactNode;
  className?: string;
  children: ReactNode;
}) {
  return (
    <div
      className={cn(
        "flex flex-col gap-2.5 sm:flex-row sm:items-center sm:justify-between",
        className,
      )}
    >
      <div
        className="min-w-0 text-xs text-status-failed-text [overflow-wrap:anywhere] empty:hidden"
        role="alert"
      >
        {message}
      </div>
      <div className="flex shrink-0 flex-wrap items-center justify-end gap-2 sm:ml-auto">
        {children}
      </div>
    </div>
  );
}

export function SupportTable({ cli }: { cli: CliSummary }) {
  const { t, language } = useI18n();
  const howTo = language.toLowerCase().startsWith("ja")
    ? `${repositoryUrl}/blob/main/README.ja.md#${encodeURIComponent("ほかの-cli-を追加する")}`
    : `${repositoryUrl}#add-other-clis`;
  const support = cli.support;
  if (!support) return null;
  return (
    <div
      className="flex flex-col gap-2 px-4 py-3 md:pl-11"
      data-iori-cli-support={cli.id}
      role="group"
      aria-label={t("Support")}
    >
      <div className="text-xs font-medium text-foreground">{t("Support")}</div>
      <div className="flex flex-wrap gap-y-2 [&>[data-slot=table-container]]:min-w-0 [&>[data-slot=table-container]]:flex-[1_1_16rem] [&>[data-slot=table-container]]:overflow-visible">
        {[CLI_FEATURES.slice(0, 3), CLI_FEATURES.slice(3)].map((group) => (
          <Table key={group[0]} className="table-fixed text-xs">
            <TableHeader>
              <TableRow className="border-border-subtle hover:bg-transparent">
                {group.map((feature) => (
                  <TableHead
                    key={feature}
                    className="h-auto py-1.5 pr-3 pl-0 font-normal whitespace-normal text-muted-foreground [overflow-wrap:anywhere]"
                  >
                    {t(featureLabels[feature])}
                  </TableHead>
                ))}
              </TableRow>
            </TableHeader>
            <TableBody>
              <TableRow className="border-0 hover:bg-transparent">
                {group.map((feature) => (
                  <TableCell
                    key={feature}
                    data-iori-support={feature}
                    data-support={support[feature]}
                    className={cn(
                      "h-auto py-1.5 pr-3 pl-0 whitespace-normal [overflow-wrap:anywhere]",
                      support[feature] === "available"
                        ? "font-medium text-foreground"
                        : "text-muted-foreground",
                    )}
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
        <div>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="-ml-2 font-normal text-muted-foreground hover:text-foreground"
            data-iori-action="cli-support-how-to"
            onClick={() => void native.openUrl(howTo)}
          >
            <ExternalLink className="size-3.5" aria-hidden="true" />
            {t("How to make these available")}
          </Button>
        </div>
      )}
    </div>
  );
}

/** A shared attachment list for uploads and JSON editors. */
export function DefinitionFiles({
  files = [],
  missing,
  onChange,
  upload = false,
  showPicker = false,
}: {
  files?: File[];
  missing: string[];
  onChange: (files: File[]) => void;
  upload?: boolean;
  showPicker?: boolean;
}) {
  const { t } = useI18n();
  const picker = useRef<HTMLInputElement>(null);
  if (!upload && !showPicker && !missing.length && !files.length) return null;
  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
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
          type="button"
          variant="outline"
          size="sm"
          data-iori-action="cli-definition-choose-file"
          onClick={() => picker.current?.click()}
        >
          <Upload className="size-3.5" aria-hidden="true" />
          {t(upload ? "Upload file" : "Choose files")}
        </Button>
      </div>
      {!!files.length && (
        <ul className="m-0 flex list-none flex-col divide-y divide-border-subtle border-y border-border-subtle p-0">
          {files.map((file) => (
            <li
              key={file.name}
              className="flex items-center justify-between gap-3 py-1.5"
            >
              <code className="min-w-0 font-mono text-xs text-foreground [overflow-wrap:anywhere]">
                {file.name}
              </code>
              <Button
                type="button"
                variant="ghost"
                size="icon-sm"
                className="shrink-0 text-muted-foreground hover:text-foreground"
                aria-label={t("Remove {file}").replace("{file}", file.name)}
                data-iori-remove-file={file.name}
                onClick={() =>
                  onChange(
                    files.filter((selected) => selected.name !== file.name),
                  )
                }
              >
                <X className="size-3.5" aria-hidden="true" />
              </Button>
            </li>
          ))}
        </ul>
      )}
      {!!missing.length && (
        <p
          className="text-xs text-muted-foreground"
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
export function useMissingDefinitionFiles(
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

export function IconField({
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
  const inputRef = useRef<HTMLInputElement>(null);

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
    <FlatSettingRow
      label={t("Icon")}
      className="px-4 py-3 md:pl-11"
      error={message || undefined}
    >
      <div className="flex flex-wrap items-center gap-2.5">
        <span className="inline-flex size-6 shrink-0 items-center justify-center">
          <CliIcon hostKey={host} cli={cli} size={24} />
        </span>
        <div className="inline-flex items-center">
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={!!busy}
            pending={busy === "image"}
            onClick={() => inputRef.current?.click()}
          >
            {t("Choose an image")}
          </Button>
          <input
            ref={inputRef}
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
            type="button"
            variant="outline"
            size="sm"
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
      </div>
    </FlatSettingRow>
  );
}
