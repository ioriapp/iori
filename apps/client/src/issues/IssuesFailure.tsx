import {
  ForgeFailure,
  forgeFailureOf,
  type ForgeRecovery,
} from "../forge/ForgeFailure.tsx";
import { translator } from "../i18n.ts";

/** The Issues screen's failures to read the Forge, in the list or the Issue. */
export function IssuesFailure({
  subject,
  error,
  locale,
  recovery,
  form,
}: {
  subject: "list" | "issue" | "labels";
  error: unknown;
  locale: string;
  recovery: ForgeRecovery;
  /** In place of the content, or above the content kept. */
  form: "notice" | "line";
}) {
  const ja = locale.startsWith("ja");
  const t = translator(locale);
  return (
    <ForgeFailure
      form={form}
      state="issues-failure"
      retryAction="issues-retry"
      subject={
        subject === "labels"
          ? t("Could not load labels.")
          : subject === "list"
            ? ja
              ? "Issueを読み込めませんでした。"
              : "Could not read the Issues."
            : ja
              ? "このIssueを読み込めませんでした。"
              : "Could not read this Issue."
      }
      failure={forgeFailureOf(error)}
      locale={locale}
      recovery={recovery}
    />
  );
}
