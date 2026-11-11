const preferredTermsByRules = new WeakMap();

function readPreferredTerms(markdown) {
  return [
    ["文書の用語", "使う語"],
    ["語", "使う語"],
    ["文書の言い回し", "使う言い方"],
  ].flatMap(([heading, column]) => {
    const section =
      markdown.match(
        new RegExp(
          `^## ${heading}\\s*$([\\s\\S]*?)(?=^## |$(?![\\s\\S]))`,
          "m",
        ),
      )?.[1] ?? "";
    const rows = section.split(/\r?\n/).filter((line) => /^\s*\|/.test(line));
    const header = rows.findIndex((line) =>
      line.split("|").some((cell) => cell.trim() === column),
    );
    if (header < 0) return [];
    const index = rows[header]
      .split("|")
      .findIndex((cell) => cell.trim() === column);
    return rows.slice(header + 2).flatMap((row) =>
      (row.split("|")[index] ?? "")
        .replace(/（[^）]*）/g, "")
        .split("・")
        .map((word) => word.trim())
        .filter((word) => word && word !== "—"),
    );
  });
}

export function readTermRules(markdown) {
  const section =
    markdown.match(/^## 文書の用語\s*$([\s\S]*?)(?=^## |$(?![\s\S]))/m)?.[1] ??
    "";
  const rows = section.split(/\r?\n/).filter((line) => /^\s*\|/.test(line));
  const header = rows.findIndex(
    (line) => line.includes("使わない語") && line.includes("使う語"),
  );
  if (header < 0) return [];
  const columns = rows[header].split("|").map((cell) => cell.trim());
  const bannedIndex = columns.indexOf("使わない語");
  const useIndex = columns.indexOf("使う語");
  const clean = (cell) => (cell ?? "").replace(/（[^）]*）/g, "").trim();
  return rows.slice(header + 2).flatMap((row) => {
    const cells = row.split("|");
    const use = clean(cells[useIndex]);
    const replaceable = !/[・、]|は/.test(cells[useIndex] ?? "");
    if (!use || use === "—") return [];
    return clean(cells[bannedIndex])
      .split("・")
      .map((banned) => banned.trim())
      .filter((banned) => banned && banned !== "—")
      .map((banned) => ({ banned, use, replaceable }));
  });
}

export function readTerms(markdown) {
  const rules = readTermRules(markdown);
  preferredTermsByRules.set(rules, readPreferredTerms(markdown));
  return rules;
}

export function readHookTermRules(markdown) {
  const documentRules = readTermRules(markdown);
  const detections = documentRules.filter((rule) => !rule.replaceable);
  for (const [heading, bannedColumn, useColumn] of [
    ["語", "使わない語", "使う語"],
    ["文書の言い回し", "使わない言い方", "使う言い方"],
  ]) {
    const section =
      markdown.match(
        new RegExp(
          `^## ${heading}\\s*$([\\s\\S]*?)(?=^## |$(?![\\s\\S]))`,
          "m",
        ),
      )?.[1] ?? "";
    const rows = section.split(/\r?\n/).filter((line) => /^\s*\|/.test(line));
    const header = rows.findIndex(
      (line) => line.includes(bannedColumn) && line.includes(useColumn),
    );
    if (header < 0) continue;
    const columns = rows[header].split("|").map((cell) => cell.trim());
    const clean = (cell) => (cell ?? "").replace(/（[^）]*）/g, "").trim();
    for (const row of rows.slice(header + 2)) {
      const cells = row.split("|");
      const use = clean(cells[columns.indexOf(useColumn)]);
      if (!use || use === "—" || use === "英語のまま") continue;
      for (const banned of clean(cells[columns.indexOf(bannedColumn)]).split(
        "・",
      )) {
        if (banned.trim() && banned.trim() !== "—") {
          detections.push({ banned: banned.trim(), use });
        }
      }
    }
  }
  preferredTermsByRules.set(detections, readPreferredTerms(markdown));
  return {
    replacements: documentRules.filter((rule) => rule.replaceable),
    detections,
  };
}

function withoutCode(text) {
  const blank = (value) => value.replace(/[^\n]/g, " ");
  return text
    .replace(
      /^ {0,3}(`{3,})[^\n]*\n[\s\S]*?^ {0,3}\1\s*(?:\n|$)|^ {0,3}(`{3,})[^\n]*(?:\n[\s\S]*)?$/gm,
      blank,
    )
    .replace(/(`+)(?!`)([\s\S]*?[^`])?\1(?!`)/g, blank);
}

function sameKind(first, second) {
  return (
    (/\p{Script=Han}/u.test(first) && /\p{Script=Han}/u.test(second)) ||
    (/[\p{Script=Katakana}ー]/u.test(first) &&
      /[\p{Script=Katakana}ー]/u.test(second))
  );
}

const verbEndings = {
  う: "あいうえお",
  く: "かきくけこ",
  ぐ: "がぎぐげご",
  す: "さしすせそ",
  つ: "たちつてと",
  ぬ: "なにぬねの",
  ぶ: "ばびぶべぼ",
  む: "まみむめも",
  る: "らりるれろ",
};

function findMatches(text, terms, inflections = false) {
  const lines = withoutCode(text).split("\n");
  const preferredWords = inflections
    ? (preferredTermsByRules.get(terms) ??
      terms.flatMap(({ use }) => use.split("・")))
    : [];
  let lineStart = 0;
  return lines.flatMap((line, index) => {
    const start = lineStart;
    lineStart += line.length + 1;
    return terms.flatMap(({ banned, use, replaceable }) => {
      const matches = [];
      const characters = Array.from(banned);
      const last = characters.at(-1);
      const verb =
        inflections &&
        !replaceable &&
        verbEndings[last] &&
        characters.length > 1;
      const stem = verb ? characters.slice(0, -1).join("") : banned;
      const ichidan =
        verb &&
        last === "る" &&
        /[いきしちにひみりゐぎじぢびぴえけせてねへめれゑげぜでべぺ]/u.test(
          characters.at(-2),
        );
      let offset = 0;
      while ((offset = line.indexOf(stem, offset)) !== -1) {
        const ending = line.slice(offset + stem.length)[0] ?? "";
        const matched = !verb
          ? banned
          : ichidan
            ? stem
            : ending && (verbEndings[last] + "いっん").includes(ending)
              ? stem + ending
              : "";
        if (!matched) {
          offset += stem.length;
          continue;
        }
        const before = Array.from(line.slice(0, offset)).at(-1) ?? "";
        const after = Array.from(line.slice(offset + matched.length))[0] ?? "";
        const preferred =
          inflections &&
          (use
            .split("・")
            .some(
              (word) => word && line.startsWith(word, offset + matched.length),
            ) ||
            preferredWords.some((word) => {
              if (!word) return false;
              let position = line.indexOf(word);
              while (position !== -1 && position <= offset) {
                if (position + word.length >= offset + matched.length)
                  return true;
                position = line.indexOf(word, position + 1);
              }
              return false;
            }));
        if (
          !sameKind(characters[0], before) &&
          !sameKind(characters.at(-1), after) &&
          !(before === "「" && line.startsWith(`${banned}」`, offset)) &&
          !preferred
        ) {
          matches.push({
            banned,
            use,
            line: index + 1,
            offset: start + offset,
          });
        }
        offset += matched.length;
      }
      return matches;
    });
  });
}

export function findTerms(text, terms) {
  const seen = new Set();
  return findMatches(text, terms, true).flatMap(
    ({ banned, use, line, offset }) => {
      const key = JSON.stringify([offset, banned]);
      if (seen.has(key)) return [];
      seen.add(key);
      return [{ banned, use, line }];
    },
  );
}

export function replaceTerms(text, terms) {
  const matches = findMatches(text, terms).sort(
    (a, b) => a.offset - b.offset || b.banned.length - a.banned.length,
  );
  let result = "";
  let end = 0;
  for (const match of matches) {
    if (match.offset < end) continue;
    result += text.slice(end, match.offset) + match.use;
    end = match.offset + match.banned.length;
  }
  return result + text.slice(end);
}
