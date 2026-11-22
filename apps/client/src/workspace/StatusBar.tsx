import { Button } from "../components/ui/button.tsx";
import { StatusDot } from "../components/StatusDot.tsx";
import { registerLowerBand } from "../components/flow/lower-band-inset.ts";
import { connection } from "../connection.ts";
import { UsageStatus } from "../usage/UsageStatus.tsx";
import type { WorkspaceFrameProps } from "./types.ts";

export function StatusBar({
  state,
  t,
  showConnection,
  disconnectedSeconds,
  staleNote,
  language,
  clisRevision,
  usageHost,
  defaultShellChange,
}: { usageHost: string } & Pick<
  WorkspaceFrameProps,
  | "state"
  | "t"
  | "showConnection"
  | "disconnectedSeconds"
  | "staleNote"
  | "language"
  | "clisRevision"
  | "defaultShellChange"
>) {
  const reconnecting =
    !state.connected && !state.revoked && disconnectedSeconds >= 5;
  return (
    <div
      ref={registerLowerBand}
      className="status-bar relative flex h-[1.375rem] min-h-[1.375rem] shrink-0 items-center justify-start gap-3 overflow-visible border-t border-border bg-sidebar pr-0.5 pl-2 text-2xs font-normal whitespace-nowrap text-muted-foreground [scrollbar-width:none] md:text-xs [&>span]:inline-flex [&>span]:shrink-0 [&>span]:items-center [&>span]:gap-1.5 [&_[data-slot=button]]:h-[1.125rem] [&_[data-slot=button]]:px-1.5 [&_[data-slot=button]]:text-2xs [&_[data-slot=button]]:font-normal [&_[data-slot=button]]:text-muted-foreground md:[&_[data-slot=button]]:text-xs"
    >
      {showConnection && state.host && state.connected && (
        <span data-iori-state="connected">
          <StatusDot
            state="active"
            animated={false}
            aria-label={t("Connected")}
          />
          {t("Connected")}
        </span>
      )}
      {showConnection && state.host && reconnecting && (
        <span data-iori-state="disconnected">
          <StatusDot state="stopped" aria-label={t("Reconnecting…")} />
          {t("Reconnecting…")}
          <Button
            variant="ghost"
            size="sm"
            data-iori-action="reconnect"
            onClick={() => void connection.reconnect()}
          >
            {t("Reconnect")}
          </Button>
        </span>
      )}
      {showConnection && staleNote && <span>{staleNote}</span>}
      <UsageStatus
        key={usageHost}
        hostKey={usageHost}
        connected={state.connectedHosts.includes(usageHost)}
        revision={`${clisRevision}:${defaultShellChange?.revision ?? 0}:${state.connectedHosts.join(",")}`}
        language={language}
      />
    </div>
  );
}
