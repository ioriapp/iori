import type { ReactNode } from "react";
/** The Board's agreed running-task treatment. */
export function TextShimmer({
  children,
  className = "",
}: {
  children: ReactNode;
  className?: string;
}) {
  return <span className={`board-text-shimmer ${className}`}>{children}</span>;
}
