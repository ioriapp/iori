import { useSyncExternalStore } from "react";
import { connection } from "./connection.ts";

/** Shared by seen/notification decisions: a displayed pane is seen only in a
 * visible, focused Client window; keyboard focus within the pane is irrelevant. */
export function isClientWindowForeground(): boolean {
  return (
    connection.getSnapshot().foreground &&
    document.visibilityState === "visible" &&
    document.hasFocus()
  );
}
function subscribe(changed: () => void) {
  const stop = connection.subscribe(changed);
  window.addEventListener("focus", changed);
  window.addEventListener("blur", changed);
  document.addEventListener("visibilitychange", changed);
  return () => {
    stop();
    window.removeEventListener("focus", changed);
    window.removeEventListener("blur", changed);
    document.removeEventListener("visibilitychange", changed);
  };
}
export function useClientWindowForeground(): boolean {
  return useSyncExternalStore(subscribe, isClientWindowForeground);
}
