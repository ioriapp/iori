// Capabilities selected by the monitoring request, never by the CLI's current behavior.
export const capabilities = {
  hermes: {
    fakeModel: true,
    approval: true,
    unsupported: {
      approval:
        "Hermesは承認の種類をextra.kindに返すが、ioriの定義は入れ子の条件を読めず、実行内容の要約も取得しない",
      resume:
        "HermesのgatewayがPTY終了後も存続し、分離Hostの停止と回収で終了待ちになる",
    },
  },
  "kimi-code": {
    fakeModel: false,
    catalog: "モデル候補は既存の固定候補であり、実物の一覧の確認ではない",
    pending:
      "最初の依頼の応答がなく、入力準備の判定が未解決。偽APIによる全契約の監視には未組込み",
  },
  vibe: {
    fakeModel: true,
    approval: true,
    unsupported: {
      approval:
        "Vibeのapproval_requested通知は道具名だけを返す。実行内容の要約にはpre_toolの入力との対応づけが必要",
    },
  },
  vtcode: {
    fakeModel: false,
    catalog: "実物のmodels listは一部の候補だけを表示する",
    pending:
      "最初の依頼の応答がなく、入力準備の判定が未解決。偽APIによる全契約の監視には未組込み",
  },
  claude: { fakeModel: true, approval: true },
  codex: { fakeModel: true, approval: true },
  pi: { fakeModel: true, approval: false },
  opencode: { fakeModel: true, approval: true },
  omp: { fakeModel: true, approval: true },
  cursor: { fakeModel: false, catalog: "ログインが要るので確かめない" },
  antigravity: { fakeModel: false, catalog: "ログインが要るので確かめない" },
  "muse-code": { fakeModel: false, catalog: "ログインが要るので確かめない" },
};
