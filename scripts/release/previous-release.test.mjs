import assert from "node:assert/strict";
import { test } from "node:test";
import {
  parsePreviousArgs,
  selectPreviousRelease,
} from "./previous-release.mjs";

const mixedReleases = [
  {
    tag_name: "v0.1.124",
    draft: false,
    prerelease: false,
    published_at: "2026-11-15T12:00:00Z",
  },
  {
    tag_name: "v0.1.123",
    draft: false,
    prerelease: true,
    published_at: "2026-11-15T10:00:00Z",
  },
  {
    tag_name: "v0.1.107",
    draft: true,
    prerelease: false,
    published_at: "2026-11-14T10:00:00Z",
  },
  {
    tag_name: "appimage-sources",
    draft: false,
    prerelease: true,
    published_at: "2026-11-15T11:00:00Z",
  },
  {
    tag_name: "v0.1.106",
    draft: false,
    prerelease: false,
    published_at: "2026-11-10T10:00:00Z",
  },
  {
    tag_name: "v0.1.105",
    draft: false,
    prerelease: false,
    published_at: "2026-11-08T10:00:00Z",
  },
];

test("指定が無いときは pre-release を含む公開済みの最新を選び、現在のバージョン自身と draft は除く", () => {
  const selected = selectPreviousRelease(mixedReleases, {
    currentVersion: "0.1.124",
  });
  assert.equal(selected?.tag_name, "v0.1.123");
  assert.equal(
    selectPreviousRelease(
      [{ tag_name: "v0.1.124", draft: false, prerelease: false }],
      { currentVersion: "0.1.124" },
    ),
    undefined,
  );
});

test("stable 指定は pre-release と現在のバージョンを除いた最新の安定バージョンを選ぶ", () => {
  const selected = selectPreviousRelease(mixedReleases, {
    currentVersion: "0.1.124",
    previous: "stable",
  });
  assert.equal(selected?.tag_name, "v0.1.106");

  const withSemverPrerelease = [
    {
      tag_name: "v0.1.120-rc.1",
      draft: false,
      prerelease: false,
      published_at: "2026-11-12T00:00:00Z",
    },
    ...mixedReleases,
  ];
  assert.equal(
    selectPreviousRelease(withSemverPrerelease, {
      currentVersion: "0.1.124",
      previous: "stable",
    })?.tag_name,
    "v0.1.106",
  );

  assert.throws(
    () =>
      selectPreviousRelease(
        mixedReleases.filter((item) => item.prerelease),
        { currentVersion: "0.1.124", previous: "stable" },
      ),
    /安定バージョン/,
  );
});

test("バージョン指定はそのバージョンを返し、見つからない場合と現在のバージョン自身はエラーになる", () => {
  assert.equal(
    selectPreviousRelease(mixedReleases, {
      currentVersion: "0.1.124",
      previous: "v0.1.106",
    })?.tag_name,
    "v0.1.106",
  );
  assert.equal(
    selectPreviousRelease(mixedReleases, {
      currentVersion: "0.1.124",
      previous: "0.1.123",
    })?.tag_name,
    "v0.1.123",
  );
  assert.throws(
    () =>
      selectPreviousRelease(mixedReleases, {
        currentVersion: "0.1.124",
        previous: "v0.1.999",
      }),
    /見つかりません/,
  );
  assert.throws(
    () =>
      selectPreviousRelease(mixedReleases, {
        currentVersion: "0.1.124",
        previous: "v0.1.107",
      }),
    /見つかりません/,
  );
  assert.throws(
    () =>
      selectPreviousRelease(mixedReleases, {
        currentVersion: "0.1.124",
        previous: "v0.1.124",
      }),
    /現在のバージョン/,
  );
});

test("parsePreviousArgs は位置を問わず --previous を取り出し、不正な指定を拒否する", () => {
  assert.deepEqual(parsePreviousArgs(["/tmp/host.tar.gz"]), {
    previous: undefined,
    args: ["/tmp/host.tar.gz"],
  });
  assert.deepEqual(
    parsePreviousArgs(["--previous=stable", "/tmp/host.tar.gz"]),
    {
      previous: "stable",
      args: ["/tmp/host.tar.gz"],
    },
  );
  assert.deepEqual(
    parsePreviousArgs(["--windows", "/tmp/release", "--previous=v0.1.106"]),
    {
      previous: "v0.1.106",
      args: ["--windows", "/tmp/release"],
    },
  );
  assert.deepEqual(
    parsePreviousArgs(["--previous", "0.1.106", "/tmp/host.tar.gz"]),
    {
      previous: "v0.1.106",
      args: ["/tmp/host.tar.gz"],
    },
  );
  assert.throws(() => parsePreviousArgs(["--previous="]), /空です/);
  assert.throws(() => parsePreviousArgs(["--previous"]), /値がありません/);
  assert.throws(() => parsePreviousArgs(["--previous=vv0.1.106"]), /不正です/);
  assert.throws(
    () => parsePreviousArgs(["--previous=stable", "--previous=v0.1.106"]),
    /重複/,
  );
});
