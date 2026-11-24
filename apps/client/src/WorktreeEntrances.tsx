import type { DragEvent } from "react";
import {
  FileCode,
  GitBranch,
  GitPullRequest,
  Terminal,
  LayoutDashboard,
} from "lucide-react";
import { Button } from "./components/ui/button.tsx";
import type { WorkspaceViewKind } from "./workspace-panel.tsx";

const entries = [
  { kind: "files" as const, label: "Files", icon: FileCode },
  { kind: "git" as const, label: "Git", icon: GitBranch },
  { kind: "ci" as const, label: "PR / CI", icon: GitPullRequest },
  { kind: "terminal" as const, label: "Terminal", icon: Terminal },
  { kind: "board" as const, label: "Board", icon: LayoutDashboard },
];
export function WorktreeEntrances({
  plain,
  board,
  mobile = false,
  t,
  onOpen,
  onDrag,
}: {
  plain: boolean;
  board: boolean;
  mobile?: boolean;
  t: (key: string) => string;
  onOpen: (kind: WorkspaceViewKind) => void;
  onDrag: (
    kind: WorkspaceViewKind,
  ) => (event: DragEvent<HTMLButtonElement>) => void;
}) {
  return (
    <div className={mobile ? "nav-view-links" : "worktree-entrances"}>
      {entries
        .filter(
          ({ kind }) =>
            ((kind !== "git" && kind !== "ci") || !plain) &&
            (kind !== "board" || board),
        )
        .map(({ kind, label, icon: Icon }) => {
          const text = kind === "git" || kind === "ci" ? label : t(label);
          return (
            <Button
              key={kind}
              variant="ghost"
              size="sm"
              className={mobile ? "nav-view-link" : undefined}
              aria-label={text}
              title={text}
              draggable={!mobile}
              onDragStart={onDrag(kind)}
              data-iori-action={`sidebar-open-${kind}`}
              onClick={() => onOpen(kind)}
            >
              <Icon size={13} />
              <span className="worktree-entry-label">{text}</span>
            </Button>
          );
        })}
    </div>
  );
}
