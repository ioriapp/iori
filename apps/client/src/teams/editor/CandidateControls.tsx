import { useState } from "react";
import {
  AlertTriangle,
  ArrowDown,
  ArrowUp,
  ChevronDown,
  ChevronRight,
  ChevronsUpDown,
  Copy,
  GripVertical,
  MoreHorizontal,
  ShieldCheck,
  Trash2,
} from "lucide-react";
import { useSortable } from "@dnd-kit/sortable";
import { cn } from "cn";
import {
  belowUsageMinimum,
  limitKey,
  orderUsageWindows,
  usageAppliesToModel,
  type UsageWindowSelection,
} from "@iori/protocol";
import { Button } from "../../components/ui/button.tsx";
import { Checkbox } from "../../components/ui/checkbox.tsx";
import { Input } from "../../components/ui/input.tsx";
import { Label } from "../../components/ui/label.tsx";
import {
  Popover,
  PopoverContent,
  PopoverHeader,
  PopoverTitle,
  PopoverTrigger,
} from "../../components/ui/popover.tsx";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "../../components/ui/dropdown-menu.tsx";
import { formatUsageLength } from "../../usage-format.ts";
import { CliIcon, useCliName, useI18n, useModelLabel } from "../context.tsx";
import { ModelPicker } from "../ModelPicker.tsx";
import { Usage } from "../Usage.tsx";
import type { Candidate, Difficulty, Role } from "../team-data.ts";
import { ShortSelect } from "./EditorPrimitives.tsx";
import {
  DIFFICULTY_LABELS,
  DIFFICULTY_LEVELS,
  hasEffortOption,
} from "./types.ts";

export function CliModelSearch({
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
  const { t, catalogs, clis } = useI18n();
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
  const selectedLabel = item.cli
    ? `${cliName(item.cli)} › ${item.model ? modelLabel(item.cli, item.model) : t("Default")}`
    : t("Not set");

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="h-7 w-full min-w-0 justify-between gap-1.5 border-input bg-card px-2 text-left text-xs font-normal text-foreground hover:bg-accent/60 max-md:h-9 dark:bg-input/25"
          data-iori-action="candidate-model"
          data-iori-cli={item.cli}
          data-iori-model={item.model}
          role="combobox"
          aria-expanded={open}
          aria-label={`${t("CLI and model")}: ${selectedLabel}`}
          title={selectedLabel}
        >
          <span className="flex min-w-0 flex-1 items-center gap-1.5">
            {item.cli && <CliIcon name={item.cli} size={14} />}
            <span className="truncate">{selectedLabel}</span>
          </span>
          <ChevronsUpDown
            className="size-3 shrink-0 text-muted-foreground"
            aria-hidden="true"
          />
        </Button>
      </PopoverTrigger>
      <PopoverContent
        className="team-search-popover w-[min(500px,calc(100vw-2rem))] gap-0 overflow-hidden p-0"
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
            if (cli === item.cli) {
              const usage = clis.find((entry) => entry.id === cli)?.usage;
              const keepMinimumWindow =
                item.minimumWindow !== undefined &&
                (!usage ||
                  usage.windows.some(
                    (window) =>
                      usageAppliesToModel(window, model) &&
                      window.minutes === item.minimumWindow!.minutes &&
                      (window.name ?? "") === (item.minimumWindow!.name ?? ""),
                  ));
              onChange({
                model,
                effort: catalogs[cli]?.models
                  .find((entry) => entry.name === model)
                  ?.efforts.includes(item.effort ?? "")
                  ? item.effort
                  : undefined,
                minimumWindow: keepMinimumWindow
                  ? item.minimumWindow
                  : undefined,
              });
            } else {
              onChange({
                cli,
                cliName: cliName(cli),
                model,
                effort: undefined,
                permission: undefined,
                sandbox: undefined,
                minimum: "",
                minimumWindow: undefined,
                tools: [],
              });
            }
            setOpen(false);
          }}
        />
      </PopoverContent>
    </Popover>
  );
}

export function PermissionsPopover({
  item,
  onChange,
}: {
  item: Candidate;
  onChange: (changes: Partial<Candidate>) => void;
}) {
  const { t, catalogs } = useI18n();
  const cliName = useCliName();
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
          type="button"
          variant="outline"
          size="sm"
          disabled={!item.cli}
          aria-label={`${t("Permissions")}: ${summary}`}
          title={summary}
          className="h-7 w-full min-w-0 justify-between gap-1.5 border-input bg-card px-2 text-left text-2xs font-normal text-foreground hover:bg-accent/60 max-md:h-8 max-md:w-auto max-md:max-w-full dark:bg-input/25"
        >
          <span className="flex min-w-0 flex-1 items-center gap-1">
            <span className="shrink-0 text-muted-foreground md:hidden">
              {t("Permissions")}:
            </span>
            <span className="truncate font-mono">{summary}</span>
          </span>
          <ChevronDown
            className="size-3 shrink-0 text-muted-foreground"
            aria-hidden="true"
          />
        </Button>
      </PopoverTrigger>
      <PopoverContent
        className="w-[min(300px,calc(100vw-2rem))] gap-3 p-3.5"
        align="start"
      >
        <PopoverHeader>
          <PopoverTitle className="flex items-center gap-1.5 text-xs font-semibold">
            <ShieldCheck
              className="size-3.5 text-muted-foreground"
              aria-hidden="true"
            />
            <span>
              {item.cli ? `${cliName(item.cli)} · ` : ""}
              {t("Permissions")}
            </span>
          </PopoverTitle>
        </PopoverHeader>
        {capability?.permissionNote && (
          <p className="text-xs leading-relaxed text-muted-foreground">
            {t(capability.permissionNote)}
          </p>
        )}
        {fields.map((field) => (
          <div key={field.key} className="flex flex-col gap-1.5">
            <Label className="font-mono text-2xs font-medium text-foreground">
              {t(field.label)}
            </Label>
            {field.multiple ? (
              <div className="grid grid-cols-2 gap-x-4 gap-y-2.5">
                {field.options.map((tool) => (
                  <label
                    key={tool}
                    className="flex cursor-pointer items-center gap-2 text-xs text-foreground"
                  >
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
                    <span>{tool}</span>
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
        {!fields.length && (
          <p className="text-xs text-muted-foreground">{t("Not specified")}</p>
        )}
      </PopoverContent>
    </Popover>
  );
}

const CANDIDATE_GRID =
  "md:grid-cols-[88px_minmax(0,2.2fr)_84px_minmax(0,1fr)_140px_32px]";

function parentGridClass(showEffort: boolean) {
  return showEffort
    ? "md:grid-cols-[minmax(0,1.5fr)_104px_minmax(0,1.25fr)]"
    : "md:grid-cols-[minmax(0,1.5fr)_minmax(0,1.25fr)]";
}

export function ExecutionHeading({
  parent = false,
  showEffort = true,
}: {
  parent?: boolean;
  showEffort?: boolean;
}) {
  const { t } = useI18n();
  return (
    <div
      className={cn(
        "hidden items-center gap-2 border-b border-border bg-sidebar/40 px-2 py-1.5 text-2xs font-medium text-muted-foreground md:grid",
        parent ? parentGridClass(showEffort) : CANDIDATE_GRID,
      )}
    >
      {!parent && <span>#</span>}
      <span>{t("CLI and model")}</span>
      {(!parent || showEffort) && <span>Effort</span>}
      <span>{t("Permissions")}</span>
      {!parent && <span>{t("Minimum remaining")}</span>}
      {!parent && <span aria-hidden="true" />}
    </div>
  );
}

export function ExecutionRow({
  item,
  index,
  total,
  parent = false,
  onChange,
  onRemove,
  onStep,
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
  total?: number;
  parent?: boolean;
  onChange: (changes: Partial<Candidate>) => void;
  onRemove?: () => void;
  onStep?: (direction: -1 | 1) => void;
  onCopyLevel?: (level: Difficulty) => void;
  onCopyRole?: (id: string) => void;
  roles?: Role[];
  availableModels: Record<string, string[]>;
  recent: { cli: string; model: string }[];
  limits: Record<string, string>;
  available: string[];
  onLimits: (cli: string) => void;
}) {
  const {
    t,
    catalogs,
    clis: usageClis,
    usageClis: supportedUsageClis,
  } = useI18n();
  const {
    attributes,
    listeners,
    setNodeRef,
    setActivatorNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: item.id, disabled: parent });
  const cliName = useCliName();
  const modelLabel = useModelLabel();
  const missing = !!item.cli && !available.includes(item.cli);
  const usageCli = usageClis.find((cli) => cli.id === item.cli);
  const supportsUsage =
    usageCli?.supportsUsage ?? supportedUsageClis?.includes(item.cli);
  const lowUsage =
    !parent &&
    usageCli?.supportsUsage &&
    belowUsageMinimum(
      item.minimum,
      usageCli?.usage,
      item.model,
      item.minimumWindow,
    );
  const applicableWindows = orderUsageWindows(
    (usageCli?.usage?.windows ?? []).filter((window) =>
      usageAppliesToModel(window, item.model),
    ),
  );
  const showWindowSelector =
    !parent &&
    supportsUsage &&
    (applicableWindows.length >= 2 || item.minimumWindow !== undefined);
  const distinctWindowNames = new Set(
    applicableWindows.map((window) => window.name ?? ""),
  );
  const showWindowName = distinctWindowNames.size > 1;
  const usageWindowKey = (window: UsageWindowSelection) =>
    `${window.minutes}:${window.name ?? ""}`;
  const windowOptions: {
    key: string;
    label: string;
    selection: UsageWindowSelection;
  }[] = applicableWindows.map((window) => {
    const selection: UsageWindowSelection = window.name
      ? { minutes: window.minutes, name: window.name }
      : { minutes: window.minutes };
    return {
      key: usageWindowKey(selection),
      label:
        showWindowName && window.name
          ? `${window.name} ${formatUsageLength(window.minutes)}`
          : formatUsageLength(window.minutes),
      selection,
    };
  });
  if (
    item.minimumWindow &&
    !windowOptions.some(
      (option) => option.key === usageWindowKey(item.minimumWindow!),
    )
  ) {
    const saved = item.minimumWindow;
    windowOptions.push({
      key: usageWindowKey(saved),
      label: `${saved.name ? `${saved.name} ` : ""}${formatUsageLength(saved.minutes)}`,
      selection: saved.name
        ? { minutes: saved.minutes, name: saved.name }
        : { minutes: saved.minutes },
    });
  }
  const selectedWindowKey = item.minimumWindow
    ? usageWindowKey(item.minimumWindow)
    : "";
  const selectedWindowLabel = item.minimumWindow
    ? (windowOptions.find((option) => option.key === selectedWindowKey)
        ?.label ??
      `${item.minimumWindow.name ? `${item.minimumWindow.name} ` : ""}${formatUsageLength(item.minimumWindow.minutes)}`)
    : t("Auto");

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
    (entry) => entry.name === item.model,
  );
  const effortOptions = [
    ...new Set(
      [
        ...(model?.efforts ?? []),
        ...(item.effort === undefined ? [] : [item.effort]),
      ].filter(Boolean),
    ),
  ];
  const showEffort = hasEffortOption(item, catalogs, usageClis);
  const isFirst = index === 0;
  const isLast =
    index !== undefined && total !== undefined && index >= total - 1;
  const hasHelper =
    (!parent && (usageCli?.usage || lowUsage || relevantLimits.length > 0)) ||
    missing;

  return (
    <div
      ref={setNodeRef}
      className={cn(
        "relative flex min-w-0 flex-col transition-colors",
        !parent && "px-2 py-2 hover:bg-accent/25 max-md:px-1 max-md:py-2.5",
        parent && "py-2",
        lowUsage && "bg-status-waiting-bg/35",
        isDragging && "z-(--z-popover) bg-background shadow-md",
      )}
      style={{
        transform: transform
          ? `translate3d(${transform.x}px,${transform.y}px,0) scaleX(${transform.scaleX}) scaleY(${transform.scaleY})`
          : undefined,
        transition,
      }}
    >
      <div
        className={cn(
          "grid min-w-0 items-center gap-x-1.5 gap-y-2 md:gap-2",
          parent
            ? cn("grid-cols-1", parentGridClass(showEffort))
            : cn("grid-cols-[auto_minmax(0,1fr)_auto]", CANDIDATE_GRID),
          missing && "opacity-55",
        )}
      >
        {/* 1. Grip + Priority + Up/Down */}
        {!parent && (
          <div className="col-start-1 row-start-1 flex items-center gap-0.5">
            <Button
              type="button"
              variant="ghost"
              size="icon-xs"
              ref={setActivatorNodeRef}
              className="relative size-6 cursor-grab touch-none text-muted-foreground hover:text-foreground max-md:size-9 [@media(pointer:coarse)]:before:absolute [@media(pointer:coarse)]:before:inset-1/2 [@media(pointer:coarse)]:before:size-11 [@media(pointer:coarse)]:before:-translate-x-1/2 [@media(pointer:coarse)]:before:-translate-y-1/2"
              data-iori-action="candidate-reorder"
              data-iori-candidate-priority={index! + 1}
              {...attributes}
              {...listeners}
              aria-label={`${t("Drag to reorder")} ${index! + 1}`}
              onKeyDown={(event) => {
                if (
                  !isDragging &&
                  onStep &&
                  (event.key === "ArrowUp" || event.key === "ArrowDown")
                ) {
                  event.preventDefault();
                  onStep(event.key === "ArrowUp" ? -1 : 1);
                } else {
                  listeners?.onKeyDown?.(event);
                }
              }}
            >
              <GripVertical className="size-3.5" aria-hidden="true" />
            </Button>
            <span className="w-4 shrink-0 text-center font-mono text-2xs tabular-nums text-muted-foreground">
              {index! + 1}
            </span>
            {onStep && (
              <div className="hidden items-center md:inline-flex">
                <button
                  type="button"
                  disabled={isFirst}
                  onClick={() => onStep(-1)}
                  aria-label={`${t("Move up")} ${index! + 1}`}
                  className="inline-flex size-5 cursor-pointer items-center justify-center rounded-xs text-muted-foreground hover:bg-accent hover:text-foreground disabled:pointer-events-none disabled:opacity-30"
                >
                  <ArrowUp className="size-3" aria-hidden="true" />
                </button>
                <button
                  type="button"
                  disabled={isLast}
                  onClick={() => onStep(1)}
                  aria-label={`${t("Move down")} ${index! + 1}`}
                  className="inline-flex size-5 cursor-pointer items-center justify-center rounded-xs text-muted-foreground hover:bg-accent hover:text-foreground disabled:pointer-events-none disabled:opacity-30"
                >
                  <ArrowDown className="size-3" aria-hidden="true" />
                </button>
              </div>
            )}
          </div>
        )}

        {/* 2. CLI › Model Picker */}
        <div
          className={cn(
            "min-w-0",
            !parent && "col-start-2 row-start-1",
            parent && "col-span-full md:col-span-1",
          )}
        >
          <CliModelSearch
            item={item}
            availableModels={availableModels}
            recent={recent}
            onChange={onChange}
          />
        </div>

        {/* Tier 2 on Mobile / Inline Grid Cells on Desktop */}
        <div
          className={cn(
            "col-span-full row-start-2 flex flex-wrap items-center gap-1.5 md:contents",
            !parent && "pl-7",
          )}
        >
          {/* 3. Effort */}
          {(!parent || showEffort) && (
            <div className="min-w-0 max-md:min-w-22">
              {showEffort && (
                <ShortSelect
                  label="Effort"
                  disabled={!item.cli}
                  value={item.effort}
                  options={effortOptions}
                  onChange={(effort) => onChange({ effort })}
                  className="text-2xs max-md:h-8"
                />
              )}
            </div>
          )}

          {/* 4. Permissions Popover */}
          <div className="min-w-0 max-md:max-w-full">
            <PermissionsPopover item={item} onChange={onChange} />
          </div>

          {/* 5. Minimum Remaining % + Usage Window */}
          {!parent &&
            (supportsUsage ? (
              <div className="flex min-w-0 items-center gap-1">
                <div className="relative flex w-16 shrink-0 items-center">
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
                    className={cn(
                      "h-7 pr-4 pl-2 text-2xs tabular-nums max-md:h-8",
                      lowUsage &&
                        "border-status-waiting-border text-status-waiting-text",
                    )}
                  />
                  <span
                    aria-hidden="true"
                    className="pointer-events-none absolute right-1.5 text-2xs text-muted-foreground"
                  >
                    %
                  </span>
                </div>
                {showWindowSelector && (
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        className="h-7 min-w-0 flex-1 justify-between gap-1 border-input bg-card px-1.5 text-2xs font-normal text-foreground hover:bg-accent/60 max-md:h-8 dark:bg-input/25"
                        data-iori-field="candidate-minimum-window"
                        aria-label={`${t("Usage window")} ${index! + 1}`}
                        title={selectedWindowLabel}
                      >
                        <span className="truncate">{selectedWindowLabel}</span>
                        <ChevronDown
                          className="size-3 shrink-0 text-muted-foreground"
                          aria-hidden="true"
                        />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                      <DropdownMenuRadioGroup
                        value={selectedWindowKey}
                        onValueChange={(next) => {
                          if (next === "") {
                            onChange({ minimumWindow: undefined });
                            return;
                          }
                          const picked = windowOptions.find(
                            (option) => option.key === next,
                          );
                          if (picked) {
                            onChange({ minimumWindow: picked.selection });
                          }
                        }}
                      >
                        <DropdownMenuRadioItem value="">
                          {t("Auto (lowest remaining)")}
                        </DropdownMenuRadioItem>
                        <DropdownMenuSeparator />
                        {windowOptions.map((option) => (
                          <DropdownMenuRadioItem
                            key={option.key}
                            value={option.key}
                          >
                            {option.label}
                          </DropdownMenuRadioItem>
                        ))}
                      </DropdownMenuRadioGroup>
                    </DropdownMenuContent>
                  </DropdownMenu>
                )}
              </div>
            ) : (
              <span className="hidden md:block" aria-hidden="true" />
            ))}
        </div>

        {/* 6. Row … Menu (single 44px touch target on Mobile) */}
        {!parent && (
          <div className="col-start-3 row-start-1 flex items-center justify-end md:col-start-6">
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-sm"
                  aria-label={t("Candidate actions")}
                  className="shrink-0 text-muted-foreground max-md:size-11"
                >
                  <MoreHorizontal className="size-4 max-md:size-5" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                {onStep && (
                  <>
                    <DropdownMenuItem
                      disabled={isFirst}
                      onSelect={() => onStep(-1)}
                      className="md:hidden"
                    >
                      <ArrowUp className="size-3.5" aria-hidden="true" />
                      {t("Move up")}
                    </DropdownMenuItem>
                    <DropdownMenuItem
                      disabled={isLast}
                      onSelect={() => onStep(1)}
                      className="md:hidden"
                    >
                      <ArrowDown className="size-3.5" aria-hidden="true" />
                      {t("Move down")}
                    </DropdownMenuItem>
                    <DropdownMenuSeparator className="md:hidden" />
                  </>
                )}
                <DropdownMenuSub>
                  <DropdownMenuSubTrigger>
                    <Copy className="size-3.5" aria-hidden="true" />
                    {t("Copy to difficulty")}
                  </DropdownMenuSubTrigger>
                  <DropdownMenuSubContent>
                    {DIFFICULTY_LEVELS.map((level) => (
                      <DropdownMenuItem
                        key={level}
                        onSelect={() => onCopyLevel?.(level)}
                      >
                        {t(DIFFICULTY_LABELS[level])}
                      </DropdownMenuItem>
                    ))}
                  </DropdownMenuSubContent>
                </DropdownMenuSub>
                <DropdownMenuSub>
                  <DropdownMenuSubTrigger>
                    <Copy className="size-3.5" aria-hidden="true" />
                    {t("Copy to role")}
                  </DropdownMenuSubTrigger>
                  <DropdownMenuSubContent>
                    {roles?.map((targetRole) => (
                      <DropdownMenuItem
                        key={targetRole.id}
                        onSelect={() => onCopyRole?.(targetRole.id)}
                      >
                        {targetRole.name}
                      </DropdownMenuItem>
                    ))}
                  </DropdownMenuSubContent>
                </DropdownMenuSub>
                <DropdownMenuSeparator />
                <DropdownMenuItem variant="destructive" onSelect={onRemove}>
                  <Trash2 className="size-3.5" aria-hidden="true" />
                  {t("Delete")}
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        )}
      </div>

      {/* Helper line: Usage, Low quota warning, Host limit link, Missing CLI */}
      {hasHelper && (
        <div
          className={cn(
            "mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-2xs",
            !parent && "pl-7 md:pl-[100px]",
          )}
        >
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
            <p className="m-0 inline-flex items-center gap-1 font-medium text-status-waiting-text">
              <AlertTriangle className="size-3 shrink-0" aria-hidden="true" />
              {t(
                "This candidate is currently below the minimum remaining usage and will not be assigned.",
              )}
            </p>
          )}
          {!parent && relevantLimits.length > 0 && (
            <button
              type="button"
              onClick={() => onLimits(item.cli)}
              aria-label={t("View Host limits")}
              className="inline-flex cursor-pointer items-center gap-0.5 text-left text-2xs text-muted-foreground underline decoration-border underline-offset-2 transition-colors hover:text-link hover:decoration-link"
            >
              <span>
                {t("Host limits")}:{" "}
                {relevantLimits
                  .map((target) => `${target.label} ${limits[target.key]}`)
                  .join(" · ")}
              </span>
              <ChevronRight className="size-3 shrink-0" aria-hidden="true" />
            </button>
          )}
          {missing && (
            <p className="m-0 text-2xs text-muted-foreground">
              {t("Not found on this Host")}
            </p>
          )}
        </div>
      )}
    </div>
  );
}
