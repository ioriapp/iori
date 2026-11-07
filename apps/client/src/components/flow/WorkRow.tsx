import type { ComponentProps, ReactNode } from "react";
import { ChevronRight } from "lucide-react";
import { Button } from "../ui/button.tsx";
import { StatusDot } from "../StatusDot.tsx";
import "./flow.css";

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
      className={`host-work-row ${props.className ?? ""}`}
    >
      <span className="what">
        {icon}
        <span>{title}</span>
      </span>
      <span className="state">
        <StatusDot
          state={state === "running" ? "active" : "waiting"}
          animated={false}
          aria-hidden="true"
        />
        {label}
        <ChevronRight className="row-chevron" aria-hidden="true" />
      </span>
    </Button>
  );
}
