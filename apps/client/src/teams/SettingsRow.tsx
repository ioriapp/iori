import { FieldRow } from "../components/page-layout.tsx";
import { useRef, useState } from "react";
import type { ReactNode } from "react";
import { Input } from "../components/ui/input.tsx";
import { Button } from "../components/ui/button.tsx";
import { ChevronUp, ChevronDown } from "lucide-react";
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
    <FieldRow className={`team-setting-row ${className}`}>
      <div className="team-setting-copy">
        <span className="team-setting-label">{t(label)}</span>
        {hint && <p className="team-hint">{t(hint)}</p>}
      </div>
      <div className="team-setting-control">{children}</div>
      {detail && (
        <div className="team-setting-control team-setting-note">{detail}</div>
      )}
      {note && (
        <p className="team-hint team-setting-note" role="status">
          {t(note)}
        </p>
      )}
      {error && (
        <p className="connection-error" role="alert">
          {t(error)}
        </p>
      )}
    </FieldRow>
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
    <div className="team-limit-stepper">
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
        className="team-numeric-input"
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
      <div className="team-limit-step-buttons">
        <Button
          type="button"
          variant="ghost"
          tabIndex={-1}
          data-iori-action="limit-increase"
          aria-label={`${label}: ${t("Increase limit")}`}
          onPointerDown={(event) => event.preventDefault()}
          onClick={() => {
            input.current?.focus();
            step(1);
          }}
        >
          <ChevronUp size={10} />
        </Button>
        <Button
          type="button"
          variant="ghost"
          tabIndex={-1}
          data-iori-action="limit-decrease"
          aria-label={`${label}: ${t("Decrease limit")}`}
          disabled={Number(displayed || 0) <= min}
          onPointerDown={(event) => event.preventDefault()}
          onClick={() => {
            input.current?.focus();
            step(-1);
          }}
        >
          <ChevronDown size={10} />
        </Button>
      </div>
    </div>
  );
}
