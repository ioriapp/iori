import { definitionOrder, limitKey } from "@iori/protocol";
import { useRef, useState } from "react";
import type { KeyboardEvent } from "react";
import { Check, ChevronDown, ChevronRight } from "lucide-react";
import { Button } from "../components/ui/button.tsx";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "../components/ui/command.tsx";
import { CliIcon, useCliName, useI18n, useModelLabel } from "./context.tsx";
import { groupModels, modelOrder, modelProvider } from "./model-catalog.ts";
import type { Candidate } from "./team-data.ts";

type Target = {
  cli: string;
  name: string;
  kind: "provider" | "model";
  provider: string;
};
type Props = {
  availableModels: Record<string, string[]>;
  recent?: { cli: string; model: string }[];
  selected?: Candidate;
  limits?: Record<string, string>;
  onSelect: (target: Target) => void;
};
const token = (target: Target) =>
  JSON.stringify([target.cli, target.kind, target.name]);

export function ModelPicker({
  availableModels,
  recent: allRecent = [],
  selected,
  limits,
  onSelect,
}: Props) {
  const { t, clis, language } = useI18n();
  const cliName = useCliName();
  const modelLabel = useModelLabel();
  const [search, setSearch] = useState("");
  const [active, setActive] = useState("");
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const root = useRef<HTMLDivElement>(null);
  const searching = search.trim() !== "";
  const cliOrder = clis.map((cli) => cli.id);
  const compareModels = modelOrder(cliOrder, language);
  const recent = allRecent
    .filter((entry) => Object.hasOwn(availableModels, entry.cli))
    .sort(compareModels);
  const recentKeys = new Set(
    recent.map((entry) => `${entry.cli}\0${entry.model}`),
  );
  const catalogs = Object.entries(availableModels)
    .sort(([a], [b]) => definitionOrder(cliOrder, language)(a, b))
    .map(([cli, models]): [string, string[]] => [
      cli,
      [...models].sort((a, b) =>
        compareModels({ cli, model: a }, { cli, model: b }),
      ),
    ]);
  const matches = (cli: string, model: string) => {
    const text = model
      ? `${cliName(cli)} ${model} ${modelLabel(cli, model)}`
      : [cliName(cli), "Default", "既定"].join(" ");
    return search
      .trim()
      .toLocaleLowerCase()
      .split(/\s+/)
      .every((word) => text.toLocaleLowerCase().includes(word));
  };
  const isConfigured = (target: Target) =>
    limits !== undefined &&
    Object.hasOwn(limits, limitKey(target.cli, target.kind, target.name));
  const providerToken = (cli: string, name: string) =>
    token({ cli, name, kind: "provider", provider: name });
  const toggle = (cli: string, provider: string, open?: boolean) => {
    const key = providerToken(cli, provider);
    setExpanded((current) => ({ ...current, [key]: open ?? !current[key] }));
  };
  const keyboard = (event: KeyboardEvent<HTMLDivElement>) => {
    if (
      event.nativeEvent.isComposing ||
      searching ||
      !["ArrowRight", "ArrowLeft"].includes(event.key)
    )
      return;
    const current = root.current?.querySelector<HTMLElement>(
      '[cmdk-item][data-selected="true"]',
    );
    if (!current) return;
    const cli = current.dataset.cli;
    const provider = current.dataset.provider;
    if (!cli || !provider) return;
    const isProvider = current.dataset.kind === "provider";
    if (event.key === "ArrowRight" && !isProvider) return;
    event.preventDefault();
    toggle(cli, provider, event.key === "ArrowRight");
    if (event.key === "ArrowLeft")
      setActive(
        isConfigured({ cli, name: provider, kind: "provider", provider })
          ? `expand:${providerToken(cli, provider)}`
          : providerToken(cli, provider),
      );
  };
  const modelItem = (
    cli: string,
    model: string,
    prefix = "",
    grouped = false,
  ) => {
    const target: Target = {
      cli,
      name: model,
      kind: "model",
      provider: modelProvider(model),
    };
    const label = model ? modelLabel(cli, model) : t("Default");
    const isSelected = selected?.cli === cli && selected.model === model;
    return (
      <CommandItem
        key={`${prefix}${token(target)}`}
        value={`${prefix}${token(target)}`}
        disabled={isConfigured(target)}
        data-cli={cli}
        data-provider={target.provider}
        data-kind="model"
        data-iori-model={model}
        onSelect={() => onSelect(target)}
        className="flex min-h-7 items-center gap-2 rounded-sm px-2 py-1.5 text-xs text-foreground data-selected:bg-accent data-selected:text-accent-foreground data-[disabled=true]:opacity-45 [&>svg:last-child]:hidden"
        title={`${cliName(cli)} › ${label}`}
      >
        {!limits && !grouped && (
          <span className="inline-flex size-3.5 shrink-0 items-center justify-center">
            <CliIcon name={cli} size={14} />
          </span>
        )}
        <span className="min-w-0 flex-1 truncate">
          {grouped
            ? label === model
              ? model.slice(model.indexOf("/") + 1)
              : label
            : limits
              ? label
              : `${cliName(cli)} › ${label}`}
        </span>
        {isSelected && (
          <Check
            className="ml-auto size-3 shrink-0 text-primary"
            aria-hidden="true"
          />
        )}
      </CommandItem>
    );
  };
  const providerRow = (cli: string, provider: string, values: string[]) => {
    const target: Target = { cli, name: provider, kind: "provider", provider };
    const key = token(target);
    const disabled = isConfigured(target);
    const open = !!expanded[key];
    const expand = (
      <Button
        type="button"
        variant="ghost"
        size="icon-sm"
        className="size-7 shrink-0 rounded-sm text-muted-foreground hover:text-foreground"
        aria-label={`${t(open ? "Collapse provider" : "Expand provider")} ${cliName(cli)} › ${provider}`}
        aria-expanded={open}
        onPointerDown={(event) => event.preventDefault()}
        onClick={(event) => {
          if (!disabled) {
            event.stopPropagation();
            toggle(cli, provider);
          }
        }}
      >
        {open ? (
          <ChevronDown className="size-3.5" aria-hidden="true" />
        ) : (
          <ChevronRight className="size-3.5" aria-hidden="true" />
        )}
      </Button>
    );
    return (
      <div key={provider}>
        <div className="flex items-center gap-0.5">
          <CommandItem
            value={key}
            data-cli={cli}
            data-provider={provider}
            data-kind="provider"
            disabled={disabled}
            onSelect={() => (limits ? onSelect(target) : toggle(cli, provider))}
            className="flex min-h-7 min-w-0 flex-1 items-center justify-between gap-2 rounded-sm px-2 py-1.5 text-xs font-medium text-foreground data-selected:bg-accent data-selected:text-accent-foreground data-[disabled=true]:opacity-45 [&>svg:last-child]:hidden"
            aria-expanded={open}
          >
            <span className="min-w-0 flex-1 truncate">{provider}</span>
            <small className="shrink-0 font-normal text-2xs tabular-nums text-muted-foreground">
              {values.length}
            </small>
          </CommandItem>
          {disabled ? (
            <CommandItem
              value={`expand:${key}`}
              data-cli={cli}
              data-provider={provider}
              data-kind="provider"
              className="flex size-7 shrink-0 items-center justify-center rounded-sm p-0 text-muted-foreground data-selected:bg-accent data-selected:text-accent-foreground [&>svg:last-child]:hidden"
              aria-label={`${t(open ? "Collapse provider" : "Expand provider")} ${cliName(cli)} › ${provider}`}
              aria-expanded={open}
              onSelect={() => toggle(cli, provider)}
            >
              {open ? (
                <ChevronDown className="size-3.5" aria-hidden="true" />
              ) : (
                <ChevronRight className="size-3.5" aria-hidden="true" />
              )}
            </CommandItem>
          ) : (
            expand
          )}
        </div>
        {open && (
          <div className="ml-3 border-l border-border-subtle pl-1.5">
            {values.map((model) => modelItem(cli, model, "", true))}
          </div>
        )}
      </div>
    );
  };
  return (
    <Command
      ref={root}
      className="flex w-full flex-col overflow-hidden rounded-md bg-popover p-1 text-popover-foreground"
      shouldFilter={false}
      value={active}
      onValueChange={setActive}
      onKeyDown={keyboard}
    >
      <CommandInput
        placeholder={t(
          limits ? "Search provider or model…" : "Search CLI or model…",
        )}
        value={search}
        onValueChange={(value) => {
          setSearch(value);
          setActive("");
        }}
      />
      <CommandList className="max-h-72 overflow-x-hidden overflow-y-auto py-1">
        <CommandEmpty className="px-3 py-6 text-center text-xs text-muted-foreground">
          {t(
            catalogs.length
              ? "No matching models."
              : "CLI not found on this Host. Install it and retry.",
          )}
        </CommandEmpty>
        {!searching && recent.length > 0 && (
          <CommandGroup
            heading={t("Models used in this team")}
            className="p-0.5 [&_[cmdk-group-heading]]:px-2 [&_[cmdk-group-heading]]:py-1.5 [&_[cmdk-group-heading]]:text-2xs [&_[cmdk-group-heading]]:font-semibold [&_[cmdk-group-heading]]:text-muted-foreground"
          >
            {recent.map(({ cli, model }) => modelItem(cli, model, "recent:"))}
          </CommandGroup>
        )}
        {catalogs.map(([cli, values]) => {
          const groups = groupModels(values);
          if (searching) {
            const defaultMatches = !limits && matches(cli, "");
            const ungrouped = (groups[""] ?? []).filter((model) =>
              matches(cli, model),
            );
            const rest = Object.entries(groups).filter(
              ([provider]) => provider,
            );
            return [
              defaultMatches || ungrouped.length ? (
                <CommandGroup
                  key={`${cli}/`}
                  heading={cliName(cli)}
                  className="p-0.5 [&_[cmdk-group-heading]]:px-2 [&_[cmdk-group-heading]]:py-1.5 [&_[cmdk-group-heading]]:text-2xs [&_[cmdk-group-heading]]:font-semibold [&_[cmdk-group-heading]]:text-muted-foreground"
                >
                  {defaultMatches && modelItem(cli, "")}
                  {ungrouped.map((model) => modelItem(cli, model))}
                </CommandGroup>
              ) : null,
              ...rest.map(([provider, list]) => {
                const found = list.filter((model) => matches(cli, model));
                if (!found.length) return null;
                return (
                  <CommandGroup
                    key={`${cli}/${provider}`}
                    heading={`${cliName(cli)} › ${provider}`}
                    className="p-0.5 [&_[cmdk-group-heading]]:px-2 [&_[cmdk-group-heading]]:py-1.5 [&_[cmdk-group-heading]]:text-2xs [&_[cmdk-group-heading]]:font-semibold [&_[cmdk-group-heading]]:text-muted-foreground"
                  >
                    {found.map((model) => modelItem(cli, model, "", true))}
                  </CommandGroup>
                );
              }),
            ];
          }
          const providers = Object.keys(groups).filter(Boolean);
          const useProviders = limits
            ? providers.length > 0
            : providers.length > 1;
          const showDefault = !limits && !recentKeys.has(`${cli}\0`);
          const remaining = values.filter(
            (model) => !recentKeys.has(`${cli}\0${model}`),
          );
          if (!showDefault && !remaining.length) return null;
          const remainingGroups = groupModels(remaining);
          return (
            <CommandGroup
              key={cli}
              heading={cliName(cli)}
              className="p-0.5 [&_[cmdk-group-heading]]:px-2 [&_[cmdk-group-heading]]:py-1.5 [&_[cmdk-group-heading]]:text-2xs [&_[cmdk-group-heading]]:font-semibold [&_[cmdk-group-heading]]:text-muted-foreground"
            >
              {showDefault && modelItem(cli, "")}
              {useProviders
                ? Object.entries(remainingGroups).map(([provider, list]) =>
                    provider
                      ? providerRow(cli, provider, list)
                      : list.map((model) => modelItem(cli, model)),
                  )
                : remaining.map((model) => modelItem(cli, model))}
            </CommandGroup>
          );
        })}
      </CommandList>
    </Command>
  );
}
