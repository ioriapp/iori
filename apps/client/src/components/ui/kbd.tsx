import type { ComponentProps } from "react";
import { cn } from "cn";

function Kbd({ className, ...props }: ComponentProps<"kbd">) {
  return (
    <kbd
      data-slot="kbd"
      className={cn(
        "pointer-events-none inline-flex w-fit items-center justify-center gap-1 font-sans text-[0.625rem] font-medium text-current opacity-80 select-none",
        className,
      )}
      {...props}
    />
  );
}

export { Kbd };
