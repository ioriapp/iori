const terms = new Set([
  "Board",
  "Records",
  "Attention",
  "You",
  "Parent",
  "Approval",
  "No candidate",
  "Report",
  "Question",
  "Plan",
  "Goal",
  "Agents",
  "Starting",
  "Running",
  "Thinking",
  "Waiting",
  "Reported",
  "Finished",
  "Pending",
  "Accepted",
  "Rejected",
  "Revisions",
  "Added",
  "Cancelled",
  "Activity",
  "Tokens",
  "Candidate",
  "Tasks",
  "Team",
  "Version",
  "Difficulty",
  "High",
  "Medium",
  "Low",
  "Handoff",
  "Delegated",
  "Revise",
  "Stopped",
  "Failed",
]);
const japanese: Record<string, string> = {
  "Tokens (input + output)": "Tokens（入力＋出力）",
  "First acceptance": "初回受入",
  Changes: "変更",
  Period: "期間",
  "Choose dates": "日付を指定",
  "Start date": "開始日",
  "End date (optional)": "終了日（任意）",
  "X axis": "横軸",
  "Clear filters": "絞り込みを解除",
  "Delegating work in a team will leave records here.":
    "Teamで委譲した作業の記録がここに表示されます。",
  "All time": "すべて",
  All: "すべて",
  "7 days": "7日",
  "30 days": "30日",
  "90 days": "90日",
  "Show all": "すべて表示",
  "Show less": "折りたたむ",
  "Previous goal": "前の目標",
  "Goal updated after your request": "追加の指示で目標を更新",
  "Parent updated the plan": "親が計画を更新",
  "Plan updated after your request": "追加の指示で計画を更新",
  "Open final screen": "最後の画面を開く",
  "Open parent conversation": "親の会話を開く",
  "Open conversation": "会話を開く",
  "Edit team": "Teamを編集",
  "No matching records": "条件に合う記録はありません",
  "No plan yet": "計画はまだありません",
  "No agents yet": "子への委譲はまだありません",
  "No team conversation": "Teamを使った会話はありません",
  "Awaiting parent decision": "親の判定待ち",
  "Awaiting the parent's answer": "親の回答待ち",
  Capacity: "同時実行の上限で待機中",
  Back: "戻る",
  Conversation: "会話",
  Retry: "再試行",
  "Could not load records. Retry.":
    "記録を読み込めませんでした。もう一度お試しください。",
  "Could not load Board": "Boardを読み込めませんでした",
  "Could not load history": "履歴を読み込めませんでした",
};
export function boardTranslator(t: (key: string) => string, language: string) {
  return (key: string) =>
    terms.has(key)
      ? key
      : language.toLowerCase().startsWith("ja")
        ? (japanese[key] ?? t(key))
        : key;
}
export function compactNumber(value: number) {
  const divisor = value >= 1_000_000 ? 1_000_000 : value >= 1000 ? 1000 : 1;
  return (
    new Intl.NumberFormat("en", { maximumFractionDigits: 1 }).format(
      value / divisor,
    ) + (divisor === 1_000_000 ? "M" : divisor === 1000 ? "k" : "")
  );
}
export function elapsedTime(value: number) {
  const seconds = Math.max(0, Math.floor(value / 1000));
  return seconds < 60
    ? `${seconds}s`
    : seconds < 3600
      ? `${Math.floor(seconds / 60)}m`
      : `${Math.floor(seconds / 3600)}h ${Math.floor((seconds % 3600) / 60)}m`;
}
export function timeOf(at: number, language: string) {
  return new Date(at).toLocaleTimeString(language, {
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function recordMeasurement(
  value: string | undefined,
  measured: number,
  total: number,
  language: string,
): string | undefined {
  if (value === undefined) return undefined;
  if (measured === total) return value;
  return language.toLowerCase().startsWith("ja")
    ? `${value}（${measured}人分）`
    : `${value} (${measured} agents)`;
}
