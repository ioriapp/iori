import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { ArrowRight, CircleAlert } from "lucide-react";
import { CliIcon } from "./CliIcon.tsx";
import { CliStateDot } from "./CliStatus.tsx";
import { Button } from "./components/ui/button.tsx";
import { connection } from "./connection.ts";
import type { AttentionItem } from "./attention.ts";
import type { CliApproval } from "@iori/protocol";

export function MobileAttentionRow({
  item,
  location,
  approval,
  connected,
  onOpen,
  t,
}: {
  item: AttentionItem;
  location: string;
  approval?: CliApproval;
  connected: boolean;
  onOpen: () => void;
  t: (key: string) => string;
}) {
  const { host, terminal } = item;
  const detail = terminal.cliStatus?.attention;
  const [pending, setPending] = useState<"allow" | "deny">();
  const [failed, setFailed] = useState(false);
  const [unavailable, setUnavailable] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [hiddenLines, setHiddenLines] = useState(0);
  const code = useRef<HTMLElement>(null);
  const sending = useRef(false);
  const inline = approval && !unavailable;
  const command = inline
    ? (approval.command ??
      approval.paths?.join("\n") ??
      approval.resources?.join("\n"))
    : undefined;
  useLayoutEffect(() => {
    const element = code.current;
    if (!element) return;
    const measure = () => {
      const lineHeight = Number.parseFloat(
        getComputedStyle(element).lineHeight,
      );
      setHiddenLines(
        Math.max(0, Math.round(element.scrollHeight / lineHeight) - 6),
      );
    };
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, [command]);
  useEffect(() => {
    if (connected) setFailed(false);
  }, [connected]);
  async function respond(decision: "allow" | "deny") {
    if (!approval || sending.current) return;
    sending.current = true;
    setPending(decision);
    setFailed(false);
    try {
      const response = await connection.requestHost(
        host.publicKey,
        "terminal.approval.respond",
        { terminalId: terminal.id, approvalId: approval.id, decision },
      );
      if (!response?.ok) throw new Error("approval_send_failed");
      if (response.result.status === "unavailable") setUnavailable(true);
      // sent/stale wait for the Host's terminal update; do not resend.
    } catch {
      sending.current = false;
      setPending(undefined);
      setFailed(true);
    }
  }
  return (
    <article
      className={inline ? "mobile-approval-row" : undefined}
      data-iori-attention-terminal={terminal.id}
      onClick={(event) => {
        if (
          event.target instanceof Element &&
          event.target.closest("button, .mobile-approval-actions")
        )
          return;
        if (window.getSelection()?.isCollapsed === false) return;
        onOpen();
      }}
    >
      <button className="mobile-task" onClick={onOpen}>
        <div>
          <CliStateDot status={terminal.cliStatus} t={t} />
          {terminal.cli && (
            <CliIcon hostKey={host.publicKey} cli={terminal.cli} size={15} />
          )}
          <strong>{terminal.cli?.name}</strong>
          <span className="mobile-task-title">
            {terminal.title !== terminal.cli?.name ? terminal.title : ""}
          </span>
          <ArrowRight size={16} />
        </div>
        <p>{location}</p>
        <span>
          {t("Attention")} ·{" "}
          {t(detail?.kind === "question" ? "Question" : "Approval")}
          {(approval?.tool ?? detail?.tool)
            ? ` · ${approval?.tool ?? detail?.tool}`
            : ""}
        </span>
        {!inline && detail?.summary && <code>{detail.summary}</code>}
      </button>
      {command !== undefined && (
        <div
          className={`mobile-approval-command${!expanded ? " is-collapsed" : ""}`}
        >
          <code ref={code}>{command}</code>
        </div>
      )}
      {inline && !expanded && hiddenLines > 0 && (
        <Button
          variant="ghost"
          className="mobile-approval-expand"
          onClick={() => setExpanded(true)}
        >
          {t("Show all ({N} more lines)").replace("{N}", String(hiddenLines))}
        </Button>
      )}
      {failed && (
        <p className="mobile-approval-error" role="alert">
          <CircleAlert size={16} aria-hidden="true" />
          <span>
            {t("Could not send. Check the connection and try again.")}
          </span>
        </p>
      )}
      {inline && (
        <div className="mobile-approval-actions">
          <Button
            pending={pending === "allow"}
            disabled={!!pending}
            onClick={() => void respond("allow")}
          >
            {t("approval.allow")}
          </Button>
          <Button
            variant="outline"
            pending={pending === "deny"}
            disabled={!!pending}
            onClick={() => void respond("deny")}
          >
            {t("Deny")}
          </Button>
        </div>
      )}
    </article>
  );
}
