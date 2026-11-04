import { useEffect, useRef } from "react";
import { connection } from "../connection.ts";

/**
 * While `enabled` (a View shows a failed Forge read), calls `onChange` when a
 * Forgejo/Gitea token of the Host is registered, replaced or removed, so the
 * View reads again without its reload (forge.md「読み直し」).
 */
export function useForgeTokenChange(
  hostKey: string,
  enabled: boolean,
  onChange: () => void,
) {
  const latest = useRef(onChange);
  latest.current = onChange;
  useEffect(() => {
    if (!enabled) return;
    const stop = connection.subscribeHostEvents((host, event) => {
      if (host === hostKey && event.type === "forge.token.changed")
        latest.current();
    });
    return () => {
      stop();
    };
  }, [hostKey, enabled]);
}
