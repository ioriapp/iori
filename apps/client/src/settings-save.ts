import { useLayoutEffect, useRef } from "react";

/** Read whether a section has changes that have not been explicitly saved. */
export type SettingsEditor = {
  (): boolean;
  discard?: () => void;
  save?: () => Promise<boolean>;
};
export type RegisterSettingsEditor = (editor: SettingsEditor) => () => void;

export function useSettingsEditor(
  isDirty: SettingsEditor,
  register?: RegisterSettingsEditor,
  discard?: () => void,
  save?: () => Promise<boolean>,
) {
  const latest = useRef(isDirty);
  latest.current = isDirty;
  const reset = useRef(discard);
  reset.current = discard;
  const commit = useRef(save);
  commit.current = save;
  const hasSave = Boolean(save);
  useLayoutEffect(() => {
    const editor: SettingsEditor = () => latest.current();
    editor.discard = () => reset.current?.();
    if (hasSave) {
      editor.save = () => commit.current?.() ?? Promise.resolve(true);
    }
    return register?.(editor);
  }, [register, hasSave]);
}
