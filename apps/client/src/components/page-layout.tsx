import type { ComponentProps, KeyboardEvent, ReactNode } from "react";
import { Button } from "./ui/button.tsx";
import "./page-layout.css";

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
    <header className={`page-header ${className}`} {...props}>
      {back && <div className="page-back">{back}</div>}
      <div className="page-header-main">
        <div className={`page-heading ${headingClassName}`}>
          <h1
            title={typeof title === "string" ? title : undefined}
            onPointerEnter={(event) => {
              event.currentTarget.title = event.currentTarget.textContent ?? "";
            }}
          >
            {title}
          </h1>
          {description && <div className="page-description">{description}</div>}
        </div>
        {actions && <div className="page-actions">{actions}</div>}
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
    <div className={`page-body page-body-${width} ${className}`} {...props} />
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
  description,
  children,
  className = "",
  onSave,
  onKeyDown,
  ...props
}: Omit<ComponentProps<"section">, "title"> & {
  title?: ReactNode;
  description?: ReactNode;
  onSave?: () => void;
}) {
  return (
    <section
      className={`settings-section layout-section ${className}`}
      {...props}
      onKeyDown={(event) => {
        onKeyDown?.(event);
        saveOnEnter(event, onSave);
      }}
    >
      {(title || description) && (
        <div className="section-heading">
          {title && <h2>{title}</h2>}
          {description && <p className="page-description">{description}</p>}
        </div>
      )}
      <div className="section-body">{children}</div>
    </section>
  );
}

export function FieldRow({
  label,
  description,
  children,
  className = "",
  stacked = false,
  hideLabel = false,
  ...props
}: ComponentProps<"div"> & {
  label?: ReactNode;
  description?: ReactNode;
  stacked?: boolean;
  hideLabel?: boolean;
}) {
  return (
    <div
      className={`field-row ${stacked ? "field-stacked" : ""} ${className}`}
      {...props}
    >
      {label !== undefined ? (
        <>
          {(!hideLabel || description) && (
            <div className="field-copy">
              <span className={hideLabel ? "sr-only" : undefined}>{label}</span>
              {description && <p className="page-description">{description}</p>}
            </div>
          )}
          <div className="field-control">{children}</div>
        </>
      ) : (
        children
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
  return (
    <div
      className={`${inline ? "page-save-result" : "section-save-result"} ${error ? "connection-error" : inline ? "" : "page-description"}`}
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
  buttonClassName?: string;
  onSave: () => void;
  children?: ReactNode;
}) {
  return (
    <div className="section-save">
      <SaveResult message={message} error={error} state={state} />
      <Button
        type="button"
        pending={busy}
        disabled={disabled}
        className={buttonClassName}
        data-iori-action={action}
        onClick={onSave}
      >
        {t("Save")}
      </Button>
      {children}
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
    <div className="settings-recovery" role="alert">
      <p>{message}</p>
      <Button variant="outline" size={buttonSize} onClick={onRetry}>
        {retryLabel}
      </Button>
    </div>
  );
}
