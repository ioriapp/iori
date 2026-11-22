import { useRef } from "react";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import type { TerminalText } from "./terminal-text.ts";

export function TerminalTextSheet({
  text,
  onClose,
  t,
}: {
  text: TerminalText;
  onClose: () => void;
  t: (key: string) => string;
}) {
  const selectedRef = useRef<HTMLSpanElement>(null);
  return (
    <Sheet
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <SheetContent
        side="bottom"
        className="h-[85dvh]"
        data-iori-panel="terminal-text"
        aria-describedby={undefined}
        onOpenAutoFocus={(event) => {
          event.preventDefault();
          const line = selectedRef.current;
          if (!line) return;
          line.focus({ preventScroll: true });
          line.scrollIntoView({ block: "center" });
          const range = document.createRange();
          range.selectNodeContents(line);
          const selection = window.getSelection();
          selection?.removeAllRanges();
          selection?.addRange(range);
        }}
        onCloseAutoFocus={(event) => event.preventDefault()}
      >
        <SheetHeader>
          <SheetTitle>{t("Select as text")}</SheetTitle>
        </SheetHeader>
        <div className="min-h-0 overflow-y-auto px-6 pb-6 font-mono text-sm whitespace-pre-wrap [overflow-wrap:anywhere] select-text">
          {text.lines.map((line, index) => (
            <span key={index}>
              <span
                ref={index === text.selectedLine ? selectedRef : undefined}
                tabIndex={index === text.selectedLine ? -1 : undefined}
              >
                {line}
              </span>
              {index < text.lines.length - 1 ? "\n" : ""}
            </span>
          ))}
        </div>
      </SheetContent>
    </Sheet>
  );
}
