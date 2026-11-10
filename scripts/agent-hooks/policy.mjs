// Split shell words without executing substitutions. Unknown shell syntax is ignored.
export function shellCommands(line) {
  const commands = [[]];
  let word = "";
  let active = false;
  let quote = "";
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (quote === "'") {
      if (c === "'") quote = "";
      else word += c;
    } else if (c === "\\" && quote !== "'") {
      if (++i >= line.length) return [];
      word += line[i];
      active = true;
    } else if (quote === '"') {
      if (c === '"') quote = "";
      else if (c === "$" || c === "`") return [];
      else word += c;
    } else if (c === "'" || c === '"') {
      quote = c;
      active = true;
    } else if (c === "$" || c === "`" || c === "(" || c === ")") {
      return [];
    } else if (/\s/.test(c) || ";&|<>".includes(c)) {
      if (active) commands.at(-1).push(word);
      word = "";
      active = false;
      if (";&|".includes(c)) {
        if (commands.at(-1).length) commands.push([]);
        if (line[i + 1] === c) i++;
      }
    } else {
      word += c;
      active = true;
    }
  }
  if (quote) return [];
  if (active) commands.at(-1).push(word);
  return commands.filter((command) => command.length);
}

// Keep separators outside quotes and substitutions, including redirection `2>&1`.
function segments(line) {
  const parts = [];
  let start = 0;
  let separator = "";
  let quote = "";
  const stack = [];
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (c === "\\" && quote !== "'") {
      i++;
      continue;
    }
    if (quote === "'") {
      if (c === "'") quote = "";
      continue;
    }
    if (c === "$" && line[i + 1] === "(" && quote !== "`") {
      stack.push(quote);
      quote = "";
      i++;
      continue;
    }
    if (!quote && c === "(") {
      stack.push(quote);
      continue;
    }
    if (!quote && c === ")" && stack.length) {
      quote = stack.pop();
      continue;
    }
    if (quote) {
      if (c === quote) quote = "";
      continue;
    }
    if (c === "'" || c === '"' || c === "`") {
      quote = c;
      continue;
    }
    if (stack.length) continue;
    if (
      (c === "&" && line[i - 1] === ">") ||
      (c === "&" && line[i - 1] === "<")
    )
      continue;
    if (";&|".includes(c)) {
      parts.push({ text: line.slice(start, i), separator });
      separator = line[i + 1] === c && c !== ";" ? c + c : c;
      if (separator.length === 2) i++;
      start = i + 1;
    }
  }
  parts.push({ text: line.slice(start), separator });
  return parts;
}

export function targets(line) {
  const result = { pushes: [], release: false, notes: [] };
  let ciInChain = false;
  for (const part of segments(line)) {
    if (part.separator !== "&&") ciInChain = false;
    const words = shellCommands(part.text)[0] ?? [];
    let executable = 0;
    while (/^[A-Za-z_][A-Za-z0-9_]*=/.test(words[executable] ?? ""))
      executable++;
    if (words[executable] === "env") {
      executable++;
      while (/^[A-Za-z_][A-Za-z0-9_]*=/.test(words[executable] ?? ""))
        executable++;
    }
    const isCi =
      words[executable] === "bash" &&
      /(?:^|\/)scripts\/ci\.sh$/.test(words[executable + 1] ?? "") &&
      !words.includes("--docs-only");
    const git = /(^|\/)git$/.test(words[executable] ?? "") ? executable : -1;
    if (git >= 0) {
      const push = words.indexOf("push", git + 1);
      if (
        push >= 0 &&
        !words
          .slice(push + 1)
          .some((word) => word === "--delete" || word === "-d")
      ) {
        for (const ref of words.slice(push + 1)) {
          const [source, destination] = ref.replace(/^\+/, "").split(":");
          if (
            (destination === "main" || destination === "refs/heads/main") &&
            source
          ) {
            result.pushes.push({ source, ciCovered: ciInChain });
          } else if (
            destination === undefined &&
            (source === "main" || source === "refs/heads/main")
          ) {
            result.pushes.push({ source, ciCovered: ciInChain });
          }
        }
      }
    } else if (
      !words.length &&
      /\bgit\s+push\b/.test(part.text) &&
      /(?:^|[^\w])main(?:$|[^\w])/.test(part.text)
    ) {
      const ref = part.text.match(
        /(?:^|\s)([\w./^~+-]+):(?:refs\/heads\/)?main(?=$|[^\w])/,
      );
      result.pushes.push({ source: ref?.[1] ?? "HEAD", ciCovered: ciInChain });
    }
    let script = words.find((word) =>
      /(?:^|\/)scripts\/release\/(?:build|publish|promote|notes)\.mjs$/.test(
        word,
      ),
    );
    if (!words.length)
      script = part.text.match(
        /scripts\/release\/(?:build|publish|promote|notes)\.mjs/,
      )?.[0];
    if (
      script &&
      (!words.length ||
        words[executable] === script ||
        /(^|\/)(?:node|nodejs)$/.test(words[executable] ?? ""))
    ) {
      if (!script.endsWith("/notes.mjs")) result.release = true;
      if (!script.endsWith("/build.mjs")) {
        const index = words.indexOf("--notes");
        if (index >= 0 && words[index + 1]) result.notes.push(words[index + 1]);
        else if (!words.length) {
          const note = part.text.match(/(?:^|\s)--notes\s+([^\s'"$`();&|<>]+)/);
          if (note) result.notes.push(note[1]);
        }
      }
    }
    if (isCi) ciInChain = true;
  }
  return result;
}

export function unresolved(latest, quarantine, acknowledged) {
  if (!Array.isArray(latest?.failed) || typeof latest.sha !== "string")
    return [];
  const record = acknowledged?.[latest.sha];
  const addressed =
    typeof record?.fix === "string" &&
    record.fix.trim() &&
    Array.isArray(record.scenarios)
      ? record.scenarios
      : [];
  return latest.failed.filter(
    (failure) =>
      typeof failure?.scenario === "string" &&
      !Object.hasOwn(quarantine, failure.scenario) &&
      !addressed.includes(failure.scenario),
  );
}

export function hasCiEvidence(sha, runs) {
  return runs.some(
    (run) =>
      run.sha.trim() === sha &&
      run.dirty === "" &&
      run.timing?.exit === 0 &&
      run.log.includes("Release npm and Cargo license inventories are current"),
  );
}
