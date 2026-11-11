import assert from "node:assert/strict";
import { test } from "node:test";
import { targets, unresolved } from "./policy.mjs";
import { hasCiEvidence, isDocsOnly } from "../ci-evidence.mjs";

test("連結されたコマンドの push・Release・本文を判定する", () => {
  assert.deepEqual(
    targets("bash scripts/ci.sh > log 2>&1 && git push origin HEAD:main"),
    {
      pushes: [{ source: "HEAD", ciCovered: true }],
      release: false,
      notes: [],
    },
  );
  assert.deepEqual(
    targets(
      "git push origin main; node scripts/release/publish.mjs --notes 'release notes.md'",
    ),
    {
      pushes: [{ source: "main", ciCovered: false }],
      release: true,
      notes: ["release notes.md"],
    },
  );
  assert.deepEqual(
    targets(
      "git push origin HEAD:other | node scripts/release/notes.mjs 1.0 --notes notes.md",
    ),
    { pushes: [], release: false, notes: ["notes.md"] },
  );
});

test("実際の連結行で CI から push まで && のみの時に証拠確認を省く", () => {
  const first =
    'bash scripts/ci.sh > .local/evidence/ci-0.1.108.log 2>&1 && git fetch -q origin && test "$(git rev-parse origin/main)" = d6a1b600259ccc551ed39c41211fabbd30abba24 && git push origin HEAD:main 2>&1 | tail -1; echo "rc=$? head=$(git rev-parse HEAD)"';
  const second =
    "git fetch -q origin && git rev-parse origin/main && git status --short && git log --oneline origin/main..HEAD && git push origin HEAD:main 2>&1 | tail -1 && git rev-parse HEAD";
  assert.deepEqual(targets(first).pushes, [
    { source: "HEAD", ciCovered: true },
  ]);
  assert.deepEqual(targets(second).pushes, [
    { source: "HEAD", ciCovered: false },
  ]);
  for (const separator of [";", "||", "|"]) {
    assert.deepEqual(
      targets(`bash scripts/ci.sh ${separator} git push origin HEAD:main`)
        .pushes,
      [{ source: "HEAD", ciCovered: false }],
    );
  }
  assert.deepEqual(
    targets(
      "bash scripts/ci.sh --docs-only > log 2>&1 && git push origin HEAD:main",
    ).pushes,
    [{ source: "HEAD", ciCovered: false, docsCiCovered: true }],
  );
  assert.equal(
    targets(
      "bash scripts/ci.sh --docs-only && git commit -am x && git push origin HEAD:main",
    ).pushes[0].headMayChange,
    true,
  );
  for (const ci of ["bash scripts/ci.sh", "bash scripts/ci.sh --docs-only"])
    assert.deepEqual(
      targets(`${ci} && git cherry-pick abc && git push origin HEAD:main`)
        .pushes,
      [{ source: "HEAD", ciCovered: false, headMayChange: true }],
    );
  assert.deepEqual(targets('git push origin "$branch":main').pushes, [
    { source: "HEAD", ciCovered: false },
  ]);
  assert.equal(
    targets('node scripts/release/publish.mjs --notes "$notes"').release,
    true,
  );
});

test("失敗のうち隔離または修正記録がある操作列を除く", () => {
  const latest = {
    sha: "abc",
    passed: 80,
    failed: [
      { scenario: "first", evidence: "/tmp/evidence", error: "error" },
      { scenario: "second" },
      { scenario: "third" },
    ],
    flaky: [],
    evidence: "/tmp/evidence",
    quarantined: [],
    total: 83,
    finishedAt: "2026-11-10",
  };
  assert.deepEqual(
    unresolved(
      latest,
      { first: "#1" },
      { abc: { scenarios: ["second"], fix: "#2" } },
    ).map((failure) => failure.scenario),
    ["third"],
  );
  assert.deepEqual(
    unresolved(latest, {}, { abc: { scenarios: ["first"], fix: "" } }).map(
      (failure) => failure.scenario,
    ),
    ["first", "second", "third"],
  );
});

test("対象 commit の証拠と送る差分から必要な CI の形を判定する", () => {
  const full = { sha: "abc\n", dirty: "", timing: { exit: 0 }, mode: "full\n" };
  const docs = { ...full, mode: "docs-only\n" };
  assert.equal(hasCiEvidence("abc", [full]), true);
  assert.equal(hasCiEvidence("def", [full]), false);
  assert.equal(hasCiEvidence("abc", [docs]), false);
  assert.equal(hasCiEvidence("abc", [docs], true), true);
  assert.equal(hasCiEvidence("abc", [full], true), true);
  assert.equal(hasCiEvidence("abc", [full, docs], true, true), false);
  assert.equal(
    hasCiEvidence(
      "abc",
      [
        { ...full, dirty: " M file\n" },
        { ...full, timing: { exit: 1 } },
        { ...full, mode: undefined },
      ],
      true,
    ),
    false,
  );
  assert.equal(isDocsOnly(true, ["README.md", "docs/product.md"]), true);
  assert.equal(isDocsOnly(true, ["README.md", "scripts/ci.sh"]), false);
  assert.equal(isDocsOnly(true, ["README.md"], ["scripts/ci.sh"]), false);
  assert.equal(isDocsOnly(true, ["README.md"], [], ["scripts/ci.sh"]), false);
  assert.equal(isDocsOnly(false, ["README.md"]), false);
  assert.equal(isDocsOnly(true, []), false);
});

test("heredoc の本文にある push はコマンドとして数えない", () => {
  assert.deepEqual(
    targets("cat > file <<'EOF'\ngit push origin HEAD:main\nEOF").pushes,
    [],
  );
});
