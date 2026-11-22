import type { Changes } from "@iori/protocol";
import { cn } from "cn";
import { translator } from "../i18n.ts";

export function ChangeAmount({
  changes,
  language,
  onClick,
  className,
}: {
  changes: Changes;
  language: string;
  onClick?: () => void;
  className?: string;
}) {
  const t = translator(language);
  const files =
    changes.files === undefined
      ? undefined
      : t(changes.files === 1 ? "1 file" : "{count} files").replace(
          "{count}",
          String(changes.files),
        );
  const content = (
    <>
      {changes.added !== undefined && (
        <span className="text-diff-add-text">+{changes.added}</span>
      )}
      {changes.removed !== undefined && (
        <span className="text-diff-del-text">−{changes.removed}</span>
      )}
      {files !== undefined && (
        <span className="text-muted-foreground">· {files}</span>
      )}
    </>
  );

  if (onClick) {
    return (
      <button
        type="button"
        onClick={onClick}
        className={cn(
          "inline-flex cursor-pointer items-center gap-1 rounded-xs px-1 -mx-1 font-mono tabular-nums transition-colors hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40",
          className,
        )}
      >
        {content}
      </button>
    );
  }

  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 font-mono tabular-nums",
        className,
      )}
    >
      {content}
    </span>
  );
}
