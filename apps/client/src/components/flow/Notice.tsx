import { useEffect, useRef, useState, type ReactNode } from "react";
import { cn } from "cn";
import { Check, ChevronDown, Info, TriangleAlert } from "lucide-react";
import { Button } from "../ui/button.tsx";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "../ui/collapsible.tsx";
import { Spinner } from "../ui/spinner.tsx";
import { native } from "../../native.ts";

/** Host・端末・ユーザー・接続先などの名前を改行で割らない。 */
export function Name({ children }: { children: ReactNode }) {
  return <span className="whitespace-nowrap">{children}</span>;
}

/** 文中の可変の名前を、改行で割らない span にする。 */
export function rich(
  node: ReactNode,
  names: readonly string[] = [],
): ReactNode {
  if (typeof node !== "string") return node;
  const pattern = [
    ...new Set([
      ...names,
      "iori Host",
      "Linux x64",
      "Windows x64",
      "Linux arm64",
      "このデバイス",
    ]),
  ]
    .filter(Boolean)
    .sort((a, b) => b.length - a.length)
    .map((name) => name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
    .join("|");
  return node
    .split(new RegExp(`(${pattern})`, "g"))
    .map((part, index) => (index % 2 ? <Name key={index}>{part}</Name> : part));
}

export function P({
  children,
  className,
  names,
}: {
  children: ReactNode;
  className?: string;
  names?: readonly string[];
}) {
  return <p className={className}>{rich(children, names)}</p>;
}

export function Text({
  children,
  muted = false,
  names,
}: {
  children: ReactNode;
  muted?: boolean;
  names?: readonly string[];
}) {
  return (
    <P
      className={
        muted
          ? "m-0 text-xs text-muted-foreground [overflow-wrap:anywhere]"
          : "m-0 text-sm text-foreground [overflow-wrap:anywhere]"
      }
      names={names}
    >
      {children}
    </P>
  );
}

export function Status({ children }: { children: ReactNode }) {
  return (
    <p
      className="m-0 flex items-center gap-2 text-sm text-foreground"
      role="status"
    >
      <Spinner aria-hidden="true" className="shrink-0 text-muted-foreground" />
      {children}
    </p>
  );
}

export function Connecting({ t }: { t: (key: string) => string }) {
  return (
    <span className="inline-flex items-center gap-1.5" role="status">
      <Spinner aria-hidden="true" className="size-3.5 shrink-0" />
      {t("Connecting")}
    </span>
  );
}

export function Notice({
  tone,
  heading,
  children,
  names,
}: {
  tone: "error" | "warning" | "info";
  heading?: ReactNode;
  children: ReactNode;
  names?: readonly string[];
}) {
  const Icon = tone === "info" ? Info : TriangleAlert;
  const surfaceClass =
    tone === "error"
      ? "border-status-failed-border bg-status-failed-bg/35"
      : tone === "warning"
        ? "border-status-waiting-border bg-status-waiting-bg/35"
        : "border-border-subtle bg-muted/40";
  const iconClass =
    tone === "error"
      ? "text-status-failed"
      : tone === "warning"
        ? "text-status-waiting"
        : "text-muted-foreground";
  const headingClass =
    tone === "error"
      ? "font-semibold text-status-failed-text"
      : tone === "warning"
        ? "font-semibold text-status-waiting-text"
        : "font-semibold text-foreground";
  return (
    <div
      className={cn(
        "grid grid-cols-[1rem_minmax(0,1fr)] items-start gap-2 rounded-md border px-3 py-2.5 text-sm text-foreground",
        surfaceClass,
      )}
      role={tone === "info" ? undefined : "alert"}
    >
      <Icon
        aria-hidden="true"
        className={cn("mt-0.5 size-4 shrink-0", iconClass)}
      />
      <div
        className={cn(
          "grid min-w-0 justify-items-stretch gap-2",
          "[&_p]:m-0 [&_p]:[overflow-wrap:anywhere]",
          "[&>[data-slot=button]]:justify-self-start",
          "[&_.lines]:grid [&_.lines]:min-w-0 [&_.lines]:gap-0.5 [&_.lines]:font-mono [&_.lines]:text-xs [&_.lines]:[overflow-wrap:anywhere]",
          "[&_.lines.is-plain]:font-sans [&_.lines.is-plain]:text-sm",
        )}
      >
        {heading && <div className={headingClass}>{rich(heading, names)}</div>}
        {rich(children, names)}
      </div>
    </div>
  );
}

export function Failure({
  heading,
  children,
}: {
  heading?: ReactNode;
  children: ReactNode;
}) {
  return (
    <Notice tone="error" heading={heading}>
      {children}
    </Notice>
  );
}

export function Warning({ children }: { children: ReactNode }) {
  return <Notice tone="warning">{children}</Notice>;
}

export function Original({ children }: { children: string }) {
  return (
    <pre className="m-0 rounded-md border border-border-subtle bg-muted/40 px-2.5 py-2 font-mono text-xs leading-normal whitespace-pre-wrap [overflow-wrap:anywhere] text-muted-foreground [font-variant-ligatures:none]">
      {children}
    </pre>
  );
}

export function SshOriginal({
  children,
  initialOpen = false,
  t,
}: {
  children: string;
  initialOpen?: boolean;
  t: (key: string) => string;
}) {
  const [open, setOpen] = useState(initialOpen);
  return (
    <Collapsible open={open} onOpenChange={setOpen} className="grid gap-1.5">
      <CollapsibleTrigger asChild>
        <Button
          variant="outline"
          size="sm"
          className="justify-self-start text-muted-foreground"
          aria-expanded={open}
        >
          {t("SSH output")}
          <ChevronDown
            className={cn(
              "size-3.5 transition-transform",
              open && "rotate-180",
            )}
            aria-hidden="true"
          />
        </Button>
      </CollapsibleTrigger>
      <CollapsibleContent>
        <Original>{children}</Original>
      </CollapsibleContent>
    </Collapsible>
  );
}

export function Mono({ children }: { children: string }) {
  return (
    <code className="font-mono text-[0.92em] [font-variant-ligatures:none]">
      {children}
    </code>
  );
}

export function Command({
  children,
  t,
}: {
  children: string;
  t: (key: string) => string;
}) {
  const [copied, setCopied] = useState(false);
  const [copyError, setCopyError] = useState(false);
  const cleanup = useRef<(() => void) | undefined>(undefined);
  const measure = (element: HTMLElement | null) => {
    cleanup.current?.();
    cleanup.current = undefined;
    if (!element) return;
    let mounted = true;
    const update = () => {
      element.dataset.right = String(
        element.scrollLeft + element.clientWidth < element.scrollWidth - 1,
      );
      element.dataset.left = String(element.scrollLeft > 1);
    };
    const toEnd = () => {
      if (mounted) {
        element.scrollLeft = element.scrollWidth;
        update();
      }
    };
    const observer = new ResizeObserver(toEnd);
    observer.observe(element);
    void document.fonts.ready.then(toEnd);
    element.addEventListener("scroll", update);
    cleanup.current = () => {
      mounted = false;
      observer.disconnect();
      element.removeEventListener("scroll", update);
    };
  };
  useEffect(() => {
    setCopied(false);
    setCopyError(false);
  }, [children]);
  return (
    <div className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-2">
      <code
        className={cn(
          "min-w-0 overflow-x-auto rounded-md border border-border-subtle bg-muted px-3 py-1.5 font-mono text-xs leading-relaxed whitespace-pre [font-variant-ligatures:none] [scrollbar-width:none]",
          "data-[right=true]:[mask-image:linear-gradient(to_right,var(--foreground)_calc(100%-1.75rem),transparent)]",
          "data-[left=true]:[mask-image:linear-gradient(to_right,transparent,var(--foreground)_1.75rem)]",
          "data-[left=true]:data-[right=true]:[mask-image:linear-gradient(to_right,transparent,var(--foreground)_1.75rem,var(--foreground)_calc(100%-1.75rem),transparent)]",
        )}
        ref={measure}
      >
        {children}
      </code>
      <Button
        variant="outline"
        size="sm"
        onClick={() => {
          void native.clipboardWrite(children).then(
            () => {
              setCopied(true);
              setCopyError(false);
            },
            () => {
              setCopied(false);
              setCopyError(true);
            },
          );
        }}
      >
        {copied && <Check />}
        {t("Copy")}
      </Button>
      {copyError && (
        <p
          role="alert"
          className="col-span-full m-0 text-xs text-status-failed-text"
        >
          {t("Could not copy. Select the text and copy it.")}
        </p>
      )}
    </div>
  );
}

export function Summary({
  children,
  names,
}: {
  children: string;
  names?: readonly string[];
}) {
  return (
    <p
      className="m-0 truncate text-sm font-medium text-foreground"
      title={children}
    >
      {rich(children, names)}
    </p>
  );
}
