import { useEffect, useLayoutEffect, useRef, useState } from "react";
import type { CliStatus } from "@iori/protocol";

import { boardActivityChange, resumesBoardTool } from "./board-activity.ts";

export function useBoardActivity(
  running: boolean,
  activity: CliStatus["activity"],
  awaitingAnswer: boolean,
): CliStatus["activity"] {
  const kind = activity?.kind;
  const tool = activity?.kind === "tool" ? activity.tool : undefined;
  const summary = activity?.kind === "tool" ? activity.summary : undefined;
  const [shown, setShown] = useState<CliStatus["activity"]>(
    running ? activity : undefined,
  );
  const beforeAnswer = useRef<CliStatus["activity"]>(undefined);
  const resumed = running && resumesBoardTool(activity, beforeAnswer.current);
  const shownAt = useRef<number | undefined>(undefined);
  useLayoutEffect(() => {
    if (shown?.kind === "tool") shownAt.current = performance.now();
  }, [shown]);
  useEffect(() => {
    const change = boardActivityChange(
      running,
      activity,
      awaitingAnswer,
      shown,
      beforeAnswer.current,
      shownAt.current,
      performance.now(),
    );
    beforeAnswer.current = change.beforeAnswer;
    const apply = () => {
      if (change.shown?.kind !== "tool") shownAt.current = undefined;
      setShown(change.shown);
    };
    if (!change.delay) {
      apply();
      return;
    }
    const timer = setTimeout(apply, change.delay);
    return () => clearTimeout(timer);
  }, [running, kind, tool, summary, awaitingAnswer]);
  return running ? (resumed ? activity : shown) : undefined;
}
