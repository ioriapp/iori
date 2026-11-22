import { useRef, useState, type ReactNode } from "react";
import { ChevronDown, ChevronUp } from "lucide-react";
import { cn } from "cn";
import { Button } from "../components/ui/button.tsx";
import { Input } from "../components/ui/input.tsx";
import { useI18n } from "./context.tsx";

export function SettingsRow({
  label,
  hint,
  children,
  className = "",
  error,
  note,
  detail,
}: {
  label: string;
  hint?: string;
  children: ReactNode;
  className?: string;
  error?: string;
  note?: string;
  detail?: ReactNode;
}) {
  const { t } = useI18n();
  return (
    <div
      className={cn(
        "team-setting-row grid min-w-0 grid-cols-[minmax(0,1fr)_auto] items-center gap-x-6 gap-y-2 py-3.5 max-md:gap-x-4",
        className,
      )}
    >
      <div className="team-setting-copy min-w-0">
        <span className="team-setting-label block text-xs font-medium leading-relaxed text-foreground">
          {t(label)}
        </span>
        {hint && (
          <p className="mt-0.5 text-2xs leading-relaxed text-muted-foreground [overflow-wrap:anywhere]">
            {t(hint)}
          </p>
        )}
      </div>
      <div className="team-setting-control flex shrink-0 items-center justify-end gap-2">
        {children}
      </div>
      {detail && (
        <div className="col-span-full flex items-center justify-end gap-2">
          {detail}
        </div>
      )}
      {note && (
        <p
          className="col-span-full m-0 text-2xs text-muted-foreground [overflow-wrap:anywhere]"
          role="status"
        >
          {t(note)}
        </p>
      )}
      {error && (
        <p
          className="col-span-full m-0 text-xs text-status-failed-text [overflow-wrap:anywhere]"
          role="alert"
        >
          {t(error)}
        </p>
      )}
    </div>
  );
}

export function LimitInput({
  value,
  onChange,
  label,
  id,
  onBlur,
  min = 0,
  max,
}: {
  value: string;
  onChange: (value: string) => void;
  label: string;
  id?: string;
  onBlur?: () => void;
  min?: number;
  max?: number;
}) {
  const { t } = useI18n();
  const input = useRef<HTMLInputElement>(null);
  const [draft, setDraft] = useState<string>();
  const displayed = draft ?? value;

  const change = (raw: string) => {
    if (
      max !== undefined &&
      (!/^[0-9]+$/.test(raw) || Number(raw) < min || Number(raw) > max)
    ) {
      setDraft(raw);
      return;
    }
    setDraft(undefined);
    onChange(raw);
  };

  const step = (direction: 1 | -1) => {
    if (max !== undefined) {
      change(
        String(
          Math.max(min, Math.min(max, Number(displayed || min) + direction)),
        ),
      );
      return;
    }
    if (direction === -1 && BigInt(value || "0") === 0n) return;
    const next = BigInt(value || "0") + BigInt(direction);
    onChange(next > 0n ? next.toString() : "");
  };

  return (
    <div className="relative inline-flex h-8 w-28 shrink-0 items-center max-md:h-10 max-md:w-32">
      <Input
        ref={input}
        id={id}
        type="text"
        inputMode="numeric"
        pattern="[0-9]*"
        role="spinbutton"
        aria-label={label}
        aria-valuemin={min}
        aria-valuemax={max}
        aria-valuenow={Number(value || 0)}
        aria-valuetext={displayed || (max === undefined ? t("Unlimited") : "")}
        value={displayed}
        placeholder={max === undefined ? t("Unlimited") : String(min)}
        className="h-full w-full pr-7 text-xs tabular-nums max-md:pr-9 max-md:text-sm"
        onChange={(event) =>
          change(
            max === undefined
              ? event.target.value.replace(/[^0-9]/g, "").replace(/^0+/u, "")
              : event.target.value,
          )
        }
        onBlur={() => {
          setDraft(undefined);
          onBlur?.();
        }}
        onKeyDown={(event) => {
          if (
            event.nativeEvent.isComposing ||
            !["ArrowUp", "ArrowDown"].includes(event.key)
          )
            return;
          event.preventDefault();
          step(event.key === "ArrowUp" ? 1 : -1);
        }}
      />
      <div className="absolute inset-y-px right-px grid w-6 grid-rows-2 border-l border-border-subtle max-md:w-8">
        <Button
          type="button"
          variant="ghost"
          tabIndex={-1}
          data-iori-action="limit-increase"
          aria-label={`${label}: ${t("Increase limit")}`}
          className="h-full min-h-0 w-full rounded-none rounded-tr-md p-0 text-muted-foreground hover:bg-accent hover:text-foreground"
          onPointerDown={(event) => event.preventDefault()}
          onClick={() => {
            input.current?.focus();
            step(1);
          }}
        >
          <ChevronUp className="size-3" aria-hidden="true" />
        </Button>
        <Button
          type="button"
          variant="ghost"
          tabIndex={-1}
          data-iori-action="limit-decrease"
          aria-label={`${label}: ${t("Decrease limit")}`}
          disabled={Number(displayed || 0) <= min}
          className="h-full min-h-0 w-full rounded-none rounded-br-md border-t border-border-subtle p-0 text-muted-foreground hover:bg-accent hover:text-foreground"
          onPointerDown={(event) => event.preventDefault()}
          onClick={() => {
            input.current?.focus();
            step(-1);
          }}
        >
          <ChevronDown className="size-3" aria-hidden="true" />
        </Button>
      </div>
    </div>
  );
}
