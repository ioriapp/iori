import {
  Circle,
  CircleCheck,
  CircleDashed,
  CircleSlash,
  CircleX,
} from "lucide-react";
import type { ForgeCiState } from "@iori/protocol";

/** The CI marks of the sidebar and the CI View: running is not Issues' CircleDot. */
export const ciStateIcons = {
  passed: CircleCheck,
  failed: CircleX,
  running: CircleDashed,
  skipped: CircleSlash,
  // A state iori does not know: neutral, counted as none of the others.
  other: Circle,
} satisfies Record<ForgeCiState, unknown>;

export function CiStateIcon({
  state,
  size = 14,
}: {
  state: ForgeCiState;
  size?: number;
}) {
  const Icon = ciStateIcons[state];
  return (
    <Icon
      size={size}
      aria-hidden="true"
      className={`ci-state ci-${state}`}
      data-iori-ci-state={state}
    />
  );
}
