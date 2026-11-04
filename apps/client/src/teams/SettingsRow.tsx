import { FieldRow } from "../components/page-layout.tsx";
import { useRef } from "react";
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
}: {
  label: string;
  hint?: string;
  children: ReactNode;
  className?: string;
  error?: string;
  note?: string;
}) {
  const { t } = useI18n();
  return (
    <FieldRow className={`team-setting-row ${className}`}>
      <div className="team-setting-copy">
        <span className="team-setting-label">{t(label)}</span>
        {hint && <p className="team-hint">{t(hint)}</p>}
      </div>
      <div className="team-setting-control">{children}</div>
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
}: {
  value: string;
  onChange: (value: string) => void;
  label: string;
  id?: string;
  onBlur?: () => void;
}) {
  const { t } = useI18n();
  const input = useRef<HTMLInputElement>(null);
  const step = (direction: 1 | -1) => {
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
        aria-valuemin={0}
        aria-valuenow={Number(value || 0)}
        aria-valuetext={value || t("Unlimited")}
        value={value}
        placeholder={t("Unlimited")}
        className="team-numeric-input"
        onChange={(event) =>
          onChange(
            event.target.value.replace(/[^0-9]/g, "").replace(/^0+/u, ""),
          )
        }
        onBlur={onBlur}
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
          disabled={!value || BigInt(value) === 0n}
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
