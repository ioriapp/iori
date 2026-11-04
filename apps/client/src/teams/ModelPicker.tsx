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
import { CliIcon, useCliName, useModelLabel } from "./context.tsx";
import { useI18n } from "./context.tsx";
import { groupModels, modelProvider } from "./model-catalog.ts";
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
  const recent = allRecent.filter((entry) =>
    Object.hasOwn(availableModels, entry.cli),
  );
  const catalogs = Object.entries(availableModels)
    .sort(([a], [b]) =>
      definitionOrder(
        clis.map((cli) => cli.id),
        language,
      )(a, b),
    )
    .map(([cli, models]): [string, string[]] => [
      cli,
      [...models].sort(
        (a, b) =>
          modelProvider(a).localeCompare(modelProvider(b), language) ||
          a.localeCompare(b, language),
      ),
    ]);
  const matches = (cli: string, model: string) =>
    search
      .trim()
      .toLocaleLowerCase()
      .split(/\s+/)
      .every((word) =>
        `${cliName(cli)} ${model} ${modelLabel(cli, model)}`
          .toLocaleLowerCase()
          .includes(word),
      );
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
    const label = modelLabel(cli, model);
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
        className="model-picker-model"
        title={`${cliName(cli)} › ${label}`}
      >
        {!limits && !grouped && <CliIcon name={cli} size={14} />}
        <span>
          {grouped
            ? label === model
              ? model.slice(model.indexOf("/") + 1)
              : label
            : limits
              ? label
              : `${cliName(cli)} › ${label}`}
        </span>
        {selected?.cli === cli && selected.model === model && (
          <Check size={12} />
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
        variant="ghost"
        size="icon-sm"
        className="model-picker-expand"
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
        {open ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
      </Button>
    );
    return (
      <div key={provider}>
        <div className="model-picker-provider-row">
          <CommandItem
            value={key}
            data-cli={cli}
            data-provider={provider}
            data-kind="provider"
            disabled={disabled}
            onSelect={() => (limits ? onSelect(target) : toggle(cli, provider))}
            className="model-picker-provider"
            aria-expanded={open}
          >
            <span>{provider}</span>
            <small>{values.length}</small>
          </CommandItem>
          {disabled ? (
            <CommandItem
              value={`expand:${key}`}
              data-cli={cli}
              data-provider={provider}
              data-kind="provider"
              className="model-picker-expand"
              aria-label={`${t(open ? "Collapse provider" : "Expand provider")} ${cliName(cli)} › ${provider}`}
              aria-expanded={open}
              onSelect={() => toggle(cli, provider)}
            >
              {open ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
            </CommandItem>
          ) : (
            expand
          )}
        </div>
        {open && (
          <div className="model-picker-provider-models">
            {values.map((model) => modelItem(cli, model, "", true))}
          </div>
        )}
      </div>
    );
  };
  return (
    <Command
      ref={root}
      className="model-picker"
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
      <CommandList>
        <CommandEmpty>{t("No matching models.")}</CommandEmpty>
        {!searching && recent.length > 0 && (
          <CommandGroup heading={t("Models used in this team")}>
            {recent.map(({ cli, model }) => modelItem(cli, model, "recent:"))}
          </CommandGroup>
        )}
        {catalogs.map(([cli, values]) => {
          const groups = groupModels(values);
          if (searching)
            return Object.entries(groups).map(([provider, list]) => {
              const found = list.filter((model) => matches(cli, model));
              if (!found.length) return null;
              return (
                <CommandGroup
                  key={`${cli}/${provider}`}
                  heading={
                    provider ? `${cliName(cli)} › ${provider}` : cliName(cli)
                  }
                >
                  {found.map((model) => modelItem(cli, model, "", !!provider))}
                </CommandGroup>
              );
            });
          const providers = Object.keys(groups).filter(Boolean);
          const useProviders = limits
            ? providers.length > 0
            : providers.length > 1;
          return (
            <CommandGroup key={cli} heading={cliName(cli)}>
              {useProviders
                ? Object.entries(groups).map(([provider, list]) =>
                    provider
                      ? providerRow(cli, provider, list)
                      : list.map((model) => modelItem(cli, model)),
                  )
                : values.map((model) => modelItem(cli, model))}
            </CommandGroup>
          );
        })}
      </CommandList>
    </Command>
  );
}
