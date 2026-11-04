import { useLayoutEffect, useRef } from "react";

/** Read whether a section has changes that have not been explicitly saved. */
export type SettingsEditor = { (): boolean; discard?: () => void };
export type RegisterSettingsEditor = (editor: SettingsEditor) => () => void;

export function useSettingsEditor(
  isDirty: SettingsEditor,
  register?: RegisterSettingsEditor,
  discard?: () => void,
) {
  const latest = useRef(isDirty);
  latest.current = isDirty;
  const reset = useRef(discard);
  reset.current = discard;
  useLayoutEffect(() => {
    const editor: SettingsEditor = () => latest.current();
    editor.discard = () => reset.current?.();
    return register?.(editor);
  }, [register]);
}
