import { FieldRow, SettingsSection } from "./components/page-layout.tsx";
import { useRef, useState } from "react";
import type { PointerEvent } from "react";
import { ArrowDown, ArrowUp, GripVertical, Trash2 } from "lucide-react";
import { Button } from "./components/ui/button.tsx";
import { Checkbox } from "./components/ui/checkbox.tsx";
import { Input } from "./components/ui/input.tsx";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "./components/ui/select.tsx";
import { Switch } from "./components/ui/switch.tsx";
import {
  normalizeShortcutKeyInput,
  TERMINAL_SHORTCUT_SPECIAL_KEYS,
  type TerminalShortcutModifier,
} from "./terminal/terminal-accessory-keys.ts";
import {
  customAccessoryKey,
  getDefaultTerminalAccessoryLayout,
  terminalAccessoryEntries,
  type TerminalAccessoryLayout,
  type TerminalCustomKey,
} from "./terminal/terminal-accessory-layout.ts";

const typedKey = "typed";

/** The phone key band: show, hide, reorder, reset, and add or remove keys. */
export function KeyboardSettings({
  t,
  layout,
  onChange,
}: {
  t: (key: string) => string;
  layout: TerminalAccessoryLayout;
  onChange: (layout: TerminalAccessoryLayout) => void;
}) {
  const [keyValue, setKeyValue] = useState("");
  const [specialKey, setSpecialKey] = useState(typedKey);
  const [textValue, setTextValue] = useState("");
  const [modifier, setModifier] = useState<
    Record<TerminalShortcutModifier, boolean>
  >({ ctrl: false, alt: false, shift: false });
  const [sendEnter, setSendEnter] = useState(false);
  const [keyError, setKeyError] = useState("");
  const draggedId = useRef<string | null>(null);
  const layoutRef = useRef(layout);
  layoutRef.current = layout;
  const entries = terminalAccessoryEntries(layout);

  const reorderKeys = (sourceId: string, targetId: string) => {
    const current = layoutRef.current;
    if (sourceId === targetId) return;
    const from = current.orderedIds.indexOf(sourceId);
    const to = current.orderedIds.indexOf(targetId);
    if (from < 0 || to < 0) return;
    const orderedIds = [...current.orderedIds];
    const [item] = orderedIds.splice(from, 1);
    orderedIds.splice(to, 0, item!);
    const visible = new Set(current.visibleIds);
    onChange({
      ...current,
      orderedIds,
      visibleIds: orderedIds.filter((id) => visible.has(id)),
    });
  };

  const moveKeyBy = (id: string, delta: -1 | 1) => {
    const index = entries.findIndex((entry) => entry.key.id === id);
    const target = entries[index + delta];
    if (target) reorderKeys(id, target.key.id);
  };

  const dragStart = (id: string, event: PointerEvent<HTMLButtonElement>) => {
    event.preventDefault();
    draggedId.current = id;
    event.currentTarget.setPointerCapture(event.pointerId);
  };
  const dragMove = (event: PointerEvent<HTMLButtonElement>) => {
    const source = draggedId.current;
    if (!source) return;
    const row = document
      .elementFromPoint(event.clientX, event.clientY)
      ?.closest<HTMLElement>("[data-key-id]");
    const target = row?.dataset.keyId;
    if (target) reorderKeys(source, target);
  };
  const dragEnd = (event: PointerEvent<HTMLButtonElement>) => {
    draggedId.current = null;
    if (event.currentTarget.hasPointerCapture(event.pointerId))
      event.currentTarget.releasePointerCapture(event.pointerId);
  };

  const setVisible = (id: string, visible: boolean) => {
    const shown = new Set(layout.visibleIds);
    if (visible) shown.add(id);
    else shown.delete(id);
    onChange({
      ...layout,
      visibleIds: layout.orderedIds.filter((item) => shown.has(item)),
    });
  };

  const removeKey = (id: string) =>
    onChange({
      ...layout,
      orderedIds: layout.orderedIds.filter((item) => item !== id),
      visibleIds: layout.visibleIds.filter((item) => item !== id),
      customKeys: layout.customKeys.filter((key) => key.id !== id),
      swipeUp: Object.fromEntries(
        Object.entries(layout.swipeUp).map(([source, target]) => [
          source,
          target === id ? null : target,
        ]),
      ),
    });

  const addKey = () => {
    const key =
      specialKey !== typedKey
        ? specialKey
        : normalizeShortcutKeyInput(keyValue);
    const hasKey = specialKey !== typedKey || keyValue.trim() !== "";
    if (hasKey === Boolean(textValue)) {
      setKeyError(t("Enter one key or one text string."));
      return;
    }
    const id = `custom-${crypto.randomUUID()}`;
    const added: TerminalCustomKey | undefined = textValue
      ? { id, kind: "text", text: textValue, enter: sendEnter }
      : key
        ? {
            id,
            kind: "shortcut",
            key,
            modifiers: (["ctrl", "alt", "shift"] as const).filter(
              (name) => modifier[name],
            ),
          }
        : undefined;
    if (!added || !customAccessoryKey(added)) {
      setKeyError(t("This key cannot be sent to a terminal."));
      return;
    }
    onChange({
      ...layout,
      orderedIds: [...layout.orderedIds, id],
      visibleIds: [...layout.visibleIds, id],
      customKeys: [...layout.customKeys, added],
    });
    setKeyValue("");
    setSpecialKey(typedKey);
    setTextValue("");
    setModifier({ ctrl: false, alt: false, shift: false });
    setSendEnter(false);
    setKeyError("");
  };

  return (
    <>
      <SettingsSection
        title={t("Key band")}
        description={t("Swipe up on a key to send its assigned key.")}
        actions={
          <Button
            variant="outline"
            size="sm"
            data-iori-action="keyboard-reset"
            onClick={() => {
              // Restore built-in order, visibility and swipes; added keys stay.
              const defaults = getDefaultTerminalAccessoryLayout();
              const ids = defaults.orderedIds;
              const added = layout.customKeys.map((key) => key.id);
              onChange({
                ...defaults,
                orderedIds: [...ids, ...added],
                visibleIds: [...defaults.visibleIds, ...added],
                customKeys: layout.customKeys,
              });
            }}
          >
            {t("Reset to defaults")}
          </Button>
        }
        data-iori-view="keyboard-settings"
      >
        <FieldRow label={t("Show button names")}>
          <Switch
            checked={layout.showButtonNames}
            onCheckedChange={(showButtonNames) =>
              onChange({ ...layout, showButtonNames })
            }
            aria-label={t("Show button names")}
            data-iori-field="keyboard-show-button-names"
          />
        </FieldRow>
        <div
          className="section-rows overflow-x-clip"
          role="list"
          aria-label={t("Key band")}
        >
          {entries.map(({ key, visible, custom }, index) => (
            <div
              className="flex min-h-10 items-center gap-2 py-2.5"
              key={key.id}
              role="listitem"
              data-key-id={key.id}
              data-iori-key-row={key.id}
            >
              <button
                type="button"
                className="grid size-7 shrink-0 cursor-grab touch-none place-items-center rounded-md border-0 bg-transparent text-muted-foreground transition-colors outline-none hover:bg-sidebar-accent hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/40 active:cursor-grabbing"
                aria-label={`${key.label} ${t("Drag to reorder")}`}
                title={t("Drag to reorder")}
                onPointerDown={(event) => dragStart(key.id, event)}
                onPointerMove={dragMove}
                onPointerUp={dragEnd}
                onPointerCancel={dragEnd}
                onLostPointerCapture={() => {
                  draggedId.current = null;
                }}
                onKeyDown={(event) => {
                  if (event.key === "ArrowUp") {
                    event.preventDefault();
                    moveKeyBy(key.id, -1);
                  } else if (event.key === "ArrowDown") {
                    event.preventDefault();
                    moveKeyBy(key.id, 1);
                  }
                }}
              >
                <GripVertical className="size-3.5" aria-hidden="true" />
              </button>
              <code className="min-w-0 flex-1 truncate font-mono text-sm text-foreground">
                {key.label}
              </code>
              <div className="flex shrink-0 items-center gap-0.5">
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-xs"
                  disabled={index === 0}
                  aria-label={`${key.label} ${t("Move up")}`}
                  title={t("Move up")}
                  data-iori-action="keyboard-key-move-up"
                  onClick={() => moveKeyBy(key.id, -1)}
                >
                  <ArrowUp className="size-3.5" aria-hidden="true" />
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-xs"
                  disabled={index === entries.length - 1}
                  aria-label={`${key.label} ${t("Move down")}`}
                  title={t("Move down")}
                  data-iori-action="keyboard-key-move-down"
                  onClick={() => moveKeyBy(key.id, 1)}
                >
                  <ArrowDown className="size-3.5" aria-hidden="true" />
                </Button>
              </div>
              {!custom && (
                <Select
                  value={layout.swipeUp[key.id] ?? "none"}
                  onValueChange={(value) =>
                    onChange({
                      ...layout,
                      swipeUp: {
                        ...layout.swipeUp,
                        [key.id]: value === "none" ? null : value,
                      },
                    })
                  }
                >
                  <SelectTrigger
                    size="sm"
                    className="w-24 shrink-0"
                    aria-label={`${key.label} ${t("Swipe up")}`}
                    data-iori-swipe-key={key.id}
                  >
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">{t("None")}</SelectItem>
                    {entries.map(({ key: target }) => (
                      <SelectItem key={target.id} value={target.id}>
                        {target.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
              {custom && (
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-sm"
                  aria-label={`${key.label} ${t("Remove")}`}
                  title={t("Remove")}
                  data-iori-action="keyboard-key-remove"
                  onClick={() => removeKey(key.id)}
                >
                  <Trash2 className="size-3.5" aria-hidden="true" />
                </Button>
              )}
              <Switch
                checked={visible}
                onCheckedChange={(value) => setVisible(key.id, value)}
                aria-label={`${key.label} ${t(visible ? "Show key" : "Hide key")}`}
              />
            </div>
          ))}
        </div>
      </SettingsSection>
      <SettingsSection title={t("Add a key")}>
        <div className="grid grid-cols-1 gap-3 md:grid-cols-[minmax(0,1fr)_auto] md:items-end">
          <div className="grid min-w-0 gap-1.5">
            <label
              htmlFor="keyboard-key-value"
              className="text-sm font-medium text-foreground"
            >
              {t("Key")}
            </label>
            <div className="flex min-w-0 gap-2">
              <Input
                id="keyboard-key-value"
                value={keyValue}
                disabled={specialKey !== typedKey}
                onChange={(event) => setKeyValue(event.target.value)}
                placeholder="k"
                data-iori-field="keyboard-key"
              />
              <Select value={specialKey} onValueChange={setSpecialKey}>
                <SelectTrigger
                  className="w-36 shrink-0 max-md:w-32"
                  aria-label={t("Special key")}
                >
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={typedKey}>
                    {t("Typed character")}
                  </SelectItem>
                  {TERMINAL_SHORTCUT_SPECIAL_KEYS.map((special) => (
                    <SelectItem key={special.id} value={special.id}>
                      {special.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          <div
            className="flex min-h-8 flex-wrap items-center gap-3"
            aria-label={t("Modifiers")}
          >
            {(["ctrl", "alt", "shift"] as const).map((name) => (
              <label
                key={name}
                className="inline-flex items-center gap-1.5 text-xs text-muted-foreground whitespace-nowrap"
              >
                <Checkbox
                  checked={modifier[name]}
                  onCheckedChange={(checked) =>
                    setModifier((current) => ({
                      ...current,
                      [name]: checked === true,
                    }))
                  }
                />
                {name === "ctrl" ? "Ctrl" : name === "alt" ? "Alt" : "Shift"}
              </label>
            ))}
          </div>
          <div className="grid min-w-0 gap-1.5">
            <label
              htmlFor="keyboard-key-text"
              className="text-sm font-medium text-foreground"
            >
              {t("Text")}
            </label>
            <Input
              id="keyboard-key-text"
              value={textValue}
              onChange={(event) => setTextValue(event.target.value)}
              placeholder="/help"
              data-iori-field="keyboard-text"
            />
          </div>
          <label className="inline-flex min-h-8 items-center gap-1.5 justify-self-start text-xs text-muted-foreground whitespace-nowrap">
            <Checkbox
              checked={sendEnter}
              data-iori-field="keyboard-send-enter"
              onCheckedChange={(checked) => setSendEnter(checked === true)}
            />
            {t("Send Enter")}
          </label>
          {keyError && (
            <span
              className="col-span-full text-xs text-status-failed-text"
              role="alert"
            >
              {keyError}
            </span>
          )}
          <div className="col-span-full flex justify-start">
            <Button
              type="button"
              variant="outline"
              size="sm"
              data-iori-action="keyboard-key-add"
              onClick={addKey}
            >
              {t("Add")}
            </Button>
          </div>
        </div>
      </SettingsSection>
    </>
  );
}
