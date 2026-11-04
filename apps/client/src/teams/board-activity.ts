import type { CliStatus } from "@iori/protocol";

type Activity = CliStatus["activity"];

export function resumesBoardTool(activity: Activity, beforeAnswer: Activity) {
  return (
    activity?.kind === "tool" &&
    beforeAnswer?.kind === "tool" &&
    beforeAnswer.tool === activity.tool &&
    beforeAnswer.summary === activity.summary
  );
}

// Match spin-delay's defaults: https://github.com/smeijer/spin-delay#api
// `now` and `shownAt` use the Client's effect/commit clock, not the CLI clock.
export function boardActivityChange(
  running: boolean,
  activity: Activity,
  awaitingAnswer: boolean,
  shown: Activity,
  beforeAnswer: Activity,
  shownAt: number | undefined,
  now: number,
): { shown: Activity; beforeAnswer?: Activity; delay?: number } {
  if (!running)
    return {
      shown: undefined,
      beforeAnswer: awaitingAnswer
        ? shown?.kind === "tool"
          ? shown
          : beforeAnswer
        : undefined,
    };
  if (activity?.kind === "tool") {
    if (resumesBoardTool(activity, beforeAnswer)) return { shown: activity };
    if (
      shown?.kind === "tool" &&
      shown.tool === activity.tool &&
      shown.summary === activity.summary
    )
      return { shown };
    return { shown: activity, delay: 500 };
  }
  return {
    shown: activity?.kind === "thinking" ? activity : undefined,
    delay:
      shownAt === undefined ? 0 : Math.max(0, Math.ceil(200 - (now - shownAt))),
  };
}
