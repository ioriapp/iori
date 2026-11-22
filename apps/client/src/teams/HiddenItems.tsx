import type { ReactNode } from "react";
import { ChevronRight } from "lucide-react";
import { Button } from "../components/ui/button.tsx";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "../components/ui/collapsible.tsx";
import { useI18n } from "./context.tsx";

/** The same disclosure used for Board and sidebar groups, initially closed. */
export function HiddenItems({ children }: { children: ReactNode }) {
  const { t } = useI18n();
  return (
    <Collapsible
      className="min-w-0 border-b border-border"
      data-iori-view="hidden-items"
    >
      <CollapsibleTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="flex h-auto w-full justify-start gap-1.5 rounded-none px-2 py-2.5 text-xs font-medium text-muted-foreground hover:bg-accent/50 hover:text-foreground [&[data-state=open]>svg]:rotate-90"
          data-iori-action="hidden-items-toggle"
        >
          <ChevronRight
            className="size-3.5 shrink-0 transition-transform"
            aria-hidden="true"
          />
          <span>{t("Hidden")}</span>
        </Button>
      </CollapsibleTrigger>
      <CollapsibleContent className="border-t border-border-subtle">
        {children}
      </CollapsibleContent>
    </Collapsible>
  );
}
