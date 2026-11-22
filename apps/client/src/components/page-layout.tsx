import { useEffect, useRef } from "react";
import type { ComponentProps, KeyboardEvent, ReactNode } from "react";
import { AlertCircle, RotateCcw } from "lucide-react";
import { cn } from "cn";
import { Badge } from "./ui/badge.tsx";
import { Button } from "./ui/button.tsx";

export function PageHeader({
  title,
  description,
  actions,
  back,
  headingClassName = "",
  className = "",
  ...props
}: Omit<ComponentProps<"header">, "title"> & {
  title: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
  back?: ReactNode;
  headingClassName?: string;
}) {
  return (
    <header
      className={cn("page-header mb-6 grid min-w-0 gap-2", className)}
      {...props}
    >
      {back && (
        <div className="page-back min-w-0 [&>button]:max-w-full [&>button]:min-w-0">
          {back}
        </div>
      )}
      <div className="page-header-main grid min-w-0 grid-cols-[minmax(0,1fr)_auto] gap-x-4 gap-y-1.5">
        <div className={cn("page-heading contents", headingClassName)}>
          <h1
            title={typeof title === "string" ? title : undefined}
            onPointerEnter={(event) => {
              event.currentTarget.title = event.currentTarget.textContent ?? "";
            }}
            className="m-0 min-w-0 truncate font-heading text-lg font-semibold tracking-tight text-foreground"
          >
            {title}
          </h1>
          {description && (
            <div className="page-description col-span-full row-start-2 m-0 text-xs leading-relaxed font-normal text-muted-foreground">
              {description}
            </div>
          )}
        </div>
        {actions && (
          <div className="page-actions col-start-2 row-start-1 flex flex-wrap items-center justify-end gap-2 self-start">
            {actions}
          </div>
        )}
      </div>
    </header>
  );
}

export function PageBody({
  className = "",
  width = "settings",
  ...props
}: ComponentProps<"div"> & {
  width?: "settings" | "editor" | "full";
}) {
  return (
    <div
      className={cn(
        "page-body mx-auto w-full min-w-0",
        width === "settings" && "max-w-[42.5rem]",
        width === "editor" && "max-w-[60rem]",
        width === "full" && "max-w-none",
        "[&_[data-slot=toggle-group-item][data-state=on]]:border-primary/55 [&_[data-slot=toggle-group-item][data-state=on]]:bg-primary/18 [&_[data-slot=toggle-group-item][data-state=on]]:font-semibold",
        "[&_button[aria-pressed=true]]:border-primary/55 [&_button[aria-pressed=true]]:bg-primary/18 [&_button[aria-pressed=true]]:font-semibold",
        className,
      )}
      {...props}
    />
  );
}

export function saveOnEnter(
  event: KeyboardEvent<HTMLElement>,
  onSave?: () => void,
) {
  if (
    !onSave ||
    event.defaultPrevented ||
    event.key !== "Enter" ||
    event.nativeEvent.isComposing ||
    !event.currentTarget.contains(event.target as Node)
  )
    return;
  const target = event.target;
  if (
    (target instanceof HTMLInputElement && target.type !== "checkbox") ||
    (target instanceof HTMLTextAreaElement && event.ctrlKey)
  ) {
    event.preventDefault();
    onSave();
  }
}

export function SettingsSection({
  title,
  actions,
  description,
  children,
  className = "",
  onSave,
  onKeyDown,
  ...props
}: Omit<ComponentProps<"section">, "title"> & {
  title?: ReactNode;
  actions?: ReactNode;
  description?: ReactNode;
  onSave?: () => void;
}) {
  return (
    <section
      className={cn(
        "settings-section layout-section flex min-w-0 flex-col [&+.layout-section]:mt-7",
        className,
      )}
      {...props}
      onKeyDown={(event) => {
        onKeyDown?.(event);
        saveOnEnter(event, onSave);
      }}
    >
      {(title || description || actions) && (
        <div className="section-heading flex min-w-0 flex-wrap items-start justify-between gap-2 pb-3">
          <div className="min-w-0 flex-1">
            {title && (
              <h2 className="m-0 font-heading text-sm font-semibold text-foreground">
                {title}
              </h2>
            )}
            {description && (
              <p className="page-description mt-0.5 mb-0 text-xs leading-relaxed font-normal text-muted-foreground">
                {description}
              </p>
            )}
          </div>
          {actions && (
            <div className="page-actions flex shrink-0 flex-wrap items-center justify-end gap-2">
              {actions}
            </div>
          )}
        </div>
      )}
      <div
        className={cn(
          "section-body flex min-w-0 flex-col divide-y divide-border-subtle border-t border-border",
          "[&>*]:m-0 [&>*]:min-w-0 [&>*:not([data-slot=collapsible]):not(.section-rows):not([data-section-flush])]:py-3.5",
          "[&_.section-rows]:divide-y [&_.section-rows]:divide-border-subtle [&_.section-rows]:py-0 [&_.section-rows>*]:py-3.5",
          "[&_code]:font-mono [&_code]:[font-variant-ligatures:none]",
        )}
      >
        {children}
      </div>
    </section>
  );
}

export function FieldRow({
  label,
  description,
  error,
  children,
  className = "",
  stacked = false,
  hideLabel = false,
  ...props
}: ComponentProps<"div"> & {
  label?: ReactNode;
  description?: ReactNode;
  error?: ReactNode;
  stacked?: boolean;
  hideLabel?: boolean;
}) {
  return (
    <div
      className={cn(
        "field-row min-w-0",
        stacked
          ? "field-stacked flex flex-col items-stretch gap-2"
          : "flex flex-wrap items-center justify-between gap-x-4 gap-y-2",
        "[&.field-code_input]:font-mono [&.field-code_input]:[font-variant-ligatures:none] [&.field-code_textarea]:font-mono [&.field-code_textarea]:[font-variant-ligatures:none]",
        className,
      )}
      {...props}
    >
      {label !== undefined ? (
        <>
          {(!hideLabel || description) && (
            <div
              className={cn(
                "field-copy min-w-0 max-w-full text-sm font-medium text-foreground",
                !stacked && "flex-1 max-md:has-[>p]:basis-full",
                "[&>:first-child]:wrap-break-word [&>:first-child]:[word-break:auto-phrase]",
              )}
            >
              <span className={hideLabel ? "sr-only" : undefined}>{label}</span>
              {description && (
                <p className="page-description mt-0.5 mb-0 text-xs leading-relaxed font-normal text-muted-foreground [word-break:auto-phrase]">
                  {description}
                </p>
              )}
            </div>
          )}
          <div
            className={cn(
              "field-control flex min-w-0 max-w-full items-center gap-2 empty:hidden",
              stacked
                ? "w-full flex-col items-stretch [&_input]:w-full [&_input]:min-w-0 [&_textarea]:min-h-[calc(3lh+1rem)] [&_textarea]:w-full [&_textarea]:min-w-0"
                : "ml-auto shrink-0 justify-end",
            )}
          >
            {children}
          </div>
          {error}
        </>
      ) : (
        <>
          {children}
          {error}
        </>
      )}
    </div>
  );
}

export function SaveResult({
  message,
  error,
  state,
  inline = false,
}: {
  message?: ReactNode;
  error?: boolean;
  state?: string;
  inline?: boolean;
}) {
  if (!message) return null;
  return (
    <div
      className={cn(
        inline ? "page-save-result" : "section-save-result",
        "min-w-0 text-xs leading-relaxed [overflow-wrap:anywhere]",
        error ? "text-status-failed-text" : "text-status-running-text",
      )}
      role={error ? "alert" : "status"}
      data-iori-state={message && !error ? state : undefined}
    >
      {message}
    </div>
  );
}

export function SectionSave({
  t,
  message,
  error,
  state,
  busy,
  action,
  onSave,
  disabled,
  dirty,
  onDiscard,
  discardAction,
  buttonClassName,
  children,
}: {
  t: (key: string) => string;
  message?: string;
  error?: boolean;
  state?: string;
  busy?: boolean;
  action?: string;
  disabled?: boolean;
  dirty?: boolean;
  onDiscard?: () => void;
  discardAction?: string;
  buttonClassName?: string;
  onSave: () => void;
  children?: ReactNode;
}) {
  const row = useRef<HTMLDivElement>(null);
  // Saving with Enter from a field can leave the result below the fold.
  useEffect(() => {
    if (message) row.current?.scrollIntoView({ block: "nearest" });
  }, [message]);
  const saveDisabled = Boolean(disabled) || (dirty !== undefined && !dirty);
  return (
    <div
      className="section-save flex flex-wrap items-center justify-between gap-2 pt-3.5"
      ref={row}
    >
      <div className="flex min-w-0 flex-1 flex-wrap items-center gap-2">
        {message ? (
          <SaveResult message={message} error={error} state={state} />
        ) : dirty ? (
          <Badge variant="waiting">{t("Unsaved changes")}</Badge>
        ) : null}
      </div>
      <div className="flex shrink-0 flex-wrap items-center justify-end gap-2">
        {dirty && onDiscard && (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            disabled={busy}
            data-iori-action={discardAction}
            onClick={onDiscard}
          >
            {t("Discard changes")}
          </Button>
        )}
        <Button
          type="button"
          size="sm"
          pending={busy}
          disabled={saveDisabled}
          className={buttonClassName}
          data-iori-action={action}
          onClick={onSave}
        >
          {t("Save")}
        </Button>
        {children}
      </div>
    </div>
  );
}

export function LoadRecovery({
  message,
  retryLabel,
  onRetry,
  buttonSize = "sm",
}: {
  message: string;
  retryLabel: string;
  onRetry: () => void;
  buttonSize?: "sm" | "lg";
}) {
  return (
    <div
      className="settings-recovery flex flex-wrap items-center justify-between gap-3 rounded-md border border-status-failed-border bg-status-failed-bg/35 px-4 py-3 text-xs text-status-failed-text"
      role="alert"
    >
      <div className="flex min-w-0 items-center gap-2">
        <AlertCircle className="size-4 shrink-0" aria-hidden="true" />
        <p className="m-0 text-foreground [overflow-wrap:anywhere]">
          {message}
        </p>
      </div>
      <Button variant="outline" size={buttonSize} onClick={onRetry}>
        <RotateCcw className="size-3.5" aria-hidden="true" />
        {retryLabel}
      </Button>
    </div>
  );
}
