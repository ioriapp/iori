import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { ArrowLeft, MoreHorizontal, Plus } from "lucide-react";
import {
  automationDateTime,
  automationDateTimeAt,
  type Automation,
  type AutomationDefinition,
  type AutomationList,
  type AutomationReceived,
  type Candidate,
  type Team,
} from "@iori/protocol";
import { pickerClis } from "../cli-list.ts";
import { FolderPicker } from "../FolderPicker.tsx";
import { ErrorMessage } from "../Settings.tsx";
import {
  FlatPageHeader,
  FlatSection,
  FlatSettingRow,
} from "../components/SectionLayout.tsx";
import { Badge } from "../components/ui/badge.tsx";
import { Button } from "../components/ui/button.tsx";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "../components/ui/dropdown-menu.tsx";
import { Input } from "../components/ui/input.tsx";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "../components/ui/select.tsx";
import { Switch } from "../components/ui/switch.tsx";
import { Textarea } from "../components/ui/textarea.tsx";
import { connection } from "../connection.ts";
import { ForgeFailure } from "../forge/ForgeFailure.tsx";
import { native } from "../native.ts";
import type { OpenTeamTerminal } from "./TaskHistory.tsx";
import { useI18n } from "./context.tsx";
import { pickerTeams } from "./team-data.ts";
import { AutomationDialogs } from "./automations/AutomationDialogs.tsx";
import { AutomationHistorySection } from "./automations/AutomationHistorySection.tsx";
import { AutomationListView } from "./automations/AutomationListView.tsx";
import {
  SAVE_ERRORS,
  editableAutomation,
  missingFieldError,
  type AutomationDraft,
  type HistoryState,
  type WebhookScope,
} from "./automations/types.ts";

function Choice({
  label,
  value,
  options,
  change,
  field,
  selectedLabel,
}: {
  field?: string;
  selectedLabel?: string;
  label: string;
  value: string;
  options: [string, string][];
  change: (value: string) => void;
}) {
  return (
    <Select value={value} onValueChange={change}>
      <SelectTrigger
        aria-label={label}
        data-iori-field={field}
        className="w-52 max-w-full"
      >
        <SelectValue>{selectedLabel}</SelectValue>
      </SelectTrigger>
      <SelectContent>
        {options.map(([id, name]) => (
          <SelectItem
            key={id}
            value={id}
            data-iori-automation-option={field ? id : undefined}
          >
            {name}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

const STACKED_FIELDS = new Set([
  "Name",
  "Instructions",
  "Folder",
  "Days",
  "URL",
  "Token",
  "Label",
  "curl example",
]);

export function Automations({
  host,
  active,
  teams,
  defaultTeam,
  renderCandidate,
  onOpenTerminal,
  onOpenIntegrations,
  onOpenWorkspaceSettings,
  registerBack,
}: {
  host: string;
  active: boolean;
  teams: (Team & { hidden?: boolean })[];
  defaultTeam: string;
  renderCandidate: (
    candidate: Candidate,
    change: (changes: Partial<Candidate>) => void,
  ) => ReactNode;
  onOpenTerminal: OpenTeamTerminal;
  onOpenIntegrations?: (hostKey: string) => void;
  onOpenWorkspaceSettings?: (hostKey: string, workspacePath: string) => void;
  registerBack: (back: () => boolean) => void;
}) {
  const { t, language, clis } = useI18n();
  const selectableTeams = pickerTeams(teams);
  const selectableClis = pickerClis(clis);

  const [data, setData] = useState<AutomationList>();
  const [listError, setListError] = useState(false);
  const savedDefinitions = useRef(new Map<string, Automation>());
  const [draft, setDraft] = useState<Automation>();
  const [historyState, setHistoryState] = useState<HistoryState>({
    status: "idle",
    runs: [],
  });
  const historyRequestRef = useRef(0);
  const [error, setError] = useState("");
  const [retryEnabled, setRetryEnabled] = useState<() => void>();
  const [workingOn, setWorkingOn] = useState<
    "save" | "run" | "delete" | "enabled" | "regenerate"
  >();
  const working = workingOn !== undefined;
  const [saved, setSaved] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [regenerating, setRegenerating] = useState(false);
  const [regenerateError, setRegenerateError] = useState("");
  const [received, setReceived] = useState<AutomationReceived>();
  const [receivedError, setReceivedError] = useState<string>();
  const [copyState, setCopyState] = useState<
    Record<string, "copied" | "error">
  >({});
  const [folderPicker, setFolderPicker] = useState(false);
  const drafts = useRef<Record<string, AutomationDraft>>({});
  const [draftRetry, setDraftRetry] = useState(0);
  const [loadedDraft, setLoadedDraft] = useState(false);
  const [onceInput, setOnceInput] = useState("");

  const load = useCallback(async () => {
    try {
      const result = await connection.requestHost(host, "automation.list", {});
      if (result?.ok) {
        const previous = savedDefinitions.current;
        setDraft((current) => {
          if (
            !current?.id ||
            (JSON.stringify(current) !==
              JSON.stringify(previous.get(current.id)) &&
              JSON.stringify(current) !==
                JSON.stringify(drafts.current[current.id]?.saved))
          )
            return current;
          const value = result.result.automations.find(
            (a) => a.id === current.id,
          );
          return value ? editableAutomation(value) : undefined;
        });
        savedDefinitions.current = new Map(
          result.result.automations.map((a) => [a.id, editableAutomation(a)]),
        );
        setData(result.result);
        setListError(false);
        setError((current) =>
          current === "Could not load Automations. Retry." ? "" : current,
        );
      } else {
        setListError(true);
        setError("Could not load Automations. Retry.");
      }
    } catch {
      setListError(true);
      setError("Could not load Automations. Retry.");
    }
  }, [host]);

  const loadHistory = useCallback(
    async (id: string) => {
      const requestId = ++historyRequestRef.current;
      if (!id) {
        setHistoryState({ status: "idle", runs: [] });
        return;
      }
      setHistoryState((current) => ({
        status: "loading",
        runs: current.runs,
      }));
      try {
        const result = await connection.requestHost(
          host,
          "automation.history",
          { id },
        );
        if (historyRequestRef.current !== requestId) return;
        if (result?.ok) {
          setHistoryState({ status: "ready", runs: result.result.runs });
        } else {
          setHistoryState((current) => ({
            status: "error",
            runs: current.runs,
            message: "Could not load automation history. Retry.",
          }));
        }
      } catch {
        if (historyRequestRef.current !== requestId) return;
        setHistoryState((current) => ({
          status: "error",
          runs: current.runs,
          message: "Could not load automation history. Retry.",
        }));
      }
    },
    [host],
  );

  useEffect(() => {
    if (!active) return;
    void load();
    const unsubscribe = connection.subscribeHostEvents((key, event) => {
      if (key !== host) return;
      if (event.type === "automation.changed" || event.type === "snapshot") {
        void load();
        if (draft?.id) void loadHistory(draft.id);
      }
    });
    return () => {
      unsubscribe();
    };
  }, [active, host, load, loadHistory, draft?.id]);

  useEffect(() => {
    let alive = true;
    void native
      .loadView<{ drafts: Record<string, AutomationDraft>; selected?: string }>(
        `automations:${host}:draft`,
      )
      .then((stored) => {
        if (!alive) return;
        if (stored) {
          drafts.current = stored.drafts;
          const selected =
            stored.selected === undefined
              ? undefined
              : stored.drafts[stored.selected];
          if (selected) {
            setDraft((current) => current ?? selected.draft);
            setOnceInput((current) => current || selected.onceInput);
          }
        }
        setLoadedDraft(true);
      })
      .catch(() => {
        if (alive)
          setError("Could not restore this device's automation drafts. Retry.");
      });
    return () => {
      alive = false;
    };
  }, [host, draftRetry]);

  useEffect(() => {
    if (!loadedDraft) return;
    if (draft) {
      drafts.current[draft.id] = {
        draft,
        onceInput,
        saved: savedDefinitions.current.get(draft.id),
      };
    }
    void native
      .saveView(`automations:${host}:draft`, {
        drafts: structuredClone(drafts.current),
        selected: draft?.id,
      })
      .catch(() => {
        setError(
          "Could not save this draft on this device. Save the automation or copy its instructions.",
        );
      });
  }, [draft, onceInput, loadedDraft, host, data]);

  useEffect(() => {
    if (draft?.id) void loadHistory(draft.id);
    else setHistoryState({ status: "idle", runs: [] });
  }, [draft?.id, loadHistory]);

  useEffect(() => {
    if (active)
      registerBack(() => {
        if (!draft) return false;
        setDraft(undefined);
        return true;
      });
  }, [active, draft, registerBack]);

  useEffect(() => {
    setDraft((current) => {
      if (!current || current.id) return current;
      if (current.target.kind === "cli" && !current.target.candidate.cli) {
        const cli = selectableClis[0]?.id;
        if (!cli) return current;
        return {
          ...current,
          target: {
            kind: "cli",
            candidate: { ...current.target.candidate, cli },
          },
        };
      }
      if (current.target.kind === "team" && !current.target.teamId) {
        const teamId =
          selectableTeams.find((team) => team.id === defaultTeam)?.id ??
          selectableTeams[0]?.id;
        if (!teamId) return current;
        return {
          ...current,
          target: { kind: "team", teamId },
        };
      }
      return current;
    });
  }, [
    draft?.id,
    draft?.target.kind,
    selectableClis,
    selectableTeams,
    defaultTeam,
  ]);

  if (!active) return null;

  const zone = data?.timeZone;
  const formatDate = (at: number) =>
    new Intl.DateTimeFormat(language, {
      dateStyle: "medium",
      timeStyle: "short",
      timeZone: zone,
    }).format(at);

  const edit = (changes: Partial<AutomationDefinition>) => {
    setSaved(false);
    setDraft((old) => (old ? { ...old, ...changes } : old));
  };

  const open = (automation: Automation, restore = true) => {
    const cached = restore ? drafts.current[automation.id] : undefined;
    const pending =
      cached &&
      (!cached.saved ||
        JSON.stringify(cached.draft) !== JSON.stringify(cached.saved) ||
        (cached.draft.schedule.kind === "once" &&
          zone &&
          cached.onceInput !==
            automationDateTime(cached.draft.schedule.at, zone)))
        ? cached
        : undefined;
    setDraft(structuredClone(pending?.draft ?? editableAutomation(automation)));
    setHistoryState(
      automation.id
        ? { status: "loading", runs: [] }
        : { status: "idle", runs: [] },
    );
    setCopyState({});
    setError("");
    setSaved(false);
    setOnceInput(
      pending?.onceInput ??
        (automation.schedule.kind === "once" && zone
          ? automationDateTime(automation.schedule.at, zone)
          : ""),
    );
  };

  const create = () =>
    open({
      id: "",
      name: "",
      instruction: "",
      cwd: "",
      target: {
        kind: "cli",
        candidate: {
          id: "automation",
          cli: selectableClis[0]?.id ?? "",
          model: "",
          tools: [],
          minimum: "",
        },
      },
      schedule: { kind: "manual" },
      enabled: true,
      missed: "latest",
    });

  const save = async (action: "save" | "run" = "save") => {
    if (!draft || !zone) return;
    if (!draftChanged) return draft;
    const missing = missingFieldError(draft);
    if (missing) {
      setError(missing);
      return;
    }
    setWorkingOn(action);
    setError("");
    try {
      const {
        id,
        nextAt: _nextAt,
        webhookToken: _token,
        ...definition
      } = draft;
      if (definition.schedule.kind === "once")
        definition.schedule = {
          kind: "once",
          at: automationDateTimeAt(onceInput, zone),
        };
      const result = await connection.requestHost(host, "automation.save", {
        ...(id ? { id } : {}),
        definition,
      });
      if (result?.ok) {
        delete drafts.current[draft.id];
        open(result.result.automation, false);
        await load();
        setSaved(true);
        return result.result.automation;
      } else
        setError("Could not save the automation. Check its fields and retry.");
    } catch {
      setError("Could not save the automation. Check its fields and retry.");
    } finally {
      setWorkingOn(undefined);
    }
  };

  const run = async () => {
    if (!draft?.id) return;
    const current = await save("run");
    if (!current) return;
    setWorkingOn("run");
    setError("");
    try {
      const result = await connection.requestHost(host, "automation.run", {
        id: current.id,
      });
      if (!result?.ok) setError("Could not run the automation. Retry.");
      await loadHistory(draft.id);
      await load();
    } catch {
      setError("Could not run the automation. Retry.");
    } finally {
      setWorkingOn(undefined);
    }
  };

  const remove = async () => {
    if (!draft?.id) return;
    setWorkingOn("delete");
    try {
      const result = await connection.requestHost(host, "automation.delete", {
        id: draft.id,
      });
      if (result?.ok) {
        setDeleting(false);
        delete drafts.current[draft.id];
        setDraft(undefined);
        await load();
      } else setError("Could not delete the automation. Retry.");
    } catch {
      setError("Could not delete the automation. Retry.");
    } finally {
      setWorkingOn(undefined);
    }
  };

  const toggleEnabled = async (enabled: boolean, targetId = draft?.id) => {
    if (!targetId) return;
    const stored = savedDefinitions.current.get(targetId);
    if (!stored) return;
    setWorkingOn("enabled");
    setError("");
    setRetryEnabled(undefined);
    try {
      const {
        id,
        nextAt: _nextAt,
        webhookToken: _token,
        ...definition
      } = stored;
      const response = await connection.requestHost(host, "automation.save", {
        id,
        definition: { ...definition, enabled },
      });
      if (!response?.ok) throw new Error();
      savedDefinitions.current.set(
        id,
        editableAutomation(response.result.automation),
      );
      setDraft((current) =>
        current?.id === id ? { ...current, enabled } : current,
      );
      await load();
    } catch {
      setError("Could not change the automation. Retry.");
      setRetryEnabled(() => () => void toggleEnabled(enabled, targetId));
    } finally {
      setWorkingOn(undefined);
    }
  };

  const regenerateToken = async () => {
    if (!draft?.id) return;
    setWorkingOn("regenerate");
    setRegenerateError("");
    try {
      const result = await connection.requestHost(
        host,
        "automation.regenerateToken",
        { id: draft.id },
      );
      if (!result?.ok) throw new Error();
      setData(
        (current) =>
          current && {
            ...current,
            automations: current.automations.map((value) =>
              value.id === draft.id
                ? {
                    ...value,
                    webhookToken: result.result.automation.webhookToken,
                  }
                : value,
            ),
          },
      );
      setRegenerating(false);
      setCopyState({});
      await load();
    } catch {
      setRegenerateError("The Host could not complete this operation. Retry.");
    } finally {
      setWorkingOn(undefined);
    }
  };

  const showReceived = async (id: string) => {
    setReceivedError((failed) => (failed === id ? undefined : failed));
    try {
      const result = await connection.requestHost(host, "automation.received", {
        id,
      });
      if (!result?.ok) throw new Error();
      setReceived(result.result.received);
    } catch {
      setReceivedError(id);
    }
  };

  const copy = (key: string, value: string) => {
    void native.clipboardWrite(value).then(
      () => setCopyState((state) => ({ ...state, [key]: "copied" })),
      () => setCopyState((state) => ({ ...state, [key]: "error" })),
    );
  };

  const copyButton = (key: string, value: string) => (
    <div className="flex flex-col items-start gap-1">
      <Button
        type="button"
        variant="outline"
        size="sm"
        data-iori-action={`automation-copy-webhook-${key}`}
        onClick={() => copy(key, value)}
      >
        {t(copyState[key] === "copied" ? "Copied" : "Copy")}
      </Button>
      {copyState[key] === "error" && (
        <ErrorMessage
          message={t("Could not copy. Select the text and copy it.")}
        />
      )}
    </div>
  );

  const storedAutomation = data?.automations.find(
    (value) => value.id === draft?.id,
  );
  const listener = data?.webhook;
  const directAddresses =
    connection
      .getSnapshot()
      .initial?.hosts.find((value) => value.publicKey === host)?.addresses ??
    [];
  const directHosts = directAddresses.map((address) =>
    address.startsWith("[")
      ? address.slice(1, address.indexOf("]"))
      : address.slice(0, address.lastIndexOf(":")),
  );
  const address =
    draft?.webhook?.scope === "local"
      ? "127.0.0.1"
      : (directHosts.find((value) => listener?.addresses.includes(value)) ??
        listener?.addresses[0]);
  const url =
    address && listener && draft?.id
      ? `http://${address.includes(":") ? `[${address}]` : address}:${listener.port}/hooks/${draft.id}`
      : undefined;
  const token = storedAutomation?.webhookToken;
  const curl = (value: string) =>
    `curl -X POST -H "Authorization: Bearer ${value}" -H "Content-Type: application/json" -d '{"message":"hello"}' ${url}`;

  const saveError = SAVE_ERRORS.has(error);
  const savedDefinition = draft && savedDefinitions.current.get(draft.id);
  const draftChanged =
    draft &&
    (JSON.stringify(draft) !== JSON.stringify(savedDefinition) ||
      (draft.schedule.kind === "once" &&
        zone &&
        (savedDefinition?.schedule.kind !== "once" ||
          onceInput !==
            automationDateTime(savedDefinition.schedule.at, zone))));

  const field = (
    label: string,
    children: ReactNode,
    description?: ReactNode,
  ) => (
    <FlatSettingRow
      stacked={STACKED_FIELDS.has(label)}
      label={t(label)}
      description={description}
    >
      {children}
    </FlatSettingRow>
  );

  const showTopError =
    error &&
    !saveError &&
    !(!draft && !data && error === "Could not load Automations. Retry.");

  return (
    <div
      className="mx-auto flex w-full max-w-[960px] flex-col gap-6 px-6 py-5 max-md:px-4 max-md:py-4"
      data-iori-view="automations"
    >
      <FlatPageHeader
        title={draft ? draft.name || t("New automation") : "Automations"}
        bordered={!draft ? false : true}
        className={!draft ? "pb-0" : undefined}
        description={
          draft ? (
            <span className="inline-flex flex-wrap items-center gap-2">
              {saveError ? (
                <span
                  role="alert"
                  className="text-xs font-medium text-status-failed-text"
                >
                  {t(error)}
                </span>
              ) : draftChanged ? (
                <Badge variant="waiting" role="status">
                  {t("Unsaved changes")}
                </Badge>
              ) : saved ? (
                <Badge variant="neutral" role="status">
                  {t("Settings saved")}
                </Badge>
              ) : null}
              {zone && (
                <span
                  className="text-2xs text-muted-foreground"
                  data-iori-automation-timezone
                >
                  {t("Host time zone")}: {zone}
                </span>
              )}
            </span>
          ) : zone ? (
            <span data-iori-automation-timezone>
              {t("Host time zone")}: {zone}
            </span>
          ) : undefined
        }
        back={
          draft ? (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => setDraft(undefined)}
              data-iori-action="automation-back"
              className="h-7 px-1.5 text-muted-foreground hover:text-foreground max-md:h-10"
            >
              <ArrowLeft className="size-3.5" aria-hidden="true" />
              {t("Automations")}
            </Button>
          ) : undefined
        }
        actions={
          !draft ? (
            <Button
              type="button"
              size="sm"
              onClick={create}
              data-iori-action="automation-new"
            >
              <Plus className="size-3.5" aria-hidden="true" />
              {t("New automation")}
            </Button>
          ) : (
            <>
              {draft.id && (
                <>
                  <label className="inline-flex cursor-pointer items-center gap-2 text-xs font-medium text-foreground">
                    <span>{t("Enabled")}</span>
                    <Switch
                      aria-label={t("Enabled")}
                      data-iori-action="automation-enabled"
                      checked={
                        savedDefinitions.current.get(draft.id)?.enabled ??
                        draft.enabled
                      }
                      disabled={working}
                      onCheckedChange={(enabled) => void toggleEnabled(enabled)}
                    />
                  </label>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => void run()}
                    disabled={working}
                    pending={workingOn === "run"}
                    data-iori-action="automation-run"
                  >
                    {t("Run now")}
                  </Button>
                </>
              )}
              <Button
                type="button"
                size="sm"
                disabled={!data || working || !draftChanged}
                pending={workingOn === "save"}
                data-iori-action="automation-save"
                onClick={() => void save()}
              >
                {t("Save")}
              </Button>
              {draft.id && (
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon-sm"
                      aria-label={t("Automation actions")}
                      data-iori-action="automation-actions"
                      className="max-md:size-11"
                    >
                      <MoreHorizontal className="size-4" />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end">
                    <DropdownMenuItem
                      variant="destructive"
                      data-iori-action="automation-delete"
                      onSelect={() => setDeleting(true)}
                    >
                      {t("Delete")}
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              )}
            </>
          )
        }
      />

      {showTopError && (
        <div
          role="alert"
          className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-status-failed-border bg-status-failed-bg/45 px-3 py-2 text-xs text-status-failed-text"
        >
          <span>{t(error)}</span>
          <Button
            type="button"
            variant="outline"
            size="xs"
            onClick={() => {
              if (
                error === "Could not change the automation. Retry." &&
                retryEnabled
              ) {
                retryEnabled();
                return;
              }
              if (
                error ===
                "Could not restore this device's automation drafts. Retry."
              )
                setDraftRetry((value) => value + 1);
              void load();
              if (draft?.id) void loadHistory(draft.id);
            }}
          >
            {t("Retry")}
          </Button>
        </div>
      )}

      {!draft ? (
        <AutomationListView
          data={data}
          listError={listError}
          formatDate={formatDate}
          onOpen={(automation) => {
            open(automation);
            void load();
          }}
          onRetry={() => void load()}
        />
      ) : (
        <div className="flex flex-col gap-6">
          <FlatSection title={t("Content")} onSave={() => void save()}>
            {field(
              "Name",
              <Input
                aria-label={t("Name")}
                data-iori-field="automation-name"
                value={draft.name}
                onChange={(e) => edit({ name: e.target.value })}
              />,
            )}
            {field(
              "Instructions",
              <Textarea
                aria-label={t("Instructions")}
                data-iori-field="automation-instruction"
                rows={6}
                value={draft.instruction}
                onChange={(e) => edit({ instruction: e.target.value })}
              />,
            )}
            {field(
              "Folder",
              <div className="flex min-w-0 items-center gap-2">
                <Input
                  aria-label={t("Folder")}
                  data-iori-field="automation-folder"
                  className="min-w-0 flex-1 font-mono text-xs"
                  value={draft.cwd}
                  onChange={(e) => edit({ cwd: e.target.value })}
                />
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  data-iori-action="automation-folder-choose"
                  onClick={() => setFolderPicker(true)}
                >
                  {t("Choose folder")}
                </Button>
              </div>,
            )}
          </FlatSection>

          <FlatSection title={t("Run")} onSave={() => void save()}>
            {field(
              "Type",
              <Choice
                label={t("Type")}
                field="automation-target"
                value={draft.target.kind}
                options={[
                  ["cli", t("Single CLI")],
                  ["team", t("Team")],
                ]}
                change={(kind) =>
                  edit({
                    target:
                      kind === "team"
                        ? {
                            kind: "team",
                            teamId:
                              selectableTeams.find(
                                (team) => team.id === defaultTeam,
                              )?.id ??
                              selectableTeams[0]?.id ??
                              "",
                          }
                        : {
                            kind: "cli",
                            candidate: {
                              id: "automation",
                              cli: selectableClis[0]?.id ?? "",
                              model: "",
                              tools: [],
                              minimum: "",
                            },
                          },
                  })
                }
              />,
            )}
            {draft.target.kind === "team" ? (
              field(
                "Team",
                <Choice
                  label={t("Team")}
                  value={draft.target.teamId}
                  options={selectableTeams.map((team) => [team.id, team.name])}
                  selectedLabel={
                    teams.find(
                      (team) =>
                        draft.target.kind === "team" &&
                        team.id === draft.target.teamId,
                    )?.name
                  }
                  change={(teamId) =>
                    edit({ target: { kind: "team", teamId } })
                  }
                />,
              )
            ) : (
              <div className="py-3">
                {renderCandidate(draft.target.candidate, (changes) => {
                  if (draft.target.kind === "cli")
                    edit({
                      target: {
                        ...draft.target,
                        candidate: { ...draft.target.candidate, ...changes },
                      },
                    });
                })}
              </div>
            )}
          </FlatSection>

          <FlatSection title={t("Schedule")} onSave={() => void save()}>
            {field(
              "Schedule",
              <Choice
                label={t("Schedule")}
                field="automation-schedule"
                value={draft.schedule.kind}
                options={[
                  ["manual", t("Manual only")],
                  ["once", t("Once")],
                  ["daily", t("Daily")],
                  ["weekly", t("Every week")],
                ]}
                change={(kind) =>
                  edit({
                    schedule:
                      kind === "manual"
                        ? { kind }
                        : kind === "once"
                          ? { kind, at: Date.now() }
                          : kind === "weekly"
                            ? { kind, time: "09:00", days: [1] }
                            : { kind: "daily", time: "09:00" },
                  })
                }
              />,
            )}
            {draft.schedule.kind === "once" &&
              field(
                "Date and time",
                <Input
                  type="datetime-local"
                  aria-label={t("Date and time")}
                  data-iori-field="automation-once"
                  className="w-52 max-w-full"
                  value={onceInput}
                  onChange={(e) => setOnceInput(e.target.value)}
                />,
              )}
            {(draft.schedule.kind === "daily" ||
              draft.schedule.kind === "weekly") &&
              field(
                "Time",
                <Input
                  type="time"
                  aria-label={t("Time")}
                  className="w-52 max-w-full"
                  value={draft.schedule.time}
                  onChange={(e) => {
                    if (
                      draft.schedule.kind === "daily" ||
                      draft.schedule.kind === "weekly"
                    )
                      edit({
                        schedule: { ...draft.schedule, time: e.target.value },
                      });
                  }}
                />,
              )}
            {draft.schedule.kind === "weekly" &&
              field(
                "Days",
                <div className="flex flex-wrap gap-1.5">
                  {[
                    "Sunday",
                    "Monday",
                    "Tuesday",
                    "Wednesday",
                    "Thursday",
                    "Friday",
                    "Saturday",
                  ].map((day, index) => (
                    <Button
                      key={day}
                      type="button"
                      size="sm"
                      variant={
                        draft.schedule.kind === "weekly" &&
                        draft.schedule.days.includes(index)
                          ? "secondary"
                          : "outline"
                      }
                      aria-pressed={
                        draft.schedule.kind === "weekly" &&
                        draft.schedule.days.includes(index)
                      }
                      onClick={() => {
                        if (draft.schedule.kind === "weekly")
                          edit({
                            schedule: {
                              ...draft.schedule,
                              days: draft.schedule.days.includes(index)
                                ? draft.schedule.days.filter((d) => d !== index)
                                : [...draft.schedule.days, index],
                            },
                          });
                      }}
                    >
                      {t(day)}
                    </Button>
                  ))}
                </div>,
              )}
            {field(
              "Missed schedules",
              <Choice
                label={t("Missed schedules")}
                value={draft.missed}
                options={[
                  ["latest", t("Run only the latest")],
                  ["skip", t("Record only")],
                ]}
                change={(missed) =>
                  edit({ missed: missed as "latest" | "skip" })
                }
              />,
            )}
          </FlatSection>

          <FlatSection title={t("Webhook")} onSave={() => void save()}>
            {field(
              "Run from webhook",
              <Switch
                aria-label={t("Run from webhook")}
                data-iori-field="automation-webhook"
                checked={!!draft.webhook}
                onCheckedChange={(enabled) =>
                  edit({
                    webhook: enabled ? { scope: "lan" } : undefined,
                  })
                }
              />,
              t(
                "If the CLI permission skips approvals, the agent can run commands without approval after reading what was received.",
              ),
            )}
            {draft.webhook && listener?.error === "port" && (
              <div className="py-3">
                <ErrorMessage
                  message={t(
                    "Webhooks are not being accepted because port {port} could not be opened.",
                  ).replace("{port}", String(listener.port))}
                />
              </div>
            )}
            {draft.webhook && (
              <>
                {field(
                  "Accept from",
                  <Choice
                    label={t("Accept from")}
                    field="automation-webhook-scope"
                    value={draft.webhook.scope}
                    selectedLabel={t(
                      draft.webhook.scope === "lan"
                        ? "LAN and VPN"
                        : "This machine only",
                    )}
                    options={
                      [
                        ["lan", t("LAN and VPN")],
                        ["local", t("This machine only")],
                      ] satisfies [WebhookScope, string][]
                    }
                    change={(scope) =>
                      edit({ webhook: { scope: scope as "lan" | "local" } })
                    }
                  />,
                )}
                {token ? (
                  <>
                    {url &&
                      field(
                        "URL",
                        <div className="flex min-w-0 flex-col gap-2">
                          <code className="block min-w-0 overflow-x-auto rounded-md border border-border-subtle bg-terminal p-2.5 font-mono text-2xs whitespace-pre-wrap [overflow-wrap:anywhere] text-terminal-foreground">
                            {url}
                          </code>
                          {copyButton("url", url)}
                        </div>,
                      )}
                    {field(
                      "Token",
                      <div className="flex min-w-0 flex-col gap-2">
                        <code className="block min-w-0 rounded-md border border-border-subtle bg-terminal p-2.5 font-mono text-2xs text-terminal-foreground">
                          ••••••••
                        </code>
                        <div className="flex flex-wrap items-start gap-2">
                          {copyButton("token", token)}
                          <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            data-iori-action="automation-regenerate-webhook-token"
                            onClick={() => {
                              setRegenerateError("");
                              setRegenerating(true);
                            }}
                          >
                            {t("Regenerate token")}
                          </Button>
                        </div>
                      </div>,
                    )}
                    {url &&
                      field(
                        "curl example",
                        <div className="flex min-w-0 flex-col gap-2">
                          <code className="block min-w-0 overflow-x-auto rounded-md border border-border-subtle bg-terminal p-2.5 font-mono text-2xs whitespace-pre-wrap [overflow-wrap:anywhere] text-terminal-foreground">
                            {curl("••••••••")}
                          </code>
                          {copyButton("curl", curl(token))}
                        </div>,
                      )}
                  </>
                ) : (
                  <div className="py-3">
                    <p className="m-0 text-xs text-muted-foreground">
                      {t("Save to create the URL and token.")}
                    </p>
                  </div>
                )}
              </>
            )}
          </FlatSection>

          <FlatSection title={t("Issue")} onSave={() => void save()}>
            {field(
              "Run from issues",
              <Switch
                aria-label={t("Run from issues")}
                data-iori-field="automation-issue"
                checked={!!draft.issue}
                onCheckedChange={(enabled) =>
                  edit({
                    issue: enabled ? { label: "agent-ready" } : undefined,
                  })
                }
              />,
              t(
                "Runs each open issue labeled by this Host's account, one at a time, in a new worktree per issue.",
              ),
            )}
            {draft.issue &&
              (storedAutomation?.issueError === "no-forge" ||
                storedAutomation?.issueError === "no-remote") && (
                <div className="py-3" data-iori-automation-issue-error>
                  <ErrorMessage
                    message={t(
                      storedAutomation.issueError === "no-remote"
                        ? "This folder's repository has no remote."
                        : "This folder's repository has no known forge.",
                    )}
                  />
                </div>
              )}
            {draft.issue &&
              storedAutomation?.issueError &&
              storedAutomation.issueError !== "no-forge" &&
              storedAutomation.issueError !== "no-remote" && (
                <div className="py-3" data-iori-automation-issue-error>
                  <ForgeFailure
                    subject={t(
                      "Could not read the issues for this automation.",
                    )}
                    failure={storedAutomation.issueError}
                    locale={language}
                    recovery={{
                      onRetry: () => void load(),
                      onOpenIntegrations:
                        onOpenIntegrations && (() => onOpenIntegrations(host)),
                      onOpenWorkspaceSettings:
                        onOpenWorkspaceSettings &&
                        (() => onOpenWorkspaceSettings(host, draft.cwd)),
                    }}
                    state="automation-issue-error"
                    retryAction="automation-issue-retry"
                    form="line"
                  />
                </div>
              )}
            {draft.issue &&
              field(
                "Label",
                <Input
                  aria-label={t("Label")}
                  data-iori-field="automation-issue-label"
                  value={draft.issue.label}
                  onChange={(e) => edit({ issue: { label: e.target.value } })}
                />,
              )}
          </FlatSection>

          {draft.id && (
            <AutomationHistorySection
              historyState={historyState}
              receivedError={receivedError}
              formatDate={formatDate}
              onRetryHistory={() => void loadHistory(draft.id)}
              onShowReceived={(id) => void showReceived(id)}
              onOpenTerminal={onOpenTerminal}
            />
          )}
        </div>
      )}

      {folderPicker && (
        <FolderPicker
          t={t}
          purpose="select"
          hosts={Object.values(connection.getSnapshot().observedHosts).filter(
            (h) => h.publicKey === host,
          )}
          hostKey={host}
          onHostChange={() => {}}
          onClose={() => setFolderPicker(false)}
          onOpen={async (_host, path) => {
            edit({ cwd: path });
            setFolderPicker(false);
            return undefined;
          }}
        />
      )}

      <AutomationDialogs
        draftName={draft?.name}
        working={working}
        regenerating={regenerating}
        regeneratingPending={workingOn === "regenerate"}
        regenerateError={regenerateError}
        onRegenerateOpenChange={(next) => {
          setRegenerating(next);
          if (!next) setRegenerateError("");
        }}
        onRegenerate={() => void regenerateToken()}
        received={received}
        onCloseReceived={() => setReceived(undefined)}
        deleting={deleting}
        deletingPending={workingOn === "delete"}
        onDeletingChange={setDeleting}
        onDelete={() => void remove()}
        formatDate={formatDate}
      />
    </div>
  );
}
