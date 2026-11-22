import {
  Circle,
  CircleCheck,
  CircleDashed,
  CircleSlash,
  CircleX,
} from "lucide-react";
import type { ForgeCiState } from "@iori/protocol";
import { cn } from "../lib/utils.ts";

/** The CI marks of the sidebar and the CI View: running is not Issues' CircleDot. */
export const ciStateIcons = {
  passed: CircleCheck,
  failed: CircleX,
  running: CircleDashed,
  skipped: CircleSlash,
  // A state iori does not know: neutral, counted as none of the others.
  other: Circle,
} satisfies Record<ForgeCiState, unknown>;

const ciStateClasses: Record<ForgeCiState, string> = {
  passed: "text-status-running-text",
  failed: "text-status-failed-text",
  // Amber means Attention in iori; running is gray with heavier dashes.
  running: "text-muted-foreground stroke-[2.6]",
  skipped: "text-muted-foreground",
  other: "text-muted-foreground",
};

export function CiStateIcon({
  state,
  size = 14,
  className,
}: {
  state: ForgeCiState;
  size?: number;
  className?: string;
}) {
  const Icon = ciStateIcons[state];
  return (
    <Icon
      size={size}
      aria-hidden="true"
      className={cn("shrink-0", ciStateClasses[state], className)}
      data-iori-ci-state={state}
    />
  );
}
