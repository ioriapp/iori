import { execFileSync, spawnSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { targets, waitsOnCommandLine } from "./policy.mjs";
import {
  hasCiEvidence,
  hasPublicationCiEvidence,
  isDocsOnly,
  readCiEvidence,
} from "../ci-evidence.mjs";

async function readInput() {
  let data = "";
  for await (const chunk of process.stdin) data += chunk;
  return JSON.parse(data);
}
function deny(reason) {
  console.log(
    JSON.stringify({
      hookSpecificOutput: {
        hookEventName: "PreToolUse",
        permissionDecision: "deny",
        permissionDecisionReason: reason,
      },
    }),
  );
}

try {
  const input = await readInput();
  if (
    input.tool_name !== "Bash" ||
    typeof input.tool_input?.command !== "string" ||
    typeof input.cwd !== "string"
  )
    process.exit(0);
  if (waitsOnCommandLine(input.tool_input.command)) {
    deny(
      "pgrep -f / pkill -f を待ちの条件に使っています。シェルのコマンド行の文字列にも一致して待ちが終わりません。起動したプロセスの PID（$!）を wait か kill -0 で待ってください。",
    );
    process.exit(0);
  }
  const target = targets(input.tool_input.command);
  if (!target.pushes.length && !target.release && !target.notes.length)
    process.exit(0);
  const cwd = input.cwd;
  const root = execFileSync("git", ["rev-parse", "--show-toplevel"], {
    cwd,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "ignore"],
  }).trim();
  const unchecked = target.pushes.filter((push) => !push.ciCovered);
  if (unchecked.length) {
    try {
      const resolve = (source) =>
        execFileSync("git", ["rev-parse", "--verify", `${source}^{commit}`], {
          cwd,
          encoding: "utf8",
          stdio: ["ignore", "pipe", "ignore"],
        }).trim();
      const runs = await readCiEvidence(root);
      const missing = unchecked.some(
        ({ source, docsCiCovered, headMayChange }) => {
          let sha;
          try {
            sha = resolve(source);
          } catch {
            sha = resolve("HEAD");
          }
          let docsOnly = false;
          let docsChainCovered = false;
          try {
            execFileSync(
              "git",
              ["merge-base", "--is-ancestor", "origin/main", sha],
              {
                cwd,
                stdio: "ignore",
              },
            );
            const diff = execFileSync(
              "git",
              ["diff", "--no-renames", "--name-only", "-z", "origin/main", sha],
              {
                cwd,
                encoding: "utf8",
                stdio: ["ignore", "pipe", "ignore"],
              },
            );
            const files = diff.split("\0").filter(Boolean);
            docsOnly = isDocsOnly(true, files);
            if (docsCiCovered) {
              const workingDiff = execFileSync(
                "git",
                ["diff", "--no-renames", "--name-only", "-z", "origin/main"],
                { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] },
              );
              const stagedDiff = execFileSync(
                "git",
                [
                  "diff",
                  "--cached",
                  "--no-renames",
                  "--name-only",
                  "-z",
                  "origin/main",
                ],
                { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] },
              );
              const untracked = execFileSync(
                "git",
                ["ls-files", "--others", "--exclude-standard", "-z"],
                { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] },
              );
              docsChainCovered = isDocsOnly(
                true,
                files,
                [...workingDiff.split("\0"), ...untracked.split("\0")].filter(
                  Boolean,
                ),
                stagedDiff.split("\0").filter(Boolean),
              );
            }
          } catch {
            // An unknown base is not a documentation-only change.
          }
          let releaseEvidence = false;
          if (!headMayChange) {
            try {
              const parents = execFileSync(
                "git",
                ["show", "-s", "--format=%P", sha],
                {
                  cwd,
                  encoding: "utf8",
                  stdio: ["ignore", "pipe", "ignore"],
                },
              )
                .trim()
                .split(" ")
                .filter(Boolean);
              const files =
                parents.length === 1
                  ? execFileSync(
                      "git",
                      [
                        "diff",
                        "--no-renames",
                        "--name-only",
                        "-z",
                        parents[0],
                        sha,
                      ],
                      {
                        cwd,
                        encoding: "utf8",
                        stdio: ["ignore", "pipe", "ignore"],
                      },
                    )
                      .split("\0")
                      .filter(Boolean)
                  : [];
              releaseEvidence = hasPublicationCiEvidence(
                sha,
                parents,
                files,
                runs,
              );
            } catch {
              // An unknown parent cannot supply evidence.
            }
          }
          return (
            !docsChainCovered &&
            !hasCiEvidence(sha, runs, docsOnly, headMayChange) &&
            !releaseEvidence
          );
        },
      );
      if (missing) {
        deny(
          "送る commit の成功した ci.sh の証拠がありません。作業ツリーをきれいにして bash scripts/ci.sh を実行してください。",
        );
        process.exit(0);
      }
    } catch {
      /* Unknown source or unreadable data must not block. */
    }
  }
  const lint =
    "/root/projects/iori/.local/tools/ui-wording-lint/node_modules/.bin/textlint";
  for (const notes of target.notes) {
    try {
      const contents = await readFile(path.resolve(cwd, notes), "utf8");
      const lines = contents.split(/\r?\n/);
      const start = lines.findIndex((line) =>
        /^## .+ からの変更点\s*$/.test(line),
      );
      if (start < 0) continue;
      const japanese = lines
        .slice(start + 1)
        .filter((line) => !line.startsWith("## "))
        .join("\n");
      const result = spawnSync(
        lint,
        [
          "--rule",
          "preset-smarthr",
          "--format",
          "json",
          "--stdin",
          "--stdin-filename",
          "release-notes.md",
        ],
        {
          cwd: path.dirname(path.dirname(path.dirname(lint))),
          input: japanese,
          encoding: "utf8",
        },
      );
      // The glossary (docs/design/wording.md) adopts these words from the
      // reference products, as the screen wording check does.
      const glossary = [
        "PC => パソコン",
        "フォルダー => フォルダ",
        "ウィンドウ => 画面",
        "既に",
        "初めて",
        "後で",
      ];
      const problems =
        !result.error && result.status === 1
          ? JSON.parse(result.stdout || "[]")
              .flatMap((file) => file.messages)
              .filter(
                ({ message }) =>
                  !glossary.some((word) => message.includes(word)),
              )
          : [];
      if (problems.length) {
        const lines = japanese.split("\n");
        deny(
          `Release 本文の日本語を修正してください。\n${problems
            .map(
              ({ line, message }) =>
                `${line}: ${(lines[line - 1] ?? "").trim()}: ${message.split("\n")[0]}`,
            )
            .join("\n")}`,
        );
        process.exit(0);
      }
    } catch {
      /* Missing notes or linter must not block. */
    }
  }
} catch {
  /* Invalid hook input must not block. */
}
