import {
  buildTerminalShortcutKey,
  TERMINAL_ACCESSORY_KEYS,
  type TerminalAccessoryKey,
  type TerminalShortcutModifier,
} from "./terminal-accessory-keys.ts";

/** A key the user added to the band: a modifier combination or a fixed text. */
export type TerminalCustomKey =
  | {
      id: string;
      kind: "shortcut";
      key: string;
      modifiers: TerminalShortcutModifier[];
    }
  | { id: string; kind: "text"; text: string; enter: boolean };

/**
 * The band's keys in order. Built-in and added keys share one order and one
 * visibility list; added keys are kept in customKeys.
 */
export type TerminalAccessoryLayout = {
  showButtonNames: boolean;
  orderedIds: string[];
  visibleIds: string[];
  customKeys: TerminalCustomKey[];
  swipeUp: Record<string, string | null>;
};

const MODIFIERS: TerminalShortcutModifier[] = ["ctrl", "alt", "shift"];

// The definitions list the built-in keys in the band's default order.
function builtInIds() {
  return TERMINAL_ACCESSORY_KEYS.map((key) => key.id);
}

export function getDefaultTerminalAccessoryLayout(): TerminalAccessoryLayout {
  const ids = builtInIds();
  return {
    showButtonNames: true,
    orderedIds: ids,
    visibleIds: TERMINAL_ACCESSORY_KEYS.filter((key) => !key.defaultHidden).map(
      (key) => key.id,
    ),
    customKeys: [],
    swipeUp: {
      arrowUp: "pageUp",
      arrowDown: "pageDown",
      arrowLeft: "home",
      arrowRight: "end",
    },
  };
}

/** Builds the key the band sends for an added key, or undefined if unusable. */
export function customAccessoryKey(
  key: TerminalCustomKey,
): TerminalAccessoryKey | undefined {
  if (key.kind === "shortcut") {
    const built = buildTerminalShortcutKey({
      key: key.key,
      modifiers: key.modifiers,
    });
    return built
      ? {
          id: key.id,
          ...built,
          shortcut: { key: key.key, modifiers: key.modifiers },
        }
      : undefined;
  }
  if (!key.text) return undefined;
  const label = [...key.text].slice(0, 12).join("");
  return {
    id: key.id,
    label: key.enter ? `${label} ↵` : label,
    bytes: key.enter ? `${key.text}\r` : key.text,
    accessibilityLabel: key.text,
  };
}

function readCustomKey(value: unknown): TerminalCustomKey | undefined {
  if (!value || typeof value !== "object") return undefined;
  const candidate = value as Record<string, unknown>;
  if (typeof candidate.id !== "string" || !candidate.id) return undefined;
  if (candidate.kind === "shortcut") {
    if (
      typeof candidate.key !== "string" ||
      !Array.isArray(candidate.modifiers)
    )
      return undefined;
    const modifiers = MODIFIERS.filter((modifier) =>
      (candidate.modifiers as unknown[]).includes(modifier),
    );
    const key: TerminalCustomKey = {
      id: candidate.id,
      kind: "shortcut",
      key: candidate.key,
      modifiers,
    };
    return customAccessoryKey(key) ? key : undefined;
  }
  if (candidate.kind === "text") {
    if (typeof candidate.text !== "string" || !candidate.text) return undefined;
    return {
      id: candidate.id,
      kind: "text",
      text: candidate.text,
      enter: candidate.enter === true,
    };
  }
  return undefined;
}

// Saved preferences are read leniently: unknown keys are dropped and missing
// built-in keys return at the end, so a saved band never blocks the band.
export function normalizeTerminalAccessoryLayout(
  value: unknown,
): TerminalAccessoryLayout {
  const fallback = getDefaultTerminalAccessoryLayout();
  if (!value || typeof value !== "object") return fallback;
  const candidate = value as Record<string, unknown>;
  const customKeys = Array.isArray(candidate.customKeys)
    ? candidate.customKeys.flatMap((item) => {
        const key = readCustomKey(item);
        return key ? [key] : [];
      })
    : [];
  const known = new Set([
    ...fallback.orderedIds,
    ...customKeys.map((key) => key.id),
  ]);
  const ordered = Array.isArray(candidate.orderedIds)
    ? [
        ...new Set(
          candidate.orderedIds.filter(
            (id): id is string => typeof id === "string" && known.has(id),
          ),
        ),
      ]
    : [];
  for (const id of known) if (!ordered.includes(id)) ordered.push(id);
  const visible = Array.isArray(candidate.visibleIds)
    ? new Set(candidate.visibleIds.filter((id) => typeof id === "string"))
    : new Set(ordered);
  return {
    showButtonNames: candidate.showButtonNames !== false,
    orderedIds: ordered,
    visibleIds: ordered.filter((id) => visible.has(id)),
    customKeys,
    swipeUp: {
      ...fallback.swipeUp,
      ...(candidate.swipeUp as TerminalAccessoryLayout["swipeUp"] | undefined),
    },
  };
}

/** Every key of the layout in band order, with whether it is shown. */
export function terminalAccessoryEntries(layout: TerminalAccessoryLayout) {
  const builtIn = new Map(TERMINAL_ACCESSORY_KEYS.map((key) => [key.id, key]));
  const custom = new Map(layout.customKeys.map((key) => [key.id, key]));
  const visible = new Set(layout.visibleIds);
  return layout.orderedIds.flatMap((id) => {
    const added = custom.get(id);
    const key = added ? customAccessoryKey(added) : builtIn.get(id);
    return key
      ? [{ key, visible: visible.has(id), custom: Boolean(added) }]
      : [];
  });
}

export function getVisibleTerminalAccessoryKeys(
  layout: TerminalAccessoryLayout,
) {
  return terminalAccessoryEntries(layout).flatMap((entry) =>
    entry.visible ? [entry.key] : [],
  );
}
