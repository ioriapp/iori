import { useCallback, useEffect, useRef } from "react";

export function useSaveOnPageHide(save: () => void) {
  useEffect(() => {
    const onVisibilityChange = () => {
      if (document.visibilityState === "hidden") save();
    };
    window.addEventListener("pagehide", save);
    document.addEventListener("visibilitychange", onVisibilityChange);
    return () => {
      window.removeEventListener("pagehide", save);
      document.removeEventListener("visibilitychange", onVisibilityChange);
    };
  }, [save]);
}

/**
 * Saves a View's state with the workspace layout shortly after it changes, and
 * whatever is still unsaved at once when the View closes or its worktree is
 * left. The list width is kept apart so that dragging it does not redraw the
 * View; the returned function takes each new width.
 */
export function useSavedViewState<T extends { ratio?: number }>(
  view: T,
  onViewState?: (state: T) => void,
) {
  const report = useRef(onViewState);
  report.current = onViewState;
  const latest = useRef(view);
  latest.current = view;
  const ratio = useRef(view.ratio);
  const unsaved = useRef(false);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const save = useCallback(() => {
    clearTimeout(timer.current);
    if (!unsaved.current) return;
    unsaved.current = false;
    report.current?.({ ...latest.current, ratio: ratio.current });
  }, []);
  const saveSoon = useCallback(() => {
    unsaved.current = true;
    clearTimeout(timer.current);
    timer.current = setTimeout(save, 250);
  }, [save]);
  useSaveOnPageHide(save);
  const shown = useRef(false);
  useEffect(() => {
    if (!shown.current) {
      shown.current = true;
      return;
    }
    saveSoon();
  }, [view, saveSoon]);
  useEffect(() => save, [save]);
  return useCallback(
    (value: number) => {
      ratio.current = value;
      saveSoon();
    },
    [saveSoon],
  );
}
