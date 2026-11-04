import { pickerClis } from "../cli-list.ts";
import { HiddenItems } from "./HiddenItems.tsx";
import { pickerTeams } from "./team-data.ts";
import { nameOrder } from "@iori/protocol";
import { useIsMobile } from "../hooks/use-mobile.ts";
import type { SettingsEditor } from "../settings-save.ts";
import {
  FieldRow,
  PageBody,
  PageHeader,
  SettingsSection,
  SaveResult,
} from "../components/page-layout.tsx";
import { Automations } from "./Automations.tsx";
import type { OpenTeamTerminal } from "./TaskHistory.tsx";
import { Records } from "./Records.tsx";
import { Usage } from "./Usage.tsx";
import { belowUsageMinimum } from "@iori/protocol";
import "./children.css";
import { parentTeamText, childTeamText, limitKey } from "@iori/protocol";
import { useCallback, useEffect, useRef, useState } from "react";
import type { ReactNode } from "react";
import {
  ArrowLeft,
  Bot,
  CalendarClock,
  Check,
  ChevronDown,
  ChevronRight,
  ChevronsUpDown,
  Copy,
  GripVertical,
  History,
  MoreHorizontal,
  Plus,
  Users,
} from "lucide-react";
import {
  DndContext,
  PointerSensor,
  KeyboardSensor,
  closestCenter,
  useSensor,
  useSensors,
} from "@dnd-kit/core";
import {
  SortableContext,
  useSortable,
  arrayMove,
  sortableKeyboardCoordinates,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { Button } from "../components/ui/button.tsx";
import { Input } from "../components/ui/input.tsx";
import { Textarea } from "../components/ui/textarea.tsx";
import { Label } from "../components/ui/label.tsx";
import { Checkbox } from "../components/ui/checkbox.tsx";
import { Switch } from "../components/ui/switch.tsx";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "../components/ui/select.tsx";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "../components/ui/popover.tsx";
import {
  Command,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "../components/ui/command.tsx";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "../components/ui/collapsible.tsx";
import {
  ToggleGroup,
  ToggleGroupItem,
} from "../components/ui/toggle-group.tsx";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "../components/ui/dropdown-menu.tsx";
import {
  ContextMenu,
  ContextMenuTrigger,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
} from "../components/ui/context-menu.tsx";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "../components/ui/dialog.tsx";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "../components/ui/sheet.tsx";
import { SidebarTrigger } from "../components/ui/sidebar.tsx";
import { useI18n } from "./context.tsx";
import { ModelPicker } from "./ModelPicker.tsx";
import { AgentSettings } from "./AgentSettings.tsx";
import { AgentsPage } from "./AgentsPage.tsx";
import { TeamHistoryEntry } from "./TeamHistoryEntry.tsx";
import { connection } from "../connection.ts";
import { native } from "../native.ts";
import type {
  CliDefinitionFailure,
  CliSummary,
  TeamDefinition,
  TeamList,
  TeamRecord as SavedRecord,
  TeamSettings,
} from "@iori/protocol";
import { SettingsRow, LimitInput } from "./SettingsRow.tsx";
import { CliIcon, useCliName, useModelLabel } from "./context.tsx";
import { candidate, clone, role } from "./team-data.ts";
import type {
  Candidate,
  Difficulty,
  HostTeams,
  Role,
  Team,
  TeamRecord,
} from "./team-data.ts";
import "./team-editor.css";

type Selection =
  | { page: "agents" | "teams" | "records" | "automations" }
  | { page: "team"; teamId: string; detail: "overview" | "parent" | string };
export function modelError(error?: string) {
  return error === "unsupported"
    ? "This CLI does not expose a model list. Team editing can continue."
    : error === "not_found"
      ? "CLI not found on this Host. Install it and retry."
      : error === "invalid_output"
        ? "Could not read the model list returned by this CLI. Retry."
        : "The model list command failed. Check this CLI on the Host and retry.";
}
export type LeaveGuard = (action: () => void) => void;
const levels: Difficulty[] = ["high", "medium", "low"];
const levelLabel = { high: "High", medium: "Medium", low: "Low" };
function isDirty(record?: TeamRecord) {
  return (
    !!record && JSON.stringify(record.saved) !== JSON.stringify(record.draft)
  );
}
function ShortSelect({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value?: string;
  options: string[];
  onChange: (value: string | undefined) => void;
}) {
  const { t } = useI18n();
  return (
    <Select
      value={value === undefined ? "unspecified" : `option:${value}`}
      onValueChange={(next) =>
        onChange(
          next === "unspecified" ? undefined : next.slice("option:".length),
        )
      }
    >
      <SelectTrigger aria-label={t(label)}>
        <SelectValue />
      </SelectTrigger>
      <SelectContent position="popper">
        <SelectItem value="unspecified">{t("Not specified")}</SelectItem>
        {options.map((o) => (
          <SelectItem value={`option:${o}`} key={o}>
            {o}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
function Field({
  label,
  children,
  hint,
  hideLabel = false,
}: {
  label: string;
  children: ReactNode;
  hint?: string;
  hideLabel?: boolean;
}) {
  const { t } = useI18n();
  return (
    <FieldRow
      stacked
      className="team-field"
      hideLabel={hideLabel}
      label={<Label>{t(label)}</Label>}
      description={hint ? t(hint) : undefined}
    >
      {children}
    </FieldRow>
  );
}
function GrowingText({
  value,
  onChange,
  label,
  rows = 4,
}: {
  value: string;
  onChange: (value: string) => void;
  label: string;
  rows?: number;
}) {
  const { t } = useI18n();
  const ref = useRef<HTMLTextAreaElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (el) {
      el.style.height = "auto";
      el.style.height = `${Math.max(el.scrollHeight, rows * 24 + 20)}px`;
    }
  }, [value, rows]);
  return (
    <Textarea
      ref={ref}
      rows={rows}
      value={value}
      aria-label={t(label)}
      onChange={(e) => onChange(e.target.value)}
    />
  );
}
function NumberLimit({
  value,
  onChange,
  label,
}: {
  value: string;
  onChange: (value: string) => void;
  label: string;
}) {
  const { t } = useI18n();
  return <LimitInput value={value} label={t(label)} onChange={onChange} />;
}
function Actions({ label, children }: { label: string; children: ReactNode }) {
  const { t } = useI18n();
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label={t(label)}
          data-iori-action={
            label === "Team actions" ? "team-actions" : undefined
          }
        >
          <MoreHorizontal size={16} />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="team-menu">
        {children}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
function TeamMenuItems({
  context = false,
  onOpen,
  onDuplicate,
  onCopy,
  onDelete,
  hidden,
  onHidden,
}: {
  context?: boolean;
  onOpen?: () => void;
  onDuplicate: () => void;
  onCopy: () => void;
  onDelete: () => void;
  hidden: boolean;
  onHidden: () => void;
}) {
  const { t } = useI18n();
  const Item = context ? ContextMenuItem : DropdownMenuItem;
  const Separator = context ? ContextMenuSeparator : DropdownMenuSeparator;
  return (
    <>
      {onOpen && (
        <Item data-iori-action="team-open" onSelect={onOpen}>
          {t("Open")}
        </Item>
      )}
      <Item data-iori-action="team-duplicate" onSelect={onDuplicate}>
        {t("Duplicate")}
      </Item>
      <Item data-iori-action="team-copy" onSelect={onCopy}>
        {t("Copy to another Host")}
      </Item>
      <Item data-iori-action="team-hidden-set" onSelect={onHidden}>
        {t(hidden ? "Show in pickers" : "Hide from pickers")}
      </Item>
      <Separator />
      <Item
        data-iori-action="team-delete"
        variant="destructive"
        onSelect={onDelete}
      >
        {t("Delete")}
      </Item>
    </>
  );
}
function CliModelSearch({
  item,
  availableModels,
  recent,
  onChange,
}: {
  item: Candidate;
  availableModels: Record<string, string[]>;
  recent: { cli: string; model: string }[];
  onChange: (changes: Partial<Candidate>) => void;
}) {
  const { t, catalogs } = useI18n();
  const [open, setOpen] = useState(false);
  const cliName = useCliName();
  const modelLabel = useModelLabel();
  const choices = {
    ...availableModels,
    ...(item.cli
      ? {
          [item.cli]: [
            ...new Set([
              ...(catalogs[item.cli]?.models.map((model) => model.name) ?? []),
              item.model,
            ]),
          ].filter(Boolean),
        }
      : {}),
  };
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          className="team-cli-model"
          data-iori-action="candidate-model"
          data-iori-cli={item.cli}
          data-iori-model={item.model}
          role="combobox"
          aria-expanded={open}
          aria-label={`${t("CLI and model")}: ${item.cli ? `${cliName(item.cli)} › ${modelLabel(item.cli, item.model)}` : t("Not set")}`}
          title={
            item.cli
              ? `${cliName(item.cli)} › ${modelLabel(item.cli, item.model)}`
              : t("Not set")
          }
        >
          {item.cli && <CliIcon name={item.cli} size={14} />}
          <span>
            {item.cli
              ? `${cliName(item.cli)} › ${modelLabel(item.cli, item.model)}`
              : t("Not set")}
          </span>
          <ChevronsUpDown size={12} />
        </Button>
      </PopoverTrigger>
      <PopoverContent
        className="team-search-popover"
        align="start"
        collisionPadding={16}
        onEscapeKeyDown={(event) => {
          if (event.isComposing) event.preventDefault();
        }}
      >
        <ModelPicker
          availableModels={choices}
          recent={recent}
          selected={item}
          onSelect={({ cli, name: model }) => {
            onChange(
              cli === item.cli
                ? {
                    model,
                    effort: catalogs[cli]?.models
                      .find((entry) => entry.name === model)
                      ?.efforts.includes(item.effort ?? "")
                      ? item.effort
                      : undefined,
                  }
                : {
                    cli,
                    cliName: cliName(cli),
                    model,
                    effort: undefined,
                    permission: undefined,
                    sandbox: undefined,
                    minimum: "",
                    tools: [],
                  },
            );
            setOpen(false);
          }}
        />
      </PopoverContent>
    </Popover>
  );
}
function Permissions({
  item,
  onChange,
}: {
  item: Candidate;
  onChange: (changes: Partial<Candidate>) => void;
}) {
  const { t, catalogs } = useI18n();
  const capability = catalogs[item.cli];
  const fields = capability?.permissions ?? [];
  const values = fields.flatMap((field) =>
    field.multiple
      ? item.tools
      : item[field.key] !== undefined
        ? [item[field.key]]
        : [],
  );
  const summary = values.length ? values.join(" · ") : t("Not specified");
  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          className="team-permission-summary"
          aria-label={`${t("Permissions")}: ${summary}`}
        >
          <span>{summary}</span>
          <ChevronDown size={12} />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="team-permissions-popover" align="start">
        {capability?.permissionNote && <p>{t(capability.permissionNote)}</p>}
        {fields.map((field) => (
          <div key={field.key} className="team-permission-field">
            <Label>{t(field.label)}</Label>
            {field.multiple ? (
              <div className="team-pi-tools">
                {field.options.map((tool) => (
                  <label key={tool}>
                    <Checkbox
                      checked={item.tools.includes(tool)}
                      onCheckedChange={(checked) =>
                        onChange({
                          tools:
                            checked === true
                              ? [...item.tools, tool]
                              : item.tools.filter((v) => v !== tool),
                        })
                      }
                    />
                    {tool}
                  </label>
                ))}
              </div>
            ) : (
              <ShortSelect
                label={field.label}
                value={item[field.key] as string | undefined}
                options={[
                  ...new Set([
                    ...field.options,
                    ...(item[field.key] === undefined
                      ? []
                      : [item[field.key] as string]),
                  ]),
                ]}
                onChange={(value) => onChange({ [field.key]: value })}
              />
            )}
          </div>
        ))}
        {!fields.length && <p>{t("Not specified")}</p>}
      </PopoverContent>
    </Popover>
  );
}
function ExecutionHeading({ parent = false }: { parent?: boolean }) {
  const { t } = useI18n();
  return (
    <div
      className={`team-execution-heading ${parent ? "parent-execution-heading" : ""}`}
    >
      {!parent && <span>#</span>}
      <span>{t("CLI and model")}</span>
      <span>Effort</span>
      <span>{t("Permissions")}</span>
      {!parent && <span>{t("Minimum remaining")}</span>}
      {!parent && <span aria-hidden="true" />}
    </div>
  );
}
function ExecutionRow({
  item,
  index,
  parent,
  onChange,
  onRemove,
  onCopyLevel,
  onCopyRole,
  roles,
  availableModels,
  recent,
  limits,
  available,
  onLimits,
}: {
  item: Candidate;
  index?: number;
  parent?: boolean;
  onChange: (changes: Partial<Candidate>) => void;
  onRemove?: () => void;
  onCopyLevel?: (level: Difficulty) => void;
  onCopyRole?: (id: string) => void;
  roles?: Role[];
  availableModels: Record<string, string[]>;
  recent: { cli: string; model: string }[];
  limits: Record<string, string>;
  available: string[];
  onLimits: (cli: string) => void;
}) {
  const { t } = useI18n();
  const { attributes, listeners, setNodeRef, transform, isDragging } =
    useSortable({ id: item.id, disabled: !!parent });
  const {
    catalogs,
    clis: usageClis,
    usageClis: supportedUsageClis,
  } = useI18n();
  const cliName = useCliName();
  const modelLabel = useModelLabel();
  const missing = !!item.cli && !available.includes(item.cli);
  const usageCli = usageClis.find((cli) => cli.id === item.cli);
  const supportsUsage =
    usageCli?.supportsUsage ?? supportedUsageClis?.includes(item.cli);
  const lowUsage =
    !parent &&
    usageCli?.supportsUsage &&
    belowUsageMinimum(item.minimum, usageCli?.usage, item.model);
  const relevantLimits = [
    { key: limitKey(item.cli, "cli"), label: cliName(item.cli) },
    ...(item.model.includes("/")
      ? [
          {
            key: limitKey(item.cli, "provider", item.model.split("/")[0]),
            label: item.model.split("/")[0],
          },
        ]
      : []),
    {
      key: limitKey(item.cli, "model", item.model),
      label: modelLabel(item.cli, item.model),
    },
  ].filter((target) => limits[target.key]);
  const model = catalogs[item.cli]?.models.find(
    (model) => model.name === item.model,
  );
  const effortOptions = [
    ...new Set(
      [
        ...(model?.efforts ?? []),
        ...(item.effort === undefined ? [] : [item.effort]),
      ].filter(Boolean),
    ),
  ];
  return (
    <div
      ref={setNodeRef}
      className={`team-candidate-row ${parent ? "parent-execution" : ""} ${missing ? "team-candidate-missing" : ""} ${isDragging ? "team-candidate-dragging" : ""}`}
      style={{
        transform: transform
          ? `translate3d(${transform.x}px,${transform.y}px,0) scaleX(${transform.scaleX}) scaleY(${transform.scaleY})`
          : undefined,
      }}
    >
      <div className="team-execution-cells">
        {!parent && (
          <div className="team-candidate-priority">
            <Button
              variant="ghost"
              size="icon-sm"
              className="team-candidate-grip"
              data-iori-action="candidate-reorder"
              data-iori-candidate-priority={index! + 1}
              {...attributes}
              {...listeners}
              aria-label={`${t("Drag to reorder")} ${index! + 1}`}
            >
              <GripVertical size={14} />
            </Button>
            <span className="team-candidate-number">{index! + 1}</span>
          </div>
        )}
        <CliModelSearch
          item={item}
          availableModels={availableModels}
          recent={recent}
          onChange={onChange}
        />
        <div className="team-execution-options">
          <div className="team-candidate-effort">
            {(!model || model.efforts.length > 0) && (
              <>
                <span className="team-mobile-cell-label">Effort</span>
                <ShortSelect
                  label="Effort"
                  value={item.effort}
                  options={effortOptions}
                  onChange={(effort) => onChange({ effort })}
                />
              </>
            )}
          </div>
          <div className="team-candidate-permissions">
            <span className="team-mobile-cell-label">{t("Permissions")}</span>
            <Permissions item={item} onChange={onChange} />
          </div>
          {!parent &&
            (supportsUsage ? (
              <label className="team-candidate-minimum">
                <span className="team-mobile-cell-label">
                  {t("Minimum remaining")}
                </span>
                <Input
                  aria-label={`${t("Minimum remaining")} ${index! + 1}`}
                  data-iori-field="candidate-minimum"
                  type="number"
                  min="0"
                  max="100"
                  step="any"
                  placeholder={t("None")}
                  value={item.minimum}
                  onChange={(event) => {
                    const value = event.target.value;
                    if (
                      value === "" ||
                      (/^\d+(?:\.\d+)?$/u.test(value) && Number(value) <= 100)
                    )
                      onChange({ minimum: value });
                  }}
                />
                <span>%</span>
              </label>
            ) : (
              <span className="team-candidate-minimum-empty" />
            ))}
        </div>
        {!parent && (
          <div className="team-candidate-actions">
            <Actions label="Candidate actions">
              <DropdownMenuSub>
                <DropdownMenuSubTrigger>
                  {t("Copy to difficulty")}
                </DropdownMenuSubTrigger>
                <DropdownMenuSubContent className="team-menu">
                  {levels.map((level) => (
                    <DropdownMenuItem
                      key={level}
                      onSelect={() => onCopyLevel?.(level)}
                    >
                      {t(levelLabel[level])}
                    </DropdownMenuItem>
                  ))}
                </DropdownMenuSubContent>
              </DropdownMenuSub>
              <DropdownMenuSub>
                <DropdownMenuSubTrigger>
                  {t("Copy to role")}
                </DropdownMenuSubTrigger>
                <DropdownMenuSubContent className="team-menu">
                  {roles?.map((r) => (
                    <DropdownMenuItem
                      key={r.id}
                      onSelect={() => onCopyRole?.(r.id)}
                    >
                      {r.name}
                    </DropdownMenuItem>
                  ))}
                </DropdownMenuSubContent>
              </DropdownMenuSub>
              <DropdownMenuSeparator />
              <DropdownMenuItem variant="destructive" onSelect={onRemove}>
                {t("Delete")}
              </DropdownMenuItem>
            </Actions>
          </div>
        )}
      </div>
      {((!parent &&
        (usageCli?.usage || lowUsage || relevantLimits.length > 0)) ||
        missing) && (
        <div className="team-candidate-help">
          {!parent && (
            <Usage
              cliId={item.cli}
              usage={usageCli?.usage}
              model={item.model}
              name="Usage"
              compact
            />
          )}
          {lowUsage && (
            <p className="team-candidate-low-usage">
              {t(
                "This candidate is currently below the minimum remaining usage and will not be assigned.",
              )}
            </p>
          )}
          {!parent && relevantLimits.length > 0 && (
            <Button
              variant="ghost"
              className="team-candidate-host-limit"
              onClick={() => onLimits(item.cli)}
              aria-label={t("View Host limits")}
            >
              {t("Host limits")}:{" "}
              {relevantLimits
                .map((target) => `${target.label} ${limits[target.key]}`)
                .join(" · ")}
              <ChevronRight size={12} />
            </Button>
          )}
          {missing && (
            <p className="team-candidate-notice">
              {t("Not found on this Host")}
            </p>
          )}
        </div>
      )}
    </div>
  );
}
function TextPreview({
  title,
  children,
}: {
  title: string;
  children: ReactNode;
}) {
  const { t } = useI18n();
  return (
    <Collapsible className="team-preview">
      <CollapsibleTrigger asChild>
        <Button variant="ghost" className="team-preview-trigger">
          <ChevronRight size={16} />
          <span>{t(title)}</span>
        </Button>
      </CollapsibleTrigger>
      <CollapsibleContent>
        <div className="team-preview-text">{children}</div>
      </CollapsibleContent>
    </Collapsible>
  );
}
function ChildText({ value }: { value: Role }) {
  return (
    <>
      <p style={{ whiteSpace: "pre-wrap" }}>{childTeamText(value)}</p>
    </>
  );
}
export function TeamEditor({
  host,
  active,
  registerGuard,
  initial,
  onOpenTerminal,
  onOpenIntegrations,
  onOpenWorkspaceSettings,
  onClisChanged,
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
  allClis,
  failedDefinitions,
}: {
  host: string;
  active: boolean;
  registerGuard: (guard: LeaveGuard) => void;
  initial: TeamList;
  onOpenTerminal: OpenTeamTerminal;
  onOpenIntegrations?: (hostKey: string) => void;
  onOpenWorkspaceSettings?: (hostKey: string, workspacePath: string) => void;
  onClisChanged: () => Promise<void>;
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
  /** The CLIs with the user's definitions that this Host does not find. */
  allClis: CliSummary[];
  failedDefinitions: CliDefinitionFailure[];
}) {
  const { t, language, clis, catalogs, loadingModels, hostName } = useI18n();
  const cliName = useCliName();
  const modelLabel = useModelLabel();
  const templates = initial.templates;
  const [hosts, setHosts] = useState<Record<string, HostTeams>>({
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
      .filter(isDirty)
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
  // The pressed action while it waits for the Host.
  const [workingOn, setWorkingOn] = useState<
    "save" | "create" | "restore" | "copy"
  >();
  const working = workingOn !== undefined;
  const settingsQueue = useRef(Promise.resolve(true));
  const [settingsError, setSettingsError] = useState<
    "enabled" | "defaultTeam" | "limits"
  >();
  const [remoteSettings, setRemoteSettings] = useState<TeamSettings>({
    enabled: initial.enabled,
    defaultTeam: initial.defaultTeam,
    limits: initial.limits,
  });
  const settingsRef = useRef(remoteSettings);
  settingsRef.current = remoteSettings;
  const [loadError, setLoadError] = useState(false);
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
                previous && isDirty(previous)
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
                    ...record,
                    draft: preserveDraft ? r.draft : clone(record.saved),
                  }
                : r,
            )
          : [...current[host].teams, { ...record, draft: clone(record.saved) }],
      },
    }));
  const confirmedSettings = useRef(remoteSettings);
  const saveSettings = ({ enabled, defaultTeam, limits }: TeamSettings) => {
    const next = { enabled, defaultTeam, limits };
    const field =
      enabled !== settingsRef.current.enabled
        ? "enabled"
        : defaultTeam !== settingsRef.current.defaultTeam
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
  const [selection, setSelection] = useState<Selection>({
    page: initialPage ?? "agents",
  });
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const [mobileDetail, setMobileDetail] = useState(false);
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
  const [candidateSearchOpen, setCandidateSearchOpen] = useState(false);
  const [difficulty, setDifficulty] = useState<Difficulty>("medium");
  const [pending, setPending] = useState<(() => void) | null>(null);
  const savingLeave = useRef<(() => void) | null>(null);
  const cancelLeave = () => {
    savingLeave.current = null;
    setPending(null);
  };
  const [confirmation, setConfirmation] = useState<{
    title: string;
    text: string;
    action: () => void | Promise<boolean>;
  } | null>(null);
  const [confirmationError, setConfirmationError] = useState("");
  const [confirmationWorking, setConfirmationWorking] = useState(false);
  useEffect(() => setConfirmationError(""), [confirmation]);
  const [newTeamOpen, setNewTeamOpen] = useState(false);
  const [teamSource, setTeamSource] = useState("template:development");
  const [copyTeam, setCopyTeam] = useState<Team | null>(null);
  const [copyHost, setCopyHost] = useState("");
  const [historyOpen, setHistoryOpen] = useState(false);
  const [historyVersion, setHistoryVersion] = useState<number | null>(null);
  const [agentExpanded, setAgentExpanded] = useState<Record<string, boolean>>(
    {},
  );
  const [saveMessage, setSaveMessage] = useState("");
  const [message, setMessage] = useState("");
  const scrollRef = useRef<HTMLDivElement>(null);
  const lastHost = useRef(host);
  const dialogReturnFocus = useRef<HTMLElement | null>(null);
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    }),
  );
  const data = {
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
  const dirty = isDirty(selectedRecord);
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
  const date = (value: string) =>
    new Intl.DateTimeFormat(locale, {
      month: "numeric",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    }).format(new Date(value));
  const updateHost = (fn: (value: HostTeams) => HostTeams) =>
    setHosts((current) => ({ ...current, [host]: fn(current[host]) }));
  const editTeam = (fn: (value: Team) => Team) => {
    if (!team) return;
    updateHost((d) => ({
      ...d,
      teams: d.teams.map((r) =>
        r.draft.id === team.id ? { ...r, draft: fn(r.draft) } : r,
      ),
    }));
    setSaveMessage("");
  };
  const editRole = (changes: Partial<Role>) =>
    editTeam((value) => ({
      ...value,
      roles: value.roles.map((r) =>
        r.id === selectedRole?.id ? { ...r, ...changes } : r,
      ),
    }));
  const undo = () => {
    if (
      selectedRecord &&
      selection.page === "team" &&
      !["overview", "parent"].includes(selection.detail) &&
      !selectedRecord.saved.roles.some((r) => r.id === selection.detail)
    )
      setSelection({
        page: "team",
        teamId: selectedRecord.saved.id,
        detail: "overview",
      });
    if (team)
      updateHost((d) => ({
        ...d,
        teams: d.teams.map((r) =>
          r.draft.id === team.id ? { ...r, draft: clone(r.saved) } : r,
        ),
      }));
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
    if (dirty || [...editors.current].some((isDirty) => isDirty())) {
      dialogReturnFocus.current = document.activeElement as HTMLElement;
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
  const save = async () => {
    if (!team || !dirty) return false;
    const submitted = clone(team);
    if (!team.name.trim()) {
      setSaveMessage("Could not save: enter a team name.");
      return false;
    }
    if (team.roles.some((r) => !r.name.trim())) {
      setSaveMessage("Could not save: enter a name for each role.");
      return false;
    }
    setWorkingOn("save");
    try {
      const response = await connection.requestHost(host, "teams.save", {
        teamId: team.id,
        definition: submitted,
      });
      if (response?.ok) {
        setHosts((current) => ({
          ...current,
          [host]: {
            ...current[host],
            teams: current[host].teams.map((record) =>
              record.saved.id === submitted.id
                ? {
                    ...response.result,
                    draft:
                      JSON.stringify(record.draft) === JSON.stringify(submitted)
                        ? clone(response.result.saved)
                        : {
                            ...record.draft,
                            version: response.result.saved.version,
                            updated: response.result.saved.updated,
                          },
                  }
                : record,
            ),
          },
        }));
        setSaveMessage("Saved");
        return true;
      } else setSaveMessage("Could not save team. Check the values and retry.");
    } catch {
      setSaveMessage("Could not save team. Reconnect and retry.");
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
        ? { template: id, language: locale === "ja-JP" ? "ja" : "en" }
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
      t("Changes\nVerification results\nRemaining issues\nQuestions to parent"),
    );
    updateHost((d) => ({
      ...d,
      teams: d.teams.map((r) =>
        r.draft.id === teamId
          ? { ...r, draft: { ...r.draft, roles: [...r.draft.roles, fresh] } }
          : r,
      ),
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
    <Actions label="Role actions">
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
            updateHost((d) => ({
              ...d,
              teams: d.teams.map((record) =>
                record.draft.id === teamId
                  ? {
                      ...record,
                      draft: {
                        ...record.draft,
                        roles: [...record.draft.roles, fresh],
                      },
                    }
                  : record,
              ),
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
                updateHost((d) => ({
                  ...d,
                  teams: d.teams.map((record) =>
                    record.draft.id === teamId
                      ? {
                          ...record,
                          draft: {
                            ...record.draft,
                            roles: record.draft.roles.filter(
                              (v) => v.id !== r.id,
                            ),
                          },
                        }
                      : record,
                  ),
                }));
                selectTeamDetail(teamId, "overview");
              },
            });
          })
        }
      >
        {t("Delete")}
      </DropdownMenuItem>
    </Actions>
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
  const candidateRows =
    selectedRole?.candidates[selectedRole.split ? difficulty : "medium"] ?? [];
  const actualDifficulty = selectedRole?.split ? difficulty : "medium";
  const editCandidate = (id: string, changes: Partial<Candidate>) =>
    editRole({
      candidates: {
        ...selectedRole!.candidates,
        [actualDifficulty]: candidateRows.map((c) =>
          c.id === id ? { ...c, ...changes } : c,
        ),
      },
    });
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
  const renderExecution = (item: Candidate, index?: number, parent = false) => (
    <ExecutionRow
      key={item.id}
      item={item}
      index={index}
      parent={parent}
      onChange={(changes) =>
        parent
          ? editTeam((value) => ({
              ...value,
              parent: { ...value.parent, ...changes },
            }))
          : editCandidate(item.id, changes)
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
  const currentHistory =
    selectedRecord?.history.find((h) => h.team.version === historyVersion) ??
    selectedRecord?.history[0];
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
  const teamTreeRow = (record: TeamRecord) => (
    <Collapsible
      className="team-tree-item"
      key={record.draft.id}
      open={!!expanded[record.draft.id]}
      onOpenChange={(yes) =>
        setExpanded((e) => ({ ...e, [record.draft.id]: yes }))
      }
    >
      <ContextMenu>
        <ContextMenuTrigger asChild>
          <CollapsibleTrigger asChild>
            <Button
              variant="ghost"
              className="team-tree-row team-tree-team"
              data-iori-team-id={record.draft.id}
            >
              {expanded[record.draft.id] ? (
                <ChevronDown size={14} />
              ) : (
                <ChevronRight size={14} />
              )}
              <span data-iori-team-name={record.draft.id}>
                {record.draft.name}
              </span>
              {isDirty(record) && (
                <span
                  className="team-unsaved-dot"
                  aria-label={t("Unsaved changes")}
                />
              )}
            </Button>
          </CollapsibleTrigger>
        </ContextMenuTrigger>
        <ContextMenuContent className="team-menu">
          {teamMenu(record.saved, true)}
        </ContextMenuContent>
      </ContextMenu>
      <div className="team-tree-actions">
        <Actions label="Team actions">{teamMenu(record.saved)}</Actions>
      </div>
      <CollapsibleContent className="team-tree-children">
        <Button
          variant="ghost"
          className={`team-tree-row ${selection.page === "team" && selection.teamId === record.draft.id && selection.detail === "overview" ? "selected" : ""}`}
          data-iori-action="team-overview"
          data-iori-team-id={record.draft.id}
          onClick={() => openTeam(record.draft.id)}
        >
          {t("Team overview")}
        </Button>
        <Button
          variant="ghost"
          className={`team-tree-row ${selection.page === "team" && selection.teamId === record.draft.id && selection.detail === "parent" ? "selected" : ""}`}
          data-iori-action="team-parent"
          data-iori-team-id={record.draft.id}
          onClick={() => openTeam(record.draft.id, "parent")}
        >
          {t("Parent")}
        </Button>
        {record.draft.roles.map((r) => (
          <div className="team-tree-role" key={r.id}>
            <Button
              variant="ghost"
              className={`team-tree-row ${selection.page === "team" && selection.teamId === record.draft.id && selection.detail === r.id ? "selected" : ""}`}
              data-iori-action="team-role"
              data-iori-role-id={r.id}
              onClick={() => openTeam(record.draft.id, r.id)}
            >
              <span>{r.name}</span>
              {r.limit && <small>{r.limit}</small>}
            </Button>
            {roleMenu(r, record.draft.id)}
          </div>
        ))}
        <Button
          variant="outline"
          className="team-tree-row team-tree-add"
          onClick={() => {
            if (
              selection.page === "team" &&
              selection.teamId !== record.draft.id
            )
              guard(() => addRole(record.draft.id));
            else addRole(record.draft.id);
          }}
        >
          <Plus size={13} />
          {t("Add role")}
        </Button>
      </CollapsibleContent>
    </Collapsible>
  );
  const teamListRow = (record: TeamRecord) => (
    <div className="team-list-row" key={record.saved.id}>
      <Button
        variant="ghost"
        className="team-list-open"
        data-iori-team-id={record.saved.id}
        onClick={() => openTeam(record.saved.id)}
      >
        <div className="team-list-name">
          <strong>{record.saved.name}</strong>
          {record.saved.id === data.defaultTeam && (
            <span className="team-default-mark">{t("Default")}</span>
          )}
        </div>
        <p>{record.saved.description}</p>
        <div className="team-list-meta">
          <span>
            {t("Version {version}").replace(
              "{version}",
              String(record.saved.version),
            )}
          </span>
          <time>
            {t("Updated")} {date(record.saved.updated)}
          </time>
        </div>
      </Button>
      <div className="team-list-actions">
        <Actions label="Team actions">{teamMenu(record.saved)}</Actions>
      </div>
    </div>
  );
  return (
    <section
      className={`team-editor ${mobileDetail ? "team-mobile-detail" : ""}`}
      aria-label={t("AI Agents/Teams")}
      data-active={active}
      data-iori-view="teams-editor"
    >
      <nav className="team-tree" aria-label={t("AI Agents/Teams")}>
        <div className="team-tree-host">
          <SidebarTrigger
            className="team-mobile-sidebar size-12"
            aria-label={t("Open sidebar")}
            title={t("Open sidebar")}
            data-iori-action="sidebar-toggle"
          />
          <span>{hostName}</span>
        </div>
        <Button
          variant="ghost"
          className={`team-tree-row ${selection.page === "agents" ? "selected" : ""}`}
          data-iori-action="teams-agents"
          onClick={() => go({ page: "agents" })}
        >
          <Bot size={16} />
          {t("AI Agents")}
        </Button>
        <div className="team-tree-heading">
          <Button
            variant="ghost"
            className={`team-tree-row ${selection.page === "teams" ? "selected" : ""}`}
            data-iori-action="teams-list"
            onClick={() => go({ page: "teams" })}
          >
            <Users size={16} />
            {t("Teams")}
          </Button>
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label={t("New team")}
            data-iori-action="team-new"
            onClick={() => guard(() => setNewTeamOpen(true))}
          >
            <Plus size={16} />
          </Button>
        </div>
        {pickerTeams(data.teams).map(teamTreeRow)}

        <Button
          variant="ghost"
          className={`team-tree-row ${selection.page === "automations" ? "selected" : ""}`}
          data-iori-action="teams-automations"
          onClick={() => go({ page: "automations" })}
        >
          <CalendarClock size={16} />
          Automations
        </Button>
        <Button
          variant="ghost"
          className={`team-tree-row ${selection.page === "records" ? "selected" : ""}`}
          data-iori-action="teams-records"
          onClick={() => go({ page: "records" })}
        >
          <History size={16} />
          Records
        </Button>
      </nav>
      <div className="team-detail">
        <div className="team-mobile-location">
          <SidebarTrigger
            className="size-12"
            aria-label={t("Open sidebar")}
            title={t("Open sidebar")}
            data-iori-action="sidebar-toggle"
          />
          <span title={team?.name}>
            {team
              ? `${team.name} › ${selection.page === "team" ? (selection.detail === "parent" ? t("Parent") : selection.detail === "overview" ? t("Team overview") : selectedRole?.name) : ""}`
              : t(
                  selection.page === "agents"
                    ? "AI Agents"
                    : selection.page === "automations"
                      ? "Automations"
                      : selection.page === "records"
                        ? "Records"
                        : "Teams",
                )}
          </span>
        </div>
        {team && (
          <PageBody width="editor" className="team-content team-editor-heading">
            <PageHeader
              headingClassName="team-save-title"
              className="team-save-header"
              data-iori-team-id={team.id}
              title={
                <strong data-iori-team-version={team.version}>
                  {selection.page === "team"
                    ? selection.detail === "parent"
                      ? t("Parent")
                      : selection.detail === "overview"
                        ? t("Team overview")
                        : selectedRole?.name
                    : team.name}
                </strong>
              }
              back={
                <Button
                  variant="ghost"
                  title={team.name}
                  onClick={() => {
                    if (isMobile) setMobileDetail(false);
                    else openTeam(team.id, "overview");
                  }}
                >
                  <ArrowLeft size={14} />
                  <span className="page-link-label">{team.name}</span>
                </Button>
              }
              description={
                <SaveResult
                  inline
                  error={saveMessage.startsWith("Could")}
                  message={
                    saveMessage.startsWith("Could")
                      ? t(saveMessage)
                      : dirty
                        ? t("Unsaved changes")
                        : `${t("Version {version}").replace("{version}", String(team.version))} · ${t(saveMessage ? "Settings saved" : "Saved")}`
                  }
                />
              }
              actions={
                <>
                  <Button
                    variant="outline"
                    className="team-history-button"
                    data-iori-action="team-history"
                    onClick={() => {
                      setHistoryVersion(null);
                      setHistoryOpen(true);
                    }}
                  >
                    <History size={14} />
                    <span>{t("History")}</span>
                  </Button>
                  <Button
                    variant="outline"
                    className="team-undo-button"
                    disabled={!dirty || working}
                    onClick={undo}
                  >
                    {t("Undo")}
                  </Button>
                  <Button
                    type="button"
                    disabled={!dirty || working}
                    pending={workingOn === "save"}
                    className="team-save-button"
                    data-iori-action="team-save"
                    onClick={() => void save()}
                  >
                    {t("Save")}
                  </Button>
                  <Actions label="Team actions">
                    {teamMenu(selectedRecord!.saved, false, false)}
                  </Actions>
                </>
              }
            />
          </PageBody>
        )}
        {draftError && (
          <div className="team-model-error" role="alert">
            {t(
              "Could not keep the team draft on this device. Retry saving the draft.",
            )}
            <Button onClick={persistDrafts}>{t("Retry saving")}</Button>
          </div>
        )}
        {loadError && (
          <div className="team-model-error" role="alert">
            {t("Could not load teams. Retry.")}
            <Button onClick={() => void reload()}>{t("Retry")}</Button>
          </div>
        )}
        {message && (
          <p role="status" className="team-error">
            {message}
          </p>
        )}
        <div className="team-detail-scroll" ref={scrollRef}>
          {selection.page === "teams" && (
            <PageBody width="editor" className="team-content team-list-page">
              <PageHeader
                title={t("Teams")}
                actions={
                  <Button
                    variant="outline"
                    onClick={() => setNewTeamOpen(true)}
                  >
                    <Plus size={15} />
                    {t("New team")}
                  </Button>
                }
              />
              <SettingsSection className="team-list-settings">
                <SettingsRow
                  label="Use teams"
                  error={
                    settingsError === "enabled"
                      ? "Could not save settings. Choose it again to retry."
                      : undefined
                  }
                >
                  <Switch
                    checked={data.enabled}
                    onCheckedChange={(enabled) =>
                      saveSettings({ ...settingsRef.current, enabled })
                    }
                    aria-label={t("Use teams")}
                  />
                </SettingsRow>
                <SettingsRow
                  label="Default team"
                  className="team-default"
                  error={
                    settingsError === "defaultTeam"
                      ? "Could not save settings. Choose it again to retry."
                      : undefined
                  }
                >
                  <Select
                    value={data.defaultTeam || "none"}
                    onValueChange={(value) =>
                      saveSettings({
                        enabled: data.enabled,
                        limits: data.limits,
                        defaultTeam: value === "none" ? "" : value,
                      })
                    }
                  >
                    <SelectTrigger
                      aria-label={t("Default team")}
                      data-iori-action="default-team"
                    >
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent className="team-default-options">
                      {[
                        "none",
                        ...pickerTeams(data.teams).map((r) => r.saved.id),
                      ].map((id) => (
                        <SelectItem
                          value={id}
                          key={id}
                          className="team-default-option"
                          data-iori-default-team={id}
                        >
                          {id === "none"
                            ? t("None")
                            : data.teams.find((r) => r.saved.id === id)?.saved
                                .name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </SettingsRow>
              </SettingsSection>
              <SettingsSection className="team-list">
                {pickerTeams(data.teams).map(teamListRow)}
                {data.teams.some((r) => r.hidden) && (
                  <HiddenItems>
                    {data.teams.filter((r) => r.hidden).map(teamListRow)}
                  </HiddenItems>
                )}
              </SettingsSection>
              {data.teams.length === 0 && (
                <p className="team-hint">
                  {t("No teams yet. Create a team from a template.")}
                </p>
              )}
            </PageBody>
          )}
          {team &&
            selection.page === "team" &&
            selection.detail === "overview" && (
              <PageBody width="editor" className="team-content team-overview">
                <SettingsSection>
                  <Field label="Name">
                    <Input
                      value={team.name}
                      aria-label={t("Name")}
                      data-iori-field="team-name"
                      onChange={(e) =>
                        editTeam((value) => ({
                          ...value,
                          name: e.target.value,
                        }))
                      }
                    />
                  </Field>
                  <Field label="Description">
                    <GrowingText
                      label="Description"
                      rows={3}
                      value={team.description}
                      onChange={(description) =>
                        editTeam((value) => ({ ...value, description }))
                      }
                    />
                  </Field>
                </SettingsSection>
              </PageBody>
            )}
          {team &&
            selection.page === "team" &&
            selection.detail === "parent" && (
              <PageBody width="editor" className="team-content">
                <SettingsSection title={t("Execution settings")}>
                  <div className="team-execution-list team-parent-execution">
                    <ExecutionHeading parent />
                    <DndContext sensors={sensors}>
                      {renderExecution(team.parent, undefined, true)}
                    </DndContext>
                  </div>
                </SettingsSection>
                <SettingsSection title={t("Parent instructions")}>
                  <Field
                    hideLabel
                    label="Parent instructions"
                    hint="Describe how to run the team. iori separately provides the delegation, revision and acceptance commands."
                  >
                    <GrowingText
                      label="Parent instructions"
                      rows={8}
                      value={team.instruction}
                      onChange={(instruction) =>
                        editTeam((value) => ({ ...value, instruction }))
                      }
                    />
                  </Field>
                </SettingsSection>
                <SettingsSection>
                  <TextPreview title="Text sent to parent">
                    <p style={{ whiteSpace: "pre-wrap" }}>
                      {parentTeamText(team)}
                    </p>
                  </TextPreview>
                </SettingsSection>
              </PageBody>
            )}
          {selectedRole && (
            <PageBody width="editor" className="team-content team-role-content">
              <SettingsSection
                id="team-section-0"
                title={t("Basics")}
                data-iori-role-name={selectedRole.name}
              >
                <Field label="Name">
                  <Input
                    value={selectedRole.name}
                    aria-label={t("Name")}
                    data-iori-field="team-name"
                    onChange={(e) => editRole({ name: e.target.value })}
                  />
                </Field>
                <Field
                  label="When to call"
                  hint="The parent reads this to choose where to delegate."
                >
                  <GrowingText
                    label="When to call"
                    rows={2}
                    value={selectedRole.when}
                    onChange={(when) => editRole({ when })}
                  />
                </Field>
                <div className="team-basic-settings">
                  <SettingsRow
                    label="Concurrency limit"
                    hint="How many children in this role can run at once in a conversation using this team."
                  >
                    <NumberLimit
                      value={selectedRole.limit}
                      label={t("Concurrency limit")}
                      onChange={(limit) => editRole({ limit })}
                    />
                  </SettingsRow>
                  <SettingsRow
                    label="Reuse child sessions"
                    hint={
                      selectedRole.reuse
                        ? "Ask a child that has reported to continue or make corrections."
                        : "A new child takes over each time, quoting the previous report."
                    }
                  >
                    <Switch
                      checked={selectedRole.reuse}
                      aria-label={t("Reuse child sessions")}
                      onCheckedChange={(reuse) => editRole({ reuse })}
                    />
                  </SettingsRow>
                </div>
              </SettingsSection>
              <SettingsSection
                id="team-section-1"
                title={t("Candidates")}
                description={
                  candidateRows.length
                    ? t("Candidates are tried in this order.")
                    : undefined
                }
              >
                <div className="team-difficulty-setting">
                  <SettingsRow
                    label="Separate by difficulty"
                    hint="High and low lists are kept when this is off."
                  >
                    <Switch
                      checked={selectedRole.split}
                      aria-label={t("Separate by difficulty")}
                      onCheckedChange={(split) => editRole({ split })}
                    />
                  </SettingsRow>
                </div>
                <div className="team-candidate-heading">
                  {selectedRole.split && (
                    <ToggleGroup
                      type="single"
                      variant="outline"
                      value={difficulty}
                      onValueChange={(v) => v && setDifficulty(v as Difficulty)}
                      aria-label={t("Separate by difficulty")}
                    >
                      {levels.map((level) => (
                        <ToggleGroupItem key={level} value={level}>
                          {t(levelLabel[level])}
                          <small>{selectedRole.candidates[level].length}</small>
                        </ToggleGroupItem>
                      ))}
                    </ToggleGroup>
                  )}
                </div>
                <div className="team-execution-list">
                  {candidateRows.length > 0 ? (
                    <ExecutionHeading />
                  ) : (
                    <p className="team-hint">
                      {t("No candidates configured.")}
                    </p>
                  )}
                  <DndContext
                    sensors={sensors}
                    collisionDetection={closestCenter}
                    onDragEnd={({ active: dragged, over }) => {
                      if (over && dragged.id !== over.id)
                        editRole({
                          candidates: {
                            ...selectedRole.candidates,
                            [actualDifficulty]: arrayMove(
                              candidateRows,
                              candidateRows.findIndex(
                                (c) => c.id === dragged.id,
                              ),
                              candidateRows.findIndex((c) => c.id === over.id),
                            ),
                          },
                        });
                    }}
                  >
                    <SortableContext
                      items={candidateRows.map((c) => c.id)}
                      strategy={verticalListSortingStrategy}
                    >
                      {candidateRows.map((c, index) =>
                        renderExecution(c, index),
                      )}
                    </SortableContext>
                  </DndContext>
                </div>
                <div className="team-candidate-add-row">
                  <Popover
                    open={candidateSearchOpen}
                    onOpenChange={setCandidateSearchOpen}
                  >
                    <PopoverTrigger asChild>
                      <Button
                        variant="outline"
                        className="team-add-candidate"
                        data-iori-action="candidate-add"
                      >
                        <Plus size={15} />
                        {t("Add candidate")}
                      </Button>
                    </PopoverTrigger>
                    <PopoverContent
                      className="team-search-popover"
                      align="start"
                      collisionPadding={16}
                      onEscapeKeyDown={(e) => {
                        if (e.isComposing) e.preventDefault();
                      }}
                    >
                      <ModelPicker
                        availableModels={selectableModels}
                        recent={recentModels}
                        onSelect={({ cli, name: model }) => {
                          addCandidate(cli, model);
                          setCandidateSearchOpen(false);
                        }}
                      />
                    </PopoverContent>
                  </Popover>
                </div>
              </SettingsSection>
              <SettingsSection id="team-section-2" title={t("Instructions")}>
                <Field label="Child instructions">
                  <GrowingText
                    label="Child instructions"
                    rows={5}
                    value={selectedRole.instruction}
                    onChange={(instruction) => editRole({ instruction })}
                  />
                </Field>
              </SettingsSection>
              <SettingsSection
                id="team-section-3"
                title={t("Request and report")}
              >
                <div className="team-format-fields">
                  <Field label="Request fields">
                    <GrowingText
                      label="Request fields"
                      rows={4}
                      value={selectedRole.request}
                      onChange={(request) => editRole({ request })}
                    />
                  </Field>
                  <Field label="Report fields">
                    <GrowingText
                      label="Report fields"
                      rows={4}
                      value={selectedRole.report}
                      onChange={(report) => editRole({ report })}
                    />
                  </Field>
                </div>
              </SettingsSection>
              <SettingsSection id="team-section-4">
                <TextPreview title="Text sent to child">
                  <ChildText value={selectedRole} />
                </TextPreview>
              </SettingsSection>
            </PageBody>
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
              <>
                <ExecutionHeading parent />
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
              </>
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
              failed={failedDefinitions}
              listError={cliListError}
              onRetryList={onRetryClis}
              onChanged={onClisChanged}
              expanded={agentExpanded}
              onExpandedChange={(id, yes) =>
                setAgentExpanded((e) => ({ ...e, [id]: yes }))
              }
              registerEditor={registerEditor}
              renderModelError={(cli) =>
                !loadingModels[cli.id] &&
                catalogs[cli.id]?.error && (
                  <div className="team-model-error" role="alert">
                    <p>{t(modelError(catalogs[cli.id].error))}</p>
                    {catalogs[cli.id]?.errorDetail && (
                      <>
                        {catalogs[cli.id].errorDetail
                          ?.split(/\r?\n/u)
                          .find((line) =>
                            /^\s*(?:error|fatal)\b/iu.test(line),
                          ) && (
                          <p
                            className="team-preview-text"
                            data-iori-model-error-summary
                          >
                            {catalogs[cli.id].errorDetail
                              ?.split(/\r?\n/u)
                              .find((line) =>
                                /^\s*(?:error|fatal)\b/iu.test(line),
                              )}
                          </p>
                        )}
                        <TextPreview title="Details">
                          <span data-iori-model-error-output>
                            {catalogs[cli.id].errorDetail}
                          </span>
                        </TextPreview>
                      </>
                    )}
                    <Button
                      variant="outline"
                      size="sm"
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
                      enabled: data.enabled,
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
      <Dialog
        open={!!pending}
        onOpenChange={(yes) => {
          if (!yes) cancelLeave();
        }}
      >
        <DialogContent
          className="team-dialog"
          data-iori-view={
            dirty ? "team-save-confirmation" : "team-discard-confirmation"
          }
          onCloseAutoFocus={(event) => {
            event.preventDefault();
            dialogReturnFocus.current?.focus();
          }}
        >
          <DialogHeader>
            <DialogTitle>
              {t(dirty ? "Save changes?" : "Discard changes?")}
            </DialogTitle>
            <DialogDescription>
              {t(
                dirty
                  ? "Changes to this team have not been saved."
                  : "Changes to these settings have not been saved.",
              )}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={cancelLeave}>
              {t(dirty ? "Cancel" : "Keep editing")}
            </Button>
            <Button
              variant={dirty ? "outline" : "default"}
              disabled={dirty && working}
              data-iori-action={
                dirty ? "team-leave-without-saving" : "team-discard"
              }
              onClick={() => {
                const action = pending;
                undo();
                for (const editor of editors.current) editor.discard?.();
                cancelLeave();
                action?.();
              }}
            >
              {t(dirty ? "Don't save" : "Discard changes")}
            </Button>
            {dirty && (
              <Button
                data-iori-action="team-save-and-leave"
                disabled={working}
                pending={workingOn === "save"}
                onClick={async () => {
                  const action = pending;
                  savingLeave.current = action;
                  const saved = await save();
                  if (savingLeave.current !== action) return;
                  cancelLeave();
                  if (saved) action?.();
                }}
              >
                {t("Save")}
              </Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <Dialog
        open={!!confirmation}
        onOpenChange={(yes) => {
          if (!yes) {
            setConfirmation(null);
            setConfirmationError("");
          }
        }}
      >
        <DialogContent className="team-dialog">
          <DialogHeader>
            <DialogTitle>{t(confirmation?.title ?? "")}</DialogTitle>
            <DialogDescription>{confirmation?.text}</DialogDescription>
          </DialogHeader>
          {confirmationError && (
            <p className="team-error" role="alert">
              {t(confirmationError)}
            </p>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirmation(null)}>
              {t("Cancel")}
            </Button>
            <Button
              variant="destructive"
              data-iori-action={
                confirmation?.title === "Delete team?"
                  ? "team-delete-confirm"
                  : "role-delete-confirm"
              }
              pending={confirmationWorking}
              onClick={async () => {
                setConfirmationWorking(true);
                try {
                  const success = await confirmation?.action();
                  if (success !== false) setConfirmation(null);
                } finally {
                  setConfirmationWorking(false);
                }
              }}
            >
              {t("Delete")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <Dialog open={newTeamOpen} onOpenChange={setNewTeamOpen}>
        <DialogContent className="team-dialog">
          <DialogHeader>
            <DialogTitle>{t("New team")}</DialogTitle>
            <DialogDescription>
              {t("Start with a template or an existing team.")}
            </DialogDescription>
          </DialogHeader>
          <Command>
            <CommandInput placeholder={t("Search")} />
            <CommandList>
              <CommandGroup heading={t("Templates")}>
                {Object.entries(templates).map(([id]) => (
                  <CommandItem
                    key={id}
                    data-iori-template={id}
                    value={`template:${id}`}
                    keywords={[
                      t(
                        {
                          development: "Development",
                          research: "Research",
                          writing: "Writing",
                          minimal: "Minimal",
                        }[id]!,
                      ),
                    ]}
                    onSelect={() => setTeamSource(`template:${id}`)}
                  >
                    {t(
                      {
                        development: "Development",
                        research: "Research",
                        writing: "Writing",
                        minimal: "Minimal",
                      }[id]!,
                    )}
                    {teamSource === `template:${id}` && <Check size={14} />}
                  </CommandItem>
                ))}
              </CommandGroup>
              <CommandGroup heading={t("Existing teams")}>
                {data.teams.map((r) => (
                  <CommandItem
                    key={r.saved.id}
                    value={`existing:${r.saved.id}`}
                    keywords={[r.saved.name]}
                    onSelect={() => setTeamSource(`existing:${r.saved.id}`)}
                  >
                    {r.saved.name}
                    {teamSource === `existing:${r.saved.id}` && (
                      <Check size={14} />
                    )}
                  </CommandItem>
                ))}
              </CommandGroup>
            </CommandList>
          </Command>
          <DialogFooter>
            <Button variant="outline" onClick={() => setNewTeamOpen(false)}>
              {t("Cancel")}
            </Button>
            <Button
              disabled={working}
              pending={workingOn === "create"}
              data-iori-action="team-create"
              onClick={addNewTeam}
            >
              {t("Create")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <Dialog
        open={!!copyTeam}
        onOpenChange={(yes) => {
          if (!yes) setCopyTeam(null);
        }}
      >
        <DialogContent className="team-dialog">
          <DialogHeader>
            <DialogTitle>{t("Copy to another Host")}</DialogTitle>
            <DialogDescription>{copyTeam?.name}</DialogDescription>
          </DialogHeader>
          <Select value={copyHost} onValueChange={setCopyHost}>
            <SelectTrigger aria-label={t("Host")}>
              <SelectValue placeholder={t("Select Host")} />
            </SelectTrigger>
            <SelectContent>
              {connection
                .getSnapshot()
                .initial?.hosts.filter((h) => h.publicKey !== host)
                .map((h) => (
                  <SelectItem value={h.publicKey} key={h.publicKey}>
                    {h.hostName}
                  </SelectItem>
                ))}
            </SelectContent>
          </Select>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCopyTeam(null)}>
              {t("Cancel")}
            </Button>
            <Button
              disabled={!copyHost || working}
              pending={workingOn === "copy"}
              onClick={() => void copyToHost()}
            >
              <Copy size={14} />
              {t("Copy to another Host")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <Sheet open={historyOpen} onOpenChange={setHistoryOpen}>
        <SheetContent
          className="team-history-sheet"
          onCloseAutoFocus={(event) => {
            event.preventDefault();
            document
              .querySelector<HTMLButtonElement>(".team-history-button")
              ?.focus();
          }}
        >
          <SheetHeader>
            <SheetTitle>
              {t("Team history")} · {team?.name}
            </SheetTitle>
            <SheetDescription>
              {t("Select a version to view its contents.")}
            </SheetDescription>
          </SheetHeader>
          <div className="team-history-scroll">
            <div className="team-history-list">
              {selectedRecord?.history.map((h) => (
                <TeamHistoryEntry
                  key={h.team.version}
                  entry={h}
                  selected={currentHistory?.team.version === h.team.version}
                  date={date(h.team.updated)}
                  onSelect={() => setHistoryVersion(h.team.version)}
                  onSaveMemo={async (memo) => {
                    try {
                      const response = await connection.requestHost(
                        host,
                        "teams.memo",
                        {
                          teamId: selectedRecord.saved.id,
                          version: h.team.version,
                          memo,
                        },
                      );
                      if (!response?.ok) return false;
                      putRecord(response.result, true);
                      return true;
                    } catch {
                      return false;
                    }
                  }}
                />
              ))}
            </div>
            {currentHistory && (
              <div className="team-history-detail">
                <h2>
                  {t("Version {version}").replace(
                    "{version}",
                    String(currentHistory.team.version),
                  )}{" "}
                  · {date(currentHistory.team.updated)}
                </h2>
                <h3>{currentHistory.team.name}</h3>
                <p>{currentHistory.team.description}</p>
                <h3>{t("Parent")}</h3>
                <p>
                  {!currentHistory.team.parent.cli ? (
                    t("Not set")
                  ) : (
                    <>
                      {cliName(currentHistory.team.parent.cli)} ·{" "}
                      {modelLabel(
                        currentHistory.team.parent.cli,
                        currentHistory.team.parent.model,
                      )}{" "}
                      ·{" "}
                      {currentHistory.team.parent.effort === undefined
                        ? t("Not specified")
                        : currentHistory.team.parent.effort}{" "}
                      ·{" "}
                      {currentHistory.team.parent.permission === undefined
                        ? t("Not specified")
                        : currentHistory.team.parent.permission}
                      {currentHistory.team.parent.sandbox !== undefined &&
                        ` · ${currentHistory.team.parent.sandbox}`}
                      {currentHistory.team.parent.tools.length > 0 &&
                        ` · ${currentHistory.team.parent.tools.join(", ")}`}
                    </>
                  )}
                </p>
                <p>{currentHistory.team.instruction}</p>
                {currentHistory.team.roles.map((r) => (
                  <div className="team-history-role" key={r.id}>
                    <h3>{r.name}</h3>
                    <p>{r.when}</p>
                    <p>
                      {t("Concurrency limit")}: {r.limit || t("Unlimited")} ·{" "}
                      {t("Reuse child sessions")}:{" "}
                      {t(r.reuse ? "Reuse" : "Do not reuse")}
                    </p>
                    {levels.map(
                      (level) =>
                        r.candidates[level].length > 0 && (
                          <div key={level}>
                            <h4>{t(levelLabel[level])}</h4>
                            {r.candidates[level].map((c, i) => (
                              <p key={c.id}>
                                {i + 1}. {cliName(c.cli)} ·{" "}
                                {modelLabel(c.cli, c.model)} ·{" "}
                                {c.effort === undefined
                                  ? t("Not specified")
                                  : c.effort}{" "}
                                ·{" "}
                                {c.permission === undefined
                                  ? t("Not specified")
                                  : c.permission}
                                {c.sandbox !== undefined && ` · ${c.sandbox}`}
                                {c.tools.length > 0 &&
                                  ` · ${c.tools.join(", ")}`}
                              </p>
                            ))}
                          </div>
                        ),
                    )}
                    <h4>{t("Child instructions")}</h4>
                    <p>{r.instruction}</p>
                    <h4>{t("Request fields")}</h4>
                    <p>{r.request}</p>
                    <h4>{t("Report fields")}</h4>
                    <p>{r.report}</p>
                  </div>
                ))}
              </div>
            )}
          </div>
          <div className="team-history-footer">
            <p>
              {t(
                "Restoring saves a new version. Started children keep their assigned version.",
              )}
            </p>
            <Button
              disabled={
                !currentHistory ||
                currentHistory.team.version === selectedRecord?.saved.version ||
                working
              }
              pending={workingOn === "restore"}
              data-iori-action="team-restore"
              onClick={() =>
                guard(() => {
                  void restore();
                })
              }
            >
              {t("Restore this version")}
            </Button>
          </div>
        </SheetContent>
      </Sheet>
    </section>
  );
}
