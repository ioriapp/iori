import { useEffect, useRef } from "react";
import type { ComponentProps, ReactNode } from "react";
import { cn } from "cn";
import { saveOnEnter } from "./page-layout.tsx";
import { Badge } from "./ui/badge.tsx";
import { Button } from "./ui/button.tsx";

export function FlatPageHeader({
  title,
  description,
  actions,
  back,
  bordered = true,
  className,
  ...props
}: Omit<ComponentProps<"header">, "title"> & {
  title: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
  back?: ReactNode;
  bordered?: boolean;
}) {
  return (
    <header
      className={cn(
        "flex min-w-0 flex-col gap-2 pb-4",
        bordered && "border-b border-border",
        className,
      )}
      {...props}
    >
      {back && <div className="min-w-0">{back}</div>}
      <div className="flex min-w-0 flex-wrap items-start justify-between gap-x-4 gap-y-2">
        <div className="min-w-0 flex-1">
          <h1
            title={typeof title === "string" ? title : undefined}
            onPointerEnter={(event) => {
              event.currentTarget.title = event.currentTarget.textContent ?? "";
            }}
            className="truncate font-heading text-lg font-semibold tracking-tight text-foreground"
          >
            {title}
          </h1>
          {description && (
            <p className="mt-1 text-xs text-muted-foreground">{description}</p>
          )}
        </div>
        {actions && (
          <div className="flex shrink-0 flex-wrap items-center justify-end gap-2">
            {actions}
          </div>
        )}
      </div>
    </header>
  );
}

export function FlatSection({
  title,
  description,
  actions,
  status,
  onSave,
  onKeyDown,
  children,
  className,
  bodyClassName,
  ...props
}: Omit<ComponentProps<"section">, "title"> & {
  title?: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
  status?: ReactNode;
  onSave?: () => void;
  bodyClassName?: string;
}) {
  return (
    <section
      className={cn("flex min-w-0 flex-col", className)}
      onKeyDown={(event) => {
        onKeyDown?.(event);
        saveOnEnter(event, onSave);
      }}
      {...props}
    >
      {(title || description || actions || status) && (
        <div className="flex min-w-0 flex-wrap items-start justify-between gap-2 pb-3.5">
          <div className="min-w-0 flex-1">
            {title && (
              <h2 className="font-heading text-sm font-semibold text-foreground">
                {title}
              </h2>
            )}
            {description && (
              <p className="mt-0.5 text-xs text-muted-foreground">
                {description}
              </p>
            )}
          </div>
          {(status || actions) && (
            <div className="flex shrink-0 flex-wrap items-center gap-2">
              {status}
              {actions}
            </div>
          )}
        </div>
      )}
      <div
        className={cn(
          "flex min-w-0 flex-col divide-y divide-border-subtle border-t border-border",
          bodyClassName,
        )}
      >
        {children}
      </div>
    </section>
  );
}

export function FlatSettingRow({
  label,
  htmlFor,
  description,
  stacked = false,
  error,
  children,
  className,
  ...props
}: ComponentProps<"div"> & {
  label?: ReactNode;
  htmlFor?: string;
  description?: ReactNode;
  stacked?: boolean;
  error?: ReactNode;
}) {
  const labelElement =
    label !== undefined ? (
      htmlFor ? (
        <label
          htmlFor={htmlFor}
          className="text-xs font-medium text-foreground"
        >
          {label}
        </label>
      ) : (
        <span className="text-xs font-medium text-foreground">{label}</span>
      )
    ) : null;

  return (
    <div
      className={cn(
        "min-w-0 py-3.5",
        stacked
          ? "flex flex-col gap-1.5"
          : "flex flex-wrap items-center justify-between gap-x-4 gap-y-2",
        className,
      )}
      {...props}
    >
      {label !== undefined || description !== undefined ? (
        <>
          <div className={cn("min-w-0", !stacked && "flex-1")}>
            {labelElement && (
              <div className="[word-break:auto-phrase]">{labelElement}</div>
            )}
            {description && (
              <p className="mt-0.5 text-2xs text-muted-foreground [word-break:auto-phrase]">
                {description}
              </p>
            )}
          </div>
          <div
            className={cn(
              "min-w-0",
              stacked ? "w-full" : "flex shrink-0 items-center gap-2",
            )}
          >
            {children}
          </div>
        </>
      ) : (
        children
      )}
      {error && (
        <p
          role="alert"
          data-iori-state="error"
          className="w-full text-xs text-status-failed-text"
        >
          {error}
        </p>
      )}
    </div>
  );
}

export function FlatSectionSave({
  t,
  dirty,
  busy = false,
  disabled = false,
  message,
  error = false,
  state,
  action,
  onSave,
  onDiscard,
  discardAction,
  saveLabel,
  discardLabel,
  children,
  className,
}: {
  t: (key: string) => string;
  dirty: boolean;
  busy?: boolean;
  disabled?: boolean;
  message?: ReactNode;
  error?: boolean;
  state?: string;
  action?: string;
  onSave: () => void;
  onDiscard?: () => void;
  discardAction?: string;
  saveLabel?: string;
  discardLabel?: string;
  children?: ReactNode;
  className?: string;
}) {
  const rowRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (message) rowRef.current?.scrollIntoView({ block: "nearest" });
  }, [message]);

  return (
    <div
      ref={rowRef}
      className={cn(
        "flex flex-wrap items-center justify-between gap-2 border-t border-border pt-3.5",
        className,
      )}
    >
      <div className="flex min-w-0 flex-wrap items-center gap-2">
        {message ? (
          <span
            role={error ? "alert" : "status"}
            data-iori-state={error ? "error" : state}
            className={cn(
              "text-xs [overflow-wrap:anywhere]",
              error ? "text-status-failed-text" : "text-status-running-text",
            )}
          >
            {message}
          </span>
        ) : dirty ? (
          <Badge variant="waiting">{t("Unsaved changes")}</Badge>
        ) : null}
      </div>
      <div className="flex shrink-0 flex-wrap items-center gap-2">
        {children}
        {dirty && onDiscard && (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            disabled={busy}
            data-iori-action={discardAction}
            onClick={onDiscard}
          >
            {discardLabel ?? t("Discard changes")}
          </Button>
        )}
        <Button
          type="button"
          variant="default"
          size="sm"
          pending={busy}
          disabled={!dirty || disabled}
          data-iori-action={action}
          onClick={onSave}
        >
          {saveLabel ?? t("Save")}
        </Button>
      </div>
    </div>
  );
}
