import type { DragEvent } from "react";
import { FileCode, GitBranch, Terminal, LayoutDashboard } from "lucide-react";
import { Button } from "./components/ui/button.tsx";
import type { WorkspaceViewKind } from "./workspace-panel.tsx";

const entries = [
  { kind: "files" as const, label: "Files", icon: FileCode },
  { kind: "git" as const, label: "Git", icon: GitBranch },
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
            (kind !== "git" || !plain) && (kind !== "board" || board),
        )
        .map(({ kind, label, icon: Icon }) => (
          <Button
            key={kind}
            variant="ghost"
            size="sm"
            className={mobile ? "nav-view-link" : undefined}
            aria-label={kind === "git" ? "Git" : t(label)}
            title={kind === "git" ? "Git" : t(label)}
            draggable={!mobile}
            onDragStart={onDrag(kind)}
            data-iori-action={`sidebar-open-${kind}`}
            onClick={() => onOpen(kind)}
          >
            <Icon size={13} />
            <span className="worktree-entry-label">
              {kind === "git" ? "Git" : t(label)}
            </span>
          </Button>
        ))}
    </div>
  );
}
