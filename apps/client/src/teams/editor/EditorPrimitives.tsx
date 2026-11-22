import { useEffect, useRef, type ReactNode } from "react";
import {
  ChevronRight,
  Copy,
  Eye,
  EyeOff,
  MoreHorizontal,
  Server,
  Trash2,
} from "lucide-react";
import { cn } from "cn";
import { childTeamText } from "@iori/protocol";
import { Button } from "../../components/ui/button.tsx";
import { Textarea } from "../../components/ui/textarea.tsx";
import { Label } from "../../components/ui/label.tsx";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "../../components/ui/select.tsx";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "../../components/ui/collapsible.tsx";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "../../components/ui/dropdown-menu.tsx";
import {
  ContextMenuItem,
  ContextMenuSeparator,
} from "../../components/ui/context-menu.tsx";
import { useI18n } from "../context.tsx";
import type { Role } from "../team-data.ts";

export function ShortSelect({
  label,
  value,
  options,
  onChange,
  disabled,
  size = "sm",
  className,
}: {
  disabled?: boolean;
  label: string;
  value?: string;
  options: string[];
  onChange: (value: string | undefined) => void;
  size?: "sm" | "default";
  className?: string;
}) {
  const { t } = useI18n();
  return (
    <Select
      value={value === undefined ? "unspecified" : `option:${value}`}
      onValueChange={(next) =>
        onChange(
          next === "unspecified" ? undefined : next.slice("option:".length),
        )
      }
    >
      <SelectTrigger
        size={size}
        aria-label={t(label)}
        disabled={disabled}
        className={cn("w-full min-w-0 text-xs", className)}
      >
        <SelectValue />
      </SelectTrigger>
      <SelectContent position="popper">
        <SelectItem value="unspecified">{t("Not specified")}</SelectItem>
        {options.map((option) => (
          <SelectItem value={`option:${option}`} key={option}>
            {option}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

export function Field({
  label,
  children,
  hint,
  hideLabel = false,
  className,
}: {
  label: string;
  children: ReactNode;
  hint?: string;
  hideLabel?: boolean;
  className?: string;
}) {
  const { t } = useI18n();
  return (
    <div className={cn("flex min-w-0 flex-col gap-1.5", className)}>
      {(!hideLabel || hint) && (
        <div className="flex min-w-0 flex-col gap-0.5">
          <Label
            className={cn(
              "text-xs font-medium text-foreground",
              hideLabel && "sr-only",
            )}
          >
            {t(label)}
          </Label>
          {hint && (
            <p className="text-2xs leading-relaxed text-muted-foreground [word-break:auto-phrase]">
              {t(hint)}
            </p>
          )}
        </div>
      )}
      <div className="min-w-0">{children}</div>
    </div>
  );
}

export function GrowingText({
  value,
  onChange,
  label,
  rows = 4,
  className,
}: {
  value: string;
  onChange: (value: string) => void;
  label: string;
  rows?: number;
  className?: string;
}) {
  const { t } = useI18n();
  const ref = useRef<HTMLTextAreaElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (el) {
      el.style.height = "auto";
      el.style.height = `${Math.max(el.scrollHeight, rows * 22 + 16)}px`;
    }
  }, [value, rows]);
  return (
    <Textarea
      ref={ref}
      rows={rows}
      value={value}
      aria-label={t(label)}
      className={cn(
        "min-h-14 resize-y overflow-hidden leading-relaxed",
        className,
      )}
      onChange={(event) => onChange(event.target.value)}
    />
  );
}

export function ActionsMenu({
  label,
  children,
  size = "icon-sm",
  triggerClassName,
}: {
  label: string;
  children: ReactNode;
  size?: "icon-sm" | "icon-touch" | "icon";
  triggerClassName?: string;
}) {
  const { t } = useI18n();
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size={size}
          aria-label={t(label)}
          data-iori-action={
            label === "Team actions" ? "team-actions" : undefined
          }
          className={cn("shrink-0 text-muted-foreground", triggerClassName)}
        >
          <MoreHorizontal className="size-4" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">{children}</DropdownMenuContent>
    </DropdownMenu>
  );
}

export function TeamMenuItems({
  context = false,
  onOpen,
  onDuplicate,
  onCopy,
  onDelete,
  hidden,
  onHidden,
}: {
  context?: boolean;
  onOpen?: () => void;
  onDuplicate: () => void;
  onCopy: () => void;
  onDelete: () => void;
  hidden: boolean;
  onHidden: () => void;
}) {
  const { t } = useI18n();
  const Item = context ? ContextMenuItem : DropdownMenuItem;
  const Separator = context ? ContextMenuSeparator : DropdownMenuSeparator;
  return (
    <>
      {onOpen && (
        <Item data-iori-action="team-open" onSelect={onOpen}>
          {t("Open")}
        </Item>
      )}
      <Item data-iori-action="team-duplicate" onSelect={onDuplicate}>
        <Copy className="size-3.5" aria-hidden="true" />
        {t("Duplicate")}
      </Item>
      <Item data-iori-action="team-copy" onSelect={onCopy}>
        <Server className="size-3.5" aria-hidden="true" />
        {t("Copy to another Host")}
      </Item>
      <Item data-iori-action="team-hidden-set" onSelect={onHidden}>
        {hidden ? (
          <Eye className="size-3.5" aria-hidden="true" />
        ) : (
          <EyeOff className="size-3.5" aria-hidden="true" />
        )}
        {t(hidden ? "Show in pickers" : "Hide from pickers")}
      </Item>
      <Separator />
      <Item
        data-iori-action="team-delete"
        variant="destructive"
        onSelect={onDelete}
      >
        <Trash2 className="size-3.5" aria-hidden="true" />
        {t("Delete")}
      </Item>
    </>
  );
}

export function TextPreview({
  title,
  children,
  className,
}: {
  title: string;
  children: ReactNode;
  className?: string;
}) {
  const { t } = useI18n();
  return (
    <Collapsible className={cn("min-w-0", className)}>
      <CollapsibleTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="flex h-auto w-full justify-start gap-1.5 px-1 py-2 text-xs font-medium text-foreground [&[data-state=open]>svg]:rotate-90"
        >
          <ChevronRight
            className="size-3.5 shrink-0 text-muted-foreground transition-transform"
            aria-hidden="true"
          />
          <span>{t(title)}</span>
        </Button>
      </CollapsibleTrigger>
      <CollapsibleContent>
        <div className="mt-1.5 rounded-md border border-border-subtle bg-terminal p-3 font-mono text-2xs leading-relaxed whitespace-pre-wrap [overflow-wrap:anywhere] text-terminal-foreground">
          {children}
        </div>
      </CollapsibleContent>
    </Collapsible>
  );
}

export function ChildText({ value }: { value: Role }) {
  return <p className="m-0 whitespace-pre-wrap">{childTeamText(value)}</p>;
}

export function InlineAlertBanner({
  message,
  actionLabel,
  onAction,
  tone = "error",
}: {
  message: string;
  actionLabel?: string;
  onAction?: () => void;
  tone?: "error" | "status";
}) {
  return (
    <div
      role={tone === "error" ? "alert" : "status"}
      className={cn(
        "flex flex-wrap items-center justify-between gap-2 rounded-md border px-3 py-2 text-xs [overflow-wrap:anywhere]",
        tone === "error"
          ? "border-status-failed-border bg-status-failed-bg/45 text-status-failed-text"
          : "border-border bg-sidebar/60 text-foreground",
      )}
    >
      <span className="min-w-0 flex-1">{message}</span>
      {actionLabel && onAction && (
        <Button type="button" variant="outline" size="xs" onClick={onAction}>
          {actionLabel}
        </Button>
      )}
    </div>
  );
}
