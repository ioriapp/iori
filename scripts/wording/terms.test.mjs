import assert from "node:assert/strict";
import { test } from "node:test";
import { readFileSync } from "node:fs";
import { findTerms, readTermRules, readTerms, replaceTerms } from "./terms.mjs";

test("用語集から自動修正できる語と文脈が必要な語を分ける", () => {
  const rules = readTermRules(readFileSync("docs/design/wording.md", "utf8"));
  for (const banned of ["版", "フォルダ", "束ねる", "見本"]) {
    assert.equal(
      rules.find((rule) => rule.banned === banned)?.replaceable,
      true,
    );
  }
  for (const banned of ["窓", "印", "往復", "写す", "効く"]) {
    assert.equal(
      rules.find((rule) => rule.banned === banned)?.replaceable,
      false,
    );
  }
});

test("一致規則に従い、コードと語そのものへの言及を除いて修正する", () => {
  const rules = readTermRules(readFileSync("docs/design/wording.md", "utf8"));
  const text =
    "版とフォルダを使う。フォルダーと「版」\n`版`\n```md\n版とフォルダ\n```\n見本を束ねる";
  assert.equal(
    replaceTerms(
      text,
      rules.filter((rule) => rule.replaceable),
    ),
    "バージョンとフォルダーを使う。フォルダーと「版」\n`版`\n```md\n版とフォルダ\n```\nモックアップをまとめる",
  );
});

test("文書の用語の表から文脈を除き、区切られた語を読む", () => {
  const terms = readTerms(`## 語
| 使わない語 | 使う語 |
| --- | --- |
| 対象外 | 対象外 |
## 文書の用語
| 使わない語 | 使う語 |
| --- | --- |
| 語一（文脈）・語二 | 使う語（文脈） |
| — | 無し |
| | 空 |
| 未使用 | — |
| 未使用二 | |
## 次
| 対象外 | 対象外 |
`);
  assert.deepEqual(terms, [
    { banned: "語一", use: "使う語", replaceable: true },
    { banned: "語二", use: "使う語", replaceable: true },
  ]);
});

test("検出する動詞の活用形に一致し、使う語や引用を除く", () => {
  const terms = [
    { banned: "確かめる", use: "確認" },
    { banned: "足す", use: "追加" },
    { banned: "読む", use: "読み込む" },
  ];
  const text =
    "確かめて 確かめた 足して 足さない 読んで\n読み込む 満足 「足す」";
  assert.deepEqual(findTerms(text, terms), [
    { banned: "確かめる", use: "確認", line: 1 },
    { banned: "確かめる", use: "確認", line: 1 },
    { banned: "足す", use: "追加", line: 1 },
    { banned: "足す", use: "追加", line: 1 },
    { banned: "読む", use: "読み込む", line: 1 },
  ]);
});

test("別の行の使う語を除き、同じ位置の重複をまとめる", async () => {
  const { readHookTermRules } = await import("./terms.mjs");
  const { detections } = readHookTermRules(
    readFileSync("docs/design/wording.md", "utf8"),
  );
  assert.deepEqual(findTerms("受け入れを確認する。", detections), []);
  assert.deepEqual(findTerms("入れてください。", detections), [
    { banned: "入れる", use: "インストール", line: 1 },
  ]);
});

test("カタカナの語の直後がカタカナなら一致せず、コード内を除く", () => {
  const terms = [
    { banned: "フォルダ", use: "フォルダー" },
    { banned: "禁止", use: "許可" },
  ];
  const text =
    "フォルダー フォルダ名 禁止\n`禁止`\n```js\n禁止 フォルダ\n```\n禁止";
  assert.deepEqual(findTerms(text, terms), [
    { banned: "フォルダ", use: "フォルダー", line: 1 },
    { banned: "禁止", use: "許可", line: 1 },
    { banned: "禁止", use: "許可", line: 6 },
  ]);
});

test("漢字とカタカナの語の両端を区切り、語そのものへの言及を除く", () => {
  const terms = [
    { banned: "係", use: "デーモン" },
    { banned: "印", use: "アイコン" },
    { banned: "窓", use: "利用枠" },
    { banned: "フォルダ", use: "フォルダー" },
  ];
  const text =
    "関係 係数 矢印 印刷 5時間の窓 「係」 係の処理\nフォルダー サブフォルダ フォルダ名";
  assert.deepEqual(findTerms(text, terms), [
    { banned: "係", use: "デーモン", line: 1 },
    { banned: "窓", use: "利用枠", line: 1 },
    { banned: "フォルダ", use: "フォルダー", line: 2 },
  ]);
});

test("3つの表から自動修正と文脈判断の対象を読む", async () => {
  const { readHookTermRules } = await import("./terms.mjs");
  const rules = readHookTermRules(`## 文書の用語
| 使わない語 | 使う語 |
| --- | --- |
| 見本 | モックアップ |
| 写す | コピー・複製（対象） |
## 語
| 意味 | 使う語 | 使わない語 | 根拠 |
| --- | --- | --- | --- |
| 操作 | 削除（対象）・解除 | 外す・消す（条件） | 基準 |
| 英語 | 英語のまま（名前） | ホスト | 基準 |
| 空 | — | 除外一 | 基準 |
| 空 | | 除外二 | 基準 |
## 文書の言い回し
| 意味 | 使わない言い方 | 使う言い方 | 根拠 |
| --- | --- | --- | --- |
| 試験 | 流す・通す（条件） | 実行する | 基準 |
`);
  assert.deepEqual(
    rules.replacements.map(({ banned }) => banned),
    ["見本"],
  );
  assert.deepEqual(
    rules.detections.map(({ banned, use }) => ({ banned, use })),
    [
      { banned: "写す", use: "コピー・複製" },
      { banned: "外す", use: "削除・解除" },
      { banned: "消す", use: "削除・解除" },
      { banned: "流す", use: "実行する" },
      { banned: "通す", use: "実行する" },
    ],
  );
});
