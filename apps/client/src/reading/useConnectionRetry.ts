import { useCallback, useEffect, useRef, useState } from "react";

/** Retry a read interrupted by a lost connection, including a late failure. */
export function useConnectionRetry(refresh: number) {
  const [attempt, setAttempt] = useState(0);
  const latest = useRef(refresh);
  const waiting = useRef(false);
  latest.current = refresh;
  useEffect(() => {
    if (!waiting.current) return;
    waiting.current = false;
    setAttempt((value) => value + 1);
  }, [refresh]);
  const begin = useCallback(() => {
    waiting.current = false;
    const started = latest.current;
    return () => {
      if (latest.current !== started) setAttempt((value) => value + 1);
      else waiting.current = true;
    };
  }, []);
  return { attempt, begin };
}
