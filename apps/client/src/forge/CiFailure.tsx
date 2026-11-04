import type { ForgeReadFailure } from "@iori/protocol";
import { ForgeFailure, type ForgeRecovery } from "./ForgeFailure.tsx";

/** What could not be read: the CI, a job's log, or an earlier part of the log. */
export type CiFailureSubject = "ci" | "log" | "earlier";

const names = {
  ci: { state: "ci-failed", action: "ci-retry" },
  log: { state: "ci-log-failed", action: "ci-log-retry" },
  earlier: { state: "ci-log-earlier-failed", action: "ci-log-earlier-retry" },
} satisfies Record<CiFailureSubject, { state: string; action: string }>;

/** The CI View's failures to read the Forge, worded as every Forge read. */
export function CiFailure({
  subject,
  failure,
  locale,
  recovery,
  form,
}: {
  subject: CiFailureSubject;
  failure?: ForgeReadFailure;
  locale: string;
  recovery: ForgeRecovery;
  /** In place of the content, above the content kept, or in a log line. */
  form: "notice" | "line" | "inline";
}) {
  const ja = locale.startsWith("ja");
  const text =
    subject === "ci"
      ? ja
        ? "CIを読めませんでした。"
        : "Could not read the CI."
      : subject === "log"
        ? ja
          ? "ログを読めませんでした。"
          : "Could not read the log."
        : ja
          ? "前のログを読めませんでした。"
          : "Could not read the earlier log.";
  return (
    <ForgeFailure
      form={form}
      state={names[subject].state}
      retryAction={names[subject].action}
      subject={text}
      failure={failure}
      locale={locale}
      recovery={recovery}
    />
  );
}
