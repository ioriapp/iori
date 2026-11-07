import { useEffect, useRef, useState, type ReactNode } from "react";
import { Check, ChevronDown, Info, TriangleAlert } from "lucide-react";
import { Button } from "../ui/button.tsx";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "../ui/collapsible.tsx";
import { Spinner } from "../ui/spinner.tsx";
import { native } from "../../native.ts";
import "./flow.css";

/** Host・端末・ユーザー・接続先などの名前を改行で割らない。 */
export function Name({ children }: { children: ReactNode }) {
  return <span className="host-flow-name">{children}</span>;
}

/** 文中の可変の名前を、見本の nm と同じ span にする。 */
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
    <P className={muted ? "host-setup-note" : "host-setup-text"} names={names}>
      {children}
    </P>
  );
}
export function Status({ children }: { children: ReactNode }) {
  return (
    <p className="host-setup-status" role="status">
      <Spinner aria-hidden="true" />
      {children}
    </p>
  );
}
export function Connecting({ t }: { t: (key: string) => string }) {
  return (
    <span className="host-connecting" role="status">
      <Spinner aria-hidden="true" />
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
  return (
    <div
      className={`host-notice is-${tone}`}
      role={tone === "info" ? undefined : "alert"}
    >
      <Icon aria-hidden="true" />
      <div className="body">
        {heading && <div className="heading">{rich(heading, names)}</div>}
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
  return <pre className="host-setup-original">{children}</pre>;
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
    <Collapsible
      open={open}
      onOpenChange={setOpen}
      className="host-ssh-original"
    >
      <CollapsibleTrigger asChild>
        <Button
          variant="outline"
          size="sm"
          className="host-ssh-original-trigger"
          aria-expanded={open}
        >
          {t("SSH output")}
          <ChevronDown className={open ? "is-open" : ""} />
        </Button>
      </CollapsibleTrigger>
      <CollapsibleContent>
        <Original>{children}</Original>
      </CollapsibleContent>
    </Collapsible>
  );
}
export function Mono({ children }: { children: string }) {
  return <code className="host-mono">{children}</code>;
}
export function Command({
  children,
  t,
}: {
  children: string;
  t: (key: string) => string;
}) {
  const [copied, setCopied] = useState(false);
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
  }, [children]);
  return (
    <div className="host-command">
      <code className="host-command-frame" ref={measure}>
        {children}
      </code>
      <Button
        variant="outline"
        size="sm"
        onClick={() => {
          void native.clipboardWrite(children).then(
            () => setCopied(true),
            () => setCopied(false),
          );
        }}
      >
        {copied && <Check />}
        {t("Copy")}
      </Button>
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
    <p className="host-setup-summary" title={children}>
      {rich(children, names)}
    </p>
  );
}
