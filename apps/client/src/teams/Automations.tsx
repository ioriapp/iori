import { pickerClis } from "../cli-list.ts";
import { pickerTeams } from "./team-data.ts";
import { ErrorMessage } from "../Settings.tsx";
import { FolderPicker } from "../FolderPicker.tsx";
import { ForgeFailure } from "../forge/ForgeFailure.tsx";
import {
  PageHeader,
  PageBody,
  SettingsSection,
  FieldRow,
  SaveResult,
} from "../components/page-layout.tsx";
import {
  useCallback,
  useEffect,
  useState,
  useRef,
  type ReactNode,
} from "react";
import { ArrowLeft, Plus, MoreHorizontal } from "lucide-react";
import {
  automationDateTime,
  automationDateTimeAt,
  type Automation,
  type AutomationDefinition,
  type AutomationList,
  type AutomationReceived,
  type AutomationRun,
  type Candidate,
  type Team,
} from "@iori/protocol";
import { connection } from "../connection.ts";
import { native } from "../native.ts";
import { Button } from "../components/ui/button.tsx";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
} from "../components/ui/dropdown-menu.tsx";
import { Input } from "../components/ui/input.tsx";
import { Textarea } from "../components/ui/textarea.tsx";
import { Switch } from "../components/ui/switch.tsx";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "../components/ui/select.tsx";
import {
  Dialog,
  DialogContent,
  DialogBody,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "../components/ui/dialog.tsx";
import { useI18n } from "./context.tsx";
import type { OpenTeamTerminal } from "./TaskHistory.tsx";
type AutomationDraft = {
  draft: Automation;
  onceInput: string;
  saved?: Automation;
};
function editable(value: AutomationList["automations"][number]): Automation {
  const {
    lastRun: _lastRun,
    issueError: _issueError,
    webhookToken: _webhookToken,
    ...automation
  } = value;
  return automation;
}
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
      <SelectTrigger aria-label={label} data-iori-field={field}>
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
  const savedDefinitions = useRef(new Map<string, Automation>());
  const [draft, setDraft] = useState<Automation>();
  const [runs, setRuns] = useState<AutomationRun[]>([]);
  const [error, setError] = useState("");
  // The pressed action while it waits for the Host.
  const [workingOn, setWorkingOn] = useState<
    "save" | "run" | "delete" | "enabled" | "regenerate"
  >();
  const working = workingOn !== undefined;
  const [saved, setSaved] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [regenerating, setRegenerating] = useState(false);
  const [regenerateError, setRegenerateError] = useState("");
  const [received, setReceived] = useState<AutomationReceived>();
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
          return value ? editable(value) : undefined;
        });
        savedDefinitions.current = new Map(
          result.result.automations.map((a) => [a.id, editable(a)]),
        );
        setData(result.result);
        setError((current) =>
          current === "Could not load Automations. Retry." ? "" : current,
        );
      } else setError("Could not load Automations. Retry.");
    } catch {
      setError("Could not load Automations. Retry.");
    }
  }, [host]);
  const history = useCallback(
    async (id: string) => {
      if (!id) {
        setRuns([]);
        return;
      }
      try {
        const result = await connection.requestHost(
          host,
          "automation.history",
          { id },
        );
        if (result?.ok) setRuns(result.result.runs);
        else setError("Could not load automation history. Retry.");
      } catch {
        setError("Could not load automation history. Retry.");
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
        if (draft?.id) void history(draft.id);
      }
    });
    return () => {
      unsubscribe();
    };
  }, [active, host, load, history, draft?.id]);
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
    if (draft?.id) void history(draft.id);
  }, [draft?.id, history]);
  useEffect(() => {
    if (active)
      registerBack(() => {
        if (!draft) return false;
        setDraft(undefined);
        return true;
      });
  }, [active, draft, registerBack]);
  if (!active) return null;
  const zone = data?.timeZone;
  const date = (at: number) =>
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
    setDraft(structuredClone(pending?.draft ?? editable(automation)));
    setRuns([]);
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
      await history(draft.id);
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
  const toggleEnabled = async (enabled: boolean) => {
    if (!draft?.id) return;
    const stored = savedDefinitions.current.get(draft.id);
    if (!stored) return;
    setWorkingOn("enabled");
    setError("");
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
      savedDefinitions.current.set(id, editable(response.result.automation));
      setDraft((current) =>
        current?.id === id ? { ...current, enabled } : current,
      );
      await load();
    } catch {
      setError("Could not change the automation. Retry.");
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
    try {
      const result = await connection.requestHost(host, "automation.received", {
        id,
      });
      if (!result?.ok) throw new Error();
      setReceived(result.result.received);
    } catch {
      setError("The Host could not complete this operation. Retry.");
    }
  };
  const copy = (key: string, value: string) => {
    void native.clipboardWrite(value).then(
      () => setCopyState((state) => ({ ...state, [key]: "copied" })),
      () => setCopyState((state) => ({ ...state, [key]: "error" })),
    );
  };
  const copyButton = (key: string, value: string) => (
    <div>
      <Button
        variant="outline"
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
  const reason = (value: AutomationRun) =>
    value.launchError
      ? t(value.launchError)
      : value.reason === "busy"
        ? t("Skipped: previous conversation is working")
        : value.reason === "offline"
          ? t("Skipped: Host was stopped or asleep")
          : value.reason === "disabled"
            ? t("Skipped: automation was disabled")
            : "";
  const saveError =
    error === "Could not save the automation. Check its fields and retry.";
  const savedDefinition = draft && savedDefinitions.current.get(draft.id);
  const draftChanged =
    draft &&
    (JSON.stringify(draft) !== JSON.stringify(savedDefinition) ||
      (draft.schedule.kind === "once" &&
        zone &&
        (savedDefinition?.schedule.kind !== "once" ||
          onceInput !==
            automationDateTime(savedDefinition.schedule.at, zone))));
  const draftStatus = draftChanged
    ? t("Unsaved changes")
    : saved
      ? t("Settings saved")
      : "";
  const field = (
    label: string,
    children: ReactNode,
    description?: ReactNode,
  ) => (
    <FieldRow
      className="automation-field"
      stacked={[
        "Name",
        "Instructions",
        "Folder",
        "Days",
        "URL",
        "Token",
        "Label",
        "curl example",
      ].includes(label)}
      label={t(label)}
      description={description}
    >
      {children}
    </FieldRow>
  );
  return (
    <PageBody
      width="editor"
      className="team-content team-list-page"
      data-iori-view="automations"
    >
      <PageHeader
        title={draft ? draft.name || t("New automation") : "Automations"}
        description={
          draft ? (
            <SaveResult
              inline
              error={saveError}
              message={
                saveError ? (
                  t(error)
                ) : (
                  <>
                    {draftStatus}
                    {draftStatus && zone && " · "}
                    {zone && (
                      <span data-iori-automation-timezone>
                        {t("Host time zone")}: {zone}
                      </span>
                    )}
                  </>
                )
              }
            />
          ) : zone ? (
            <span data-iori-automation-timezone>
              {t("Host time zone")}: {zone}
            </span>
          ) : undefined
        }
        back={
          draft ? (
            <div className="automation-navigation">
              <Button
                variant="ghost"
                onClick={() => setDraft(undefined)}
                data-iori-action="automation-back"
              >
                <ArrowLeft size={16} />
                {t("Automations")}
              </Button>
            </div>
          ) : undefined
        }
        actions={
          !draft ? (
            <Button
              variant="outline"
              onClick={create}
              data-iori-action="automation-new"
            >
              <Plus size={15} />
              {t("New automation")}
            </Button>
          ) : (
            <>
              {draft.id && (
                <>
                  <label className="field-row">
                    {t("Enabled")}
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
                    variant="outline"
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
                disabled={working || !draftChanged}
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
                      variant="ghost"
                      size="icon"
                      aria-label={t("Automation actions")}
                      data-iori-action="automation-actions"
                    >
                      <MoreHorizontal />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end">
                    <DropdownMenuItem
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
      {error &&
        error !==
          "Could not save the automation. Check its fields and retry." && (
          <p role="alert">
            {t(error)}{" "}
            <Button
              variant="outline"
              onClick={() => {
                if (
                  error ===
                  "Could not restore this device's automation drafts. Retry."
                )
                  setDraftRetry((value) => value + 1);
                void load();
                if (draft?.id) void history(draft.id);
              }}
            >
              {t("Retry")}
            </Button>
          </p>
        )}
      {!draft ? (
        <SettingsSection className="team-list">
          {data?.automations.map((automation) => (
            <div className="team-list-row" key={automation.id}>
              <Button
                variant="ghost"
                className="team-list-open"
                data-iori-automation-id={automation.id}
                onClick={() => {
                  open(automation);
                  void load();
                }}
              >
                <div className="team-list-name">
                  <strong>{automation.name}</strong>
                  <span
                    data-iori-automation-enabled={
                      automation.enabled ? "true" : "false"
                    }
                  >
                    {t(automation.enabled ? "Enabled" : "Disabled")}
                  </span>
                </div>
                <div className="team-list-meta">
                  {automation.enabled && automation.nextAt !== undefined && (
                    <span>
                      <span data-iori-automation-next>
                        {t("Next run")}: {date(automation.nextAt)}
                      </span>
                    </span>
                  )}
                  {automation.lastRun && (
                    <span>
                      {t("Last run")}: {date(automation.lastRun.scheduledAt)}{" "}
                      {reason(automation.lastRun)}
                    </span>
                  )}
                </div>
              </Button>
            </div>
          ))}
          {data && !data.automations.length && (
            <p className="team-hint">
              {t("No automations yet. Create one to schedule an agent.")}
            </p>
          )}
        </SettingsSection>
      ) : (
        <>
          <SettingsSection title={t("Content")} onSave={() => void save()}>
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
              <div className="automation-folder-control field-code">
                <Input
                  aria-label={t("Folder")}
                  data-iori-field="automation-folder"
                  value={draft.cwd}
                  onChange={(e) => edit({ cwd: e.target.value })}
                />
                <Button
                  variant="outline"
                  data-iori-action="automation-folder-choose"
                  onClick={() => setFolderPicker(true)}
                >
                  {t("Choose folder")}
                </Button>
              </div>,
            )}
          </SettingsSection>
          <SettingsSection title={t("Run")} onSave={() => void save()}>
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
              <div className="team-execution-list team-parent-execution">
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
          </SettingsSection>
          <SettingsSection title={t("Schedule")} onSave={() => void save()}>
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
                <div className="flex flex-wrap gap-2">
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
          </SettingsSection>
          <SettingsSection title={t("Webhook")} onSave={() => void save()}>
            {field(
              "Run from webhook",
              <Switch
                aria-label={t("Run from webhook")}
                data-iori-field="automation-webhook"
                checked={!!draft.webhook}
                onCheckedChange={(enabled) =>
                  edit({ webhook: enabled ? { scope: "lan" } : undefined })
                }
              />,
              t(
                "If the CLI permission skips approvals, the agent can run commands without approval after reading what was received.",
              ),
            )}
            {draft.webhook && listener?.error === "port" && (
              <FieldRow>
                <ErrorMessage
                  message={t(
                    "Webhooks are not being accepted because port {port} could not be opened.",
                  ).replace("{port}", String(listener.port))}
                />
              </FieldRow>
            )}
            {draft.webhook && (
              <>
                {field(
                  "Accept from",
                  <Choice
                    label={t("Accept from")}
                    field="automation-webhook-scope"
                    value={draft.webhook.scope}
                    options={[
                      ["lan", t("LAN and VPN")],
                      ["local", t("This machine only")],
                    ]}
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
                        <div className="automation-copy-value">
                          <code className="automation-code field-code">
                            {url}
                          </code>
                          {copyButton("url", url)}
                        </div>,
                      )}
                    {field(
                      "Token",
                      <div className="automation-copy-value">
                        <code className="automation-code field-code">
                          ••••••••
                        </code>
                        <div className="flex flex-wrap items-start gap-2">
                          {copyButton("token", token)}
                          <Button
                            variant="outline"
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
                        <div className="automation-copy-value">
                          <code className="automation-code field-code">
                            {curl("••••••••")}
                          </code>
                          {copyButton("curl", curl(token))}
                        </div>,
                      )}
                  </>
                ) : (
                  <FieldRow>
                    <p className="team-hint">
                      {t("Save to create the URL and token.")}
                    </p>
                  </FieldRow>
                )}
              </>
            )}
          </SettingsSection>
          <SettingsSection title={t("Issue")} onSave={() => void save()}>
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
            {draft.issue && storedAutomation?.issueError === "no-forge" && (
              <FieldRow data-iori-automation-issue-error>
                <ErrorMessage
                  message={t("This folder's repository has no known forge.")}
                />
              </FieldRow>
            )}
            {draft.issue &&
              storedAutomation?.issueError &&
              storedAutomation.issueError !== "no-forge" && (
                <FieldRow data-iori-automation-issue-error>
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
                </FieldRow>
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
          </SettingsSection>
          {draft.id && (
            <SettingsSection title={t("History")}>
              <div className="section-rows" data-iori-view="automation-history">
                {runs.length === 0 && (
                  <FieldRow>
                    <p className="team-hint">{t("Not run yet.")}</p>
                  </FieldRow>
                )}
                {runs.map((value) => (
                  <FieldRow
                    className="automation-history-row"
                    key={value.id}
                    data-iori-automation-run={value.id}
                  >
                    <div className="team-list-meta">
                      <span>
                        {t(
                          value.trigger === "manual"
                            ? "Run now"
                            : value.trigger === "webhook"
                              ? "Webhook"
                              : value.trigger === "issue"
                                ? "Issue"
                                : "Scheduled",
                        )}
                        : {date(value.scheduledAt)}
                      </span>
                      {value.trigger === "webhook" && value.from && (
                        <span>
                          {t("From")}: {value.from}
                        </span>
                      )}
                      {value.trigger === "issue" && value.issue && (
                        <span>
                          #{value.issue.number} {value.issue.title}
                        </span>
                      )}
                      {value.startedAt !== undefined && (
                        <span>
                          {t("Started")}: {date(value.startedAt)}
                        </span>
                      )}
                    </div>
                    {reason(value) && (
                      <p data-iori-automation-reason={value.reason ?? "launch"}>
                        {reason(value)}
                      </p>
                    )}
                    <div className="flex flex-wrap items-start gap-2">
                      {value.trigger === "issue" && value.issue && (
                        <Button
                          variant="outline"
                          data-iori-action="automation-issue-open"
                          onClick={() => void native.openUrl(value.issue!.url)}
                        >
                          {language.startsWith("ja")
                            ? "ブラウザーで開く"
                            : "Open in browser"}
                        </Button>
                      )}
                      {value.trigger === "webhook" && (
                        <Button
                          variant="outline"
                          data-iori-action="automation-received"
                          onClick={() => void showReceived(value.id)}
                        >
                          {t("Received content")}
                        </Button>
                      )}
                      {value.terminalId && (
                        <Button
                          variant="outline"
                          data-iori-action="automation-conversation"
                          data-iori-terminal-id={value.terminalId}
                          onClick={() => onOpenTerminal(value.terminalId!)}
                        >
                          {t("Open conversation")}
                        </Button>
                      )}
                    </div>
                  </FieldRow>
                ))}
              </div>
            </SettingsSection>
          )}
        </>
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
      <Dialog
        open={regenerating}
        onOpenChange={(open) => {
          setRegenerating(open);
          if (!open) setRegenerateError("");
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("Regenerate the token?")}</DialogTitle>
            <DialogDescription>
              {t("The current token will stop working.")}
            </DialogDescription>
            <ErrorMessage
              message={regenerateError ? t(regenerateError) : undefined}
            />
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setRegenerating(false)}>
              {t("Cancel")}
            </Button>
            <Button
              disabled={working}
              pending={workingOn === "regenerate"}
              onClick={() => void regenerateToken()}
            >
              {t("Regenerate")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <Dialog
        open={!!received}
        onOpenChange={(open) => {
          if (!open) setReceived(undefined);
        }}
      >
        <DialogContent
          className="automation-received-dialog"
          data-iori-view="automation-received"
        >
          <DialogHeader>
            <DialogTitle>{t("Received content")}</DialogTitle>
          </DialogHeader>
          {received && (
            <DialogBody>
              <div className="team-list-meta">
                <span>
                  {t("Received at")}: {date(received.receivedAt)}
                </span>
                <span>
                  {t("From")}: {received.from}
                </span>
              </div>
              {(
                [
                  ["Query", JSON.stringify(received.query, null, 2)],
                  ["Headers", JSON.stringify(received.headers, null, 2)],
                  ["Body", received.body],
                ] as const
              ).map(([label, value]) => (
                <div className="automation-received-field" key={label}>
                  <div>{t(label)}</div>
                  <pre className="automation-code field-code">{value}</pre>
                </div>
              ))}
            </DialogBody>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setReceived(undefined)}>
              {t("Close")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <Dialog open={deleting} onOpenChange={setDeleting}>
        <DialogContent data-iori-view="automation-delete">
          <DialogHeader>
            <DialogTitle>{t("Delete automation")}</DialogTitle>
            <DialogDescription>
              {draft?.name}{" "}
              {t(
                "The automation and its history will be deleted. Started conversations will remain.",
              )}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleting(false)}>
              {t("Cancel")}
            </Button>
            <Button
              variant="destructive"
              data-iori-action="automation-delete-confirm"
              onClick={() => void remove()}
              disabled={working}
              pending={workingOn === "delete"}
            >
              {t("Delete")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </PageBody>
  );
}
