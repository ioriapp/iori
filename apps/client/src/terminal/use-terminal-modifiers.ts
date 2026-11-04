import { useCallback, useRef, useState } from "react";
import {
  buildTerminalShortcutKey,
  type TerminalAccessoryKey,
  type TerminalShortcutModifier,
} from "./terminal-accessory-keys.ts";

/** One-shot phone modifiers, shared by xterm and both batch input fields. */
export function useTerminalModifiers(
  mobile: boolean,
  send: (bytes: string) => boolean,
) {
  const [modifiers, setModifiers] = useState<TerminalShortcutModifier[]>([]);
  const held = useRef(modifiers);
  const enabled = useRef(mobile);
  enabled.current = mobile;
  const update = useCallback((value: TerminalShortcutModifier[]) => {
    held.current = value;
    setModifiers(value);
  }, []);
  const sendKey = useCallback(
    (key: TerminalAccessoryKey) => {
      if (key.modifier) {
        update(
          held.current.includes(key.modifier)
            ? held.current.filter((modifier) => modifier !== key.modifier)
            : [...held.current, key.modifier],
        );
        return;
      }
      const binding = key.shortcut ?? { key: key.id, modifiers: [] };
      const built = held.current.length
        ? buildTerminalShortcutKey({
            key: binding.key,
            modifiers: [...binding.modifiers, ...held.current],
          })
        : null;
      if (send(built?.bytes ?? key.bytes)) update([]);
    },
    [send, update],
  );
  // xterm has already settled IME input here. The caller supplies only data
  // classified as user input, so parser replies never consume a held modifier.
  const modifyInput = useCallback(
    (data: string) => {
      if (!enabled.current || !held.current.length || !isAsciiCharacter(data))
        return data;
      const built = buildTerminalShortcutKey({
        key: data,
        modifiers: held.current,
      });
      update([]);
      return built?.bytes ?? data;
    },
    [update],
  );
  const attachInput = useCallback(
    (input: HTMLTextAreaElement) => {
      const snapshot = () => ({
        value: input.value,
        start: input.selectionStart,
        end: input.selectionEnd,
        direction: input.selectionDirection,
      });
      let before = snapshot();
      let composing = false;
      let restoring = false;
      const shortcut = (key: string | null) => {
        if (
          !enabled.current ||
          !held.current.length ||
          !key ||
          !isAsciiCharacter(key)
        )
          return null;
        const built = buildTerminalShortcutKey({
          key,
          modifiers: held.current,
        });
        // Unencodable combinations remain ordinary input, but still use up
        // the one-shot modifier (for example Ctrl+1).
        update([]);
        return built;
      };
      const consume = (key: string, event: Event) => {
        const built = shortcut(key);
        if (!built) return;
        event.preventDefault();
        event.stopImmediatePropagation();
        send(built.bytes);
      };
      const beforeInput = (event: InputEvent) => {
        if (!composing) before = snapshot();
        if (
          event.inputType === "insertText" &&
          !event.isComposing &&
          event.cancelable &&
          event.data
        )
          consume(event.data, event);
      };
      const onInput = (event: InputEvent) => {
        if (restoring) {
          event.stopImmediatePropagation();
          return;
        }
        if (
          ![
            "insertText",
            "insertCompositionText",
            "insertFromComposition",
          ].includes(event.inputType)
        )
          return;
        const built = shortcut(event.data);
        if (!built) return;
        event.stopImmediatePropagation();
        // Android composition updates cannot be cancelled in beforeinput.
        // Reconcile the DOM after input, as CodeMirror's applyDOMChange does.
        // Replacing the value and resetting focus ends the native composition;
        // ProseMirror's Android beforeinput handler also uses blur/focus to
        // reset native editing. Keep this synchronous, with no delayed retry.
        const saved = before;
        const endComposition = composing || event.isComposing;
        restoring = true;
        if (endComposition) input.blur();
        input.value = saved.value;
        input.setSelectionRange(saved.start, saved.end, saved.direction);
        composing = false;
        if (endComposition) input.focus({ preventScroll: true });
        restoring = false;
        send(built.bytes);
      };
      // Blur commits the textarea's native change event too. The consumed
      // composition must not update React's draft through that second route.
      const change = (event: Event) => {
        if (restoring) event.stopImmediatePropagation();
      };
      const keyDown = (event: KeyboardEvent) => {
        // Gboard sends Unidentified/229; its real character arrives in input.
        if (
          composing ||
          event.isComposing ||
          event.keyCode === 229 ||
          event.key.length !== 1
        )
          return;
        consume(event.key, event);
      };
      const start = () => {
        before = snapshot();
        composing = true;
      };
      const end = () => {
        composing = false;
      };
      input.addEventListener("beforeinput", beforeInput, true);
      input.addEventListener("input", onInput, true);
      input.addEventListener("change", change, true);
      input.addEventListener("keydown", keyDown, true);
      input.addEventListener("compositionstart", start);
      input.addEventListener("compositionend", end);
      return () => {
        input.removeEventListener("beforeinput", beforeInput, true);
        input.removeEventListener("input", onInput, true);
        input.removeEventListener("change", change, true);
        input.removeEventListener("keydown", keyDown, true);
        input.removeEventListener("compositionstart", start);
        input.removeEventListener("compositionend", end);
      };
    },
    [send, update],
  );
  return { modifiers, sendKey, attachInput, modifyInput };
}

function isAsciiCharacter(text: string): boolean {
  return text.length === 1 && text >= " " && text <= "~";
}
