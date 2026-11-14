import { Fragment } from "react";
import { worktreeOrder } from "@iori/protocol";
import { ChevronDown, GitBranch } from "lucide-react";
import { MiddleEllipsis } from "../MiddleEllipsis";
import { Button } from "../components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
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
  const sorted = [...worktrees].sort(worktreeOrder);
  const separated = sorted.length > 1 && sorted.some((w) => w.primary);
  const name = (
    <span className="reading-worktree-choice-name reading-truncate">
      <span aria-hidden="true">{label}</span>
      <MiddleEllipsis text={label} className="reading-worktree-choice-fitted" />
    </span>
  );
  if (sorted.length < 2) {
    return (
      <span
        className="reading-worktree reading-worktree-static"
        title={root}
        data-iori-field={field}
      >
        <GitBranch />
        {name}
      </span>
    );
  }
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
          {name}
          <ChevronDown />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start">
        <DropdownMenuRadioGroup value={root} onValueChange={onSelect}>
          {sorted.map((worktree) => (
            <Fragment key={worktree.path}>
              <DropdownMenuRadioItem
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
              {separated && worktree.primary ? <DropdownMenuSeparator /> : null}
            </Fragment>
          ))}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
