import {
  ForgeFailure,
  forgeFailureOf,
  type ForgeRecovery,
} from "../forge/ForgeFailure.tsx";

/** The Issues screen's failures to read the Forge, in the list or the Issue. */
export function IssuesFailure({
  subject,
  error,
  locale,
  recovery,
  form,
}: {
  subject: "list" | "issue";
  error: unknown;
  locale: string;
  recovery: ForgeRecovery;
  /** In place of the content, or above the content kept. */
  form: "notice" | "line";
}) {
  const ja = locale.startsWith("ja");
  return (
    <ForgeFailure
      form={form}
      state="issues-failure"
      retryAction="issues-retry"
      subject={
        subject === "list"
          ? ja
            ? "Issueを読めませんでした。"
            : "Could not read the Issues."
          : ja
            ? "このIssueを読めませんでした。"
            : "Could not read this Issue."
      }
      failure={forgeFailureOf(error)}
      locale={locale}
      recovery={recovery}
    />
  );
}
