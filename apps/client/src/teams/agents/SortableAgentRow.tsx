import { createContext, useContext, useState } from "react";
import type { ReactNode } from "react";
import { ChevronDown, ChevronRight, GripVertical } from "lucide-react";
import type { CliSummary } from "@iori/protocol";
import { useSortable } from "@dnd-kit/sortable";
import { cn } from "cn";
import { Button } from "../../components/ui/button.tsx";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "../../components/ui/collapsible.tsx";
import { useI18n } from "../context.tsx";

const AgentReorderContext = createContext<ReactNode>(null);

export function AgentReorderGrip() {
  return useContext(AgentReorderContext);
}

export function SortableAgentRow({
  cli,
  orderable,
  open,
  onOpenChange,
  onMove,
  children,
}: {
  cli: CliSummary;
  orderable?: true;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onMove: (step: number) => void;
  children: ReactNode;
}) {
  const { t } = useI18n();
  const enabled = !!orderable && !cli.hidden;
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: cli.id, disabled: !enabled });

  return (
    <Collapsible
      ref={setNodeRef}
      data-iori-cli-row={cli.id}
      data-iori-cli-source={cli.source}
      id={`team-agent-${cli.id}`}
      open={open}
      onOpenChange={onOpenChange}
      className={cn(
        "relative bg-background",
        isDragging && "z-(--z-sticky) rounded-md bg-popover shadow-md",
      )}
      style={{
        transform: transform
          ? `translate3d(${transform.x}px,${transform.y}px,0) scaleX(${transform.scaleX}) scaleY(${transform.scaleY})`
          : undefined,
        transition,
      }}
    >
      <AgentReorderContext.Provider
        value={
          enabled && (
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              className="shrink-0 cursor-grab touch-none text-muted-foreground hover:text-foreground active:cursor-grabbing [@media(pointer:coarse)]:min-h-11 [@media(pointer:coarse)]:min-w-11"
              data-iori-action="cli-reorder"
              {...attributes}
              {...listeners}
              aria-label={`${t("Drag to reorder")} ${cli.name}`}
              onKeyDown={(event) => {
                if (
                  !isDragging &&
                  (event.key === "ArrowUp" || event.key === "ArrowDown")
                ) {
                  event.preventDefault();
                  onMove(event.key === "ArrowUp" ? -1 : 1);
                } else listeners?.onKeyDown?.(event);
              }}
            >
              <GripVertical className="size-3.5" aria-hidden="true" />
            </Button>
          )
        }
      >
        {children}
      </AgentReorderContext.Provider>
    </Collapsible>
  );
}

/** Flat hairline disclosure for hidden CLIs, initially closed. */
export function HiddenCliItems({ children }: { children: ReactNode }) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);

  return (
    <Collapsible
      open={open}
      onOpenChange={setOpen}
      className="border-t border-border-subtle"
      data-iori-view="hidden-items"
    >
      <CollapsibleTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="h-auto min-h-9 w-full justify-start gap-1.5 rounded-none px-2 py-2 text-xs font-medium text-muted-foreground hover:bg-accent/40 hover:text-foreground [@media(pointer:coarse)]:min-h-11"
          data-iori-action="hidden-items-toggle"
        >
          {open ? (
            <ChevronDown className="size-3.5" aria-hidden="true" />
          ) : (
            <ChevronRight className="size-3.5" aria-hidden="true" />
          )}
          {t("Hidden")}
        </Button>
      </CollapsibleTrigger>
      <CollapsibleContent className="divide-y divide-border-subtle border-t border-border-subtle">
        {children}
      </CollapsibleContent>
    </Collapsible>
  );
}
