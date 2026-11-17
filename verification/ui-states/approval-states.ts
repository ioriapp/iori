export const allStates = [
  {
    id: "approval-01",
    reference: "01-mobile",
    label: "Claude Code の承認が1件",
  },
  {
    id: "approval-02",
    reference: "02-mobile",
    label: "長いコマンド（6行を超える）",
  },
  {
    id: "approval-02-expanded",
    reference: "02-expanded-mobile",
    label: "長いコマンドの全文",
  },
  {
    id: "approval-03",
    reference: "03-mobile",
    label: "3件の承認と Codex の承認1件",
  },
  { id: "approval-04", reference: "04-mobile", label: "許可の送信中" },
  { id: "approval-05", reference: "05-mobile", label: "CLI に届いた後" },
  { id: "approval-06", reference: "06-mobile", label: "送信の失敗" },
  {
    id: "approval-07",
    reference: "07-mobile",
    label: "CLI の画面で先に回答した後",
  },
  { id: "approval-08", reference: "08-mobile", label: "Claude Code の質問" },
  { id: "approval-09", reference: "09-mobile", label: "承認が0件" },
  { id: "approval-10", reference: "10-mobile", label: "同じ Agent の次の承認" },
  {
    id: "approval-11",
    reference: "11-mobile",
    label: "再接続の後（回答済み）",
  },
  {
    id: "approval-12",
    reference: "12-mobile",
    label: "再接続の後（回答待ち）",
  },
  { id: "approval-deny", label: "拒否の送信中" },
  { id: "approval-unavailable", label: "回答できない承認" },
];
