"use client"

import * as React from "react"
import { cn } from "cn"
import { Dialog as DialogPrimitive } from "radix-ui"

import { Button } from "@/components/ui/button"
import { XIcon } from "lucide-react"
import "./dialog-full-screen.css"

function Dialog({
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Root>) {
  return <DialogPrimitive.Root data-slot="dialog" {...props} />
}

function DialogTrigger({
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Trigger>) {
  return <DialogPrimitive.Trigger data-slot="dialog-trigger" {...props} />
}

function DialogPortal({
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Portal>) {
  return <DialogPrimitive.Portal data-slot="dialog-portal" {...props} />
}

function DialogClose({
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Close>) {
  return <DialogPrimitive.Close data-slot="dialog-close" {...props} />
}

function DialogOverlay({
  className,
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Overlay>) {
  return (
    <DialogPrimitive.Overlay
      data-slot="dialog-overlay"
      className={cn(
        "fixed inset-0 z-50 bg-(--modal-scrim)",
        className
      )}
      {...props}
    />
  )
}

function DialogContent({
  className,
  children,
  showCloseButton = true,
  onOpenAutoFocus,
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Content> & {
  showCloseButton?: boolean
}) {
  const [content, setContent] = React.useState<HTMLDivElement | null>(null)
  React.useEffect(() => {
    if (!content) return
    const update = () => {
      const body = content.querySelector<HTMLElement>('[data-slot="dialog-body"]')
      const areas = body ? [body, ...body.querySelectorAll<HTMLElement>("*")] : []
      const canScroll = areas.some((area) => {
        const overflow = getComputedStyle(area).overflowY
        return (overflow === "auto" || overflow === "scroll") &&
          area.scrollHeight > area.clientHeight &&
          area.scrollTop + area.clientHeight < area.scrollHeight - 1
      })
      content.toggleAttribute("data-body-scrollable", canScroll)
    }
    const resize = new ResizeObserver(update)
    const observe = () => {
      resize.disconnect()
      resize.observe(content)
      content.querySelectorAll<HTMLElement>('[data-slot="dialog-body"], [data-slot="dialog-body"] *').forEach((node) => resize.observe(node))
      update()
    }
    const mutation = new MutationObserver(observe)
    mutation.observe(content, { childList: true, subtree: true })
    content.addEventListener("scroll", update, true)
    observe()
    return () => {
      resize.disconnect()
      mutation.disconnect()
      content.removeEventListener("scroll", update, true)
    }
  }, [content])
  return (
    <DialogPortal>
      <DialogOverlay />
      <DialogPrimitive.Content
        ref={setContent}
        onOpenAutoFocus={(event) => {
          onOpenAutoFocus?.(event)
          if (event.defaultPrevented) return
          const dialog = event.target as HTMLElement
          const buttons = dialog.querySelectorAll<HTMLButtonElement>('[data-slot="dialog-footer"] button:not(:disabled)')
          const input = dialog.querySelector('input:not([type="checkbox"]):not([type="radio"]):not([type="hidden"]), textarea, [contenteditable="true"]')
          const first = Array.from(dialog.querySelectorAll<HTMLElement>('button, input, textarea, select, [tabindex]')).find(
            (element) => element.tabIndex >= 0 && !element.matches(':disabled') && element.getClientRects().length > 0 && getComputedStyle(element).visibility !== 'hidden'
          )
          if (!input && buttons.length > 1) {
            event.preventDefault()
            buttons[0].focus({ preventScroll: true })
          } else if (!input || first?.matches('[data-slot="dialog-close"]')) {
            event.preventDefault()
            dialog.focus({ preventScroll: true })
          }
        }}
        data-slot="dialog-content"
        tabIndex={-1}
        className={cn(
          "fixed top-1/2 left-1/2 z-50 grid max-h-[calc(100dvh-2rem)] w-full max-w-[calc(100%-2rem)] -translate-x-1/2 -translate-y-1/2 gap-4 overflow-y-auto rounded-xl bg-popover p-4 text-xs/relaxed text-popover-foreground ring-1 ring-foreground/10 outline-none sm:max-w-sm has-data-[slot=dialog-body]:flex has-data-[slot=dialog-body]:flex-col",
          className
        )}
        {...props}
      >
        {children}
        {showCloseButton && (
          <DialogPrimitive.Close data-slot="dialog-close" asChild>
            <Button
              variant="ghost"
              className="absolute top-2 right-2"
              size="icon-sm"
            >
              <XIcon
              />
              <span className="sr-only">Close</span>
            </Button>
          </DialogPrimitive.Close>
        )}
      </DialogPrimitive.Content>
    </DialogPortal>
  )
}

function DialogHeader({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="dialog-header"
      className={cn("flex flex-col gap-1", className)}
      {...props}
    />
  )
}

// Between the header and footer of a tall dialog, only this part scrolls.
function DialogBody({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="dialog-body"
      className={cn("-mx-4 grid min-h-0 gap-4 overflow-y-auto px-4", className)}
      {...props}
    />
  )
}

function DialogFooter({
  className,
  showCloseButton = false,
  children,
  ...props
}: React.ComponentProps<"div"> & {
  showCloseButton?: boolean
}) {
  return (
    <div
      data-slot="dialog-footer"
      className={cn(
        "flex flex-col-reverse gap-2 sm:flex-row sm:justify-end",
        className
      )}
      {...props}
    >
      {children}
      {showCloseButton && (
        <DialogPrimitive.Close asChild>
          <Button variant="outline">Close</Button>
        </DialogPrimitive.Close>
      )}
    </div>
  )
}

function DialogTitle({
  className,
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Title>) {
  return (
    <DialogPrimitive.Title
      data-slot="dialog-title"
      className={cn("font-heading text-sm font-medium", className)}
      {...props}
    />
  )
}

function DialogDescription({
  className,
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Description>) {
  return (
    <DialogPrimitive.Description
      data-slot="dialog-description"
      className={cn(
        "[word-break:auto-phrase] text-xs/relaxed text-muted-foreground *:[a]:underline *:[a]:underline-offset-3 *:[a]:hover:text-foreground",
        className
      )}
      {...props}
    />
  )
}

export {
  Dialog,
  DialogBody,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogOverlay,
  DialogPortal,
  DialogTitle,
  DialogTrigger,
}
