import { execFileSync, spawnSync } from "node:child_process";
import { readFile, readdir } from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { hasCiEvidence, targets, unresolved } from "./policy.mjs";

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
async function json(file) {
  return JSON.parse(await readFile(file, "utf8"));
}

try {
  const input = await readInput();
  if (
    input.tool_name !== "Bash" ||
    typeof input.tool_input?.command !== "string" ||
    typeof input.cwd !== "string"
  )
    process.exit(0);
  const target = targets(input.tool_input.command);
  if (!target.pushes.length && !target.release && !target.notes.length)
    process.exit(0);
  const cwd = input.cwd;
  const root = execFileSync("git", ["rev-parse", "--show-toplevel"], {
    cwd,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "ignore"],
  }).trim();
  if (target.pushes.length || target.release) {
    try {
      const base = path.join(homedir(), ".local/share/iori-background-e2e");
      const latest = await json(path.join(base, "latest.json"));
      const { quarantine } = await import(
        pathToFileURL(path.join(root, "scripts/background-e2e/config.mjs"))
      );
      let acknowledged = {};
      try {
        acknowledged = await json(path.join(base, "acknowledged.json"));
      } catch (error) {
        if (error.code !== "ENOENT") throw error;
      }
      const pending = unresolved(latest, quarantine, acknowledged);
      if (pending.length) {
        deny(
          `裏の全画面 E2E が未処置: ${pending.map((failure) => failure.scenario).join("、")}。証拠: ${latest.evidence}。隔離するか acknowledged.json に処置を記録してください。`,
        );
        process.exit(0);
      }
    } catch {
      /* Unreadable or malformed data must not block. */
    }
  }
  const unchecked = target.pushes.filter((push) => !push.ciCovered);
  if (unchecked.length) {
    try {
      const resolve = (source) =>
        execFileSync("git", ["rev-parse", "--verify", `${source}^{commit}`], {
          cwd,
          encoding: "utf8",
          stdio: ["ignore", "pipe", "ignore"],
        }).trim();
      const shas = unchecked.map(({ source }) => {
        try {
          return resolve(source);
        } catch {
          return resolve("HEAD");
        }
      });
      const evidenceDir = path.join(root, ".local/evidence/ci");
      let dirs;
      try {
        dirs = await readdir(evidenceDir);
      } catch (error) {
        if (error.code === "ENOENT") dirs = [];
        else throw error;
      }
      const runs = [];
      for (const dir of dirs.filter((name) => name.startsWith("run-"))) {
        try {
          const base = path.join(evidenceDir, dir);
          runs.push({
            sha: await readFile(path.join(base, "source-sha.txt"), "utf8"),
            dirty: await readFile(path.join(base, "source-dirty.txt"), "utf8"),
            timing: await json(path.join(base, "timing.json")),
            log: await readFile(path.join(base, "container.log"), "utf8"),
          });
        } catch {
          /* Incomplete runs are not evidence. */
        }
      }
      if (shas.some((sha) => !hasCiEvidence(sha, runs))) {
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
      if (
        !result.error &&
        result.status === 1 &&
        (result.stdout || result.stderr)
      ) {
        deny(
          `Release 本文の日本語を修正してください。\n${result.stdout}${result.stderr}`,
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
