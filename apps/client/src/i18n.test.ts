import assert from "node:assert/strict";
import test from "node:test";
import { translator } from "./i18n.ts";
import { boardTranslator } from "./teams/board-i18n.ts";

test("日本語の状態とラベルは Board と共通の翻訳で一致する", () => {
  const language = "ja-JP";
  const translate = translator(language);
  const board = boardTranslator(translate, language);
  const labels = {
    Connected: "接続済み",
    Disconnected: "未接続",
    Idle: "待機中",
    Exited: "終了",
    Running: "実行中",
    Starting: "起動中",
    Waiting: "待機中",
    Thinking: "考え中",
    Approval: "承認待ち",
    Question: "質問",
    Reported: "報告済み",
    "Not responding": "応答なし",
    Finished: "完了",
    Done: "完了",
    Pending: "判定待ち",
    Accepted: "承認済み",
    Rejected: "不採用",
    Cancelled: "キャンセル",
    Stopped: "停止",
    Failed: "失敗",
    Revisions: "差し戻し",
    Added: "追加",
    "No candidate": "候補なし",
    Candidate: "候補",
    Tasks: "タスク",
    Version: "バージョン",
    Difficulty: "難易度",
    High: "高",
    Medium: "中",
    Low: "低",
    Delegated: "委譲",
    Revise: "修正依頼",
    Handoff: "引き継ぎ",
    You: "あなた",
    Report: "報告",
    Goal: "目標",
    Activity: "履歴",
    Tokens: "トークン",
    "{value1} notification": "通知 {value1}件",
    "{value1} notifications": "通知 {value1}件",
  };
  for (const [key, expected] of Object.entries(labels)) {
    assert.equal(translate(key), expected, key);
    assert.equal(board(key), expected, key);
  }
  for (const name of [
    "Board",
    "Records",
    "Attention",
    "Orchestrator",
    "Plan",
    "Agents",
    "Team",
  ]) {
    assert.equal(board(name), name);
  }
});

test("空白は翻訳せず、Issue の作成者と日付は文全体を翻訳する", () => {
  const key = "{author} opened on {date}";
  const japanese = translator("ja");
  assert.equal(japanese(""), "");
  assert.equal(japanese(" "), " ");
  assert.equal(japanese(key), "{author}が{date}に作成");
  assert.equal(translator("en")(key), key);
});
