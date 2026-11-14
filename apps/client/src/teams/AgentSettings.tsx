import {
  useSettingsEditor,
  type RegisterSettingsEditor,
} from "../settings-save.ts";
import {
  SectionSave,
  FieldRow,
  saveOnEnter,
} from "../components/page-layout.tsx";
import { limitKey, limitTarget } from "@iori/protocol";
import { useEffect, useId, useRef, useState } from "react";
import { Plus, X } from "lucide-react";
import { connection } from "../connection.ts";
import { Input } from "../components/ui/input.tsx";
import { Button } from "../components/ui/button.tsx";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "../components/ui/popover.tsx";
import { SettingsRow, LimitInput } from "./SettingsRow.tsx";
import { ModelPicker } from "./ModelPicker.tsx";
import { modelProvider } from "./model-catalog.ts";
import { useI18n, useCliName, useModelLabel } from "./context.tsx";

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
  const row = (name: string, key: string, className = "") => (
    <SettingsRow
      key={key}
      label={limitTarget(key).kind === "model" ? modelLabel(cli, name) : name}
      className={`team-agent-limit-setting ${className}`}
    >
      <LimitInput
        id={inputId(key)}
        value={limits[key] ?? ""}
        label={`${cliName(cli)} ${limitTarget(key).kind === "model" ? modelLabel(cli, name) : name}`}
        onChange={(value) => update(key, value)}
        onBlur={() => {
          if (limits[key] === "") remove(key);
        }}
      />
      <Button
        variant="ghost"
        size="icon-sm"
        aria-label={`${t("Remove limit")} ${cliName(cli)} › ${limitTarget(key).kind === "model" ? modelLabel(cli, name) : name}`}
        disabled={!Object.hasOwn(limits, key)}
        onClick={() => remove(key)}
      >
        <X size={14} />
      </Button>
    </SettingsRow>
  );
  return (
    <div
      className="team-agent-settings"
      onChange={() => setStatus(undefined)}
      onKeyDown={(event) => saveOnEnter(event, () => void save())}
    >
      {initialArguments !== undefined && (
        <FieldRow
          stacked
          className="field-code"
          label={t("Startup arguments")}
          description={t(
            "Used when opening or resuming this CLI outside a team.",
          )}
        >
          <Input
            aria-label={t("Startup arguments")}
            data-iori-field="cli-arguments"
            value={argumentsValue}
            onChange={(event) => {
              setArguments(event.target.value);
              setStatus(undefined);
            }}
          />
        </FieldRow>
      )}
      <div className="team-agent-limits">
        <div className="team-agent-limit-heading">{t("Concurrency limit")}</div>
        {row(t("All models"), limitKey(cli, "cli"))}
        {Array.from(providerNames)
          .sort((a, b) => a.localeCompare(b))
          .map((provider) => (
            <div className="team-limit-provider" key={provider}>
              {configured.some(
                (target) =>
                  target.kind === "provider" && target.name === provider,
              ) ? (
                row(provider, limitKey(cli, "provider", provider), "provider")
              ) : (
                <div className="team-limit-provider-label">{provider}</div>
              )}
              {modelNames
                .filter((model) => modelProvider(model) === provider)
                .map((model) =>
                  row(
                    model,
                    limitKey(cli, "model", model),
                    "model with-provider",
                  ),
                )}
            </div>
          ))}
        {modelNames
          .filter((model) => !modelProvider(model))
          .map((model) => row(model, limitKey(cli, "model", model), "model"))}
        <Popover open={open} onOpenChange={setOpen}>
          <PopoverTrigger asChild>
            <Button
              variant="outline"
              className="team-add-limit"
              aria-label={`${cliName(cli)} ${t("Add provider or model limit")}`}
            >
              <Plus size={14} />
              {t("Add provider or model limit")}
            </Button>
          </PopoverTrigger>
          <PopoverContent
            className="team-search-popover"
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
      <SectionSave
        t={t}
        state="saved"
        busy={busy}
        action="save-cli-settings"
        onSave={() => void save()}
        error={status === "error"}
        message={
          status === "saved"
            ? t("Settings saved")
            : status === "error"
              ? t("Could not save CLI settings. Retry.")
              : undefined
        }
      />
    </div>
  );
}
