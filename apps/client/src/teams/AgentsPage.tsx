import { useEffect, useRef, useState } from "react";
import type { ReactNode } from "react";
import {
  ArrowDown,
  ArrowUp,
  Bot,
  ChevronDown,
  ChevronRight,
  CircleAlert,
  MoreHorizontal,
  Plus,
  RotateCw,
} from "lucide-react";
import type {
  CliDefinitionAttachment,
  CliDefinitionFailure,
  CliDefinitionReason,
  CliSummary,
} from "@iori/protocol";
import {
  DndContext,
  KeyboardSensor,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
} from "@dnd-kit/core";
import {
  SortableContext,
  arrayMove,
  sortableKeyboardCoordinates,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { cn } from "cn";
import { connection } from "../connection.ts";
import {
  definitionImageReason,
  uploadDefinitionFiles,
} from "../cli-definition-files.ts";
import { CliIcon } from "../CliIcon.tsx";
import { saveOnEnter } from "../components/page-layout.tsx";
import { AsyncState, type AsyncViewMode } from "../components/AsyncState.tsx";
import {
  FlatPageHeader,
  FlatSection,
  FlatSettingRow,
} from "../components/SectionLayout.tsx";
import { Badge } from "../components/ui/badge.tsx";
import { Button } from "../components/ui/button.tsx";
import { Textarea } from "../components/ui/textarea.tsx";
import {
  ToggleGroup,
  ToggleGroupItem,
} from "../components/ui/toggle-group.tsx";
import {
  CollapsibleContent,
  CollapsibleTrigger,
} from "../components/ui/collapsible.tsx";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "../components/ui/dropdown-menu.tsx";
import {
  useSettingsEditor,
  type RegisterSettingsEditor,
} from "../settings-save.ts";
import { useI18n } from "./context.tsx";
import { Usage } from "./Usage.tsx";
import {
  DefinitionFileDisclosure,
  DefinitionFileStatus,
  DefinitionFileTabs,
  DefinitionTextField,
  definitionFileKey,
  definitionFiles,
  definitionJsonKey,
  useDefinitionFileReads,
  type DefinitionFile,
} from "./DefinitionFilesSection.tsx";
import {
  emptySimple,
  fieldsOf,
  simpleOf,
  type AddMode,
  type Adding,
  type Confirm,
  type Editing,
  type FileDisclosures,
  type Removal,
} from "./agents/cli-definition-types.ts";
import {
  DefinitionFiles,
  Foot,
  IconField,
  Reason,
  ReasonText,
  SimpleFields,
  SupportTable,
  useMissingDefinitionFiles,
} from "./agents/CliDefinitionForms.tsx";
import {
  CliDefinitionConfirmDialog,
  CliDefinitionRemovalDialog,
} from "./agents/CliDefinitionDialogs.tsx";
import {
  AgentReorderGrip,
  HiddenCliItems,
  SortableAgentRow,
} from "./agents/SortableAgentRow.tsx";

export function AgentsPage({
  host,
  clis,
  orderable,
  failed,
  listError,
  loading,
  onRetryList,
  onChanged,
  expanded,
  onHiddenChanged,
  onExpandedChange,
  registerEditor,
  renderSettings,
  renderModelError,
}: {
  host: string;
  /** The Host's CLIs with the user's definitions it does not find. */
  clis: CliSummary[];
  orderable?: true;
  failed: CliDefinitionFailure[];
  listError: boolean;
  loading?: boolean;
  onRetryList: () => void;
  /** Read the CLIs again after a definition changed. */
  onChanged: () => Promise<void>;
  onHiddenChanged: (cliId: string, hidden: boolean) => void;
  expanded: Record<string, boolean>;
  onExpandedChange: (id: string, open: boolean) => void;
  registerEditor?: RegisterSettingsEditor;
  renderSettings: (cli: CliSummary) => ReactNode;
  renderModelError: (cli: CliSummary) => ReactNode;
}) {
  const { t } = useI18n();
  const [adding, setAdding] = useState<Adding | null>(null);
  const [editing, setEditing] = useState<Editing | null>(null);
  const fileReads = useDefinitionFileReads(host);
  const editFileReads = useDefinitionFileReads(host);
  const [disclosures, setDisclosures] = useState(
    () => new Map<string, FileDisclosures>(),
  );
  const disclosureKey = (id: string) => JSON.stringify([host, id]);
  const [confirm, setConfirm] = useState<Confirm | null>(null);
  const [removal, setRemoval] = useState<Removal | null>(null);
  const [listMessage, setListMessage] = useState("");
  const [dialogMessage, setDialogMessage] = useState("");
  const [busy, setBusy] = useState<
    "add" | "save" | "confirm" | "remove" | undefined
  >();
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    }),
  );
  const visible = clis.filter((cli) => !cli.hidden);
  const reorder = async (from: number, to: number) => {
    if (!orderable || from < 0 || to < 0 || to >= visible.length || from === to)
      return;
    const ordered = arrayMove(visible, from, to);
    let index = 0;
    const order = clis.map((cli) =>
      cli.hidden ? cli.id : ordered[index++]!.id,
    );
    // The Host event commits the new order for this Client and every other one.
    // Until then the saved order stays intact, including after a failed request.
    const response = await request(() =>
      connection.requestHost(host, "cli.order.set", { order }),
    );
    setListMessage(
      "error" in response ? t("Could not change the order. Retry.") : "",
    );
  };
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
        : json.find((entry) => entry.name === "definition.json");
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
  ).filter((name) => !editing?.drafts?.has(name));

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
          !!editing.drafts?.size ||
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

  const resetDefinitionFiles = (id: string, keepLastOpened = false) => {
    fileReads.clear(id);
    setDisclosures((current) => {
      const key = disclosureKey(id);
      const lastOpened = current.get(key)?.lastOpened;
      const next = new Map(current);
      if (keepLastOpened && lastOpened) next.set(key, { open: [], lastOpened });
      else next.delete(key);
      return next;
    });
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
    resetDefinitionFiles(saved.result.cliId, true);
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

  const readForEdit = (id: string, file: DefinitionFile) => {
    if (file.kind !== "json" && !editFileReads.get(id, file.name))
      void editFileReads.load(id, file.name);
  };

  const startEdit = (
    id: string,
    simple?: CliSummary["simple"],
    json = "",
    files: DefinitionFile[] = [],
  ) => {
    const value = simple && fieldsOf(simple);
    const lastOpened = disclosures.get(disclosureKey(id))?.lastOpened;
    const selected = files.find(
      (file) => definitionFileKey(file) === lastOpened,
    );
    editFileReads.clear(id);
    if (selected && selected.kind !== "json")
      void editFileReads.load(id, selected.name, true);
    setEditing(
      value
        ? { id, simple: value, initial: JSON.stringify(value) }
        : {
            id,
            json,
            initial: json,
            selectedFile: selected
              ? definitionFileKey(selected)
              : definitionJsonKey,
          },
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
    if (
      text === editing.initial &&
      !editing.files?.length &&
      !editing.drafts?.size
    )
      return setEditing(null);
    if (!text.trim())
      return setEditing({ ...editing, message: t("Enter the JSON.") });
    if (editingMissing.length) return;
    setBusy("save");
    discardUploads();
    try {
      const selectedFiles = [
        ...(editing.files ?? []),
        ...Array.from(
          editing.drafts ?? [],
          ([name, content]) => new File([content], name),
        ),
      ];
      const reason = await definitionImageReason(text, selectedFiles);
      if (reason) {
        setEditing({ ...editing, reason });
        setBusy(undefined);
        return;
      }
      const files = await uploadDefinitionFiles(host, selectedFiles, (id) =>
        uploads.current.push(id),
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
    resetDefinitionFiles(removal.id);
    setRemoval(null);
    await onChanged();
  };

  const jsonEditor = (
    edit: Editing,
    kind: Confirm["kind"],
    files: DefinitionFile[] = [],
  ) => {
    const selected =
      edit.selectedFile &&
      files.some((file) => definitionFileKey(file) === edit.selectedFile)
        ? edit.selectedFile
        : definitionJsonKey;
    const updateFiles = (picked: File[]) =>
      setEditing((current) => {
        if (!current) return current;
        const drafts = new Map(current.drafts);
        for (const file of picked) drafts.delete(file.name);
        return {
          ...current,
          files: picked,
          drafts,
          message: undefined,
          reason: undefined,
        };
      });
    const picker = (
      <DefinitionFiles
        showPicker={!!files.length}
        files={edit.files}
        missing={editingMissing}
        onChange={updateFiles}
      />
    );
    const jsonField = (children?: ReactNode) => (
      <DefinitionTextField
        kind="json"
        value={edit.json ?? ""}
        invalid={!!edit.reason}
        onChange={(json) =>
          setEditing(
            (current) =>
              current && {
                ...current,
                json,
                message: undefined,
                reason: undefined,
              },
          )
        }
      >
        {edit.reason && <Reason reason={edit.reason} />}
        {children}
      </DefinitionTextField>
    );
    const fileField = (file: DefinitionFile) => {
      if (file.kind === "json") return jsonField();
      const read = editFileReads.get(edit.id, file.name);
      if (!read || !("text" in read))
        return (
          <DefinitionFileStatus
            read={read}
            onRetry={() => void editFileReads.load(edit.id, file.name)}
          />
        );
      const original = read.text;
      return (
        <DefinitionTextField
          kind={file.kind}
          value={edit.drafts?.get(file.name) ?? original}
          onChange={(text) =>
            setEditing((current) => {
              if (!current) return current;
              const drafts = new Map(current.drafts);
              if (text === original) drafts.delete(file.name);
              else drafts.set(file.name, text);
              return {
                ...current,
                drafts,
                files: current.files?.filter(
                  (picked) => picked.name !== file.name,
                ),
                message: undefined,
                reason: undefined,
              };
            })
          }
        />
      );
    };
    return (
      <div
        className="flex min-w-0 flex-col divide-y divide-border-subtle"
        data-iori-view="cli-definition-editor"
        onKeyDown={(event) => saveOnEnter(event, () => void saveEdit(kind))}
      >
        <div className="flex min-w-0 flex-col gap-3 px-4 py-3 md:pl-11">
          {files.length ? (
            <DefinitionFileTabs
              files={files}
              selected={selected}
              onSelect={(file) => {
                readForEdit(edit.id, file);
                setEditing(
                  (current) =>
                    current && {
                      ...current,
                      selectedFile: definitionFileKey(file),
                    },
                );
              }}
              changed={(file) =>
                file.kind === "json"
                  ? edit.json !== edit.initial
                  : !!edit.drafts?.has(file.name)
              }
              renderFile={fileField}
            >
              {picker}
              {edit.reason && selected !== definitionJsonKey && (
                <Reason reason={edit.reason} />
              )}
            </DefinitionFileTabs>
          ) : (
            jsonField(picker)
          )}
        </div>
        <Foot message={edit.message} className="px-4 py-3 md:pl-11">
          <Button
            type="button"
            variant="outline"
            size="sm"
            data-iori-action="cli-definition-cancel"
            onClick={() => setEditing(null)}
          >
            {t("Cancel")}
          </Button>
          <Button
            type="button"
            size="sm"
            pending={busy === "save"}
            data-iori-action="cli-definition-save"
            onClick={() => void saveEdit(kind)}
          >
            {t("Save")}
          </Button>
        </Foot>
      </div>
    );
  };

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
    onHiddenChanged(response.result.cliId, response.result.hidden);
  };

  const openAddForm = () => {
    setAdding({ mode: "simple", simple: emptySimple, json: "" });
    requestAnimationFrame(() =>
      document
        .getElementById("team-cli-form")
        ?.scrollIntoView({ block: "nearest" }),
    );
  };

  const cliRow = (cli: CliSummary) => {
    const open = !!expanded[cli.id];
    const edit = editing?.id === cli.id ? editing : null;
    const user = cli.source === "user" || cli.source === "override";
    const files = definitionFiles(cli);
    const key = disclosureKey(cli.id);
    const expandedFiles = disclosures.get(key)?.open ?? [];
    const visibleIndex = visible.findIndex((item) => item.id === cli.id);
    const canReorderMenu =
      !!orderable && !cli.hidden && visibleIndex >= 0 && visible.length > 1;

    return (
      <SortableAgentRow
        key={cli.id}
        cli={cli}
        orderable={orderable}
        open={open}
        onOpenChange={(yes) => onExpandedChange(cli.id, yes)}
        onMove={(step) => {
          const from = visible.findIndex((item) => item.id === cli.id);
          void reorder(from, from + step);
        }}
      >
        <div
          className={cn(
            "flex items-center gap-1 px-1.5 py-2 transition-colors [@media(hover:hover)]:hover:bg-accent/40",
            open && "bg-accent/25",
          )}
        >
          <AgentReorderGrip />
          <CollapsibleTrigger asChild>
            <Button
              type="button"
              variant="ghost"
              className="h-auto min-h-9 min-w-0 flex-1 items-center justify-start gap-2.5 rounded-sm px-2 py-1.5 text-left font-normal hover:bg-transparent"
            >
              {open ? (
                <ChevronDown
                  className="size-3.5 shrink-0 text-muted-foreground"
                  aria-hidden="true"
                />
              ) : (
                <ChevronRight
                  className="size-3.5 shrink-0 text-muted-foreground"
                  aria-hidden="true"
                />
              )}
              <span
                className="inline-flex size-4.5 shrink-0 items-center justify-center"
                aria-hidden="true"
              >
                <CliIcon hostKey={host} cli={cli} size={18} />
              </span>
              <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
                  <span
                    className="truncate font-heading text-sm font-semibold text-foreground"
                    title={cli.name}
                  >
                    {cli.name}
                  </span>
                  {user && (
                    <Badge
                      variant="outline"
                      className="font-normal text-muted-foreground"
                      data-iori-state="cli-user-definition"
                    >
                      {t("User definition")}
                    </Badge>
                  )}
                </div>
                {cli.missing ? (
                  <div
                    className="text-xs text-muted-foreground"
                    data-iori-state="cli-missing"
                  >
                    {t("Not found on this Host")}
                  </div>
                ) : cli.usage?.windows.length ? (
                  <div className="min-w-0 text-xs text-muted-foreground">
                    <Usage cliId={cli.id} usage={cli.usage} />
                  </div>
                ) : null}
              </div>
            </Button>
          </CollapsibleTrigger>
          <div className="flex shrink-0 items-center gap-2 pr-1">
            {cli.version && (
              <small
                className="max-w-28 truncate text-2xs tabular-nums text-muted-foreground"
                data-iori-cli-version={cli.id}
                title={cli.version}
              >
                {cli.version}
              </small>
            )}
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-sm"
                  className="text-muted-foreground hover:text-foreground [@media(pointer:coarse)]:min-h-11 [@media(pointer:coarse)]:min-w-11"
                  aria-label={t("CLI actions")}
                  data-iori-action="cli-actions"
                >
                  <MoreHorizontal className="size-4" aria-hidden="true" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                {canReorderMenu && (
                  <>
                    <DropdownMenuItem
                      disabled={visibleIndex === 0}
                      data-iori-action="cli-move-up"
                      onSelect={() =>
                        void reorder(visibleIndex, visibleIndex - 1)
                      }
                    >
                      <ArrowUp className="size-3.5" aria-hidden="true" />
                      {t("Move up")}
                    </DropdownMenuItem>
                    <DropdownMenuItem
                      disabled={visibleIndex === visible.length - 1}
                      data-iori-action="cli-move-down"
                      onSelect={() =>
                        void reorder(visibleIndex, visibleIndex + 1)
                      }
                    >
                      <ArrowDown className="size-3.5" aria-hidden="true" />
                      {t("Move down")}
                    </DropdownMenuItem>
                    <DropdownMenuSeparator />
                  </>
                )}
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
          <div className="divide-y divide-border-subtle border-t border-border-subtle">
            <SupportTable cli={cli} />
            <IconField cli={cli} host={host} onChanged={onChanged} />
            {!edit && (
              <div className="flex min-w-0 flex-col gap-2 px-4 py-3 md:pl-11">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="text-xs font-medium text-foreground">
                    {t("Definition")}
                  </span>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    data-iori-action="cli-definition-edit"
                    onClick={() =>
                      startEdit(cli.id, cli.simple, cli.definition, files)
                    }
                  >
                    {t("Edit definition")}
                  </Button>
                </div>
                {!!files.length && (
                  <div className="min-w-0 divide-y divide-border-subtle border-y border-border-subtle">
                    {files.map((file) => {
                      const fileKey = definitionFileKey(file);
                      const load = () => void fileReads.load(cli.id, file.name);
                      return (
                        <DefinitionFileDisclosure
                          key={fileKey}
                          file={file}
                          read={
                            file.kind === "json"
                              ? { text: cli.definition ?? "" }
                              : fileReads.get(cli.id, file.name)
                          }
                          open={expandedFiles.includes(fileKey)}
                          onOpenChange={(nextOpen) => {
                            setDisclosures((current) => {
                              const entry = current.get(key);
                              const others = (entry?.open ?? []).filter(
                                (name) => name !== fileKey,
                              );
                              return new Map(current).set(
                                key,
                                nextOpen
                                  ? {
                                      open: [...others, fileKey],
                                      lastOpened: fileKey,
                                    }
                                  : { ...entry, open: others },
                              );
                            });
                            if (nextOpen && file.kind !== "json") load();
                          }}
                          onRetry={load}
                        />
                      );
                    })}
                  </div>
                )}
              </div>
            )}
            {edit?.simple ? (
              <div
                className="flex min-w-0 flex-col divide-y divide-border-subtle"
                data-iori-view="cli-definition-editor"
                onKeyDown={(event) =>
                  saveOnEnter(event, () => void saveEdit("save"))
                }
              >
                <SimpleFields
                  value={edit.simple}
                  rowClassName="px-4 py-3 md:pl-11"
                  onChange={(simple) =>
                    setEditing({ ...edit, simple, message: undefined })
                  }
                />
                <Foot message={edit.message} className="px-4 py-3 md:pl-11">
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    data-iori-action="cli-definition-cancel"
                    onClick={() => setEditing(null)}
                  >
                    {t("Cancel")}
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    pending={busy === "save"}
                    data-iori-action="cli-definition-save"
                    onClick={() => void saveEdit("save")}
                  >
                    {t("Save")}
                  </Button>
                </Foot>
              </div>
            ) : (
              edit && jsonEditor(edit, user ? "save" : "replace", files)
            )}
          </div>
        </CollapsibleContent>
      </SortableAgentRow>
    );
  };

  const failedRow = (item: CliDefinitionFailure) => (
    <div
      key={item.folder}
      id={`team-agent-${item.folder}`}
      className="min-w-0 bg-status-failed-bg/20"
      data-iori-cli-failed={item.folder}
    >
      <div className="flex flex-wrap items-start justify-between gap-3 px-3 py-3 md:pl-8">
        <div className="flex min-w-0 flex-1 items-start gap-2.5">
          <span
            className="mt-0.5 inline-flex size-4.5 shrink-0 items-center justify-center text-status-failed"
            aria-hidden="true"
          >
            <CircleAlert className="size-4" />
          </span>
          <div className="flex min-w-0 flex-1 flex-col gap-0.5">
            <span className="truncate font-heading text-sm font-semibold text-foreground">
              {item.folder}
            </span>
            <span className="text-xs text-foreground [overflow-wrap:anywhere]">
              {t("Failed to load the definition")}
            </span>
            <span
              className="text-xs text-muted-foreground [overflow-wrap:anywhere]"
              data-iori-state="cli-failed-reason"
            >
              <ReasonText reason={item.reason} />
            </span>
          </div>
        </div>
        {editing?.id !== item.folder && (
          <div className="flex shrink-0 flex-wrap items-center justify-end gap-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              data-iori-action="cli-definition-edit"
              onClick={() => startEdit(item.folder, undefined, item.definition)}
            >
              {t("Edit definition")}
            </Button>
            <Button
              type="button"
              variant="destructive"
              size="sm"
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
        <div className="border-t border-border-subtle bg-background">
          {jsonEditor(editing, "save")}
        </div>
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
        className="flex min-w-0 flex-col divide-y divide-border-subtle"
        data-iori-view="cli-definition-add"
        onKeyDown={(event) => saveOnEnter(event, () => void add())}
      >
        <FlatSettingRow label={t("Add method")} className="py-3">
          <ToggleGroup
            type="single"
            variant="outline"
            className="flex-wrap max-md:w-full"
            value={state.mode}
            aria-label={t("Add method")}
            onValueChange={(mode) => mode && update({ mode: mode as AddMode })}
          >
            <ToggleGroupItem
              value="simple"
              className="h-8 px-3 text-xs max-md:flex-1"
              data-iori-action="cli-add-simple"
            >
              {t("Name and command")}
            </ToggleGroupItem>
            <ToggleGroupItem
              value="json"
              className="h-8 px-3 text-xs max-md:flex-1"
              data-iori-action="cli-add-json"
            >
              {t("JSON")}
            </ToggleGroupItem>
            <ToggleGroupItem
              value="file"
              className="h-8 px-3 text-xs max-md:flex-1"
              data-iori-action="cli-add-file"
            >
              {t("Upload file")}
            </ToggleGroupItem>
          </ToggleGroup>
        </FlatSettingRow>
        {state.mode === "simple" && (
          <SimpleFields
            value={state.simple}
            rowClassName="py-3"
            onChange={(simple) => update({ simple })}
          />
        )}
        {state.mode === "json" && (
          <FlatSettingRow stacked label={t("Definition JSON")} className="py-3">
            <div className="flex flex-col gap-2">
              <Textarea
                className="max-h-96 min-h-36 overflow-auto font-mono text-xs whitespace-pre-wrap [field-sizing:fixed] [overflow-wrap:anywhere]"
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
            </div>
          </FlatSettingRow>
        )}
        {state.mode === "file" && (
          <div className="flex flex-col gap-2 py-3">
            <DefinitionFiles
              upload
              files={state.files}
              missing={addingMissing}
              onChange={(files) => update({ files, file: undefined })}
            />
            {state.reason && <Reason reason={state.reason} />}
          </div>
        )}
        <Foot message={state.message} className="py-3">
          <Button
            type="button"
            variant="outline"
            size="sm"
            data-iori-action="cli-add-cancel"
            onClick={() => setAdding(null)}
          >
            {t("Cancel")}
          </Button>
          <Button
            type="button"
            size="sm"
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

  const hasItems = clis.length > 0 || failed.length > 0;
  const listMode: AsyncViewMode = hasItems
    ? "ready"
    : listError
      ? "error"
      : loading
        ? "loading"
        : "empty";

  return (
    <div className="mx-auto flex w-full max-w-4xl min-w-0 flex-col gap-6 px-4 py-5 md:px-6">
      <FlatPageHeader
        title={t("AI Agents")}
        description={t("CLIs available on this Host")}
      />
      {listError && hasItems && (
        <div
          className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-status-failed-border bg-status-failed-bg/35 px-3.5 py-2.5 text-xs text-foreground"
          role="alert"
        >
          <p>{t("Could not load CLIs. Retry.")}</p>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={onRetryList}
          >
            {t("Retry")}
          </Button>
        </div>
      )}
      {listMessage && (
        <p
          role="alert"
          className="rounded-md border border-status-failed-border bg-status-failed-bg/35 px-3.5 py-2 text-xs text-status-failed-text"
        >
          {listMessage}
        </p>
      )}
      <FlatSection
        title="CLI"
        bodyClassName={
          listMode === "ready" ? "border-b border-border" : "border-t-0"
        }
        actions={
          <Button
            type="button"
            variant="outline"
            size="sm"
            pending={loading}
            onClick={onRetryList}
          >
            <RotateCw className="size-3.5" aria-hidden="true" />
            {t("Reload")}
          </Button>
        }
      >
        <AsyncState
          mode={listMode}
          t={t}
          emptyIcon={<Bot className="size-4" aria-hidden="true" />}
          emptyTitle={t("No CLIs found")}
          emptyDescription={t(
            "CLI not found on this Host. Install it and retry.",
          )}
          emptyActionLabel={t("Add CLI")}
          onEmptyAction={openAddForm}
          errorTitle={t("Could not load CLIs. Retry.")}
          onRetry={onRetryList}
        >
          <DndContext
            sensors={sensors}
            collisionDetection={closestCenter}
            onDragEnd={({ active, over }) => {
              if (over && active.id !== over.id)
                void reorder(
                  visible.findIndex((cli) => cli.id === active.id),
                  visible.findIndex((cli) => cli.id === over.id),
                );
            }}
          >
            <SortableContext
              items={visible.map((cli) => cli.id)}
              strategy={verticalListSortingStrategy}
            >
              {visible.map(cliRow)}
            </SortableContext>
          </DndContext>
          {failed.map(failedRow)}
          {clis.some((cli) => cli.hidden) && (
            <HiddenCliItems>
              {clis.filter((cli) => cli.hidden).map(cliRow)}
            </HiddenCliItems>
          )}
        </AsyncState>
      </FlatSection>

      <FlatSection
        title={t("Add CLI")}
        id="team-cli-form"
        bodyClassName="border-b border-border"
      >
        {adding ? (
          addForm(adding)
        ) : (
          <div className="flex justify-end py-3">
            <Button
              type="button"
              variant="outline"
              size="sm"
              data-iori-action="cli-add-open"
              onClick={openAddForm}
            >
              <Plus className="size-3.5" aria-hidden="true" />
              {t("Add CLI")}
            </Button>
          </div>
        )}
      </FlatSection>

      <CliDefinitionConfirmDialog
        confirm={confirm}
        busy={busy === "confirm"}
        dialogMessage={dialogMessage}
        onClose={() => setConfirm(null)}
        onConfirm={() => void saveConfirmed()}
      />

      <CliDefinitionRemovalDialog
        removal={removal}
        busy={busy === "remove"}
        dialogMessage={dialogMessage}
        onClose={() => setRemoval(null)}
        onRemove={() => void remove()}
      />
    </div>
  );
}
