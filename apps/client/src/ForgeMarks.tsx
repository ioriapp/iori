import {
  GitPullRequest,
  GitPullRequestDraft,
  GitMerge,
  GitPullRequestClosed,
} from "lucide-react";
import type { ForgeStatus } from "@iori/protocol";
import { Button } from "./components/ui/button.tsx";
import { native } from "./native.ts";
import { ciStateIcons } from "./forge/CiStateIcon.tsx";

export function ForgeMarks({
  status,
  t,
  onOpenCi,
}: {
  status?: ForgeStatus;
  t: (key: string) => string;
  /** Opens the CI View of the row's worktree. */
  onOpenCi: () => void;
}) {
  const pull = status?.pullRequest;
  const checks = status?.checks;
  if (!pull && !checks) return null;
  const PullIcon =
    pull?.state === "merged"
      ? GitMerge
      : pull?.state === "closed"
        ? GitPullRequestClosed
        : pull?.state === "draft"
          ? GitPullRequestDraft
          : GitPullRequest;
  const CheckIcon = ciStateIcons[checks?.state ?? "passed"];
  const pullLabel = pull
    ? t(`Pull request #{number} ${pull.state}`).replace(
        "{number}",
        String(pull.number),
      )
    : "";
  // Only states iori does not know: the Forge's word as it came.
  const checkLabel = !checks
    ? ""
    : checks.state === "other"
      ? checks.word
        ? `CI: ${checks.word}`
        : "CI"
      : t(`CI ${checks.state}`);
  return (
    <span className="nav-forge-marks">
      {pull && (
        <Button
          variant="ghost"
          size="icon-sm"
          className={`nav-forge-mark nav-forge-${pull.state}`}
          title={pullLabel}
          aria-label={pullLabel}
          data-iori-forge="pull-request"
          onClick={() => void native.openUrl(pull.url)}
        >
          <PullIcon size={13} />
          <span>#{pull.number}</span>
        </Button>
      )}
      {checks && (
        <Button
          variant="ghost"
          size="icon-sm"
          className={`nav-forge-mark nav-forge-${checks.state}`}
          title={checkLabel}
          aria-label={checkLabel}
          data-iori-forge="ci"
          onClick={onOpenCi}
        >
          <CheckIcon size={13} />
        </Button>
      )}
    </span>
  );
}
