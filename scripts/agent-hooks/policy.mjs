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

// Heredoc bodies are data, not shell commands.
function withoutHeredocBodies(line) {
  const lines = line.split("\n");
  const result = [];
  const pending = [];
  for (const text of lines) {
    if (pending.length) {
      const { delimiter, stripTabs } = pending[0];
      if ((stripTabs ? text.replace(/^\t+/, "") : text) === delimiter)
        pending.shift();
      continue;
    }
    result.push(text);
    let quote = "";
    for (let i = 0; i < text.length; i++) {
      const c = text[i];
      if (c === "\\" && quote !== "'") {
        i++;
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
      if (text.startsWith("<<<", i)) {
        i += 2;
        continue;
      }
      if (!text.startsWith("<<", i)) continue;
      const match = text
        .slice(i)
        .match(/^<<(-)?[ \t]*(?:'([^']*)'|"([^"]*)"|\\?([^\s;&|<>]+))/);
      if (!match) continue;
      pending.push({
        delimiter: match[2] ?? match[3] ?? match[4],
        stripTabs: !!match[1],
      });
      i += match[0].length - 1;
    }
  }
  return result.join("\n");
}

// Keep separators outside quotes and substitutions, including redirection `2>&1`.
function segments(line) {
  line = withoutHeredocBodies(line);
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
    if (";&|\n".includes(c)) {
      parts.push({ text: line.slice(start, i), separator });
      separator = line[i + 1] === c && (c === "&" || c === "|") ? c + c : c;
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
  let docsCiInChain = false;
  let headMayChange = false;
  for (const part of segments(line)) {
    if (part.separator !== "&&") {
      ciInChain = false;
      docsCiInChain = false;
      headMayChange = false;
    }
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
      /(?:^|\/)scripts\/ci\.sh$/.test(words[executable + 1] ?? "");
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
            result.pushes.push({
              source,
              ciCovered: ciInChain,
              ...(headMayChange ? { headMayChange: true } : {}),
              ...(docsCiInChain && !ciInChain ? { docsCiCovered: true } : {}),
            });
          } else if (
            destination === undefined &&
            (source === "main" || source === "refs/heads/main")
          ) {
            result.pushes.push({
              source,
              ciCovered: ciInChain,
              ...(headMayChange ? { headMayChange: true } : {}),
              ...(docsCiInChain && !ciInChain ? { docsCiCovered: true } : {}),
            });
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
      result.pushes.push({
        source: ref?.[1] ?? "HEAD",
        ciCovered: ciInChain,
        ...(headMayChange ? { headMayChange: true } : {}),
        ...(docsCiInChain && !ciInChain ? { docsCiCovered: true } : {}),
      });
    }
    if (git >= 0) {
      let action = git + 1;
      while ((words[action] ?? "").startsWith("-")) {
        const option = words[action++];
        if (
          [
            "-C",
            "-c",
            "--git-dir",
            "--work-tree",
            "--namespace",
            "--config-env",
          ].includes(option)
        )
          action++;
      }
      if (
        ["commit", "cherry-pick", "merge", "am", "rebase"].includes(
          words[action],
        )
      )
        headMayChange = true;
      // ci.sh checked the working tree; commits it brings in after the check
      // were never checked.
      if (["cherry-pick", "merge", "am", "rebase"].includes(words[action])) {
        ciInChain = false;
        docsCiInChain = false;
      }
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
    if (isCi) {
      if (words.includes("--docs-only")) docsCiInChain = true;
      else ciInChain = true;
    }
  }
  return result;
}

// A wait on `pgrep -f`/`pkill -f` also matches the shell that runs the wait
// (its command line contains the pattern), so the loop never ends.
export function waitsOnCommandLine(line) {
  return /\b(?:while|until)\b[^\n]*?\bp(?:grep|kill)\s+(?:-[A-Za-z]*\s+)*-[A-Za-z]*f/u.test(
    line,
  );
}
