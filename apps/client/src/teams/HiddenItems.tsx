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
      className="team-preview team-hidden-items"
      data-iori-view="hidden-items"
    >
      <CollapsibleTrigger asChild>
        <Button
          variant="ghost"
          className="team-preview-trigger"
          data-iori-action="hidden-items-toggle"
        >
          <ChevronRight size={14} />
          {t("Hidden")}
        </Button>
      </CollapsibleTrigger>
      <CollapsibleContent>{children}</CollapsibleContent>
    </Collapsible>
  );
}
