import assert from "node:assert/strict";
import { test } from "node:test";
import { targets, usesAdbDevices, waitsOnCommandLine } from "./policy.mjs";
import {
  hasCiEvidence,
  hasPublicationCiEvidence,
  isDocsOnly,
} from "../ci-evidence.mjs";

test("adb devices を拒み、ほかの adb コマンドは通す", () => {
  for (const line of [
    "adb devices",
    "/opt/android/adb -s device devices -l",
    'adb -s "$serial" devices',
    "echo ready && adb devices",
  ])
    assert.equal(usesAdbDevices(line), true, line);
  for (const line of [
    "adb -s device shell getprop",
    "adb shell echo devices",
    "echo 'adb devices'",
  ])
    assert.equal(usesAdbDevices(line), false, line);
});

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

test("pgrep -f を待ちの条件にしたコマンドを見つけ、PID の待ちは通す", () => {
  assert.equal(
    waitsOnCommandLine(
      'node build.mjs & while pgrep -f "[s]cripts/release/build.mjs" >/dev/null; do sleep 4; done',
    ),
    true,
  );
  assert.equal(
    waitsOnCommandLine(
      'until ! pgrep -af "[b]ackground-e2e.mjs"; do sleep 30; done',
    ),
    true,
  );
  assert.equal(
    waitsOnCommandLine(
      "node build.mjs & B=$!; while kill -0 $B 2>/dev/null; do sleep 3; done",
    ),
    false,
  );
  assert.equal(
    waitsOnCommandLine('pgrep -af "[b]ackground-e2e.mjs" | wc -l'),
    false,
  );
});

test("版番号だけを変えた commit は親の通常 CI の証拠を使う", () => {
  const parent = {
    sha: "parent",
    dirty: "",
    timing: { exit: 0 },
    mode: "full",
  };
  const files = ["release-version.json"];
  assert.equal(
    hasPublicationCiEvidence("release", ["parent"], files, [parent]),
    true,
  );
  assert.equal(
    hasPublicationCiEvidence(
      "release",
      ["parent"],
      [...files, "apps/host/src/host.ts"],
      [parent],
    ),
    false,
  );
  assert.equal(
    hasPublicationCiEvidence("release", ["parent"], [], [parent]),
    false,
  );
  assert.equal(
    hasPublicationCiEvidence("release", ["parent", "other"], files, [parent]),
    false,
  );
  assert.equal(
    hasPublicationCiEvidence("release", ["parent"], files, [
      { ...parent, mode: "docs-only" },
    ]),
    false,
  );
  assert.equal(
    hasPublicationCiEvidence("release", ["parent"], files, [
      { ...parent, dirty: " M file" },
    ]),
    false,
  );
  assert.equal(
    hasPublicationCiEvidence(
      "release",
      ["parent"],
      ["other"],
      [{ ...parent, sha: "release" }],
    ),
    true,
  );
});
