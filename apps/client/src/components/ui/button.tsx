import * as React from "react"
import { cva, type VariantProps } from "class-variance-authority"
import { cn } from "cn"
import { Slot } from "radix-ui"
import { Spinner } from "./spinner.tsx"

const buttonVariants = cva(
  "group/button inline-flex shrink-0 cursor-pointer items-center justify-center rounded-md border border-transparent bg-clip-padding font-medium whitespace-nowrap transition-colors outline-none select-none focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/40 active:not-aria-[haspopup]:translate-y-px disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-45 aria-invalid:border-destructive aria-invalid:ring-2 aria-invalid:ring-destructive/25 [&_svg]:pointer-events-none [&_svg]:shrink-0",
  {
    variants: {
      variant: {
        default: "bg-primary text-primary-foreground hover:bg-primary/90",
        outline:
          "border-border bg-card text-foreground hover:bg-accent hover:text-accent-foreground aria-expanded:bg-accent",
        secondary:
          "bg-secondary text-secondary-foreground hover:bg-accent aria-expanded:bg-accent",
        ghost:
          "text-foreground hover:bg-accent hover:text-accent-foreground aria-expanded:bg-accent",
        destructive:
          "border-status-failed-border bg-status-failed-bg text-status-failed-text hover:bg-destructive hover:text-destructive-foreground focus-visible:border-destructive focus-visible:ring-destructive/30",
        link: "h-auto rounded-xs px-0.5 py-0 text-link underline decoration-link/60 underline-offset-4 hover:decoration-link",
      },
      size: {
        default:
          "h-8 gap-1.5 px-3 text-xs [@media(pointer:coarse)]:min-h-11 has-data-[icon=inline-end]:pr-2 has-data-[icon=inline-start]:pl-2 [&_svg:not([class*='size-'])]:size-3.5",
        xs: "h-6 gap-1 rounded-sm px-2 text-2xs has-data-[icon=inline-end]:pr-1.5 has-data-[icon=inline-start]:pl-1.5 [&_svg:not([class*='size-'])]:size-3",
        sm: "h-7 gap-1.5 px-2.5 text-xs has-data-[icon=inline-end]:pr-2 has-data-[icon=inline-start]:pl-2 [&_svg:not([class*='size-'])]:size-3.5",
        lg: "h-9 gap-2 px-4 text-sm [@media(pointer:coarse)]:min-h-11 has-data-[icon=inline-end]:pr-3 has-data-[icon=inline-start]:pl-3 [&_svg:not([class*='size-'])]:size-4",
        touch:
          "min-h-11 gap-2 px-4 text-sm [&_svg:not([class*='size-'])]:size-4",
        icon: "size-8 [@media(pointer:coarse)]:min-h-11 [@media(pointer:coarse)]:min-w-11 [&_svg:not([class*='size-'])]:size-4",
        "icon-xs": "size-6 rounded-sm [&_svg:not([class*='size-'])]:size-3",
        "icon-sm": "size-7 [&_svg:not([class*='size-'])]:size-3.5",
        "icon-lg":
          "size-9 [@media(pointer:coarse)]:min-h-11 [@media(pointer:coarse)]:min-w-11 [&_svg:not([class*='size-'])]:size-4",
        "icon-touch": "size-11 [&_svg:not([class*='size-'])]:size-5",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  }
)

const spinnerSizes = {
  default: "size-3.5",
  xs: "size-3",
  sm: "size-3.5",
  lg: "size-4",
  touch: "size-4",
  icon: "size-3.5",
  "icon-xs": "size-3",
  "icon-sm": "size-3.5",
  "icon-lg": "size-4",
  "icon-touch": "size-4",
} as const

// pending: the press is waiting for the Host. The label keeps its place (and the
// accessible name) while a spinner sits in the middle, so the button never
// changes width, and the button stays disabled so the request is not sent twice.
function Button({
  className,
  variant = "default",
  size = "default",
  asChild = false,
  pending = false,
  disabled,
  children,
  ...props
}: React.ComponentProps<"button"> &
  VariantProps<typeof buttonVariants> & {
    asChild?: boolean
    pending?: boolean
  }) {
  const Comp = asChild ? Slot.Root : "button"

  return (
    <Comp
      data-slot="button"
      data-variant={variant}
      data-size={size}
      className={cn(
        buttonVariants({ variant, size, className }),
        pending && "relative disabled:opacity-100"
      )}
      disabled={disabled || pending}
      aria-busy={pending || undefined}
      {...props}
    >
      {pending ? (
        <>
          <span className="inline-flex items-center gap-1.5 opacity-0">
            {children}
          </span>
          <Spinner
            aria-hidden="true"
            role={undefined}
            aria-label={undefined}
            className={cn(
              "absolute inset-0 m-auto motion-reduce:animate-none",
              spinnerSizes[size ?? "default"]
            )}
          />
        </>
      ) : (
        children
      )}
    </Comp>
  )
}

export { Button, buttonVariants }
