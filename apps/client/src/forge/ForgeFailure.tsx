import type { ComponentProps, ReactNode } from "react";
import type { ForgeReadFailure } from "@iori/protocol";
import { Button } from "../components/ui/button.tsx";
import { withCode } from "../GitSettings.tsx";
import { translator } from "../i18n.ts";
import { ReadError } from "../reading/transport.ts";
import "./forge-notice.css";

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
  ...props
}: Omit<ComponentProps<typeof Button>, "variant" | "size"> & {
  compact?: boolean;
}) {
  return <Button variant="outline" size={compact ? "xs" : "sm"} {...props} />;
}

/**
 * A message where a CI or Issues View's content would be: that there is
 * nothing to show, or that the first read failed.
 */
export function ForgeNotice({
  failed = false,
  className = "",
  ...props
}: ComponentProps<"div"> & { failed?: boolean }) {
  return (
    <div
      className={`forge-notice ${failed ? "is-failure" : ""} ${className}`}
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
  const Line = compact ? "span" : "p";
  const content = (
    <>
      <Line className="forge-failure-heading">{subject}</Line>
      {explained && (
        <Line className="forge-failure-reason" data-iori-part="forge-failure">
          {explained.text}
        </Line>
      )}
      {button}
    </>
  );
  const marks = {
    "data-iori-state": state,
    "data-iori-forge-failure": failure?.reason,
  };
  if (form === "notice")
    return (
      <ForgeNotice failed role="alert" {...marks}>
        {content}
      </ForgeNotice>
    );
  if (compact)
    return (
      <span className="forge-failure-inline" {...marks}>
        {content}
      </span>
    );
  return (
    <div className="forge-failure-line" role="alert" {...marks}>
      {content}
    </div>
  );
}
