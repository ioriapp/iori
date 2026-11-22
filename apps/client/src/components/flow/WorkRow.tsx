import type { ComponentProps, ReactNode } from "react";
import { cn } from "cn";
import { ChevronRight } from "lucide-react";
import { Button } from "../ui/button.tsx";
import { StatusDot } from "../StatusDot.tsx";

/** 中断される作業を開く行。CLI や Terminal の情報と操作は呼び出し元が渡す。 */
export function WorkRow({
  icon,
  title,
  state,
  label,
  ...props
}: Omit<ComponentProps<typeof Button>, "children"> & {
  icon: ReactNode;
  title: ReactNode;
  state: "running" | "approval" | "question";
  label: string;
}) {
  return (
    <Button
      {...props}
      variant="ghost"
      className={cn(
        "h-auto min-h-10 w-full justify-between gap-3 rounded-none border-b border-border-subtle px-3 py-2.5 text-left text-sm font-normal whitespace-normal first:rounded-t-md last:rounded-b-md last:border-b-0",
        props.className,
      )}
    >
      <span className="flex min-w-0 items-center gap-2 [&>svg]:shrink-0 [&>svg]:text-muted-foreground">
        {icon}
        <span className="min-w-0 truncate">{title}</span>
      </span>
      <span className="inline-flex shrink-0 items-center gap-1.5 text-xs text-muted-foreground">
        <StatusDot
          state={state === "running" ? "active" : "waiting"}
          animated={false}
          aria-hidden="true"
        />
        {label}
        <ChevronRight
          className="size-4 text-muted-foreground"
          aria-hidden="true"
        />
      </span>
    </Button>
  );
}
