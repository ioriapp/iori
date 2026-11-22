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
      className={cn("fixed inset-0 z-(--z-modal) bg-scrim", className)}
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
  return (
    <DialogPortal>
      <DialogOverlay />
      <DialogPrimitive.Content
        onOpenAutoFocus={(event) => {
          onOpenAutoFocus?.(event)
          if (event.defaultPrevented) return
          const dialog = event.target as HTMLElement
          const buttons = dialog.querySelectorAll<HTMLButtonElement>(
            '[data-slot="dialog-footer"] button:not(:disabled)'
          )
          const input = dialog.querySelector(
            'input:not([type="checkbox"]):not([type="radio"]):not([type="hidden"]), textarea, [contenteditable="true"]'
          )
          const first = Array.from(
            dialog.querySelectorAll<HTMLElement>(
              "button, input, textarea, select, [tabindex]"
            )
          ).find(
            (element) =>
              element.tabIndex >= 0 &&
              !element.matches(":disabled") &&
              element.getClientRects().length > 0 &&
              getComputedStyle(element).visibility !== "hidden"
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
          "fixed top-1/2 left-1/2 z-(--z-modal) grid max-h-[calc(100dvh-2rem)] w-full max-w-[calc(100%-2rem)] -translate-x-1/2 -translate-y-1/2 gap-4 overflow-y-auto rounded-lg border border-border bg-popover p-5 text-sm text-popover-foreground shadow-lg outline-none focus-visible:outline-none sm:max-w-md has-data-[slot=dialog-body]:flex has-data-[slot=dialog-body]:flex-col",
          className
        )}
        {...props}
      >
        {children}
        {showCloseButton && (
          <DialogPrimitive.Close data-slot="dialog-close" asChild>
            <Button
              variant="ghost"
              className="absolute top-3 right-3"
              size="icon-sm"
            >
              <XIcon />
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
      className={cn("flex flex-col gap-1.5 pr-8", className)}
      {...props}
    />
  )
}

// Between the header and footer of a tall dialog, only this part scrolls.
function DialogBody({
  className,
  onScroll,
  ...props
}: React.ComponentProps<"div">) {
  const [body, setBody] = React.useState<HTMLDivElement | null>(null)
  const syncScrollable = React.useCallback((element: HTMLDivElement | null) => {
    if (!element) return
    const content = element.closest<HTMLElement>('[data-slot="dialog-content"]')
    if (!content) return
    const canScroll =
      element.scrollHeight > element.clientHeight &&
      element.scrollTop + element.clientHeight < element.scrollHeight - 1
    content.toggleAttribute("data-body-scrollable", canScroll)
  }, [])

  React.useEffect(() => {
    if (!body) return
    syncScrollable(body)
    const resize = new ResizeObserver(() => syncScrollable(body))
    resize.observe(body)
    return () => {
      resize.disconnect()
      body
        .closest<HTMLElement>('[data-slot="dialog-content"]')
        ?.removeAttribute("data-body-scrollable")
    }
  }, [body, syncScrollable])

  return (
    <div
      ref={setBody}
      data-slot="dialog-body"
      onScroll={(event) => {
        onScroll?.(event)
        syncScrollable(event.currentTarget)
      }}
      className={cn("-mx-5 grid min-h-0 gap-4 overflow-y-auto px-5", className)}
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
      className={cn(
        "font-heading text-base font-semibold text-foreground",
        className
      )}
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
        "[word-break:auto-phrase] text-sm text-muted-foreground *:[a]:underline *:[a]:underline-offset-3 *:[a]:hover:text-foreground",
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
