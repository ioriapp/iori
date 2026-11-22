import { useEffect, useRef, useState } from "react";
import type { ReactNode } from "react";
import { Command as CommandPrimitive } from "cmdk";
import { Minus, Plus, RotateCcw } from "lucide-react";
import {
  FieldRow,
  SectionSave,
  SettingsSection as Section,
} from "../components/page-layout.tsx";
import { Button } from "../components/ui/button.tsx";
import {
  Command,
  CommandItem,
  CommandList,
} from "../components/ui/command.tsx";
import { Input } from "../components/ui/input.tsx";
import {
  Popover,
  PopoverAnchor,
  PopoverContent,
} from "../components/ui/popover.tsx";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "../components/ui/select.tsx";
import { Switch } from "../components/ui/switch.tsx";
import { native } from "../native.ts";
import { NewWorktreeLayoutSettings } from "../NewWorktreeLayoutSettings.tsx";
import type { RegisterSettingsEditor } from "../settings-save.ts";
import type { TerminalLinkOpen } from "../terminal/link-click.ts";
import { TERMINAL_FONT_SIZES } from "../terminal/terminal-font-size.ts";
import {
  UI_FONT_DEFAULT,
  UI_FONT_MAX,
  UI_FONT_MIN,
  useSaveableSettingsEditor,
  type Preferences,
  type Translate,
} from "./shared.tsx";

function TerminalFontSettings({
  value: savedValue,
  onSave,
  t,
  registerEditor,
  mobile,
}: {
  value: string;
  onSave: (value: string) => Promise<boolean | void>;
  t: Translate;
  registerEditor: RegisterSettingsEditor;
  mobile: boolean;
}) {
  const [value, setValue] = useState(savedValue);
  const saved = useRef(savedValue);
  const draft = useRef(savedValue);
  draft.current = value;
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string>();
  const [error, setError] = useState(false);
  const [families, setFamilies] = useState<string[]>([]);
  const [suggestionsOpen, setSuggestionsOpen] = useState(false);
  const [selectedFont, setSelectedFont] = useState("");
  const [unselectedVersion, setUnselectedVersion] = useState(0);
  const selectingFont = useRef(false);
  const [input, setInput] = useState<HTMLInputElement | null>(null);

  useEffect(() => {
    if (mobile) return;
    let active = true;
    void native.fontFamilies().then(
      (names) => {
        if (active) setFamilies(names);
      },
      () => undefined,
    );
    return () => {
      active = false;
    };
  }, [mobile]);

  const dirty = value !== saved.current;

  const discard = () => {
    draft.current = saved.current;
    setValue(saved.current);
    setMessage(undefined);
    setError(false);
  };

  const save = async (): Promise<boolean> => {
    if (busy) return false;
    const raw = draft.current;
    const submitted = raw.trim();
    setBusy(true);
    setMessage(undefined);
    setError(false);
    try {
      const ok = await onSave(submitted);
      if (ok === false) throw new Error();
      saved.current = submitted;
      // Keep edits made while the save was in progress.
      setValue((current) => (current === raw ? submitted : current));
      if (draft.current === raw) draft.current = submitted;
      setMessage(t("Settings saved"));
      return true;
    } catch {
      setError(true);
      setMessage(t("Could not save. Press Save or Enter to retry."));
      return false;
    } finally {
      setBusy(false);
    }
  };

  useSaveableSettingsEditor(
    dirty,
    () => draft.current !== saved.current,
    registerEditor,
    discard,
    save,
  );

  const fragment = value
    .slice(value.lastIndexOf(",") + 1)
    .trim()
    .toLowerCase();
  const matches = families.filter((name) =>
    name.toLowerCase().includes(fragment),
  );
  const completed = families.some((name) => name.toLowerCase() === fragment);
  const shown = !mobile && suggestionsOpen && matches.length > 0 && !completed;
  const clearSelection = () => {
    selectingFont.current = false;
    setSelectedFont("");
    // cmdk may select the first remaining item after removing the selected
    // one. Change the controlled value even when already unselected so its
    // internal value and selection styling are reset too.
    setUnselectedVersion((version) => version + 1);
  };
  const startSelection = () => {
    selectingFont.current = true;
    // cmdk reports keyboard/pointer selection synchronously during the event.
    // An event that leaves the selection unchanged must not authorize a later
    // automatic selection when items mount or unmount.
    queueMicrotask(() => {
      selectingFont.current = false;
    });
  };
  const change = (next: string) => {
    draft.current = next;
    setValue(next);
    clearSelection();
    setMessage(undefined);
    setError(false);
  };
  const choose = (name: string) => {
    const comma = value.lastIndexOf(",");
    change(comma < 0 ? name : value.slice(0, comma + 1) + " " + name);
    setSuggestionsOpen(false);
  };
  const label = t("Font name");

  return (
    <Section
      title={t("Terminal font")}
      onSave={() => {
        if (dirty || error) void save();
      }}
    >
      <FieldRow
        stacked
        label={<label htmlFor={input?.id}>{label}</label>}
        description={
          <span id="terminal-font-help">
            {t(
              "To use several fonts, separate them with commas. The first font installed on this device is used; if the field is empty or none are installed, the default font is used.",
            )}
          </span>
        }
      >
        <Command
          label={label}
          shouldFilter={false}
          // A nonempty value absent from font names suppresses cmdk's initial
          // automatic selection. NUL cannot occur in an installed font name.
          value={selectedFont || `\u0000${unselectedVersion}`}
          onValueChange={(name) => {
            if (selectingFont.current) {
              selectingFont.current = false;
              setSelectedFont(name);
            } else {
              clearSelection();
            }
          }}
          loop={!selectedFont}
          className="h-auto w-full overflow-visible rounded-none bg-transparent p-0"
          onKeyDown={(event) => {
            if (event.nativeEvent.isComposing) return;
            if (["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) {
              startSelection();
            }
            if (event.key === "Escape" && shown) {
              event.preventDefault();
              event.stopPropagation();
              setSuggestionsOpen(false);
            } else if (event.key === "Enter") {
              event.stopPropagation();
              if (!shown || !selectedFont) {
                event.preventDefault();
                setSuggestionsOpen(false);
                if (dirty || error) void save();
              }
            }
          }}
        >
          <Popover open={shown} onOpenChange={setSuggestionsOpen}>
            <PopoverAnchor asChild>
              <CommandPrimitive.Input
                asChild
                // Filtering is handled above. Keeping cmdk's search empty
                // avoids its automatic first-item selection on search changes.
                value=""
                onValueChange={(next) => {
                  change(next);
                  setSuggestionsOpen(true);
                }}
                onFocus={() => {
                  clearSelection();
                  setSuggestionsOpen(true);
                }}
                onBlur={() => setSuggestionsOpen(false)}
                aria-describedby="terminal-font-help"
              >
                <Input
                  // cmdk finds and focuses its input by the ID it generates.
                  ref={setInput}
                  value={value}
                  {...(!selectedFont && { "aria-activedescendant": undefined })}
                  data-iori-field="terminal-font-family"
                  placeholder="JetBrains Mono"
                  aria-expanded={shown}
                  className="max-md:text-base"
                />
              </CommandPrimitive.Input>
            </PopoverAnchor>
            <PopoverContent
              className="z-(--z-toast) max-h-[min(14.5rem,var(--radix-popover-content-available-height))] w-(--radix-popover-trigger-width) gap-0 p-1"
              align="start"
              side="bottom"
              sideOffset={4}
              onOpenAutoFocus={(event) => event.preventDefault()}
              onCloseAutoFocus={(event) => event.preventDefault()}
              onInteractOutside={(event) => {
                if (event.target === input) event.preventDefault();
              }}
              onEscapeKeyDown={(event) => {
                event.preventDefault();
                event.stopPropagation();
                setSuggestionsOpen(false);
              }}
            >
              <CommandList
                label={label}
                className="max-h-[inherit] min-h-0 [scrollbar-width:thin]"
              >
                {matches.map((name) => (
                  <CommandItem
                    key={name}
                    value={name}
                    onPointerMoveCapture={startSelection}
                    onPointerDown={(event) => event.preventDefault()}
                    onSelect={() => choose(name)}
                  >
                    {name}
                  </CommandItem>
                ))}
              </CommandList>
            </PopoverContent>
          </Popover>
        </Command>
      </FieldRow>
      <SectionSave
        t={t}
        busy={busy}
        dirty={dirty}
        error={error}
        message={message}
        state="terminal-font-saved"
        action="save-terminal-font"
        onDiscard={discard}
        onSave={() => void save()}
        buttonClassName="max-md:min-h-11"
      />
    </Section>
  );
}

export function DisplaySettings({
  preferences,
  isNativeMobile,
  isNarrowViewport,
  onPreferencesChange,
  onTerminalFontSave,
  preferenceError,
  registerEditor,
  t,
}: {
  preferences: Preferences;
  isNativeMobile: boolean;
  isNarrowViewport: boolean;
  onPreferencesChange: (change: Partial<Preferences>) => void;
  onTerminalFontSave: (value: string) => Promise<boolean | void>;
  preferenceError: (field: string) => ReactNode;
  registerEditor: RegisterSettingsEditor;
  t: Translate;
}) {
  const selectRow = (
    label: string,
    value: string,
    options: [string, string, string?][],
    onValueChange: (next: string) => void,
    action: string,
    field: string,
    description?: string,
  ) => (
    <FieldRow
      label={t(label)}
      description={description ? t(description) : undefined}
      error={preferenceError(field)}
    >
      <Select value={value} onValueChange={onValueChange}>
        <SelectTrigger
          className="w-56 max-w-full max-sm:w-full"
          aria-label={t(label)}
          data-iori-action={action}
        >
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {options.map(([optionValue, optionLabel, option]) => (
            <SelectItem
              key={optionValue}
              value={optionValue}
              data-iori-option={option}
            >
              {t(optionLabel)}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </FieldRow>
  );

  return (
    <>
      <Section>
        {selectRow(
          "Display language",
          preferences.language,
          [
            ["system", "System default", "language-system"],
            ["en", "English", "language-en"],
            ["ja", "日本語", "language-ja"],
          ],
          (value) =>
            onPreferencesChange({
              language: value as Preferences["language"],
            }),
          "display-language",
          "language",
        )}
        {selectRow(
          "Theme",
          preferences.theme,
          [
            ["light", "Light", "theme-light"],
            ["system", "System default", "theme-system"],
            ["dark", "Dark", "theme-dark"],
          ],
          (value) =>
            onPreferencesChange({
              theme: value as Preferences["theme"],
            }),
          "display-theme",
          "theme",
        )}
        <FieldRow label={t("Text size")} error={preferenceError("fontSize")}>
          {preferences.fontSize !== UI_FONT_DEFAULT && (
            <Button
              type="button"
              variant="ghost"
              size="xs"
              data-iori-action="display-text-size-reset"
              onClick={() => onPreferencesChange({ fontSize: UI_FONT_DEFAULT })}
              className="text-muted-foreground hover:text-foreground"
            >
              <RotateCcw className="size-3" aria-hidden="true" />
              {t("Reset to default")}
            </Button>
          )}
          <div
            role="group"
            aria-label={t("Text size")}
            data-iori-field="display-text-size"
            className="inline-flex h-8 items-center overflow-hidden rounded-md border border-input bg-card"
          >
            <button
              type="button"
              disabled={preferences.fontSize <= UI_FONT_MIN}
              onClick={() =>
                onPreferencesChange({
                  fontSize: Math.max(UI_FONT_MIN, preferences.fontSize - 1),
                })
              }
              aria-label={t("Decrease text size")}
              data-iori-action="display-text-size-decrease"
              className="inline-flex h-full w-8 cursor-pointer items-center justify-center text-foreground transition-colors hover:bg-accent focus-visible:bg-accent disabled:pointer-events-none disabled:opacity-35"
            >
              <Minus className="size-3.5" aria-hidden="true" />
            </button>
            <span
              data-iori-value="display-text-size"
              className="min-w-22 border-x border-border-subtle px-2 text-center font-mono text-xs font-medium tabular-nums text-foreground"
            >
              {preferences.fontSize}px (
              {Math.round((preferences.fontSize / UI_FONT_DEFAULT) * 100)}%)
            </span>
            <button
              type="button"
              disabled={preferences.fontSize >= UI_FONT_MAX}
              onClick={() =>
                onPreferencesChange({
                  fontSize: Math.min(UI_FONT_MAX, preferences.fontSize + 1),
                })
              }
              aria-label={t("Increase text size")}
              data-iori-action="display-text-size-increase"
              className="inline-flex h-full w-8 cursor-pointer items-center justify-center text-foreground transition-colors hover:bg-accent focus-visible:bg-accent disabled:pointer-events-none disabled:opacity-35"
            >
              <Plus className="size-3.5" aria-hidden="true" />
            </button>
          </div>
        </FieldRow>
        {selectRow(
          "Usage display",
          preferences.usageDisplay ?? "used",
          [
            ["remaining", "Remaining"],
            ["used", "Used"],
          ],
          (value) =>
            onPreferencesChange({
              usageDisplay: value as Preferences["usageDisplay"],
            }),
          "usage-display",
          "usageDisplay",
          "Choose whether usage limits show the percentage remaining or used.",
        )}
        {selectRow(
          "Usage graph",
          preferences.usageGraph ?? "bar",
          [
            ["bar", "Bar"],
            ["circle", "Circle"],
          ],
          (value) =>
            onPreferencesChange({
              usageGraph: value as Preferences["usageGraph"],
            }),
          "usage-graph",
          "usageGraph",
          "Choose the shape of usage graphs in the status bar and popovers.",
        )}
        {selectRow(
          "Terminal text size",
          String(preferences.terminalFontSize),
          TERMINAL_FONT_SIZES.map((size) => [
            String(size),
            String(size),
            `terminal-size-${size}`,
          ]),
          (value) =>
            onPreferencesChange({
              terminalFontSize: Number(value),
            }),
          "terminal-text-size",
          "terminalFontSize",
        )}
        {/* A touch screen has no right-click and opens links by tap. */}
        {!isNativeMobile && (
          <>
            {selectRow(
              "Right-click",
              preferences.terminalRightClick,
              [
                ["menu", "Menu", "right-click-menu"],
                ["copyPaste", "Copy/paste", "right-click-copy-paste"],
              ],
              (value) =>
                onPreferencesChange({
                  terminalRightClick:
                    value as Preferences["terminalRightClick"],
                }),
              "terminal-right-click",
              "terminalRightClick",
            )}
            {selectRow(
              "Open links",
              preferences.terminalLinkOpen,
              [
                ["click", "Click", "link-open-click"],
                ["ctrlClick", "Ctrl+click", "link-open-ctrl-click"],
              ],
              (value) =>
                onPreferencesChange({
                  terminalLinkOpen: value as TerminalLinkOpen,
                }),
              "terminal-link-open",
              "terminalLinkOpen",
              "Links in Terminal and CLI screens",
            )}
          </>
        )}
        <FieldRow
          label={t("Show PR and CI status")}
          error={preferenceError("showForgeStatus")}
        >
          <Switch
            checked={preferences.showForgeStatus !== false}
            onCheckedChange={(checked) =>
              onPreferencesChange({ showForgeStatus: checked })
            }
            aria-label={t("Show PR and CI status")}
            data-iori-action="display-forge-status"
          />
        </FieldRow>
        <FieldRow
          label={t("Double-click a tab to maximize")}
          error={preferenceError("doubleClickMaximize")}
        >
          <Switch
            checked={preferences.doubleClickMaximize}
            onCheckedChange={(checked) =>
              onPreferencesChange({ doubleClickMaximize: checked })
            }
            aria-label={t("Double-click a tab to maximize")}
            data-iori-action="display-double-click-maximize"
          />
        </FieldRow>
      </Section>
      {!isNativeMobile && !isNarrowViewport && (
        <NewWorktreeLayoutSettings t={t} />
      )}
      <TerminalFontSettings
        value={preferences.terminalFontFamily}
        onSave={onTerminalFontSave}
        t={t}
        registerEditor={registerEditor}
        mobile={isNativeMobile || isNarrowViewport}
      />
    </>
  );
}
