import { useEffect, useId, useRef, useState } from "react";
import { ChevronDown, ChevronUp, Plus, X } from "lucide-react";
import { limitKey, limitTarget } from "@iori/protocol";
import { cn } from "cn";
import {
  useSettingsEditor,
  type RegisterSettingsEditor,
} from "../settings-save.ts";
import { saveOnEnter } from "../components/page-layout.tsx";
import { FlatSettingRow } from "../components/SectionLayout.tsx";
import { connection } from "../connection.ts";
import { Input } from "../components/ui/input.tsx";
import { Button } from "../components/ui/button.tsx";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "../components/ui/popover.tsx";
import { ModelPicker } from "./ModelPicker.tsx";
import { modelProvider } from "./model-catalog.ts";
import { useCliName, useI18n, useModelLabel } from "./context.tsx";

function AgentLimitInput({
  value,
  onChange,
  label,
  id,
  onBlur,
  min = 0,
  max,
}: {
  value: string;
  onChange: (value: string) => void;
  label: string;
  id?: string;
  onBlur?: () => void;
  min?: number;
  max?: number;
}) {
  const { t } = useI18n();
  const input = useRef<HTMLInputElement>(null);
  const [draft, setDraft] = useState<string>();
  const displayed = draft ?? value;

  const change = (raw: string) => {
    if (
      max !== undefined &&
      (!/^[0-9]+$/.test(raw) || Number(raw) < min || Number(raw) > max)
    ) {
      setDraft(raw);
      return;
    }
    setDraft(undefined);
    onChange(raw);
  };

  const step = (direction: 1 | -1) => {
    if (max !== undefined) {
      change(
        String(
          Math.max(min, Math.min(max, Number(displayed || min) + direction)),
        ),
      );
      return;
    }
    if (direction === -1 && BigInt(value || "0") === 0n) return;
    const next = BigInt(value || "0") + BigInt(direction);
    onChange(next > 0n ? next.toString() : "");
  };

  return (
    <div className="relative inline-flex items-center">
      <Input
        ref={input}
        id={id}
        type="text"
        inputMode="numeric"
        pattern="[0-9]*"
        role="spinbutton"
        aria-label={label}
        aria-valuemin={min}
        aria-valuemax={max}
        aria-valuenow={Number(value || 0)}
        aria-valuetext={displayed || (max === undefined ? t("Unlimited") : "")}
        value={displayed}
        placeholder={max === undefined ? t("Unlimited") : String(min)}
        className="h-8 w-24 pr-6 text-right font-mono text-xs tabular-nums"
        onChange={(event) =>
          change(
            max === undefined
              ? event.target.value.replace(/[^0-9]/g, "").replace(/^0+/u, "")
              : event.target.value,
          )
        }
        onBlur={() => {
          setDraft(undefined);
          onBlur?.();
        }}
        onKeyDown={(event) => {
          if (
            event.nativeEvent.isComposing ||
            !["ArrowUp", "ArrowDown"].includes(event.key)
          )
            return;
          event.preventDefault();
          step(event.key === "ArrowUp" ? 1 : -1);
        }}
      />
      <div className="absolute inset-y-0.5 right-0.5 flex flex-col justify-center">
        <Button
          type="button"
          variant="ghost"
          tabIndex={-1}
          data-iori-action="limit-increase"
          aria-label={`${label}: ${t("Increase limit")}`}
          className="h-3.5 w-5 rounded-xs p-0 text-muted-foreground hover:text-foreground"
          onPointerDown={(event) => event.preventDefault()}
          onClick={() => {
            input.current?.focus();
            step(1);
          }}
        >
          <ChevronUp className="size-2.5" aria-hidden="true" />
        </Button>
        <Button
          type="button"
          variant="ghost"
          tabIndex={-1}
          data-iori-action="limit-decrease"
          aria-label={`${label}: ${t("Decrease limit")}`}
          disabled={Number(displayed || 0) <= min}
          className="h-3.5 w-5 rounded-xs p-0 text-muted-foreground hover:text-foreground"
          onPointerDown={(event) => event.preventDefault()}
          onClick={() => {
            input.current?.focus();
            step(-1);
          }}
        >
          <ChevronDown className="size-2.5" aria-hidden="true" />
        </Button>
      </div>
    </div>
  );
}

export function AgentSettings({
  host,
  initialArguments,
  onSaved,
  cli,
  models,
  limits: stored,
  onChange: persist,
  registerEditor,
}: {
  host: string;
  initialArguments?: string;
  onSaved: () => void;
  cli: string;
  models: string[];
  limits: Record<string, string>;
  onChange: (next: Record<string, string>) => Promise<boolean>;
  registerEditor?: RegisterSettingsEditor;
}) {
  const { t } = useI18n();
  const [argumentsValue, setArguments] = useState(initialArguments ?? "");
  const argumentsBaseline = useRef(initialArguments ?? "");
  const argumentsDraft = useRef(argumentsValue);
  argumentsDraft.current = argumentsValue;
  useEffect(() => {
    if (argumentsDraft.current === argumentsBaseline.current)
      setArguments(initialArguments ?? "");
    argumentsBaseline.current = initialArguments ?? "";
  }, [initialArguments]);
  const [limits, onChange] = useState(stored);
  const baseline = useRef(stored);
  const draft = useRef(limits);
  draft.current = limits;
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<"saved" | "error">();
  const saveRowRef = useRef<HTMLDivElement>(null);

  const cliLimits = (values: Record<string, string>) =>
    JSON.stringify(
      Object.entries(values)
        .filter(([key]) => limitTarget(key).cli === cli)
        .sort(([a], [b]) => a.localeCompare(b)),
    );

  useSettingsEditor(
    () =>
      argumentsDraft.current !== argumentsBaseline.current ||
      cliLimits(draft.current) !== cliLimits(baseline.current),
    registerEditor,
    () => {
      setArguments(argumentsBaseline.current);
      onChange(baseline.current);
      setStatus(undefined);
    },
  );

  useEffect(() => {
    // Saving may publish optimistic limits and then roll them back. Neither
    // update is a new baseline for the user's draft until saving settles.
    if (busy) return;
    if (cliLimits(draft.current) === cliLimits(baseline.current))
      onChange(stored);
    baseline.current = stored;
  }, [stored, busy]);

  useEffect(() => {
    if (status) saveRowRef.current?.scrollIntoView({ block: "nearest" });
  }, [status]);

  const save = async () => {
    if (busy) return;
    const submitted = limits;
    setBusy(true);
    setStatus(undefined);
    const next = Object.fromEntries(
      Object.entries(stored).filter(([key]) => limitTarget(key).cli !== cli),
    );
    for (const [key, value] of Object.entries(submitted))
      if (limitTarget(key).cli === cli) next[key] = value;
    let argumentsSaved = true;
    if (initialArguments !== undefined) {
      try {
        const response = await connection.requestHost(
          host,
          "cli.arguments.set",
          { cliId: cli, arguments: argumentsValue },
        );
        argumentsSaved = !!response?.ok;
        if (response?.ok) {
          argumentsBaseline.current = response.result.arguments;
          onSaved();
        }
      } catch {
        argumentsSaved = false;
      }
    }
    const saved = await persist(next);
    if (saved) {
      baseline.current = submitted;
      if (
        argumentsSaved &&
        argumentsDraft.current === argumentsBaseline.current &&
        cliLimits(draft.current) === cliLimits(submitted)
      )
        setStatus("saved");
      else if (!argumentsSaved) setStatus("error");
    } else setStatus("error");
    setBusy(false);
  };

  const cliName = useCliName();
  const modelLabel = useModelLabel();
  const [open, setOpen] = useState(false);
  const [editingEmpty, setEditingEmpty] = useState<string | null>(null);
  const focusAfterClose = useRef<string | null>(null);
  const baseId = useId();
  const inputId = (key: string) => `${baseId}-${encodeURIComponent(key)}`;
  const configured = Object.keys(limits)
    .filter((key) => {
      const target = limitTarget(key);
      return (
        target.cli === cli &&
        target.kind !== "cli" &&
        (limits[key] !== "" || editingEmpty === key)
      );
    })
    .map((key) => ({ key, ...limitTarget(key) }));
  const providerNames = new Set(
    configured
      .filter((target) => target.kind === "provider")
      .map((target) => target.name),
  );
  const modelNames = configured
    .filter((target) => target.kind === "model")
    .map((target) => target.name)
    .sort((a, b) => a.localeCompare(b));
  modelNames.forEach((model) => {
    const provider = modelProvider(model);
    if (provider) providerNames.add(provider);
  });
  const remove = (key: string) => {
    setStatus(undefined);
    const next = { ...limits };
    delete next[key];
    onChange(next);
    if (editingEmpty === key) setEditingEmpty(null);
  };
  const update = (key: string, value: string) => {
    setStatus(undefined);
    setEditingEmpty(value === "" ? key : null);
    onChange({ ...limits, [key]: value });
  };

  const row = (
    name: string,
    key: string,
    indent: "none" | "provider" | "model" | "nested-model" = "none",
  ) => {
    const displayLabel =
      limitTarget(key).kind === "model" ? modelLabel(cli, name) : name;
    return (
      <div
        key={key}
        className={cn(
          "flex flex-wrap items-center justify-between gap-x-3 gap-y-1.5 py-2",
          indent === "provider" && "pl-2",
          indent === "model" && "pl-2",
          indent === "nested-model" && "pl-5",
        )}
      >
        <span
          className={cn(
            "min-w-0 flex-1 text-xs [overflow-wrap:anywhere]",
            indent === "provider"
              ? "font-medium text-foreground"
              : "text-foreground",
          )}
        >
          {displayLabel}
        </span>
        <div className="flex shrink-0 items-center gap-1.5">
          <AgentLimitInput
            id={inputId(key)}
            value={limits[key] ?? ""}
            label={`${cliName(cli)} ${displayLabel}`}
            onChange={(value) => update(key, value)}
            onBlur={() => {
              if (limits[key] === "") remove(key);
            }}
          />
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            className="text-muted-foreground hover:text-foreground"
            aria-label={`${t("Remove limit")} ${cliName(cli)} › ${displayLabel}`}
            disabled={!Object.hasOwn(limits, key)}
            onClick={() => remove(key)}
          >
            <X className="size-3.5" aria-hidden="true" />
          </Button>
        </div>
      </div>
    );
  };

  const statusMessage =
    status === "saved"
      ? t("Settings saved")
      : status === "error"
        ? t("Could not save CLI settings. Retry.")
        : undefined;

  return (
    <div
      className="divide-y divide-border-subtle border-t border-border-subtle"
      onChange={() => setStatus(undefined)}
      onKeyDown={(event) => saveOnEnter(event, () => void save())}
    >
      {initialArguments !== undefined && (
        <FlatSettingRow
          stacked
          className="px-4 py-3 md:pl-11"
          label={t("Startup arguments")}
          description={t(
            "Used when opening or resuming this CLI outside a team.",
          )}
        >
          <Input
            aria-label={t("Startup arguments")}
            data-iori-field="cli-arguments"
            className="font-mono text-xs"
            value={argumentsValue}
            onChange={(event) => {
              setArguments(event.target.value);
              setStatus(undefined);
            }}
          />
        </FlatSettingRow>
      )}
      <div className="flex flex-col gap-2 px-4 py-3 md:pl-11">
        <div className="text-xs font-medium text-foreground">
          {t("Concurrency limit")}
        </div>
        <div className="divide-y divide-border-subtle border-y border-border-subtle">
          {row(t("All models"), limitKey(cli, "cli"))}
          {Array.from(providerNames)
            .sort((a, b) => a.localeCompare(b))
            .map((provider) => (
              <div key={provider} className="divide-y divide-border-subtle">
                {configured.some(
                  (target) =>
                    target.kind === "provider" && target.name === provider,
                ) ? (
                  row(provider, limitKey(cli, "provider", provider), "provider")
                ) : (
                  <div className="py-1.5 pl-2 text-2xs font-medium text-muted-foreground">
                    {provider}
                  </div>
                )}
                {modelNames
                  .filter((model) => modelProvider(model) === provider)
                  .map((model) =>
                    row(model, limitKey(cli, "model", model), "nested-model"),
                  )}
              </div>
            ))}
          {modelNames
            .filter((model) => !modelProvider(model))
            .map((model) => row(model, limitKey(cli, "model", model), "model"))}
        </div>
        <div>
          <Popover open={open} onOpenChange={setOpen}>
            <PopoverTrigger asChild>
              <Button
                type="button"
                variant="outline"
                size="sm"
                aria-label={`${cliName(cli)} ${t("Add provider or model limit")}`}
              >
                <Plus className="size-3.5" aria-hidden="true" />
                {t("Add provider or model limit")}
              </Button>
            </PopoverTrigger>
            <PopoverContent
              className="w-[min(22rem,calc(100vw-2rem))] p-0"
              align="start"
              collisionPadding={16}
              onEscapeKeyDown={(event) => {
                if (event.isComposing) event.preventDefault();
              }}
              onCloseAutoFocus={(event) => {
                if (!focusAfterClose.current) return;
                event.preventDefault();
                const key = focusAfterClose.current;
                focusAfterClose.current = null;
                requestAnimationFrame(() =>
                  document.getElementById(inputId(key))?.focus(),
                );
              }}
            >
              <ModelPicker
                availableModels={{ [cli]: models }}
                limits={limits}
                onSelect={(target) => {
                  setStatus(undefined);
                  const key = limitKey(cli, target.kind, target.name);
                  setEditingEmpty(key);
                  onChange({ ...limits, [key]: "" });
                  focusAfterClose.current = key;
                  setOpen(false);
                }}
              />
            </PopoverContent>
          </Popover>
        </div>
      </div>
      <div
        ref={saveRowRef}
        className="flex flex-wrap items-center justify-between gap-2 px-4 py-3 md:pl-11"
      >
        <div
          role={status === "error" ? "alert" : "status"}
          data-iori-state={status === "saved" ? "saved" : undefined}
          className={cn(
            "min-w-0 text-xs [overflow-wrap:anywhere]",
            status === "error"
              ? "text-status-failed-text"
              : "text-status-running-text",
          )}
        >
          {statusMessage}
        </div>
        <Button
          type="button"
          size="sm"
          pending={busy}
          data-iori-action="save-cli-settings"
          onClick={() => void save()}
        >
          {t("Save")}
        </Button>
      </div>
    </div>
  );
}
