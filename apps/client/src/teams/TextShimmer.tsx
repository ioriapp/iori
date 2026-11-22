import type { ReactNode } from "react";
import { cn } from "cn";

/** The Board's agreed running-task treatment. */
export function TextShimmer({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <span className={cn("motion-safe:animate-pulse", className)}>
      {children}
    </span>
  );
}
