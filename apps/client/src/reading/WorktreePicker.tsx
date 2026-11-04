import { worktreeOrder } from "@iori/protocol";
import { ChevronDown, GitBranch } from "lucide-react";
import { MiddleEllipsis } from "../MiddleEllipsis";
import { Button } from "../components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from "../components/ui/dropdown-menu";

export type WorktreeChoice = { path: string; label: string; primary?: boolean };

/** The list's top: the shown worktree, and the opened folder's others to switch to. */
export function WorktreePicker({
  label,
  root,
  worktrees,
  onSelect,
  field,
}: {
  label: string;
  root: string;
  worktrees: WorktreeChoice[];
  onSelect?: (path: string) => void;
  field: string;
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="sm"
          className="reading-worktree"
          title={root}
          data-iori-field={field}
        >
          <GitBranch />
          <span className="reading-truncate">{label}</span>
          <ChevronDown />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start">
        <DropdownMenuRadioGroup value={root} onValueChange={onSelect}>
          {[...worktrees].sort(worktreeOrder).map((worktree) => (
            <DropdownMenuRadioItem
              key={worktree.path}
              value={worktree.path}
              title={`${worktree.label}\n${worktree.path}`}
              data-iori-worktree-choice={worktree.path}
              className="reading-worktree-choice"
            >
              <span className="reading-worktree-choice-name">
                <span aria-hidden="true">{worktree.label}</span>
                <MiddleEllipsis
                  text={worktree.label}
                  className="reading-worktree-choice-fitted"
                />
              </span>
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
