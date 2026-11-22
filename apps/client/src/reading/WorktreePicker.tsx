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
    <span className="grid min-w-0 flex-1 grid-cols-[minmax(0,1fr)] overflow-hidden whitespace-nowrap">
      <span
        className="invisible col-start-1 row-start-1 whitespace-nowrap"
        aria-hidden="true"
      >
        {label}
      </span>
      <MiddleEllipsis
        text={label}
        className="col-start-1 row-start-1 min-w-0 overflow-hidden whitespace-nowrap"
      />
    </span>
  );
  if (sorted.length < 2) {
    return (
      <span
        className="reading-worktree inline-flex h-7 max-w-full min-w-0 items-center gap-1.5 rounded-sm px-2 text-xs font-medium whitespace-nowrap text-foreground select-none [@media(pointer:coarse)]:min-h-11"
        title={root}
        data-iori-field={field}
      >
        <GitBranch
          className="size-3.5 shrink-0 text-muted-foreground"
          aria-hidden="true"
        />
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
          className="reading-worktree h-7 max-w-full min-w-0 gap-1.5 px-2 text-xs font-medium text-foreground [@media(pointer:coarse)]:min-h-11 [@media(pointer:coarse)]:min-w-11"
          title={root}
          data-iori-field={field}
        >
          <GitBranch
            className="size-3.5 shrink-0 text-muted-foreground"
            aria-hidden="true"
          />
          {name}
          <ChevronDown
            className="size-3 shrink-0 text-muted-foreground"
            aria-hidden="true"
          />
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
                className="data-[state=checked]:bg-accent data-[state=checked]:font-medium [@media(pointer:coarse)]:min-h-11"
              >
                <span className="grid min-w-0 flex-1 grid-cols-[minmax(0,1fr)]">
                  <span
                    className="invisible col-start-1 row-start-1 whitespace-nowrap"
                    aria-hidden="true"
                  >
                    {worktree.label}
                  </span>
                  <MiddleEllipsis
                    text={worktree.label}
                    className="col-start-1 row-start-1 min-w-0 overflow-hidden whitespace-nowrap"
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
