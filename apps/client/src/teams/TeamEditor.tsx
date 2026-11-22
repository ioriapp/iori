import { useCallback, useEffect, useRef, useState } from "react";
import {
  DndContext,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
} from "@dnd-kit/core";
import { arrayMove, sortableKeyboardCoordinates } from "@dnd-kit/sortable";
import { cn } from "cn";
import {
  nameOrder,
  type CliDefinitionFailure,
  type CliSummary,
  type TeamDefinition,
  type TeamList,
  type TeamRecord as SavedRecord,
  type TeamSettings,
} from "@iori/protocol";
import { pickerClis } from "../cli-list.ts";
import { connection } from "../connection.ts";
import { useIsMobile } from "../hooks/use-mobile.ts";
import { native } from "../native.ts";
import type { SettingsEditor } from "../settings-save.ts";
import { Button } from "../components/ui/button.tsx";
import { DropdownMenuItem } from "../components/ui/dropdown-menu.tsx";
import { SidebarTrigger } from "../components/ui/sidebar.tsx";
import { AgentSettings } from "./AgentSettings.tsx";
import { AgentsPage } from "./AgentsPage.tsx";
import { Automations } from "./Automations.tsx";
import { Records } from "./Records.tsx";
import type { OpenTeamTerminal } from "./TaskHistory.tsx";
import { useCliName, useI18n } from "./context.tsx";
import {
  candidate,
  clone,
  role,
  type Candidate,
  type Difficulty,
  type Role,
  type Team,
} from "./team-data.ts";
import { AdminSidebar } from "./editor/AdminSidebar.tsx";
import { ExecutionHeading, ExecutionRow } from "./editor/CandidateControls.tsx";
import {
  ActionsMenu,
  InlineAlertBanner,
  TeamMenuItems,
  TextPreview,
} from "./editor/EditorPrimitives.tsx";
import { OrchestratorSection } from "./editor/OrchestratorSection.tsx";
import { RoleEditorSection } from "./editor/RoleEditorSection.tsx";
import {
  TeamDetailHeader,
  TeamSaveStatus,
} from "./editor/TeamDetailHeader.tsx";
import {
  CopyToHostDialog,
  DeleteConfirmDialog,
  LeaveConfirmDialog,
  NewTeamDialog,
  SaveConflictDialog,
  TeamHistorySheet,
} from "./editor/TeamDialogs.tsx";
import { TeamOverviewSection } from "./editor/TeamOverviewSection.tsx";
import { TeamsListView } from "./editor/TeamsListView.tsx";
import {
  hasEffortOption,
  isTeamDirty,
  modelError,
  modelErrorKey,
  type ConfirmationState,
  type EditableHostTeams,
  type EditableTeamRecord,
  type LeaveGuard,
  type SaveConflictState,
  type Selection,
  type WorkingAction,
} from "./editor/types.ts";

export { modelError, type LeaveGuard } from "./editor/types.ts";

export function TeamEditor({
  host,
  active,
  registerGuard,
  initial,
  onBack,
  onOpenTerminal,
  onOpenIntegrations,
  onOpenWorkspaceSettings,
  onClisChanged,
  onCliHiddenChanged,
  onAgentsOpened,
  onRetryModels,
  initialPage,
  requestedTeam,
  onRequestedTeamOpened,
  entry,
  initialDrafts,
  registerBack,
  cliListError,
  onRetryClis,
  loadingClis,
  allClis,
  orderable,
  failedDefinitions,
}: {
  host: string;
  active: boolean;
  registerGuard: (guard: LeaveGuard) => void;
  initial: TeamList;
  onBack?: () => void;
  onOpenTerminal: OpenTeamTerminal;
  onOpenIntegrations?: (hostKey: string) => void;
  onOpenWorkspaceSettings?: (hostKey: string, workspacePath: string) => void;
  onClisChanged: () => Promise<void>;
  onCliHiddenChanged: (cliId: string, hidden: boolean) => void;
  onAgentsOpened: () => void;
  onRetryModels: (id: string) => void;
  initialPage?: "teams" | "agents";
  requestedTeam?: { teamId: string; roleId?: string; nonce: number };
  onRequestedTeamOpened: () => void;
  entry: number;
  initialDrafts: Record<string, Team>;
  registerBack: (back: () => boolean) => void;
  cliListError: boolean;
  onRetryClis: () => void;
  loadingClis?: boolean;
  /** The CLIs with the user's definitions that this Host does not find. */
  allClis: CliSummary[];
  orderable?: true;
  failedDefinitions: CliDefinitionFailure[];
}) {
  const { t, language, clis, catalogs, loadingModels } = useI18n();
  const cliName = useCliName();
  const templates = initial.templates;

  const [hosts, setHosts] = useState<Record<string, EditableHostTeams>>({
    [host]: {
      ...initial,
      teams: initial.teams.map((record) => ({
        ...record,
        draft: initialDrafts[record.saved.id] ?? clone(record.saved),
      })),
    },
  });
  const [draftError, setDraftError] = useState(false);
  const draftQueue = useRef(Promise.resolve());
  const drafts = Object.fromEntries(
    hosts[host].teams
      .filter(isTeamDirty)
      .map((record) => [record.saved.id, record.draft]),
  );
  const draftKey = JSON.stringify(drafts);
  const persistDrafts = () => {
    draftQueue.current = draftQueue.current.then(async () => {
      try {
        await native.saveView(`teams:${host}:drafts`, drafts);
        setDraftError(false);
      } catch {
        setDraftError(true);
      }
    });
  };
  useEffect(persistDrafts, [draftKey, host]);

  const [workingOn, setWorkingOn] = useState<WorkingAction>();
  const working = workingOn !== undefined;
  const settingsQueue = useRef(Promise.resolve(true));
  const [settingsError, setSettingsError] = useState<
    "defaultTeam" | "limits"
  >();
  const [remoteSettings, setRemoteSettings] = useState<TeamSettings>({
    defaultTeam: initial.defaultTeam,
    limits: initial.limits,
  });
  const settingsRef = useRef(remoteSettings);
  settingsRef.current = remoteSettings;
  const confirmedSettings = useRef(remoteSettings);
  const [loadError, setLoadError] = useState(false);

  const updateHost = (fn: (value: EditableHostTeams) => EditableHostTeams) =>
    setHosts((current) => ({ ...current, [host]: fn(current[host]) }));

  const reload = async () => {
    try {
      const response = await connection.requestHost(host, "teams.list", {});
      if (!response?.ok) {
        setLoadError(true);
        return;
      }
      setLoadError(false);
      setRemoteSettings(response.result);
      confirmedSettings.current = response.result;
      setHosts((current) => ({
        ...current,
        [host]: {
          ...response.result,
          teams: response.result.teams.map((record) => {
            const previous = current[host]?.teams.find(
              (r) => r.saved.id === record.saved.id,
            );
            return {
              ...record,
              draft:
                previous && isTeamDirty(previous)
                  ? previous.draft
                  : clone(record.saved),
            };
          }),
        },
      }));
    } catch {
      setLoadError(true);
    }
  };

  useEffect(() => {
    let connected = connection.getSnapshot().connectedHosts.includes(host);
    return connection.subscribe(() => {
      const next = connection.getSnapshot().connectedHosts.includes(host);
      if (next && !connected && active) void reload();
      connected = next;
    });
  }, [host, active]);

  const putRecord = (record: SavedRecord, preserveDraft = false) =>
    setHosts((current) => ({
      ...current,
      [host]: {
        ...current[host],
        teams: current[host].teams.some((r) => r.saved.id === record.saved.id)
          ? current[host].teams.map((r) =>
              r.saved.id === record.saved.id
                ? {
                    ...r,
                    ...record,
                    draft: preserveDraft ? r.draft : clone(record.saved),
                  }
                : r,
            )
          : [...current[host].teams, { ...record, draft: clone(record.saved) }],
      },
    }));

  const saveSettings = ({ defaultTeam, limits }: TeamSettings) => {
    const next = { defaultTeam, limits };
    const field =
      defaultTeam !== settingsRef.current.defaultTeam
        ? "defaultTeam"
        : "limits";
    settingsRef.current = next;
    setRemoteSettings(next);
    updateHost((d) => ({ ...d, ...next }));
    settingsQueue.current = settingsQueue.current.then(async () => {
      try {
        const response = await connection.requestHost(
          host,
          "teams.settings",
          next,
        );
        if (!response?.ok) throw new Error();
        confirmedSettings.current = response.result;
        setSettingsError(undefined);
        if (settingsRef.current === next) {
          settingsRef.current = response.result;
          setRemoteSettings(response.result);
          updateHost((d) => ({ ...d, ...response.result }));
        }
        return true;
      } catch {
        setSettingsError(field);
        if (settingsRef.current === next) {
          settingsRef.current = confirmedSettings.current;
          setRemoteSettings(confirmedSettings.current);
          updateHost((d) => ({ ...d, ...confirmedSettings.current }));
        }
        return false;
      }
    });
    return settingsQueue.current;
  };

  const isMobile = useIsMobile();
  // State variable names preserved for verification/ui-states preview tooling.
  const [selection, setSelection] = useState<Selection>({
    page: initialPage ?? "agents",
  });
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const [mobileDetail, setMobileDetail] = useState(false);
  const [candidateSearchOpen, setCandidateSearchOpen] = useState(false);
  const [difficulty, setDifficulty] = useState<Difficulty>("medium");
  const [newTeamOpen, setNewTeamOpen] = useState(false);
  const [teamSource, setTeamSource] = useState("template:development");
  const [newParent, setNewParent] = useState(() =>
    candidate(pickerClis(clis)[0]?.id ?? "", ""),
  );

  const agentsVisible =
    active && selection.page === "agents" && (!isMobile || mobileDetail);
  useEffect(() => {
    if (agentsVisible) onAgentsOpened();
  }, [agentsVisible, onAgentsOpened]);

  useEffect(
    () =>
      registerBack(() => {
        if (!mobileDetail) return false;
        setMobileDetail(false);
        return true;
      }),
    [mobileDetail, registerBack],
  );

  const [pending, setPending] = useState<(() => void) | null>(null);
  const savingLeave = useRef<(() => void) | null>(null);
  const cancelLeave = () => {
    savingLeave.current = null;
    setPending(null);
  };
  const [confirmation, setConfirmation] = useState<ConfirmationState | null>(
    null,
  );
  const [confirmationError, setConfirmationError] = useState("");
  const [confirmationWorking, setConfirmationWorking] = useState(false);
  useEffect(() => setConfirmationError(""), [confirmation]);

  const openNewTeam = () => {
    const cli = pickerClis(clis)[0];
    setNewParent(candidate(cli?.id ?? "", "", cli?.name));
    setNewTeamOpen(true);
  };

  const [copyTeam, setCopyTeam] = useState<Team | null>(null);
  const [copyHost, setCopyHost] = useState("");
  const [historyOpen, setHistoryOpen] = useState(false);
  const [historyVersion, setHistoryVersion] = useState<number | null>(null);
  const [agentExpanded, setAgentExpanded] = useState<Record<string, boolean>>(
    {},
  );
  const [saveConflict, setSaveConflict] = useState<SaveConflictState | null>(
    null,
  );
  const [conflictError, setConflictError] = useState(false);
  const [saveMessage, setSaveMessage] = useState("");
  const [message, setMessage] = useState("");
  const scrollRef = useRef<HTMLDivElement>(null);
  const lastHost = useRef(host);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    }),
  );

  const data: EditableHostTeams = {
    ...hosts[host],
    teams: [...hosts[host].teams].sort((a, b) => nameOrder(a.saved, b.saved)),
  };
  const selectedRecord =
    selection.page === "team"
      ? data.teams.find((r) => r.draft.id === selection.teamId)
      : undefined;
  const team = selectedRecord?.draft;
  const recentModels = team
    ? Array.from(
        new Map(
          [
            team.parent,
            ...team.roles.flatMap((r) => Object.values(r.candidates).flat()),
          ].map((c) => [
            JSON.stringify([c.cli, c.model]),
            { cli: c.cli, model: c.model },
          ]),
        ).values(),
      )
    : [];
  const selectedRole =
    team && selection.page === "team"
      ? team.roles.find((r) => r.id === selection.detail)
      : undefined;
  const dirty = isTeamDirty(selectedRecord);

  const availableModels = Object.fromEntries(
    Object.entries(catalogs).map(([id, catalog]) => [
      id,
      catalog.models.map((model) => model.name),
    ]),
  );
  const selectableModels = Object.fromEntries(
    pickerClis(clis).map((cli) => [cli.id, availableModels[cli.id] ?? []]),
  );
  const availableClis = clis.map((c) => c.id);

  const locale =
    language.toLowerCase().startsWith("ja") ||
    (language === "system" && navigator.language.startsWith("ja"))
      ? "ja-JP"
      : "en-US";
  const formatDate = (value: string) =>
    new Intl.DateTimeFormat(locale, {
      month: "numeric",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    }).format(new Date(value));

  const updateTeamDraft = (
    teamId: string,
    fn: (draft: Team, saved: Team) => Team,
  ) =>
    updateHost((d) => ({
      ...d,
      teams: d.teams.map((r) =>
        r.draft.id === teamId ? { ...r, draft: fn(r.draft, r.saved) } : r,
      ),
    }));

  const editTeam = (fn: (value: Team) => Team) => {
    if (!team) return;
    updateTeamDraft(team.id, fn);
    setSaveMessage("");
  };

  const editRole = (changes: Partial<Role>) =>
    editTeam((value) => ({
      ...value,
      roles: value.roles.map((r) =>
        r.id === selectedRole?.id ? { ...r, ...changes } : r,
      ),
    }));

  const undo = (record = selectedRecord) => {
    if (
      record &&
      selection.page === "team" &&
      selection.teamId === record.saved.id &&
      !["overview", "parent"].includes(selection.detail) &&
      !record.saved.roles.some((r) => r.id === selection.detail)
    )
      setSelection({
        page: "team",
        teamId: record.saved.id,
        detail: "overview",
      });
    if (record)
      updateTeamDraft(record.saved.id, (_draft, saved) => clone(saved));
    setSaveMessage("");
  };

  const editors = useRef(new Set<SettingsEditor>());
  const registerEditor = useCallback((editor: SettingsEditor) => {
    editors.current.add(editor);
    return () => {
      editors.current.delete(editor);
    };
  }, []);

  const guard: LeaveGuard = (action) => {
    if (dirty || [...editors.current].some((checkDirty) => checkDirty())) {
      setPending(() => action);
    } else action();
  };

  useEffect(() => {
    registerGuard(guard);
  }, [dirty, selectedRecord, registerGuard]);

  useEffect(() => {
    if (host !== lastHost.current) {
      setSelection({ page: "teams" });
      setMobileDetail(false);
      setSaveMessage("");
      setMessage("");
      lastHost.current = host;
    }
  }, [host]);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: 0 });
  }, [selection, mobileDetail, active]);

  const go = (next: Selection, detail = true) => {
    const change = () => {
      setSelection(next);
      setMobileDetail(detail);
      setSaveMessage("");
      setMessage("");
    };
    if (
      (selection.page === "agents" && next.page !== "agents") ||
      (selection.page === "team" &&
        (next.page !== "team" || next.teamId !== selection.teamId))
    )
      guard(change);
    else change();
  };

  const cancelConflict = () => {
    if (working) return;
    setSaveConflict(null);
    setConflictError(false);
    cancelLeave();
  };

  const finishConflict = (navigate = true) => {
    const action = navigate ? savingLeave.current : null;
    setSaveConflict(null);
    setConflictError(false);
    cancelLeave();
    action?.();
  };

  const save = async (
    record = selectedRecord,
    baseVersion = record?.draft.version,
    editedFrom?: number,
  ) => {
    const currentTeam = record?.draft;
    if (!currentTeam || !isTeamDirty(record)) return false;
    const submitted = clone(currentTeam);
    if (!currentTeam.name.trim()) {
      setSaveMessage("Could not save: enter a team name.");
      return false;
    }
    if (currentTeam.roles.some((r) => !r.name.trim())) {
      setSaveMessage("Could not save: enter a name for each role.");
      return false;
    }
    setWorkingOn("save");
    setConflictError(false);
    try {
      const response = await connection.requestHost(host, "teams.save", {
        teamId: currentTeam.id,
        definition: submitted,
        baseVersion,
        ...(editedFrom === undefined ? {} : { editedFrom }),
      });
      const result = response?.ok ? response.result : undefined;
      const saved =
        result && "conflict" in result
          ? result.conflict === "changed" &&
            JSON.stringify({
              ...result.current.saved,
              version: submitted.version,
              updated: submitted.updated,
            }) === JSON.stringify(submitted)
            ? result.current
            : undefined
          : result;
      if (result && "conflict" in result && !saved) {
        setSaveConflict({
          current: result.conflict === "changed" ? result.current : null,
          editedFrom: editedFrom ?? submitted.version,
        });
        return "conflict";
      }
      if (saved) {
        setHosts((current) => ({
          ...current,
          [host]: {
            ...current[host],
            teams: current[host].teams.map((entry) =>
              entry.saved.id === submitted.id
                ? {
                    ...entry,
                    ...saved,
                    draft:
                      JSON.stringify(entry.draft) === JSON.stringify(submitted)
                        ? clone(saved.saved)
                        : {
                            ...entry.draft,
                            version: saved.saved.version,
                            updated: saved.saved.updated,
                          },
                  }
                : entry,
            ),
          },
        }));
        setSaveMessage(editedFrom === undefined ? "Saved" : "");
        return true;
      } else if (editedFrom !== undefined) setConflictError(true);
      else setSaveMessage("Could not save team. Check the values and retry.");
    } catch {
      if (editedFrom !== undefined) setConflictError(true);
      else setSaveMessage("Could not save team. Reconnect and retry.");
    } finally {
      setWorkingOn(undefined);
    }
    return false;
  };

  const openTeam = (id: string, detail = "overview") => {
    setExpanded((e) => ({ ...e, [id]: true }));
    go({ page: "team", teamId: id, detail });
  };

  const create = async (source: {
    template?: string;
    parent?: Candidate;
    language?: "en" | "ja";
    sourceId?: string;
    definition?: TeamDefinition;
    name?: string;
  }) => {
    setWorkingOn("create");
    try {
      const response = await connection.requestHost(
        host,
        "teams.create",
        source,
      );
      if (!response?.ok) {
        setMessage(t("Could not create team. Retry."));
        return;
      }
      putRecord(response.result);
      setNewTeamOpen(false);
      openTeam(response.result.saved.id);
    } catch {
      setMessage(t("Could not create team. Retry."));
    } finally {
      setWorkingOn(undefined);
    }
  };

  const addNewTeam = () => {
    const [kind, id] = teamSource.split(":");
    void create(
      kind === "template"
        ? {
            template: id,
            language: locale === "ja-JP" ? "ja" : "en",
            parent: newParent,
          }
        : {
            sourceId: id,
            name: `${data.teams.find((r) => r.saved.id === id)?.saved.name} — ${t("Duplicate")}`,
          },
    );
  };

  const duplicate = (source: Team) =>
    guard(() => {
      void create({
        sourceId: source.id,
        name: `${source.name} — ${t("Duplicate")}`,
      });
    });

  const deleteTeam = async (id: string) => {
    try {
      const response = await connection.requestHost(host, "teams.delete", {
        teamId: id,
      });
      if (!response?.ok) {
        setMessage(t("Could not delete team. Retry."));
        return;
      }
      updateHost((d) => ({
        ...d,
        defaultTeam: d.defaultTeam === id ? "" : d.defaultTeam,
        teams: d.teams.filter((r) => r.saved.id !== id),
      }));
      if (selection.page === "team" && selection.teamId === id) {
        setSelection({ page: "teams" });
        setMobileDetail(true);
      }
    } catch {
      setMessage(t("Could not delete team. Retry."));
    }
  };

  const setTeamHidden = async (teamId: string, hidden: boolean) => {
    try {
      const response = await connection.requestHost(host, "teams.hidden.set", {
        teamId,
        hidden,
      });
      if (!response?.ok) {
        setMessage(t("Could not change picker visibility. Retry."));
        return;
      }
      await reload();
    } catch {
      setMessage(t("Could not change picker visibility. Retry."));
    }
  };

  const teamMenu = (source: Team, context = false, includeOpen = true) => (
    <TeamMenuItems
      context={context}
      hidden={!!data.teams.find((r) => r.saved.id === source.id)?.hidden}
      onHidden={() =>
        void setTeamHidden(
          source.id,
          !data.teams.find((r) => r.saved.id === source.id)?.hidden,
        )
      }
      onOpen={includeOpen ? () => openTeam(source.id) : undefined}
      onDuplicate={() => duplicate(source)}
      onCopy={() => {
        setCopyHost(
          connection
            .getSnapshot()
            .initial?.hosts.find((h) => h.publicKey !== host)?.publicKey ?? "",
        );
        setCopyTeam(source);
      }}
      onDelete={() =>
        setConfirmation({
          title: "Delete team?",
          text: `${source.name} — ${t("Started conversations and records will remain.")}`,
          action: () => {
            void deleteTeam(source.id);
          },
        })
      }
    />
  );

  const currentHistory =
    selectedRecord?.history.find((h) => h.team.version === historyVersion) ??
    selectedRecord?.history[0];

  const restore = async () => {
    if (!currentHistory || !team) return;
    setWorkingOn("restore");
    try {
      const response = await connection.requestHost(host, "teams.restore", {
        teamId: team.id,
        version: currentHistory.team.version,
      });
      if (response?.ok) {
        putRecord(response.result);
        setHistoryOpen(false);
        setSelection({ page: "team", teamId: team.id, detail: "overview" });
        setSaveMessage("Saved");
      } else setSaveMessage("Could not restore version. Retry.");
    } catch {
      setSaveMessage("Could not restore version. Reconnect and retry.");
    } finally {
      setWorkingOn(undefined);
    }
  };

  const copyToHost = async () => {
    if (!copyTeam || !copyHost) return;
    setWorkingOn("copy");
    try {
      const response = await connection.requestHost(copyHost, "teams.create", {
        definition: copyTeam,
      });
      if (response?.ok) {
        setMessage(
          t("Copied to {host}").replace(
            "{host}",
            connection
              .getSnapshot()
              .initial?.hosts.find((h) => h.publicKey === copyHost)?.hostName ??
              "",
          ),
        );
        setCopyTeam(null);
      } else setMessage(t("Could not copy team. Retry."));
    } catch {
      setMessage(t("Could not copy team. Retry."));
    } finally {
      setWorkingOn(undefined);
    }
  };

  const addRole = (teamId: string) => {
    const fresh = role(
      t("New role"),
      t("Purpose\nScope\nCompletion criteria\nConstraints"),
      t(
        "Changes\nVerification results\nRemaining issues\nQuestions to orchestrator",
      ),
    );
    updateTeamDraft(teamId, (draft) => ({
      ...draft,
      roles: [...draft.roles, fresh],
    }));
    setExpanded((e) => ({ ...e, [teamId]: true }));
    go({ page: "team", teamId, detail: fresh.id });
  };

  const selectTeamDetail = (teamId: string, detail: string) => {
    setExpanded((e) => ({ ...e, [teamId]: true }));
    setSelection({ page: "team", teamId, detail });
    setMobileDetail(true);
    setSaveMessage("");
  };

  const roleAction = (teamId: string, action: () => void) => {
    if (selection.page === "team" && selection.teamId !== teamId) guard(action);
    else action();
  };

  const roleMenu = (r: Role, teamId: string) => (
    <ActionsMenu
      label="Role actions"
      size={isMobile ? "icon-touch" : "icon-sm"}
    >
      <DropdownMenuItem
        onSelect={() =>
          roleAction(teamId, () => {
            selectTeamDetail(teamId, r.id);
            requestAnimationFrame(() => {
              const field = document.querySelector<HTMLInputElement>(
                ".team-role-content input",
              );
              field?.focus();
              field?.select();
            });
          })
        }
      >
        {t("Rename")}
      </DropdownMenuItem>
      <DropdownMenuItem
        onSelect={() =>
          roleAction(teamId, () => {
            const fresh = clone(r);
            fresh.id = crypto.randomUUID();
            fresh.name += ` — ${t("Duplicate")}`;
            Object.values(fresh.candidates)
              .flat()
              .forEach((c) => {
                c.id = crypto.randomUUID();
              });
            updateTeamDraft(teamId, (draft) => ({
              ...draft,
              roles: [...draft.roles, fresh],
            }));
            selectTeamDetail(teamId, fresh.id);
          })
        }
      >
        {t("Duplicate")}
      </DropdownMenuItem>
      <DropdownMenuItem
        variant="destructive"
        onSelect={() =>
          roleAction(teamId, () => {
            selectTeamDetail(teamId, r.id);
            setConfirmation({
              title: "Delete role?",
              text: `${r.name} — ${t("Started conversations and records will remain.")}`,
              action: () => {
                updateTeamDraft(teamId, (draft) => ({
                  ...draft,
                  roles: draft.roles.filter((v) => v.id !== r.id),
                }));
                selectTeamDetail(teamId, "overview");
              },
            });
          })
        }
      >
        {t("Delete")}
      </DropdownMenuItem>
    </ActionsMenu>
  );

  const onLimits = (cli: string) =>
    guard(() => {
      setAgentExpanded((e) => ({ ...e, [cli]: true }));
      setSelection({ page: "agents" });
      setMobileDetail(true);
      requestAnimationFrame(() =>
        document
          .getElementById(`team-agent-${cli}`)
          ?.scrollIntoView({ block: "start" }),
      );
    });

  const actualDifficulty: Difficulty = selectedRole?.split
    ? difficulty
    : "medium";
  const candidateRows = selectedRole?.candidates[actualDifficulty] ?? [];

  const editCandidate = (id: string, changes: Partial<Candidate>) =>
    editRole({
      candidates: {
        ...selectedRole!.candidates,
        [actualDifficulty]: candidateRows.map((c) =>
          c.id === id ? { ...c, ...changes } : c,
        ),
      },
    });

  const stepCandidate = (index: number, direction: -1 | 1) => {
    const target = index + direction;
    if (!selectedRole || target < 0 || target >= candidateRows.length) return;
    editRole({
      candidates: {
        ...selectedRole.candidates,
        [actualDifficulty]: arrayMove(candidateRows, index, target),
      },
    });
  };

  const addCandidate = (cli: string, model: string) =>
    editRole({
      candidates: {
        ...selectedRole!.candidates,
        [actualDifficulty]: [
          ...candidateRows,
          candidate(cli, model, cliName(cli)),
        ],
      },
    });

  const renderExecution = (
    item: Candidate,
    index?: number,
    parent = false,
    total?: number,
  ) => (
    <ExecutionRow
      key={item.id}
      item={item}
      index={index}
      total={total}
      parent={parent}
      onChange={(changes) =>
        parent
          ? editTeam((value) => ({
              ...value,
              parent: { ...value.parent, ...changes },
            }))
          : editCandidate(item.id, changes)
      }
      onStep={
        !parent && index !== undefined
          ? (direction) => stepCandidate(index, direction)
          : undefined
      }
      onRemove={() =>
        editRole({
          candidates: {
            ...selectedRole!.candidates,
            [actualDifficulty]: candidateRows.filter((c) => c.id !== item.id),
          },
        })
      }
      onCopyLevel={(level) =>
        editRole({
          candidates: {
            ...selectedRole!.candidates,
            [level]: [
              ...selectedRole!.candidates[level],
              { ...clone(item), id: crypto.randomUUID() },
            ],
          },
        })
      }
      onCopyRole={(id) =>
        editTeam((value) => ({
          ...value,
          roles: value.roles.map((r) =>
            r.id === id
              ? {
                  ...r,
                  candidates: {
                    ...r.candidates,
                    [actualDifficulty]: [
                      ...r.candidates[actualDifficulty],
                      { ...clone(item), id: crypto.randomUUID() },
                    ],
                  },
                }
              : r,
          ),
        }))
      }
      roles={team?.roles.filter((r) => r.id !== selectedRole?.id)}
      availableModels={selectableModels}
      recent={recentModels}
      limits={data.limits}
      available={availableClis}
      onLimits={onLimits}
    />
  );

  useEffect(() => {
    if (active) {
      void reload();
      setSelection({ page: initialPage ?? "agents" });
      setMobileDetail(initialPage === "agents");
    }
  }, [active, initialPage, entry]);

  useEffect(() => {
    if (active && requestedTeam) {
      openTeam(requestedTeam.teamId, requestedTeam.roleId ?? "overview");
      onRequestedTeamOpened();
    }
  }, [active, requestedTeam]);

  const withTreeTeam = (
    record: EditableTeamRecord,
    detail: string,
    action: () => void,
  ) => {
    if (selectedRecord?.draft.id === record.draft.id) action();
    else
      guard(() => {
        setSelection({ page: "team", teamId: record.draft.id, detail });
        setMessage("");
        setSaveMessage("");
        action();
      });
  };

  const moveRole = (
    record: EditableTeamRecord,
    id: string,
    targetId: string,
  ) => {
    if (id === targetId) return;
    withTreeTeam(record, id, () => {
      updateTeamDraft(record.draft.id, (draft) => {
        const from = draft.roles.findIndex((r) => r.id === id);
        const to = draft.roles.findIndex((r) => r.id === targetId);
        if (from < 0 || to < 0) return draft;
        return { ...draft, roles: arrayMove(draft.roles, from, to) };
      });
      setSaveMessage("");
    });
  };

  const mobileLocationTitle = team
    ? `${team.name} › ${
        selection.page === "team"
          ? selection.detail === "parent"
            ? t("Orchestrator")
            : selection.detail === "overview"
              ? t("Team overview")
              : selectedRole?.name
          : ""
      }`
    : t(
        selection.page === "agents"
          ? "AI Agents"
          : selection.page === "automations"
            ? "Automations"
            : selection.page === "records"
              ? "Records"
              : "Teams",
      );

  return (
    <section
      className="flex h-full min-h-0 min-w-0 flex-1 overflow-hidden bg-background"
      aria-label={t("AI Agents/Teams")}
      data-active={active}
      data-iori-view="teams-editor"
    >
      <AdminSidebar
        selection={selection}
        teams={data.teams}
        expanded={expanded}
        onExpandedChange={(teamId, yes) =>
          setExpanded((current) => ({ ...current, [teamId]: yes }))
        }
        isMobile={isMobile}
        mobileDetail={mobileDetail}
        sensors={sensors}
        onBack={onBack ? () => guard(onBack) : undefined}
        onNavigate={(next) => go(next)}
        onNewTeam={() => guard(openNewTeam)}
        onOpenTeam={openTeam}
        onAddRole={(teamId) => {
          if (selection.page === "team" && selection.teamId !== teamId)
            guard(() => addRole(teamId));
          else addRole(teamId);
        }}
        onMoveRole={moveRole}
        renderTeamMenu={(source, context) => teamMenu(source, context)}
        renderRoleMenu={roleMenu}
        renderMobileSaveBar={(record) => (
          <>
            <div className="mr-auto">
              <TeamSaveStatus
                dirty={true}
                saveMessage={record === selectedRecord ? saveMessage : ""}
              />
            </div>
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={working}
              onClick={() => undo(record)}
            >
              {t("Undo")}
            </Button>
            <Button
              type="button"
              size="sm"
              disabled={working}
              pending={workingOn === "save" && record === selectedRecord}
              className="team-save-button"
              data-iori-action="team-save"
              onClick={() =>
                withTreeTeam(record, "overview", () => void save(record))
              }
            >
              {t("Save")}
            </Button>
          </>
        )}
      />

      {/* Right Main Surface */}
      <div
        className={cn(
          "flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden bg-background",
          !mobileDetail && "max-md:hidden",
        )}
      >
        {/* Mobile top navigation strip (non-team sections, or sidebar opener) */}
        <div className="hidden min-h-12 shrink-0 items-center gap-1.5 border-b border-border bg-background px-1.5 max-md:flex">
          <SidebarTrigger
            className="size-11"
            aria-label={t("Open sidebar")}
            title={t("Open sidebar")}
            data-iori-action="sidebar-toggle"
          />
          <span
            title={team?.name}
            className="min-w-0 flex-1 truncate font-heading text-sm font-medium text-foreground"
          >
            {mobileLocationTitle}
          </span>
        </div>

        {/* Sticky Team Editor Header */}
        {team && selection.page === "team" && selectedRecord && (
          <TeamDetailHeader
            record={selectedRecord}
            selection={selection}
            selectedRoleName={selectedRole?.name}
            dirty={dirty}
            working={working}
            workingOn={workingOn}
            saveMessage={saveMessage}
            isMobile={isMobile}
            onBack={() => {
              if (isMobile) setMobileDetail(false);
              else openTeam(team.id, "overview");
            }}
            onOpenHistory={() => {
              setHistoryVersion(null);
              setHistoryOpen(true);
            }}
            onUndo={() => undo(selectedRecord)}
            onSave={() => void save(selectedRecord)}
            renderTeamMenu={() => teamMenu(selectedRecord.saved, false, false)}
          />
        )}

        {/* Inline Status / Error Banners */}
        {(draftError || loadError || message) && (
          <div className="mx-auto flex w-full max-w-[960px] shrink-0 flex-col gap-2 px-6 pt-3 max-md:px-4">
            {draftError && (
              <InlineAlertBanner
                message={t(
                  "Could not keep the team draft on this device. Retry saving the draft.",
                )}
                actionLabel={t("Retry saving")}
                onAction={persistDrafts}
              />
            )}
            {loadError && (
              <InlineAlertBanner
                message={t("Could not load teams. Retry.")}
                actionLabel={t("Retry")}
                onAction={() => void reload()}
              />
            )}
            {message && <InlineAlertBanner message={message} tone="status" />}
          </div>
        )}

        {/* Scrollable Workspace Area */}
        <div
          ref={scrollRef}
          className="min-h-0 flex-1 overflow-y-auto [scrollbar-gutter:stable]"
        >
          {selection.page === "teams" && (
            <TeamsListView
              teams={data.teams}
              defaultTeam={data.defaultTeam}
              settingsError={settingsError}
              onDefaultTeamChange={(defaultTeam) =>
                saveSettings({ limits: data.limits, defaultTeam })
              }
              onNewTeam={openNewTeam}
              onOpenTeam={(id) => openTeam(id)}
              formatDate={formatDate}
              renderTeamMenu={(source) => teamMenu(source)}
            />
          )}

          {team &&
            selection.page === "team" &&
            selection.detail === "overview" && (
              <TeamOverviewSection team={team} onEditTeam={editTeam} />
            )}

          {team &&
            selection.page === "team" &&
            selection.detail === "parent" && (
              <OrchestratorSection
                team={team}
                sensors={sensors}
                onEditTeam={editTeam}
                renderParentExecution={() =>
                  renderExecution(team.parent, undefined, true)
                }
              />
            )}

          {team && selectedRole && (
            <RoleEditorSection
              team={team}
              role={selectedRole}
              difficulty={difficulty}
              onDifficultyChange={setDifficulty}
              candidateSearchOpen={candidateSearchOpen}
              onCandidateSearchOpenChange={setCandidateSearchOpen}
              selectableModels={selectableModels}
              recentModels={recentModels}
              sensors={sensors}
              onEditRole={editRole}
              onAddCandidate={addCandidate}
              renderCandidateRow={(item, index, total) =>
                renderExecution(item, index, false, total)
              }
            />
          )}

          <Automations
            host={host}
            onOpenIntegrations={onOpenIntegrations}
            onOpenWorkspaceSettings={onOpenWorkspaceSettings}
            active={active && selection.page === "automations"}
            teams={data.teams.map((r) => ({ ...r.saved, hidden: r.hidden }))}
            defaultTeam={data.defaultTeam}
            onOpenTerminal={onOpenTerminal}
            registerBack={(back) =>
              registerBack(() => {
                if (back()) return true;
                if (mobileDetail) {
                  setMobileDetail(false);
                  return true;
                }
                return false;
              })
            }
            renderCandidate={(item, onChange) => (
              <div className="border-y border-border">
                <ExecutionHeading
                  parent
                  showEffort={hasEffortOption(item, catalogs, clis)}
                />
                <DndContext sensors={sensors}>
                  <ExecutionRow
                    item={item}
                    parent
                    onChange={onChange}
                    availableModels={selectableModels}
                    recent={[]}
                    limits={data.limits}
                    available={clis.map((cli) => cli.id)}
                    onLimits={onLimits}
                  />
                </DndContext>
              </div>
            )}
          />

          {selection.page === "records" && (
            <Records
              host={host}
              active={active}
              t={t}
              language={language}
              onOpenTerminal={onOpenTerminal}
              registerBack={(back) =>
                registerBack(() => {
                  if (back()) return true;
                  if (mobileDetail) {
                    setMobileDetail(false);
                    return true;
                  }
                  return false;
                })
              }
            />
          )}

          {selection.page === "agents" && (
            <AgentsPage
              host={host}
              clis={allClis}
              orderable={orderable}
              failed={failedDefinitions}
              listError={cliListError}
              onRetryList={onRetryClis}
              loading={loadingClis}
              onChanged={onClisChanged}
              onHiddenChanged={onCliHiddenChanged}
              expanded={agentExpanded}
              onExpandedChange={(id, yes) =>
                setAgentExpanded((e) => ({ ...e, [id]: yes }))
              }
              registerEditor={registerEditor}
              renderModelError={(cli) =>
                catalogs[cli.id]?.error && (
                  <div
                    key={modelErrorKey(catalogs[cli.id])}
                    className="team-model-error"
                    role="alert"
                  >
                    <p>{t(modelError(catalogs[cli.id].error))}</p>
                    {catalogs[cli.id]?.errorDetail && (
                      <>
                        {catalogs[cli.id].errorDetail
                          ?.split(/\r?\n/u)
                          .find((line) =>
                            /^\s*(?:error|fatal)\b/iu.test(line),
                          ) && (
                          <p
                            className="mt-1 font-mono text-2xs whitespace-pre-wrap [overflow-wrap:anywhere] text-muted-foreground"
                            data-iori-model-error-summary
                          >
                            {catalogs[cli.id].errorDetail
                              ?.split(/\r?\n/u)
                              .find((line) =>
                                /^\s*(?:error|fatal)\b/iu.test(line),
                              )}
                          </p>
                        )}
                        <TextPreview title="Details" className="mt-1">
                          <span data-iori-model-error-output>
                            {catalogs[cli.id].errorDetail}
                          </span>
                        </TextPreview>
                      </>
                    )}
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      pending={loadingModels[cli.id]}
                      data-iori-action="retry-models"
                      onClick={() => onRetryModels(cli.id)}
                    >
                      {t("Retry")}
                    </Button>
                  </div>
                )
              }
              renderSettings={(cli) => (
                <AgentSettings
                  host={host}
                  initialArguments={cli.startupArguments}
                  onSaved={() => void onClisChanged()}
                  cli={cli.id}
                  models={availableModels[cli.id] ?? []}
                  limits={data.limits}
                  registerEditor={registerEditor}
                  onChange={(limits) =>
                    saveSettings({
                      defaultTeam: data.defaultTeam,
                      limits,
                    })
                  }
                />
              )}
            />
          )}
        </div>
      </div>

      {/* Dialogs & Sheets */}
      <SaveConflictDialog
        saveConflict={saveConflict}
        conflictError={conflictError}
        working={working}
        workingOn={workingOn}
        formatDate={formatDate}
        onCancel={cancelConflict}
        onReload={(current) => {
          putRecord(current);
          if (
            selection.page === "team" &&
            !["overview", "parent"].includes(selection.detail) &&
            !current.saved.roles.some((r) => r.id === selection.detail)
          )
            setSelection({
              page: "team",
              teamId: current.saved.id,
              detail: "overview",
            });
          setSaveMessage("");
          finishConflict();
        }}
        onOverwrite={async () => {
          if (!saveConflict?.current) return;
          const saved = await save(
            selectedRecord,
            saveConflict.current.saved.version,
            saveConflict.editedFrom,
          );
          if (saved === true) finishConflict();
        }}
        onDiscardDeleted={() => {
          if (!team) return;
          updateHost((d) => ({
            ...d,
            defaultTeam: d.defaultTeam === team.id ? "" : d.defaultTeam,
            teams: d.teams.filter((r) => r.saved.id !== team.id),
          }));
          setSelection({ page: "teams" });
          setMobileDetail(true);
          setSaveMessage("");
          finishConflict(false);
        }}
        onSaveAsNew={async () => {
          if (!team) return;
          setWorkingOn("create");
          setConflictError(false);
          try {
            const response = await connection.requestHost(
              host,
              "teams.create",
              { definition: clone(team) },
            );
            if (!response?.ok) {
              setConflictError(true);
              return;
            }
            updateHost((d) => ({
              ...d,
              defaultTeam: d.defaultTeam === team.id ? "" : d.defaultTeam,
              teams: d.teams.filter((r) => r.saved.id !== team.id),
            }));
            putRecord(response.result);
            setExpanded((e) => ({
              ...e,
              [response.result.saved.id]: true,
            }));
            setSelection({
              page: "team",
              teamId: response.result.saved.id,
              detail: "overview",
            });
            setMobileDetail(true);
            setSaveMessage("");
            finishConflict(false);
          } catch {
            setConflictError(true);
          } finally {
            setWorkingOn(undefined);
          }
        }}
      />

      <LeaveConfirmDialog
        open={!!pending}
        dirty={dirty}
        working={working}
        saving={workingOn === "save"}
        onCancel={cancelLeave}
        onDiscard={() => {
          const action = pending;
          undo();
          for (const editor of editors.current) editor.discard?.();
          cancelLeave();
          action?.();
        }}
        onSave={() => {
          void (async () => {
            const action = pending;
            savingLeave.current = action;
            const saved = await save();
            if (savingLeave.current !== action) return;
            if (saved === "conflict") {
              setPending(null);
              return;
            }
            cancelLeave();
            if (saved) action?.();
          })();
        }}
      />

      <DeleteConfirmDialog
        confirmation={confirmation}
        error={confirmationError}
        working={confirmationWorking}
        onClose={() => {
          setConfirmation(null);
          setConfirmationError("");
        }}
        onConfirm={async () => {
          setConfirmationWorking(true);
          try {
            const success = await confirmation?.action();
            if (success !== false) setConfirmation(null);
          } finally {
            setConfirmationWorking(false);
          }
        }}
      />

      <NewTeamDialog
        open={newTeamOpen}
        onOpenChange={setNewTeamOpen}
        templates={templates}
        teams={data.teams}
        teamSource={teamSource}
        onTeamSourceChange={setTeamSource}
        newParent={newParent}
        onNewParentChange={(changes) =>
          setNewParent((value) => ({ ...value, ...changes }))
        }
        selectableModels={selectableModels}
        availableClis={availableClis}
        sensors={sensors}
        working={working}
        creating={workingOn === "create"}
        onLimits={onLimits}
        onCreate={addNewTeam}
      />

      <CopyToHostDialog
        host={host}
        copyTeam={copyTeam}
        copyHost={copyHost}
        working={working}
        copying={workingOn === "copy"}
        onCopyHostChange={setCopyHost}
        onClose={() => setCopyTeam(null)}
        onCopy={copyToHost}
      />

      <TeamHistorySheet
        open={historyOpen}
        onOpenChange={setHistoryOpen}
        record={selectedRecord}
        historyVersion={historyVersion}
        onSelectVersion={setHistoryVersion}
        formatDate={formatDate}
        working={working}
        restoring={workingOn === "restore"}
        onSaveMemo={async (version, memo) => {
          if (!selectedRecord) return false;
          try {
            const response = await connection.requestHost(host, "teams.memo", {
              teamId: selectedRecord.saved.id,
              version,
              memo,
            });
            if (!response?.ok) return false;
            putRecord(response.result, true);
            return true;
          } catch {
            return false;
          }
        }}
        onRestore={() =>
          guard(() => {
            void restore();
          })
        }
      />
    </section>
  );
}
