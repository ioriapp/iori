import { useEffect, useRef } from "react";
import { ArrowDown, ArrowUp, X } from "lucide-react";
import { Button } from "../components/ui/button";
import { Input } from "../components/ui/input";

/** The find box laid over the top right of a reading surface (Ctrl+F). */
export function FindBar({
  query,
  onQuery,
  onNext,
  onPrevious,
  onClose,
  status,
  locale,
  focusKey,
}: {
  query: string;
  onQuery: (value: string) => void;
  onNext: () => void;
  onPrevious: () => void;
  onClose: () => void;
  /** Shown beside the box, e.g. "No matches". */
  status?: string;
  locale: string;
  /** Changes whenever the box is asked to take focus again. */
  focusKey: number;
}) {
  const ja = locale.startsWith("ja");
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => {
    input.current?.focus({ preventScroll: true });
    input.current?.select();
  }, [focusKey]);
  return (
    <div className="reading-overlay" role="search" data-iori-part="find">
      <Input
        ref={input}
        value={query}
        data-iori-field="find-query"
        aria-label={ja ? "検索" : "Find"}
        placeholder={ja ? "検索" : "Find"}
        onChange={(event) => onQuery(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Enter") {
            event.preventDefault();
            if (event.shiftKey) onPrevious();
            else onNext();
          } else if (event.key === "Escape") {
            event.preventDefault();
            onClose();
          }
        }}
      />
      {status && <span className="reading-overlay-status">{status}</span>}
      <Button
        variant="ghost"
        size="icon-sm"
        aria-label={ja ? "前の一致項目" : "Previous match"}
        title={
          ja ? "前の一致項目（Shift+Enter）" : "Previous match (Shift+Enter)"
        }
        data-iori-action="find-previous"
        onClick={onPrevious}
      >
        <ArrowUp />
      </Button>
      <Button
        variant="ghost"
        size="icon-sm"
        aria-label={ja ? "次の一致項目" : "Next match"}
        title={ja ? "次の一致項目（Enter）" : "Next match (Enter)"}
        data-iori-action="find-next"
        onClick={onNext}
      >
        <ArrowDown />
      </Button>
      <Button
        variant="ghost"
        size="icon-sm"
        aria-label={ja ? "閉じる" : "Close"}
        data-iori-action="find-close"
        onClick={onClose}
      >
        <X />
      </Button>
    </div>
  );
}

/** The go-to-line box (Ctrl+G). */
export function GoToLineBar({
  max,
  onGo,
  onClose,
  locale,
}: {
  max: number;
  onGo: (line: number) => void;
  onClose: () => void;
  locale: string;
}) {
  const ja = locale.startsWith("ja");
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => input.current?.focus({ preventScroll: true }), []);
  return (
    <form
      className="reading-overlay"
      data-iori-part="go-to-line"
      onSubmit={(event) => {
        event.preventDefault();
        const line = Number(input.current?.value);
        if (Number.isSafeInteger(line) && line > 0) onGo(Math.min(line, max));
      }}
    >
      <Input
        ref={input}
        inputMode="numeric"
        data-iori-field="go-to-line"
        aria-label={ja ? "行へ移動" : "Go to line"}
        placeholder={ja ? `行番号（1–${max}）` : `Line (1–${max})`}
        onKeyDown={(event) => {
          if (event.key === "Escape") {
            event.preventDefault();
            onClose();
          }
        }}
      />
      <Button
        variant="ghost"
        size="icon-sm"
        aria-label={ja ? "閉じる" : "Close"}
        onClick={onClose}
        type="button"
      >
        <X />
      </Button>
    </form>
  );
}
