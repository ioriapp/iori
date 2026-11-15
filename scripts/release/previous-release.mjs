import semver from "semver";

function normalizeVersionTag(value) {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  if (!trimmed) return undefined;
  const stripped = trimmed.startsWith("v") ? trimmed.slice(1) : trimmed;
  if (!/^\d/u.test(stripped)) return undefined;
  const parsed = semver.valid(stripped);
  return parsed ? `v${parsed}` : undefined;
}

export function normalizePreviousSpec(previous) {
  if (previous === undefined || previous === null) return undefined;
  if (typeof previous !== "string" || !previous.trim())
    throw new Error("前のバージョンの指定が空です");
  const trimmed = previous.trim();
  if (trimmed === "stable") return "stable";
  const tag = normalizeVersionTag(trimmed);
  if (!tag) throw new Error(`前のバージョンの指定が不正です: ${previous}`);
  return tag;
}

export function parsePreviousArgs(argv) {
  let previous;
  const args = [];
  for (let index = 0; index < argv.length; index++) {
    const arg = argv[index];
    if (arg === "--previous") {
      if (previous !== undefined)
        throw new Error("--previous が重複しています");
      const next = argv[index + 1];
      if (next === undefined || next.startsWith("-"))
        throw new Error("--previous の値がありません");
      previous = normalizePreviousSpec(next);
      index++;
      continue;
    }
    if (arg.startsWith("--previous=")) {
      if (previous !== undefined)
        throw new Error("--previous が重複しています");
      previous = normalizePreviousSpec(arg.slice("--previous=".length));
      continue;
    }
    args.push(arg);
  }
  return { previous, args };
}

function compareReleaseRecency(a, b) {
  const timeDiff =
    (Date.parse(b.published_at) || 0) - (Date.parse(a.published_at) || 0);
  if (timeDiff !== 0) return timeDiff;
  return semver.rcompare(a.tag_name.slice(1), b.tag_name.slice(1));
}

export function selectPreviousRelease(
  releases,
  { currentVersion, previous } = {},
) {
  const spec = normalizePreviousSpec(previous);
  const currentTag = normalizeVersionTag(currentVersion);
  const candidates = releases.filter(
    (item) =>
      item &&
      !item.draft &&
      typeof item.tag_name === "string" &&
      item.tag_name.startsWith("v") &&
      semver.valid(item.tag_name.slice(1)) !== null &&
      item.tag_name !== currentTag,
  );
  if (!spec) {
    candidates.sort(compareReleaseRecency);
    return candidates[0];
  }
  if (spec === "stable") {
    const stable = candidates.filter(
      (item) =>
        !item.prerelease && semver.prerelease(item.tag_name.slice(1)) === null,
    );
    stable.sort(compareReleaseRecency);
    if (!stable.length)
      throw new Error(
        "更新互換の確認に必要な安定バージョンの Release がありません",
      );
    return stable[0];
  }
  if (spec === currentTag)
    throw new Error(
      `前のバージョンに現在のバージョン (${currentTag}) は指定できません`,
    );
  const match = candidates.find((item) => item.tag_name === spec);
  if (!match)
    throw new Error(`指定された前の Release が見つかりません: ${spec}`);
  return match;
}
