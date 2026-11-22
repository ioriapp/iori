import type { ComponentProps, ReactNode } from "react";
import { AlertCircle } from "lucide-react";
import type { ForgeReadFailure } from "@iori/protocol";
import { Button } from "../components/ui/button.tsx";
import { withCode } from "../GitSettings.tsx";
import { translator } from "../i18n.ts";
import { cn } from "../lib/utils.ts";
import { ReadError } from "../reading/transport.ts";

/** What the View around a failed Forge read lets the reader do about it. */
export type ForgeRecovery = {
  onRetry: () => void;
  /** The Host's Settings → Integrations. */
  onOpenIntegrations?: () => void;
  /** The workspace's Git settings: its remotes and their Web sites. */
  onOpenWorkspaceSettings?: () => void;
};

/** The Host's reason for a failed read, when it could tell one. */
export const forgeFailureOf = (error: unknown) =>
  error instanceof ReadError ? error.forge : undefined;

type Explained = {
  text: ReactNode;
  action: "integrations" | "workspace" | "retry";
};

function explain(
  failure: ForgeReadFailure,
  t: (key: string) => string,
  locale: string,
): Explained {
  // iori reads GitHub at github.com with the Host's gh sign-in.
  const github = failure.site === "https://github.com";
  const site = (key: string) => t(key).replace("{site}", failure.site);
  switch (failure.reason) {
    case "token-missing":
      return {
        text: !github
          ? site("No token is registered for {site}.")
          : failure.ghMissing
            ? withCode(t("gh was not found."), ["gh"])
            : withCode(
                t(
                  "This Host's gh is not signed in to GitHub. Run gh auth login in a Terminal on this Host.",
                ),
                ["gh auth login", "gh"],
              ),
        action: "integrations",
      };
    case "token-invalid":
      return {
        text: github
          ? withCode(t("GitHub does not accept this Host's gh sign-in."), [
              "gh",
            ])
          : site("{site} does not accept the token."),
        action: "integrations",
      };
    case "insufficient-scope":
      return {
        text: github
          ? t("No GitHub account on this Host can read this repository.")
          : failure.scope
            ? withCode(
                t("The token does not have the {scope} permission.").replace(
                  "{scope}",
                  failure.scope,
                ),
                [failure.scope],
              )
            : t("The token does not have enough permissions."),
        action: "integrations",
      };
    case "not-found":
      return {
        text: failure.repository
          ? t("The repository {repository} was not found.").replace(
              "{repository}",
              failure.repository,
            )
          : t("The repository was not found."),
        action: "workspace",
      };
    case "unreachable":
      return { text: site("Cannot connect to {site}."), action: "retry" };
    case "rate-limited":
      return {
        text:
          failure.resetAt === undefined
            ? site("{site} has reached its API rate limit.")
            : site(
                "{site} has reached its API rate limit. You can read again at {time}.",
              ).replace(
                "{time}",
                new Date(failure.resetAt).toLocaleTimeString(locale, {
                  hour: "2-digit",
                  minute: "2-digit",
                }),
              ),
        action: "retry",
      };
  }
}

/** The action of a Forge View's notice: a recovery, or clearing filters. */
export function ForgeAction({
  compact = false,
  className,
  ...props
}: Omit<ComponentProps<typeof Button>, "variant" | "size"> & {
  compact?: boolean;
}) {
  return (
    <Button
      variant="outline"
      size={compact ? "xs" : "sm"}
      className={cn(!compact && "[@media(pointer:coarse)]:min-h-10", className)}
      {...props}
    />
  );
}

/**
 * A message where a CI or Issues View's content would be: that there is
 * nothing to show, or that the first read failed.
 */
export function ForgeNotice({
  failed = false,
  className,
  ...props
}: ComponentProps<"div"> & { failed?: boolean }) {
  return (
    <div
      className={cn(
        failed
          ? "m-4 flex flex-col items-center justify-center gap-3 rounded-md border border-status-failed-border bg-status-failed-bg/35 px-6 py-9 text-center text-sm text-foreground [&_p]:m-0 [&_p]:[overflow-wrap:anywhere]"
          : "m-0 flex flex-1 flex-col items-center justify-center gap-3 px-6 py-12 text-center text-sm text-muted-foreground [&_p]:m-0 [&_p]:[overflow-wrap:anywhere]",
        className,
      )}
      {...props}
    />
  );
}

/**
 * The one place that words a failed Forge read and its recovery for the CI
 * and Issues Views (forge.md「失敗の示し方」): what could not be read, why,
 * and the action that helps. Without a reason from the Host, it offers a
 * retry. With nothing else to show it takes the content's place; when the
 * View keeps what it read last, it is one line under the head (ui.md「読め
 * なかった時の見た目」).
 */
export function ForgeFailure({
  subject,
  failure,
  locale,
  recovery,
  state,
  retryAction,
  form,
  className,
}: {
  /** What could not be read, as a sentence. */
  subject: string;
  failure?: ForgeReadFailure;
  locale: string;
  recovery: ForgeRecovery;
  /** The View's own data-iori-state for this failure. */
  state: string;
  /** The View's own data-iori-action for its retry. */
  retryAction: string;
  /**
   * `notice` in place of the content, `line` under the head above the kept
   * content, `inline` inside a log line.
   */
  form: "notice" | "line" | "inline";
  className?: string;
}) {
  const t = translator(locale);
  const explained = failure && explain(failure, t, locale);
  const action = explained?.action ?? "retry";
  const open =
    action === "integrations"
      ? recovery.onOpenIntegrations
      : action === "workspace"
        ? recovery.onOpenWorkspaceSettings
        : undefined;
  const compact = form === "inline";
  const button = open ? (
    <ForgeAction
      compact={compact}
      data-iori-action={
        action === "integrations"
          ? "forge-open-integrations"
          : "forge-open-workspace-settings"
      }
      onClick={open}
    >
      {t(
        action === "integrations"
          ? "Open Integrations"
          : "Open workspace settings",
      )}
    </ForgeAction>
  ) : (
    <ForgeAction
      compact={compact}
      data-iori-action={retryAction}
      onClick={recovery.onRetry}
    >
      {t("Retry")}
    </ForgeAction>
  );
  const marks = {
    "data-iori-state": state,
    "data-iori-forge-failure": failure?.reason,
  };
  if (form === "notice")
    return (
      <ForgeNotice failed role="alert" className={className} {...marks}>
        <div className="flex size-9 items-center justify-center rounded-md border border-status-failed-border bg-status-failed-bg text-status-failed-text">
          <AlertCircle className="size-4" aria-hidden="true" />
        </div>
        <div className="flex min-w-0 max-w-md flex-col gap-1">
          <p className="text-sm font-semibold text-status-failed-text">
            {subject}
          </p>
          {explained && (
            <p
              className="text-xs text-foreground/90"
              data-iori-part="forge-failure"
            >
              {explained.text}
            </p>
          )}
        </div>
        {button}
      </ForgeNotice>
    );
  if (compact)
    return (
      <span
        className={cn(
          "inline-flex flex-wrap items-center gap-x-2 gap-y-1 rounded-md border border-status-failed-border bg-status-failed-bg/35 px-2 py-0.5 font-sans text-xs whitespace-normal text-foreground",
          className,
        )}
        {...marks}
      >
        <AlertCircle
          className="size-3 shrink-0 text-status-failed-text"
          aria-hidden="true"
        />
        <span className="font-semibold text-status-failed-text">{subject}</span>
        {explained && (
          <span className="text-foreground/90" data-iori-part="forge-failure">
            {explained.text}
          </span>
        )}
        {button}
      </span>
    );
  return (
    <div
      className={cn(
        "flex min-w-0 max-w-full flex-wrap items-center gap-x-2.5 gap-y-1.5 rounded-md border border-status-failed-border bg-status-failed-bg/35 px-3 py-2 text-xs text-foreground [&_p]:m-0 [&_p]:min-w-0 [&_p]:max-w-full [&_p]:[overflow-wrap:anywhere]",
        className,
      )}
      role="alert"
      {...marks}
    >
      <AlertCircle
        className="size-3.5 shrink-0 text-status-failed-text"
        aria-hidden="true"
      />
      <div className="flex min-w-0 flex-1 flex-wrap items-baseline gap-x-2 gap-y-0.5">
        <p className="font-semibold text-status-failed-text">{subject}</p>
        {explained && (
          <p className="text-foreground/90" data-iori-part="forge-failure">
            {explained.text}
          </p>
        )}
      </div>
      {button}
    </div>
  );
}
